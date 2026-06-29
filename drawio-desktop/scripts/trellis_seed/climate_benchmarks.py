from __future__ import annotations

import hashlib
import json
import random
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from .artifacts import unique_artifact_dir
from .config import Settings
from .db import load_cities, load_methods, load_plant_allowed_categories, load_plants
from .generator import (
    _call_openai_with_retry,
    _city_identity_label,
    _city_window_context,
    _sowing_window_methods_for_crop,
    _validate_sowing_window_result,
)
from .jsonio import read_json, write_json
from .providers import OpenAIJsonClient, ProviderTrace
from .schema import CITY_CLIMATE_BANDS, OPENAI_SOWING_WINDOW_SCHEMA
from .sowing_windows import normalize_window_row, usable_crop_for_sowing_windows
from .validator import normalize_key


BENCHMARK_ARTIFACT = "climate_benchmark.json"
BENCHMARK_REFERENCES = "benchmark_references.json"


@dataclass(frozen=True)
class ClimateBenchmarkResult:
    run_dir: Path
    benchmark_path: Path
    references_path: Path


def preflight_climate_benchmark(settings: Settings) -> dict[str, Any]:
    cities_by_band = eligible_major_cities_by_band(settings)
    missing = [band for band in sorted(CITY_CLIMATE_BANDS) if not cities_by_band.get(band)]
    return {
        "ok": not missing,
        "missing_bands": missing,
        "city_counts": {band: len(cities_by_band.get(band, [])) for band in sorted(CITY_CLIMATE_BANDS)},
    }


def eligible_major_cities_by_band(settings: Settings) -> dict[str, list[dict[str, Any]]]:
    grouped = {band: [] for band in sorted(CITY_CLIMATE_BANDS)}
    for city in load_cities(settings.db_path):
        band = str(city.get("climate_band") or "").strip().casefold()
        if int(city.get("is_major_city") or 0) != 1 or band not in grouped:
            continue
        grouped[band].append(city)
    for rows in grouped.values():
        rows.sort(key=lambda row: _city_identity_label(row))
    return grouped


def benchmarked_crop_keys(runs_dir: Path) -> set[str]:
    keys: set[str] = set()
    for path in sorted(runs_dir.glob(f"*/{BENCHMARK_ARTIFACT}")):
        data = read_json(path, {}) or {}
        crop = data.get("crop") or {}
        key = normalize_key(crop.get("plant_name"))
        if key:
            keys.add(key)
    return keys


def select_benchmark_crop(settings: Settings, random_seed: str) -> dict[str, Any]:
    methods_by_id = {str(method["method_id"]): method for method in load_methods(settings.db_path)}
    covered = benchmarked_crop_keys(settings.runs_dir)
    candidates = [
        plant for plant in load_plants(settings.db_path)
        if int(plant.get("annual") or 0) == 1
        and int(plant.get("biennial") or 0) != 1
        and int(plant.get("perennial") or 0) != 1
        and normalize_key(plant.get("plant_name")) not in covered
        and usable_crop_for_sowing_windows(plant, methods_by_id)
    ]
    if not candidates:
        raise RuntimeError("No uncovered annual crops are available for climate benchmark generation.")
    rng = _rng(random_seed, "crop")
    return sorted(candidates, key=lambda row: str(row.get("plant_name") or ""))[rng.randrange(len(candidates))]


def select_benchmark_cities(settings: Settings, random_seed: str) -> dict[str, dict[str, Any]]:
    grouped = eligible_major_cities_by_band(settings)
    missing = [band for band, cities in grouped.items() if not cities]
    if missing:
        raise RuntimeError("Missing labeled major cities for climate bands: " + ", ".join(sorted(missing)))
    selected: dict[str, dict[str, Any]] = {}
    for band, cities in grouped.items():
        rng = _rng(random_seed, f"city|{band}")
        selected[band] = cities[rng.randrange(len(cities))]
    return selected


def generate_climate_benchmark(
    settings: Settings,
    openai: OpenAIJsonClient,
    *,
    random_seed: str,
) -> ClimateBenchmarkResult:
    preflight = preflight_climate_benchmark(settings)
    if not preflight["ok"]:
        raise RuntimeError("Cannot generate climate benchmark; missing labeled major cities for: " + ", ".join(preflight["missing_bands"]))

    crop = select_benchmark_crop(settings, random_seed)
    cities_by_band = select_benchmark_cities(settings, random_seed)
    methods = load_methods(settings.db_path)
    allowed_categories = load_plant_allowed_categories(settings.db_path)
    plant_methods = _sowing_window_methods_for_crop(crop, methods, allowed_categories.get(normalize_key(crop.get("plant_name")), []))
    if not plant_methods:
        raise RuntimeError(f"Selected crop has no supported benchmark methods: {crop.get('plant_name')}")

    timestamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    run_dir = unique_artifact_dir(settings.runs_dir, "climate-benchmark", timestamp, normalize_key(crop.get("plant_name")).replace(" ", "-"))
    run_dir.mkdir(parents=True, exist_ok=True)

    references, traces = _generate_reference_rows(openai, crop, cities_by_band, plant_methods)
    references_path = run_dir / BENCHMARK_REFERENCES
    benchmark_path = run_dir / BENCHMARK_ARTIFACT
    write_json(references_path, references)
    write_json(benchmark_path, {
        "benchmark_type": "annual_climate_benchmark",
        "created_at": datetime.now(timezone.utc).isoformat(),
        "random_seed": random_seed,
        "crop": _compact_crop(crop),
        "cities_by_band": {band: _compact_city(city) for band, city in cities_by_band.items()},
        "method_ids": [method["method_id"] for method in plant_methods],
        "reference_count": len(references),
        "references_path": str(references_path),
        "traces": [trace.redacted() for trace in traces],
    })
    return ClimateBenchmarkResult(run_dir=run_dir, benchmark_path=benchmark_path, references_path=references_path)


def _generate_reference_rows(
    openai: OpenAIJsonClient,
    crop: dict[str, Any],
    cities_by_band: dict[str, dict[str, Any]],
    plant_methods: list[dict[str, Any]],
) -> tuple[list[dict[str, Any]], list[ProviderTrace]]:
    cities = list(cities_by_band.values())
    crop_name = str(crop.get("plant_name") or "").strip()
    source_values = {crop_name, f"crop.name: {crop_name}", "expert estimate"}
    result, trace = _call_openai_with_retry(
        openai,
        schema_name="trellis_climate_benchmark_windows",
        json_schema=OPENAI_SOWING_WINDOW_SCHEMA,
        validator=lambda candidate: _validate_sowing_window_result(
            candidate,
            crop_name,
            source_values,
            {city["city_name"] for city in cities},
            {method["method_id"] for method in plant_methods},
        ),
        progress_label=f"climate benchmark windows: {crop_name}",
        system=(
            "You are an expert vegetable-garden extension agronomist creating independent benchmark reference windows. "
            "Return conservative, typical, yearless planting windows for one annual crop across hot, temperate, and cold major cities. "
            "These are test references, not dates copied from the Trellis scheduler. "
            "Use MM-DD dates, multiple windows when genuinely typical, and only stages 'sow' or 'transplant'."
        ),
        user=json.dumps({
            "crop": crop,
            "cities_by_climate_band": {band: _city_window_context(city) for band, city in cities_by_band.items()},
            "methods": plant_methods,
            "allowed_city_names": [city["city_name"] for city in cities],
            "allowed_method_ids": [method["method_id"] for method in plant_methods],
            "allowed_provenance_references": sorted(source_values),
            "output_rules": {
                "date_format": "MM-DD",
                "stage": ["sow", "transplant"],
                "confidence": ["low", "medium", "high"],
                "summary": "short reason, including climate/method rationale",
            },
        }, indent=2),
    )
    city_by_key = {normalize_key(city.get("city_name")): city for city in cities}
    method_by_id = {str(method["method_id"]): method for method in plant_methods}
    rows = []
    for raw in result.get("windows", []):
        row = normalize_window_row(dict(raw), crop_name)
        city = city_by_key.get(normalize_key(row.get("city_name")))
        method = method_by_id.get(str(row.get("method_id") or ""))
        rows.append({
            **row,
            "plant_name": crop_name,
            "plant": crop,
            "city": city,
            "method_category_id": method.get("method_category_id") if method else None,
            "method_name": method.get("method_name") if method else None,
        })
    return rows, [trace]


def _compact_crop(crop: dict[str, Any]) -> dict[str, Any]:
    keys = ["plant_id", "plant_name", "annual", "biennial", "perennial", "days_maturity", "gdd_to_maturity", "default_planting_method"]
    return {key: crop.get(key) for key in keys if key in crop}


def _compact_city(city: dict[str, Any]) -> dict[str, Any]:
    keys = ["city_id", "city_name", "country_name", "country_code", "region_name", "region_code", "is_major_city", "climate_band", "gdd_annual"]
    return {key: city.get(key) for key in keys if key in city}


def _rng(seed: str, scope: str) -> random.Random:
    digest = hashlib.sha256(f"{seed}|{scope}".encode("utf-8")).hexdigest()
    return random.Random(int(digest[:16], 16))
