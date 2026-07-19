from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from .artifacts import input_summary_slug, unique_artifact_dir
from .config import Settings, read_openai_api_key
from .db import load_cities, load_method_categories, load_methods, load_plant_allowed_categories, load_plants
from .jsonio import read_json, write_json
from .planner import effective_tables_from_input, selected_tables_warning
from .providers import NasaPowerClient, OpenAIJsonClient, OpenMeteoClient, ProviderError, ProviderTrace
from .schema import (
    CITY_GEO_IDENTITY_COLUMNS,
    GENERATED_TABLES,
    OPENAI_CITY_LABEL_SCHEMA,
    OPENAI_PLANT_SCHEMA,
    OPENAI_SOWING_WINDOW_SCHEMA,
    OPENAI_TEMPLATE_SCHEMA,
    PLANT_FLAG_FIELDS,
    PLANT_INTEGER_FIELDS,
    PLANT_REAL_FIELDS,
    PROVENANCE_SCHEMA,
    compact_json,
)
from .sowing_windows import normalize_window_row, select_cities_for_crop, usable_crop_for_sowing_windows
from .validator import normalize_key, source_ref_allowed, source_values_from_input, validate_input, validate_row, validate_run  # CHANGED
from .weather import forecast_rows, history_window, summarize_city_monthly_weather


TASK_RULE_ORDER = ["prep", "sow", "start", "harden", "transplant", "thin", "harvest"]
VALID_STAGES = {"SOW", "GERM", "TRANSPLANT", "HARVEST_START", "HARVEST_END"}
CONTROLLED_CROP_SOURCE_FIELDS = {
    "plant_name", "default_planting_method_category", "default_planting_method", "direct_sow", "transplant"
}

CROP_PROMPT_FIELD_GUIDE = {
    "regional_default": "Use generic temperate home-garden assumptions unless the crop input specifies a region.",  # prompt quality
    "field_completion": "Every plant row field is required; provide realistic expert estimates instead of nulls.",  # prompt quality
    "flags": "Flag fields are integers: 1 means true/allowed, 0 means false/not typical.",  # prompt quality
    "lifecycle": "Set annual, biennial, and perennial to a coherent lifecycle; normally exactly one is 1.",  # prompt quality
    "units": "Fields ending _c are Celsius, _cm centimeters, _kg kilograms, and day fields are days.",  # prompt quality
    "temperature": "Use plausible crop physiology values: killtemp_c is lethal cold tolerance, and tmin_c <= topt_low_c <= topt_high_c <= tmax_c describes growth.",  # CHANGED
    "start_cooling_threshold_c": "This is a fall/overwinter cooling trigger, not a heat-stress threshold; use 0 for normal spring/summer annual crops.",  # scheduler semantics
    "spacing": "spacing_x_cm and spacing_y_cm should describe in-row and between-row spacing when useful.",  # prompt quality
    "methods": "allowed_method_categories are broad capabilities; allowed_method_ids are concrete fixed_methods that truly fit the crop.",  # prompt quality
    "default_method": "default_planting_method must be one of allowed_method_ids and should reflect the most common reliable home-garden method.",  # prompt quality
    "varieties": "Return real named cultivars only, preferably widely available and suitable for temperate gardens.",  # prompt quality
    "provenance": "For required provenance fields, use exact strings from allowed_provenance_references only.",  # prompt quality
}

COMPANION_PROMPT_GUIDE = {
    "rating": "-1 = antagonistic, 0 = mixed/unclear/neutral, 1 = beneficial.",  # prompt quality
    "companion_type": "Use one conservative label: beneficial, antagonistic, neutral, mixed, pest, pollinator, support, nutrient, shade, or growth.",  # prompt quality
    "companion_type_id": "Use null unless the input provides an exact Trellis type id mapping.",  # prompt quality
    "evidence": "Summarize only the supplied evidence; do not infer a relationship beyond the source text.",  # prompt quality
}


@dataclass(frozen=True)
class GenerationOptions:
    generate_templates: bool = True  # template opt-in is controlled by the CLI prompt
    run_preflight: bool = True  # provider preflight is controlled by the CLI prompt
    preflight_already_run: bool = False  # avoids repeating menu preflight


def create_run(settings: Settings, input_path: Path, options: GenerationOptions | None = None) -> Path:
    options = options or GenerationOptions()
    input_data = read_json(input_path, None)
    if not isinstance(input_data, dict):
        raise ValueError(f"Input must be a JSON object: {input_path}")
    errors = validate_input(input_data)
    if errors:
        raise ValueError("Input validation failed:\n" + "\n".join(f"- {e}" for e in errors))
    normalized = normalize_input(input_data, settings)
    resume_run = _find_resume_run(settings, input_path, normalized)
    if resume_run:
        _update_run_metadata(resume_run, {"status": "running", "error": None, "resumed_at": datetime.now(timezone.utc).isoformat()})
        return resume_run

    timestamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    run_dir = unique_artifact_dir(settings.runs_dir, "run", timestamp, input_summary_slug(input_data, input_path))
    run_id = run_dir.name
    (run_dir / "generated").mkdir(parents=True, exist_ok=True)
    (run_dir / "traces").mkdir(parents=True, exist_ok=True)
    write_json(run_dir / "input.normalized.json", normalized)
    effective_tables = _effective_tables_for_options(effective_tables_from_input(normalized), options)
    metadata = {
        "run_id": run_id,
        "status": "running",
        "input_path": str(input_path),
        "created_at": datetime.now(timezone.utc).isoformat(),
        "db_path": str(settings.db_path),
        "openai_model": settings.openai_model,
        "openai_reasoning_effort": settings.openai_reasoning_effort,
        "generation_options": {
            "generate_templates": options.generate_templates,
            "run_preflight": options.run_preflight,
            "preflight_already_run": options.preflight_already_run,
        },  # run audit trail
        "effective_tables": effective_tables,
    }
    warning = selected_tables_warning(input_data, effective_tables)
    if warning:
        metadata["tables_warning"] = warning
    write_json(run_dir / "metadata.json", metadata)
    return run_dir


def _effective_tables_for_options(tables: list[str], options: GenerationOptions) -> list[str]:
    if options.generate_templates:
        return tables
    skipped = {"PlantTaskTemplates", "VarietyTaskTemplates"}
    return [table for table in tables if table not in skipped]


def normalize_input(input_data: dict[str, Any], settings: Settings) -> dict[str, Any]:
    data = dict(input_data)
    data.setdefault("tables", [])
    data.setdefault("crops", [])
    data.setdefault("cities", [])
    data.setdefault("companions", [])
    data.setdefault("sowing_windows", {})
    data.setdefault("settings", {})
    data["settings"].setdefault("variety_count", settings.data.get("default_variety_count", 5))
    data["sowing_windows"] = settings.data.get("sowing_windows", {}) | (data.get("sowing_windows") or {})
    data["effective_tables"] = effective_tables_from_input(data)
    return data


def estimate_openai_calls(input_data: dict[str, Any], settings: Settings, db_path: Path, options: GenerationOptions | None = None) -> dict[str, int]:
    options = options or GenerationOptions()
    methods = load_methods(db_path)
    categories = load_method_categories(db_path)
    crop_count = len(input_data.get("crops") or [])
    city_label_count = len(input_data.get("cities") or [])  # ADDED
    companion_count = len(input_data.get("companions") or [])
    sowing_window_count = _estimate_sowing_window_calls(input_data, settings, db_path)
    template_count = 0
    variety_override_count = 0
    for crop in input_data.get("crops", []) or []:
        if options.generate_templates:
            requested_methods = _requested_method_ids(crop, methods)
            requested_categories = crop.get("allowed_method_categories") or list(categories)
            crop_methods = [m for m in methods if m["method_id"] in requested_methods] if requested_methods else [m for m in methods if m["method_category_id"] in requested_categories]
            template_count += len(crop_methods)
            variety_override_count += len(crop.get("variety_task_overrides") or [])
    return {
        "crop_rows": crop_count,
        "city_labels": city_label_count,  # ADDED
        "companion_rows": companion_count,
        "plant_task_templates": template_count,
        "variety_task_overrides": variety_override_count,
        "sowing_window_crops": sowing_window_count,
        "estimated_total": crop_count + city_label_count + companion_count + sowing_window_count,  # CHANGED: template rows are deterministic, not OpenAI calls
    }


def preflight(settings: Settings, input_data: dict[str, Any]) -> list[ProviderTrace]:
    traces = []
    if input_data.get("crops") or input_data.get("cities") or input_data.get("companions") or (input_data.get("sowing_windows") or {}).get("enabled"):  # CHANGED
        traces.append(OpenAIJsonClient(read_openai_api_key(), settings.openai_model, settings.openai_reasoning_effort).preflight())
    if input_data.get("cities"):
        traces.append(OpenMeteoClient(settings.data["open_meteo"]).preflight())
        traces.append(NasaPowerClient(settings.data["nasa_power"]).preflight())
    return traces


def generate_run(settings: Settings, input_path: Path, options: GenerationOptions | None = None) -> Path:
    options = options or GenerationOptions()
    input_data = normalize_input(read_json(input_path, {}), settings)
    run_dir = create_run(settings, input_path, options)
    provenance: dict[str, Any] = {
        "tables": {},
        "traces": [],
        "generation_options": {
            "generate_templates": options.generate_templates,
            "run_preflight": options.run_preflight,
            "preflight_already_run": options.preflight_already_run,
        },
    }
    generated: dict[str, list[dict[str, Any]]] = _load_generated_checkpoint(run_dir)

    try:
        if options.preflight_already_run:
            print("Provider preflight checks already completed.", flush=True)
        elif options.run_preflight:
            print("Running provider preflight checks...")
            for trace in preflight(settings, input_data):
                provenance["traces"].append(trace.redacted())
        else:
            print("Skipping provider preflight checks.", flush=True)

        openai = OpenAIJsonClient(read_openai_api_key(), settings.openai_model, settings.openai_reasoning_effort)
        meteo = OpenMeteoClient(settings.data["open_meteo"])
        nasa = NasaPowerClient(settings.data["nasa_power"])
        methods = load_methods(settings.db_path)

        if input_data.get("cities"):
            _generate_cities(settings, input_data, meteo, nasa, openai, generated, provenance, run_dir)  # CHANGED
        if input_data.get("crops"):
            _generate_crops(settings, input_data, openai, methods, generated, provenance, run_dir, generate_templates=options.generate_templates)  # CHANGED
        if input_data.get("companions"):
            _generate_companions(input_data, openai, generated, provenance, run_dir)  # CHANGED
        if (input_data.get("sowing_windows") or {}).get("enabled"):
            _generate_sowing_windows(settings, input_data, openai, methods, generated, provenance, run_dir)

        _write_generated_checkpoint(run_dir, generated)
        write_json(run_dir / "provenance.json", provenance)
        validate_run(run_dir, settings.db_path)
        has_rows = any(rows for rows in generated.values())  # ADDED
        has_failures = bool(provenance.get("failures"))  # ADDED
        if has_failures and not has_rows:  # ADDED
            _update_run_metadata(run_dir, {"status": "failed", "error": "All requested generation items failed."})  # ADDED
            raise ProviderError("All requested generation items failed.")  # ADDED
        _update_run_metadata(run_dir, {"status": "complete_with_failures" if has_failures else "complete", "error": None})  # CHANGED
        return run_dir
    except Exception as exc:
        _update_run_metadata(run_dir, {"status": "failed", "error": str(exc)})
        raise


def _update_run_metadata(run_dir: Path, updates: dict[str, Any]) -> None:
    metadata = read_json(run_dir / "metadata.json", {}) or {}
    metadata.update(updates)
    write_json(run_dir / "metadata.json", metadata)


def _record_generation_failure(run_dir: Path, provenance: dict[str, Any], scope: str, label: str, exc: Exception) -> None:  # ADDED
    failure = {"scope": scope, "label": label, "error": str(exc)}  # ADDED
    provenance.setdefault("failures", {}).setdefault(scope, []).append(failure)  # ADDED
    _update_run_metadata(run_dir, {"last_failure": failure, "failure_count": _failure_count(provenance), "failures": provenance["failures"]})  # CHANGED
    print(f"Skipping {scope} {label} after generation error: {exc}", flush=True)  # ADDED


def _failure_count(provenance: dict[str, Any]) -> int:  # ADDED
    failures = provenance.get("failures") or {}  # ADDED
    return sum(len(items) for items in failures.values() if isinstance(items, list))  # ADDED


def _generated_lengths(generated: dict[str, list[dict[str, Any]]]) -> dict[str, int]:  # ADDED
    return {table: len(rows) for table, rows in generated.items()}  # ADDED


def _restore_generated_lengths(generated: dict[str, list[dict[str, Any]]], lengths: dict[str, int]) -> None:  # ADDED
    for table, original_length in lengths.items():  # ADDED
        del generated[table][original_length:]  # ADDED


def _find_resume_run(settings: Settings, input_path: Path, normalized_input: dict[str, Any]) -> Path | None:
    if not settings.runs_dir.exists():
        return None
    wanted_path = str(input_path)
    for run_dir in sorted([path for path in settings.runs_dir.iterdir() if path.is_dir() and path.name.startswith("run-")], reverse=True):
        metadata = read_json(run_dir / "metadata.json", {}) or {}
        if metadata.get("status") != "failed" or metadata.get("input_path") != wanted_path:
            continue
        if read_json(run_dir / "input.normalized.json", {}) == normalized_input:
            return run_dir
    return None


def _load_generated_checkpoint(run_dir: Path) -> dict[str, list[dict[str, Any]]]:
    generated: dict[str, list[dict[str, Any]]] = {}
    for table in GENERATED_TABLES:
        rows = read_json(run_dir / "generated" / f"{table}.json", []) or []
        generated[table] = rows if isinstance(rows, list) else []
    return generated


def _write_generated_checkpoint(run_dir: Path, generated: dict[str, list[dict[str, Any]]], tables: set[str] | None = None) -> None:
    selected = tables or set(generated)
    for table in GENERATED_TABLES:
        if table not in selected:
            continue
        rows = generated.get(table) or []
        if rows:
            write_json(run_dir / "generated" / f"{table}.json", rows)


def _generate_cities(settings: Settings, input_data: dict[str, Any], meteo: OpenMeteoClient, nasa: NasaPowerClient, openai: OpenAIJsonClient, generated: dict[str, list[dict[str, Any]]], provenance: dict[str, Any], run_dir: Path) -> None:
    _start_date, _end_date, start_year, end_year = history_window(int(settings.data.get("city_history_years", 15)))
    completed_cities = {_city_identity_key(row) for row in generated.get("Cities", [])}  # CHANGED
    completed_city_names = [normalize_key(row.get("city_name")) for row in generated.get("Cities", [])]  # ADDED
    for city in input_data.get("cities", []) or []:
        display_name = _city_display_name(city)  # CHANGED
        name = _city_storage_name(city, display_name)  # CHANGED
        input_identity = _city_identity_key(_city_input_identity_row(city, name))  # ADDED
        legacy_unique_completed = not _city_has_geography(input_identity) and completed_city_names.count(normalize_key(name)) == 1  # ADDED
        if input_identity in completed_cities or legacy_unique_completed:  # CHANGED
            print(f"Skipping city weather already checkpointed: {display_name}", flush=True)  # CHANGED
            continue
        geocode_query = str(city.get("name") or display_name).strip()  # CHANGED
        geocode_qualifiers = _city_geocode_qualifiers(city, display_name)  # CHANGED
        generated_lengths = _generated_lengths(generated)  # ADDED
        try:
            print(f"Generating city weather: {display_name}", flush=True)  # CHANGED
            print("  - Geocoding city", flush=True)
            geo, trace = meteo.geocode(geocode_query, geocode_qualifiers)
            provenance["traces"].append(trace.redacted())
            timezone_name = str(city.get("timezone") or geo.get("timezone") or "UTC")
            geo["timezone"] = timezone_name
            geo["country_name"] = str(city.get("country_name") or city.get("country") or geo.get("country") or "").strip()  # ADDED
            geo["country_code"] = str(city.get("country_code") or geo.get("country_code") or "").strip()  # ADDED
            geo["region_name"] = str(city.get("region_name") or city.get("admin1") or geo.get("admin1") or "Unspecified").strip()  # ADDED
            geo["region_code"] = str(city.get("region_code") or "").strip()  # ADDED
            print(f"  - Fetching NASA POWER monthly history: {start_year} to {end_year}", flush=True)
            monthly, trace = nasa.monthly_history(
                latitude=float(geo["latitude"]),
                longitude=float(geo["longitude"]),
                start_year=start_year,
                end_year=end_year,
            )
            provenance["traces"].append(trace.redacted())
            city_row, weather_rows, city_provenance = summarize_city_monthly_weather(
                name,
                geo,
                monthly,
                float(settings.data.get("gdd_base_c", 5)),
                str(settings.data["nasa_power"].get("dataset", "nasa-power-monthly")),
            )
            if not weather_rows:
                raise ProviderError(f"NASA POWER returned no monthly weather rows for {name}.")
            print("  - Labeling city for climate benchmark eligibility", flush=True)  # ADDED
            city_labels, trace = _label_city_for_benchmark(openai, city_row)  # ADDED
            provenance["traces"].append(trace.redacted())  # ADDED
            city_row.update(city_labels)  # ADDED
            generated["Cities"].append(city_row)
            generated["CityWeatherMonthly"].extend(weather_rows)
            print(f"  - Monthly history rows: {len(weather_rows)}", flush=True)
            print(f"  - Fetching {int(settings.data.get('forecast_days', 16))}-day forecast", flush=True)
            forecast, trace = meteo.forecast_daily(
                latitude=float(geo["latitude"]),
                longitude=float(geo["longitude"]),
                timezone=timezone_name,
                forecast_days=int(settings.data.get("forecast_days", 16)),
            )
            provenance["traces"].append(trace.redacted())
            generated["CityWeatherForecastDaily"].extend(
                forecast_rows(name, forecast, str(settings.data["open_meteo"].get("forecast_model", "best_match")), geo)  # CHANGED
            )
            print("  - City weather complete", flush=True)
            identity_label = _city_identity_label(city_row)  # ADDED
            provenance["tables"].setdefault("Cities", {})[identity_label] = city_provenance | {"history_start_year": start_year, "history_end_year": end_year}  # CHANGED
            completed_cities.add(_city_identity_key(city_row))  # CHANGED
            completed_city_names.append(normalize_key(name))  # ADDED
            _write_generated_checkpoint(run_dir, generated, {"Cities", "CityWeatherMonthly", "CityWeatherForecastDaily"})
            write_json(run_dir / "provenance.json", provenance)
        except Exception as exc:
            _restore_generated_lengths(generated, generated_lengths)  # ADDED
            _record_generation_failure(run_dir, provenance, "city", display_name, exc)  # CHANGED
            write_json(run_dir / "provenance.json", provenance)  # ADDED
            continue  # ADDED


def _label_city_for_benchmark(openai: OpenAIJsonClient, city_row: dict[str, Any]) -> tuple[dict[str, Any], ProviderTrace]:  # ADDED
    result, trace = _call_openai_with_retry(  # ADDED
        openai,  # ADDED
        schema_name="trellis_city_benchmark_label",  # ADDED
        json_schema=OPENAI_CITY_LABEL_SCHEMA,  # ADDED
        validator=_validate_city_label_result,  # ADDED
        progress_label=f"city labels: {_city_identity_label(city_row)}",  # ADDED
        system=(  # ADDED
            "You classify cities for Trellis crop-model benchmark selection. "  # ADDED
            "Return whether the city is a major city and one broad agricultural climate band. "  # ADDED
            "Use major city to mean a nationally or regionally important population center likely to have reliable weather and agronomic reference data."  # ADDED
        ),  # ADDED
        user=json.dumps({  # ADDED
            "city": _city_window_context(city_row),  # ADDED
            "rules": {  # ADDED
                "is_major_city": "1 for major city, otherwise 0",  # ADDED
                "climate_band": ["hot", "temperate", "cold"],  # ADDED
                "labels_only": True,  # ADDED
            },  # ADDED
        }, indent=2),  # ADDED
    )  # ADDED
    return {"is_major_city": int(result["is_major_city"]), "climate_band": str(result["climate_band"]).strip().casefold()}, trace  # ADDED


def _validate_city_label_result(result: dict[str, Any]) -> list[str]:  # ADDED
    report = validate_row("Cities", {  # ADDED
        "city_name": "Label Check",  # ADDED
        "country_name": "Label Country",  # ADDED
        "region_name": "Label Region",  # ADDED
        "latitude": 0,  # ADDED
        "longitude": 0,  # ADDED
        "gdd_annual": 0,  # ADDED
        "gdd_base_c": 5,  # ADDED
        "is_major_city": result.get("is_major_city"),  # ADDED
        "climate_band": result.get("climate_band"),  # ADDED
    })  # ADDED
    return report["errors"]  # ADDED


def _city_display_name(city: dict[str, Any]) -> str:
    explicit_name = str(city.get("name") or "").strip()
    if explicit_name:
        return explicit_name
    parts = [str(city.get(field) or "").strip() for field in ("city_name", "admin1", "country")]
    return ", ".join(part for part in parts if part)


def _city_storage_name(city: dict[str, Any], display_name: str) -> str:  # ADDED
    explicit_city = str(city.get("city_name") or "").strip()  # ADDED
    if explicit_city:  # ADDED
        return explicit_city  # ADDED
    return str(display_name or "").split(",", 1)[0].strip()  # ADDED


def _city_input_identity_row(city: dict[str, Any], city_name: str) -> dict[str, Any]:  # ADDED
    return {  # ADDED
        "city_name": city_name,  # ADDED
        "country_name": city.get("country_name") or city.get("country"),  # ADDED
        "country_code": city.get("country_code"),  # ADDED
        "region_name": city.get("region_name") or city.get("admin1"),  # ADDED
        "region_code": city.get("region_code"),  # ADDED
    }  # ADDED


def _city_identity_key(city: dict[str, Any]) -> tuple[str, str, str]:  # ADDED
    return (  # ADDED
        normalize_key(city.get("city_name")),  # ADDED
        normalize_key(city.get("country_code")) or normalize_key(city.get("country_name")),  # CHANGED
        normalize_key(city.get("region_name")) or normalize_key(city.get("region_code")),  # CHANGED
    )  # ADDED


def _city_has_geography(identity: tuple[str, str, str]) -> bool:  # ADDED
    return any(identity[1:])  # ADDED


def _city_identity_label(city: dict[str, Any]) -> str:  # ADDED
    name = str(city.get("city_name") or "").strip()  # ADDED
    country = str(city.get("country_name") or city.get("country_code") or "").strip()  # ADDED
    region = str(city.get("region_name") or city.get("region_code") or "").strip()  # ADDED
    return " / ".join(part for part in (name, country, region) if part) or name  # ADDED


def _city_geography_fields(city: dict[str, Any]) -> dict[str, Any]:  # ADDED
    return {field: city.get(field) for field in CITY_GEO_IDENTITY_COLUMNS if city.get(field) not in (None, "")}  # ADDED


def _city_geocode_qualifiers(city: dict[str, Any], display_name: str) -> dict[str, str]:
    return {
        "display_name": display_name,
        "admin1": str(city.get("admin1") or "").strip(),
        "country": str(city.get("country") or "").strip(),
        "country_code": str(city.get("country_code") or "").strip(),
    }


def _generate_crops(settings: Settings, input_data: dict[str, Any], openai: OpenAIJsonClient, methods: list[dict[str, Any]], generated: dict[str, list[dict[str, Any]]], provenance: dict[str, Any], run_dir: Path, generate_templates: bool) -> None:  # CHANGED
    default_variety_count = int(input_data.get("settings", {}).get("variety_count", settings.data.get("default_variety_count", 5)))
    crops = input_data.get("crops", []) or []
    for crop_index, crop in enumerate(crops, 1):
        name = str(crop.get("plant_name") or crop.get("name")).strip()
        generated_lengths = _generated_lengths(generated)  # ADDED
        try:  # ADDED
            _generate_one_crop(settings, crop, crop_index, len(crops), default_variety_count, openai, methods, generated, provenance, generate_templates)  # ADDED
        except Exception as exc:  # ADDED
            _restore_generated_lengths(generated, generated_lengths)  # ADDED
            _record_generation_failure(run_dir, provenance, "crop", name, exc)  # CHANGED
            write_json(run_dir / "provenance.json", provenance)  # ADDED
            continue  # ADDED


def _generate_one_crop(settings: Settings, crop: dict[str, Any], crop_index: int, crop_count: int, default_variety_count: int, openai: OpenAIJsonClient, methods: list[dict[str, Any]], generated: dict[str, list[dict[str, Any]]], provenance: dict[str, Any], generate_templates: bool) -> None:  # ADDED
        name = str(crop.get("plant_name") or crop.get("name")).strip()
        requested_varieties = int(crop.get("variety_count") or default_variety_count)
        print(f"Generating crop {crop_index}/{crop_count}: {name}", flush=True)
        source_values = _crop_source_values(crop, methods)
        print(f"  - Source/provenance references available: {len(source_values)}", flush=True)
        print(f"  - Requested varieties: {requested_varieties}", flush=True)
        result, trace = _call_openai_with_retry(
            openai,
            schema_name="trellis_crop_row",
            json_schema=OPENAI_PLANT_SCHEMA,
            validator=lambda candidate: _validate_crop_result(_prepare_crop_result(candidate, crop, methods), source_values, methods),
            progress_label=f"crop row: {name}",
            system=(
                "You are a professional horticultural agronomist creating complete database seed rows. "
                "Create agronomically realistic data for a temperate home garden unless the input specifies a region. "
                "Use supplied sources/notes first; when they are broad or incomplete, use expert horticultural estimates to complete every field. "
                "Never return nulls or empty strings for plant row fields; use concise 'N/A' only for text fields that truly do not apply. "
                "Numeric and integer fields must be in the requested units, never text. "
                "Lifecycle flags must be coherent, method flags must match allowed planting methods, and default_planting_method must be a concrete allowed method. "
                "Return real named cultivars/varieties only; never placeholders such as '<crop> variety 1', 'generic', 'standard', or crop-name-only varieties. "
                "Set variety.maturity_class only when a supplied variety source explicitly supports early, mid, or late maturity; otherwise return an empty string. "  # ADDED
                "Do not include planting methods (such as propagation-by-cutting) unless the crop is normally grown using the method. "
                "provenance.field_sources must cite exact supplied strings from allowed_provenance_references for required provenance fields; do not cite invented estimate labels."
            ),
            user=json.dumps({
                "crop": crop,
                "trellis_field_guide": CROP_PROMPT_FIELD_GUIDE,  # prompt quality
                "fixed_method_categories": sorted({m["method_category_id"] for m in methods}),
                "fixed_methods": methods,
                "default_variety_count": requested_varieties,
                "allowed_provenance_references": sorted(source_values),
            }, indent=2),
        )
        provenance["traces"].append(trace.redacted())
        result = _prepare_crop_result(result, crop, methods)
        row = dict(result["row"])
        row["plant_name"] = row.get("plant_name") or name
        row["provenance"] = result.get("provenance") or {}
        generated["Plants"].append(row)
        allowed_categories = result.get("allowed_method_categories") or crop.get("allowed_method_categories") or []
        allowed_method_ids = _resolved_allowed_method_ids(result, crop, methods)
        print(f"  - Crop row accepted: {row['plant_name']}", flush=True)
        print(f"  - Allowed method categories: {', '.join(map(str, allowed_categories)) or '[none]'}", flush=True)
        print(f"  - Allowed planting methods: {', '.join(allowed_method_ids) or '[none]'}", flush=True)
        for category in allowed_categories:
            generated["PlantAllowedMethodCategories"].append({"plant_name": row["plant_name"], "method_category_id": category})
        varieties = result.get("varieties", [])[:requested_varieties]
        print(f"  - Varieties generated: {len(varieties)}", flush=True)
        for variety in varieties:
            variety_row = {  # CHANGED
                "plant_name": row["plant_name"],
                "variety_name": variety["variety_name"],
                "overrides": _override_pairs_to_dict(variety.get("overrides") or {}),
            }  # CHANGED
            maturity_class = str(variety.get("maturity_class") or "").strip().casefold()  # ADDED
            if maturity_class and _has_explicit_variety_sources(variety):  # CHANGED
                variety_row["maturity_class"] = maturity_class  # ADDED
            generated["PlantVarieties"].append(variety_row)  # CHANGED
        crop_methods = [m for m in methods if m["method_id"] in set(allowed_method_ids)]
        if not generate_templates:
            print("  - Plant task templates skipped; scheduler defaults will be used", flush=True)  # template opt-in
            if crop.get("variety_task_overrides"):
                print("  - Variety task overrides skipped because template generation is disabled", flush=True)
            provenance["tables"].setdefault("Plants", {})[row["plant_name"]] = result.get("provenance") or {}
            print(f"Finished crop {crop_index}/{crop_count}: {row['plant_name']}", flush=True)
            return
        print(f"  - Plant task templates to generate: {len(crop_methods)}", flush=True)
        for method_index, method in enumerate(crop_methods, 1):
            print(f"    * Template {method_index}/{len(crop_methods)}: {method['method_id']}", flush=True)
            template = build_task_template_from_method(method)  # deterministic template generation
            generated["PlantTaskTemplates"].append({
                "plant_name": row["plant_name"],
                "method_id": method["method_id"],
                "template_json": compact_json({"version": 2, "rules": template["rules"]}),
            })
        overrides = crop.get("variety_task_overrides", []) or []
        print(f"  - Variety task overrides to generate: {len(overrides)}", flush=True)
        for override_index, override in enumerate(overrides, 1):
            method = next((m for m in methods if m["method_id"] == override.get("method_id")), None)
            if not method:
                print(f"    * Override {override_index}/{len(overrides)} skipped: unknown method {override.get('method_id')}", flush=True)
                continue
            print(f"    * Override {override_index}/{len(overrides)}: {override.get('variety_name')} / {override.get('method_id')}", flush=True)
            template = build_task_template_from_method(method)  # deterministic template generation
            generated["VarietyTaskTemplates"].append({
                "plant_name": row["plant_name"],
                "variety_name": override["variety_name"],
                "method_id": override["method_id"],
                "template_json": compact_json({"version": 2, "rules": template["rules"]}),
            })
        provenance["tables"].setdefault("Plants", {})[row["plant_name"]] = result.get("provenance") or {}
        print(f"Finished crop {crop_index}/{crop_count}: {row['plant_name']}", flush=True)


def _generate_task_template(openai: OpenAIJsonClient, plant_row: dict[str, Any], method: dict[str, Any], crop_input: dict[str, Any], progress_label: str) -> tuple[dict[str, Any], ProviderTrace]:
    source_values = _crop_source_values(crop_input, [method])
    skeleton = build_task_template_from_method(method)
    result, trace = _call_openai_with_retry(
        openai,
        schema_name="trellis_task_template",
        json_schema=OPENAI_TEMPLATE_SCHEMA,
        validator=lambda candidate: _validate_template_polish(candidate, source_values, skeleton),
        progress_label=progress_label,
        system="Polish a Trellis scheduler task template. Keep every rule id exactly as supplied. You may modify any non-id field. Use version 2 and strict JSON. Use only supported anchor stages: SOW, GERM, TRANSPLANT, HARVEST_START, HARVEST_END.",
        user=json.dumps({
            "plant_row": plant_row,
            "method": method,
            "deterministic_template": skeleton,
            "source_backed_crop_input": crop_input,
            "allowed_provenance_references": sorted(source_values),
        }, indent=2),
    )
    return _merge_template_polish(skeleton, result), trace


def _generate_companions(input_data: dict[str, Any], openai: OpenAIJsonClient, generated: dict[str, list[dict[str, Any]]], provenance: dict[str, Any], run_dir: Path) -> None:  # CHANGED
    for item in input_data.get("companions", []) or []:
        p1 = str(item["p1"]).strip()
        p2 = str(item["p2"]).strip()
        label = f"{p1} / {p2}"  # ADDED
        generated_lengths = _generated_lengths(generated)  # ADDED
        try:  # ADDED
            print(f"Generating companion evidence: {p1} / {p2}")
            source_values = source_values_from_input(item)
            result, trace = _call_openai_with_retry(
                openai,
                schema_name="trellis_companion",
                json_schema={
                    "type": "object",
                    "additionalProperties": False,
                    "properties": {
                        "companion": {
                            "type": "object",
                            "additionalProperties": False,
                            "properties": {
                                "p1": {"type": "string"},
                                "p2": {"type": "string"},
                                "rating": {"type": "integer"},
                                "companion_type": {"type": "string"},
                                "companion_type_id": {"type": ["integer", "null"]},
                            },
                            "required": ["p1", "p2", "rating", "companion_type", "companion_type_id"],
                        },
                        "evidence": {
                            "type": "object",
                            "additionalProperties": False,
                            "properties": {
                                "evidence_level": {"type": "string"},
                                "review_status": {"type": "string"},
                                "source_url": {"type": ["string", "null"]},
                                "source_note": {"type": ["string", "null"]},
                                "summary": {"type": "string"},
                            },
                            "required": ["evidence_level", "review_status", "source_url", "source_note", "summary"],
                        },
                        "provenance": PROVENANCE_SCHEMA,
                    },
                    "required": ["companion", "evidence", "provenance"],
                },
                validator=lambda candidate: _validate_companion_result(candidate, source_values),
                system=(
                    "Convert source-backed companion planting evidence into companion rows. "
                    "Do not invent unsupported relationships or upgrade weak evidence into a stronger claim. "
                    "Use rating -1 for antagonistic, 0 for mixed/unclear/neutral, and 1 for beneficial. "
                    "Use conservative normalized companion_type labels and keep companion_type_id null unless an exact mapping is supplied. "
                    "evidence.summary must be specific, reviewable, and grounded in the supplied source URL or note. "
                    "provenance.field_sources must include a summary entry using an exact supplied source string."
                ),
                user=json.dumps({"companion_input": item, "trellis_relationship_guide": COMPANION_PROMPT_GUIDE}, indent=2),  # prompt quality
            )
            provenance["traces"].append(trace.redacted())
            companion = result["companion"]
            evidence = result["evidence"]
            generated["Companions"].append(companion)
            generated["CompanionEvidence"].append({"p1": companion["p1"], "p2": companion["p2"], **evidence})
        except Exception as exc:  # ADDED
            _restore_generated_lengths(generated, generated_lengths)  # ADDED
            _record_generation_failure(run_dir, provenance, "companion", label, exc)  # ADDED
            write_json(run_dir / "provenance.json", provenance)  # ADDED
            continue  # ADDED


def _generate_sowing_windows(
    settings: Settings,
    input_data: dict[str, Any],
    openai: OpenAIJsonClient,
    methods: list[dict[str, Any]],
    generated: dict[str, list[dict[str, Any]]],
    provenance: dict[str, Any],
    run_dir: Path,
) -> None:
    config = _sowing_window_config(input_data, settings)
    methods_by_id = {str(method["method_id"]): method for method in methods}
    plants = _sowing_window_plants(settings, generated, methods_by_id, config)
    cities = _sowing_window_cities(settings, generated, config)
    allowed_categories = load_plant_allowed_categories(settings.db_path)
    allowed_categories.update(_generated_allowed_categories(generated))
    completed = {
        _sowing_window_identity_key(row)  # CHANGED
        for row in generated.get("PlantingWindowReferences", [])
    }
    print(f"Generating sowing-window references for {len(plants)} crop(s)", flush=True)
    for index, plant in enumerate(plants, 1):
        plant_name = str(plant.get("plant_name") or "").strip()
        plant_methods = _sowing_window_methods_for_crop(plant, methods, allowed_categories.get(normalize_key(plant_name), []))
        if not plant_methods:
            print(f"  - Skipping {plant_name}: no supported planting methods", flush=True)
            continue
        selected_cities = select_cities_for_crop(
            plant_name,
            cities,
            int(config.get("cities_per_crop") or 5),
            str(config.get("random_seed") or "trellis-sowing-windows"),
            config.get("city_overrides_by_crop") or {},
        )
        if not selected_cities:
            print(f"  - Skipping {plant_name}: no cities selected", flush=True)
            continue
        print(f"  - Sowing windows {index}/{len(plants)}: {plant_name} across {len(selected_cities)} city/cities", flush=True)
        generated_lengths = _generated_lengths(generated)  # ADDED
        try:  # ADDED
            source_values = _sowing_window_source_values(input_data, plant_name)
            result, trace = _call_openai_with_retry(
                openai,
                schema_name="trellis_sowing_windows",
                json_schema=OPENAI_SOWING_WINDOW_SCHEMA,
                validator=lambda candidate, p=plant_name, sv=source_values, ac={city["city_name"] for city in selected_cities}, am={method["method_id"] for method in plant_methods}: _validate_sowing_window_result(candidate, p, sv, ac, am),
                progress_label=f"sowing windows: {plant_name}",
                system=(
                    "You are an expert vegetable-garden extension agronomist creating QA reference sowing windows. "
                    "Return conservative, typical, yearless planting windows for the supplied crop, cities, and planting methods. "
                    "These are independent reference windows, not dates copied from a scheduler model. "
                    "Use MM-DD dates, multiple windows when genuinely typical, and only stages 'sow' or 'transplant'. "
                    "Use supplied source URLs/notes when available; otherwise provide a concise source_note naming this as an expert estimate."
                ),
                user=json.dumps({
                    "crop": plant,
                    "cities": [_city_window_context(city) for city in selected_cities],
                    "methods": plant_methods,
                    "allowed_city_names": [city["city_name"] for city in selected_cities],
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
            provenance["traces"].append(trace.redacted())
            city_by_name = _unique_cities_by_name(selected_cities)  # ADDED
            rows = [_attach_window_city_geography(normalize_window_row(row, plant_name), city_by_name) for row in result.get("windows", [])]  # CHANGED
            for row in rows:
                key = _sowing_window_identity_key(row)  # CHANGED
                if key in completed:
                    continue
                generated["PlantingWindowReferences"].append(row)
                completed.add(key)
            provenance["tables"].setdefault("PlantingWindowReferences", {})[plant_name] = {"cities": [_city_identity_label(city) for city in selected_cities]}  # CHANGED
            _write_generated_checkpoint(run_dir, generated, {"PlantingWindowReferences"})
            write_json(run_dir / "provenance.json", provenance)
        except Exception as exc:  # ADDED
            _restore_generated_lengths(generated, generated_lengths)  # ADDED
            _record_generation_failure(run_dir, provenance, "sowing_window", plant_name, exc)  # ADDED
            write_json(run_dir / "provenance.json", provenance)  # ADDED
            continue  # ADDED


def _sowing_window_config(input_data: dict[str, Any], settings: Settings) -> dict[str, Any]:
    return (settings.data.get("sowing_windows") or {}) | (input_data.get("sowing_windows") or {})


def _estimate_sowing_window_calls(input_data: dict[str, Any], settings: Settings, db_path: Path) -> int:
    config = _sowing_window_config(input_data, settings)
    if not config.get("enabled"):
        return 0
    methods_by_id = {str(method["method_id"]): method for method in load_methods(db_path)}
    allow = {normalize_key(name) for name in (config.get("crop_allowlist") or [])}
    plants = [
        plant for plant in load_plants(db_path)
        if (not allow or normalize_key(plant.get("plant_name")) in allow)
        and usable_crop_for_sowing_windows(plant, methods_by_id)
    ]
    return len(plants)


def _sowing_window_plants(settings: Settings, generated: dict[str, list[dict[str, Any]]], methods_by_id: dict[str, dict[str, Any]], config: dict[str, Any]) -> list[dict[str, Any]]:
    plants = load_plants(settings.db_path) + list(generated.get("Plants", []))
    allow = {normalize_key(name) for name in (config.get("crop_allowlist") or [])}
    out = []
    seen = set()
    for plant in plants:
        name = str(plant.get("plant_name") or "")
        key = normalize_key(name)
        if key in seen:
            continue
        if allow and normalize_key(name) not in allow:  # CHANGED
            continue
        if not usable_crop_for_sowing_windows(plant, methods_by_id):
            continue
        out.append(plant)
        seen.add(key)
    return out


def _sowing_window_cities(settings: Settings, generated: dict[str, list[dict[str, Any]]], config: dict[str, Any]) -> list[dict[str, Any]]:
    cities = load_cities(settings.db_path) + list(generated.get("Cities", []))
    allow = {normalize_key(name) for name in (config.get("city_allowlist") or [])}
    out = []
    seen = set()
    for city in cities:
        name = str(city.get("city_name") or "")
        key = _city_identity_key(city)  # CHANGED
        if key in seen:
            continue
        if allow and key not in allow:
            continue
        out.append(city)
        seen.add(key)
    return out


def _generated_allowed_categories(generated: dict[str, list[dict[str, Any]]]) -> dict[str, list[str]]:
    grouped: dict[str, list[str]] = {}
    for row in generated.get("PlantAllowedMethodCategories", []):
        grouped.setdefault(normalize_key(row.get("plant_name")), []).append(str(row.get("method_category_id")))
    return grouped


def _sowing_window_methods_for_crop(plant: dict[str, Any], methods: list[dict[str, Any]], categories: list[str]) -> list[dict[str, Any]]:
    method_by_id = {str(method["method_id"]): method for method in methods}
    selected: list[dict[str, Any]] = []
    default_method = str(plant.get("default_planting_method") or "").strip()
    if default_method in method_by_id:
        selected.append(method_by_id[default_method])
    category_set = set(categories)
    if int(plant.get("direct_sow") or 0):
        category_set.add("direct_sow")
    if int(plant.get("transplant") or 0):
        category_set.add("transplant")
    for method in methods:
        if method.get("method_category_id") in category_set and method not in selected:
            selected.append(method)
    return selected[:4]


def _city_window_context(city: dict[str, Any]) -> dict[str, Any]:
    return {
        "city_name": city.get("city_name"),
        **_city_geography_fields(city),  # ADDED
        "gdd_annual": city.get("gdd_annual"),
        "gdd_base_c": city.get("gdd_base_c"),
        "last_spring_frost_p50_doy": city.get("last_spring_frost_p50_doy") or city.get("last_spring_frost_doy"),
        "first_fall_frost_p50_doy": city.get("first_fall_frost_p50_doy") or city.get("first_fall_frost_doy"),
        "monthly_mean_c": {
            str(month): _monthly_mean(city, month)
            for month in range(1, 13)
            if _monthly_mean(city, month) is not None
        },
    }


def _unique_cities_by_name(cities: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:  # ADDED
    grouped: dict[str, list[dict[str, Any]]] = {}  # ADDED
    for city in cities:  # ADDED
        grouped.setdefault(normalize_key(city.get("city_name")), []).append(city)  # ADDED
    return {key: rows[0] for key, rows in grouped.items() if len(rows) == 1}  # ADDED


def _attach_window_city_geography(row: dict[str, Any], city_by_name: dict[str, dict[str, Any]]) -> dict[str, Any]:  # ADDED
    city = city_by_name.get(normalize_key(row.get("city_name")))  # ADDED
    if city:  # ADDED
        row.update(_city_geography_fields(city))  # ADDED
    return row  # ADDED


def _sowing_window_identity_key(row: dict[str, Any]) -> tuple[Any, ...]:  # ADDED
    return (  # ADDED
        normalize_key(row.get("plant_name")),  # ADDED
        *_city_identity_key(row),  # ADDED
        str(row.get("method_id")),  # ADDED
        str(row.get("stage")),  # ADDED
        str(row.get("window_label")),  # ADDED
    )  # ADDED


def _monthly_mean(city: dict[str, Any], month: int) -> float | None:
    low = city.get(f"avg_monthly_low_c{month}")
    high = city.get(f"avg_monthly_high_c{month}")
    if low is None or high is None:
        return None
    return (float(low) + float(high)) / 2


def _sowing_window_source_values(input_data: dict[str, Any], plant_name: str) -> set[str]:
    values = {plant_name, f"crop.name: {plant_name}", "expert estimate"}
    for crop in input_data.get("crops", []) or []:
        if normalize_key(crop.get("name") or crop.get("plant_name")) == normalize_key(plant_name):
            values.update(source_values_from_input(crop))
    notes = str((input_data.get("sowing_windows") or {}).get("notes") or "").strip()
    if notes:
        values.add(notes)
    return values


def _validate_sowing_window_result(result: dict[str, Any], plant_name: str, source_values: set[str], allowed_cities: set[str] | None = None, allowed_methods: set[str] | None = None) -> list[str]:
    errors: list[str] = []
    allowed_city_keys = {normalize_key(city) for city in (allowed_cities or set())}
    allowed_method_ids = {str(method) for method in (allowed_methods or set())}
    windows = result.get("windows")
    if not isinstance(windows, list) or not windows:
        return ["windows must be a non-empty list."]
    for index, raw in enumerate(windows):
        row = normalize_window_row(dict(raw or {}), plant_name)
        report = validate_row("PlantingWindowReferences", row)
        errors.extend(f"windows[{index}].{error}" for error in report["errors"])
        if allowed_city_keys and normalize_key(row.get("city_name")) not in allowed_city_keys:
            errors.append(f"windows[{index}].city_name is outside selected cities: {row.get('city_name')}")
        if allowed_method_ids and str(row.get("method_id")) not in allowed_method_ids:
            errors.append(f"windows[{index}].method_id is outside selected methods: {row.get('method_id')}")
        if row.get("source_url") is None and row.get("source_note") not in source_values and not str(row.get("source_note") or "").strip():
            errors.append(f"windows[{index}] needs a supplied source or explicit estimate note.")
    return errors


def _call_openai_with_retry(openai: OpenAIJsonClient, validator=None, **kwargs: Any) -> tuple[dict[str, Any], ProviderTrace]:
    progress_label = kwargs.pop("progress_label", None)
    repair_reason = None
    try:
        _print_openai_progress(openai, progress_label, str(kwargs.get("schema_name")), attempt=1, status="requesting")
        result, trace = openai.generate_json(**kwargs)
        _print_openai_progress(openai, progress_label, str(kwargs.get("schema_name")), attempt=1, status="received")
        errors = validator(result) if validator else []
        if not errors:
            _print_openai_progress(openai, progress_label, str(kwargs.get("schema_name")), attempt=1, status="validation ok")
            return result, trace
        _print_openai_progress(openai, progress_label, str(kwargs.get("schema_name")), attempt=1, status=f"validation failed ({len(errors)} issue(s))")
        _print_openai_errors(progress_label, errors)
        repair_reason = "The previous attempt failed row validation with these errors:\n" + "\n".join(f"- {e}" for e in errors)
    except ProviderError as first_error:
        _print_openai_progress(openai, progress_label, str(kwargs.get("schema_name")), attempt=1, status=f"provider failed: {first_error}")
        repair_reason = "The previous attempt failed parsing/provider validation with this error:\n" + str(first_error)
    repair_user = kwargs["user"] + "\n\n" + str(repair_reason)
    _print_openai_progress(openai, progress_label, str(kwargs.get("schema_name")), attempt=2, status="requesting repair")
    repaired, repair_trace = openai.generate_json(**(kwargs | {"user": repair_user}))
    _print_openai_progress(openai, progress_label, str(kwargs.get("schema_name")), attempt=2, status="received repair")
    repaired_errors = validator(repaired) if validator else []
    if repaired_errors:
        _print_openai_progress(openai, progress_label, str(kwargs.get("schema_name")), attempt=2, status=f"repair validation failed ({len(repaired_errors)} issue(s))")
        _print_openai_errors(progress_label, repaired_errors)
        raise ProviderError("OpenAI repair output failed validation:\n" + "\n".join(repaired_errors))
    _print_openai_progress(openai, progress_label, str(kwargs.get("schema_name")), attempt=2, status="repair validation ok")
    repair_trace.request["repair_for"] = repair_reason
    return repaired, repair_trace


def _print_openai_progress(openai: OpenAIJsonClient, label: str, schema_name: str, *, attempt: int, status: str) -> None:
    if not label:
        return
    print(
        f"    [OpenAI] {label} | schema={schema_name} | model={getattr(openai, 'model', 'unknown')} | "
        f"effort={getattr(openai, 'reasoning_effort', 'unknown')} | attempt={attempt} | {status}",
        flush=True,
    )


def _print_openai_errors(label: str | None, errors: list[str]) -> None:
    if not label:
        return
    for error in errors[:5]:
        print(f"      - {error}", flush=True)
    if len(errors) > 5:
        print(f"      - ... {len(errors) - 5} more", flush=True)


def _override_pairs_to_dict(value: Any) -> dict[str, Any]:
    if isinstance(value, dict):
        return value
    if not isinstance(value, list):
        return {}
    result: dict[str, Any] = {}
    for item in value:
        if not isinstance(item, dict):
            continue
        field = str(item.get("field") or "").strip()
        if field:
            result[field] = item.get("value")
    return result


def build_task_template_from_method(method: dict[str, Any]) -> dict[str, Any]:
    planning_mode = "direct_sow" if method.get("method_category_id") == "direct_sow" else "transplant"
    library = _task_rule_library(planning_mode)
    required = _safe_json_obj(method.get("tasks_required_json"))
    rules: list[dict[str, Any]] = []
    for rule_id in TASK_RULE_ORDER:
        if rule_id == "harvest":
            override = required.get("harvest") if isinstance(required.get("harvest"), dict) else None
            rules.append(_apply_rule_override(library["harvest"], override))
            continue
        req = required.get(rule_id)
        if not req or rule_id not in library:
            continue
        override = req if isinstance(req, dict) else None
        rules.append(_apply_rule_override(library[rule_id], override))
    return {"version": 2, "rules": rules, "provenance": _method_rule_provenance(method)}


def _task_rule_library(planning_mode: str) -> dict[str, dict[str, Any]]:
    prep_anchor = "SOW" if planning_mode == "direct_sow" else "TRANSPLANT"
    return {
        "prep": _base_rule("prep", "Prep bed - {plant}", prep_anchor, 3, "before", "fixed_days", 3),
        "sow": _base_rule("sow", "Sow - {plant}", "SOW", 0, "after", "fixed_days", 7),
        "start": _base_rule("start", "Start indoors - {plant}", "SOW", 0, "after", "fixed_days", 0),
        "harden": _base_rule("harden", "Harden off - {plant}", "TRANSPLANT", 7, "before", "fixed_days", 7),
        "transplant": _base_rule("transplant", "Transplant - {plant}", "TRANSPLANT", 0, "after", "fixed_days", 7),
        "thin": _base_rule("thin", "Thin / check - {plant}", "GERM", 7, "after", "fixed_days", 7),
        "harvest": _base_rule("harvest", "Harvest - {plant}", "HARVEST_START", 0, "after", "anchor_range", None, "HARVEST_END"),
    }


def _base_rule(
    rule_id: str,
    title: str,
    start_anchor_stage: str,
    start_offset_days: int,
    start_offset_direction: str,
    end_mode: str,
    duration_days: int | None,
    end_anchor_stage: str | None = None,
) -> dict[str, Any]:
    return {
        "id": rule_id,
        "title": title,
        "startAnchorStage": start_anchor_stage,
        "startOffsetDays": start_offset_days,
        "startOffsetDirection": start_offset_direction,
        "endMode": end_mode,
        "durationDays": duration_days,
        "endAnchorStage": end_anchor_stage,
        "endAnchorOffsetDays": 0,
        "endAnchorOffsetDirection": "after",
        "repeatMode": "none",
        "repeatEveryDays": 1,
        "repeatUntilMode": "x_times",
        "repeatTimes": 1,
        "repeatUntilAnchorStage": "HARVEST_END",
        "repeatCutoffOffsetDays": 0,
        "repeatCutoffOffsetDirection": "after",
    }


def _apply_rule_override(base_rule: dict[str, Any], override: dict[str, Any] | None) -> dict[str, Any]:
    rule = dict(base_rule)
    if override:
        normalized_override = dict(override)
        _rename_override_key(normalized_override, "offsetDays", "startOffsetDays")
        _rename_override_key(normalized_override, "offsetDirection", "startOffsetDirection")
        rule.update(normalized_override)
    rule["id"] = base_rule["id"]
    return normalize_task_rule(rule)


def _rename_override_key(value: dict[str, Any], old_key: str, new_key: str) -> None:
    if old_key in value and new_key not in value:
        value[new_key] = value.pop(old_key)


def _merge_template_polish(skeleton: dict[str, Any], polish: dict[str, Any]) -> dict[str, Any]:
    polished_rules = polish.get("rules") if isinstance(polish, dict) else []
    if not isinstance(polished_rules, list):
        polished_rules = []
    merged_rules: list[dict[str, Any]] = []
    by_id = {str(rule.get("id")): rule for rule in polished_rules if isinstance(rule, dict) and rule.get("id")}
    for index, base_rule in enumerate(skeleton.get("rules") or []):
        candidate = by_id.get(str(base_rule.get("id")))
        if candidate is None and index < len(polished_rules) and isinstance(polished_rules[index], dict):
            candidate = polished_rules[index]
        merged = dict(base_rule)
        if candidate:
            merged.update({key: value for key, value in candidate.items() if key != "id"})
        merged["id"] = base_rule["id"]
        merged_rules.append(normalize_task_rule(merged))
    return {"version": 2, "rules": merged_rules, "provenance": skeleton.get("provenance") or {"field_sources": []}}


def normalize_task_rule(rule: dict[str, Any]) -> dict[str, Any]:
    normalized = dict(rule)
    normalized["title"] = str(normalized.get("title") or normalized.get("id") or "Task").strip()
    normalized["startAnchorStage"] = _normalize_stage(normalized.get("startAnchorStage"), "SOW")
    normalized["startOffsetDays"] = _int_value(normalized.get("startOffsetDays"), 0)
    normalized["startOffsetDirection"] = _normalize_direction(normalized.get("startOffsetDirection"), "after")
    normalized["endMode"] = _normalize_end_mode(normalized.get("endMode"))
    normalized["durationDays"] = None if normalized["endMode"] == "anchor_range" else _int_value(normalized.get("durationDays"), 0)
    normalized["endAnchorStage"] = _normalize_nullable_stage(normalized.get("endAnchorStage"))
    if normalized["endMode"] == "anchor_range" and normalized["endAnchorStage"] is None:
        normalized["endAnchorStage"] = "HARVEST_END"
    normalized["endAnchorOffsetDays"] = _int_value(normalized.get("endAnchorOffsetDays"), 0)
    normalized["endAnchorOffsetDirection"] = _normalize_direction(normalized.get("endAnchorOffsetDirection"), "after")
    normalized["repeatMode"] = _normalize_repeat_mode(normalized.get("repeatMode"))
    normalized["repeatEveryDays"] = _int_value(normalized.get("repeatEveryDays"), 1)
    normalized["repeatUntilMode"] = _normalize_repeat_until_mode(normalized.get("repeatUntilMode"))
    normalized["repeatTimes"] = _int_value(normalized.get("repeatTimes"), 1)
    normalized["repeatUntilAnchorStage"] = _normalize_stage(normalized.get("repeatUntilAnchorStage"), "HARVEST_END")
    normalized["repeatCutoffOffsetDays"] = _int_value(normalized.get("repeatCutoffOffsetDays"), 0)
    normalized["repeatCutoffOffsetDirection"] = _normalize_direction(normalized.get("repeatCutoffOffsetDirection"), "after")
    return normalized


def _method_rule_provenance(method: dict[str, Any]) -> dict[str, Any]:
    source = str(method.get("tasks_required_json") or method.get("method_id") or "method")
    return {"field_sources": [{"field": "rules", "source": source}]}


def _safe_json_obj(value: Any) -> dict[str, Any]:
    if isinstance(value, dict):
        return value
    try:
        parsed = json.loads(str(value or "{}"))
    except Exception:
        return {}
    return parsed if isinstance(parsed, dict) else {}


def _normalize_stage(value: Any, default: str) -> str:
    token = str(value or "").strip().upper().replace("-", "_").replace(" ", "_")
    aliases = {
        "SOWING": "SOW",
        "GERMINATION": "GERM",
        "GERMINATE": "GERM",
        "TRANSPLANTING": "TRANSPLANT",
        "HARVEST": "HARVEST_START",
        "HARVEST_START": "HARVEST_START",
        "HARVEST_END": "HARVEST_END",
    }
    token = aliases.get(token, token)
    return token if token in VALID_STAGES else default


def _normalize_nullable_stage(value: Any) -> str | None:
    if value is None or str(value).strip().lower() in {"", "none", "null", "n/a"}:
        return None
    return _normalize_stage(value, "HARVEST_END")


def _normalize_direction(value: Any, default: str) -> str:
    token = str(value or "").strip().casefold()
    if token in {"before", "prior", "earlier"}:
        return "before"
    if token in {"after", "later", "from"}:
        return "after"
    return default


def _normalize_end_mode(value: Any) -> str:
    token = str(value or "").strip().casefold().replace("-", "_").replace(" ", "_")
    if token in {"anchor_range", "range", "anchor", "between_anchors", "until_anchor"}:
        return "anchor_range"
    return "fixed_days"


def _normalize_repeat_mode(value: Any) -> str:
    token = str(value or "").strip().casefold().replace("-", "_").replace(" ", "_")
    return "interval" if token in {"interval", "repeat", "repeating", "recurring"} else "none"


def _normalize_repeat_until_mode(value: Any) -> str:
    token = str(value or "").strip().casefold().replace("-", "_").replace(" ", "_")
    return "until_anchor" if token in {"until_anchor", "anchor", "until"} else "x_times"


def _int_value(value: Any, default: int) -> int:
    if value is None or value == "":
        return default
    try:
        return int(float(value))
    except (TypeError, ValueError):
        return default


def _crop_source_values(crop: dict[str, Any], methods: list[dict[str, Any]]) -> set[str]:
    values = set(source_values_from_input(crop))
    values.update({"direct_sow", "transplant"})
    name = str(crop.get("plant_name") or crop.get("name") or "").strip()
    if name:
        values.update({
            name,
            f"crop.name: {name}",
            f"crop.plant_name: {name}",
            f"user supplied crop.name: {name}",
            f"user supplied crop.plant_name: {name}",
        })
    for method in methods:
        for key in ("method_id", "method_category_id", "method_name"):
            raw = str(method.get(key) or "").strip()
            if raw:
                values.add(raw)
                values.add(f"{key}: {raw}")
        raw_tasks = str(method.get("tasks_required_json") or "").strip()
        if raw_tasks:
            values.add(raw_tasks)
            values.add(f"tasks_required_json: {raw_tasks}")
            try:
                parsed = json.loads(raw_tasks)
                compact = json.dumps(parsed, sort_keys=True, separators=(",", ":"))
                values.add(compact)
                values.add(json.dumps(parsed, sort_keys=True, indent=2))
            except Exception:
                pass
    return values


def _prepare_crop_result(result: dict[str, Any], crop: dict[str, Any], methods: list[dict[str, Any]]) -> dict[str, Any]:
    prepared = dict(result or {})
    row = _normalize_plant_row(dict(prepared.get("row") or {}))
    name = str(crop.get("plant_name") or crop.get("name") or "").strip()
    if name and not row.get("plant_name"):
        row["plant_name"] = name
    prepared["_allowed_method_ids_explicit"] = bool(prepared.get("allowed_method_ids") or crop.get("allowed_method_ids"))  # validation guard
    prepared["allowed_method_ids"] = _resolved_allowed_method_ids(prepared, crop, methods)  # concrete crop methods
    if not prepared.get("allowed_method_categories"):
        method_by_id = {str(method.get("method_id")): method for method in methods}
        prepared["allowed_method_categories"] = sorted({
            str(method_by_id[method_id].get("method_category_id"))
            for method_id in prepared["allowed_method_ids"]
            if method_id in method_by_id and method_by_id[method_id].get("method_category_id")
        })
    provenance = prepared.get("provenance") if isinstance(prepared.get("provenance"), dict) else {"field_sources": []}
    provenance["field_sources"] = _merge_field_sources(
        provenance.get("field_sources"),
        _controlled_crop_field_sources(row, crop, methods),
    )
    prepared["row"] = row
    prepared["provenance"] = provenance
    return prepared


def _requested_method_ids(crop: dict[str, Any], methods: list[dict[str, Any]]) -> list[str]:
    method_ids = [str(method_id).strip() for method_id in (crop.get("allowed_method_ids") or []) if str(method_id).strip()]
    if method_ids:
        return _unique(method_ids)
    categories = set(crop.get("allowed_method_categories") or [])
    if not categories:
        return []
    return [str(method["method_id"]) for method in methods if method.get("method_category_id") in categories]


def _resolved_allowed_method_ids(result: dict[str, Any], crop: dict[str, Any], methods: list[dict[str, Any]]) -> list[str]:
    explicit = [str(method_id).strip() for method_id in (result.get("allowed_method_ids") or crop.get("allowed_method_ids") or []) if str(method_id).strip()]
    if explicit:
        return _unique(explicit)
    categories = set(result.get("allowed_method_categories") or crop.get("allowed_method_categories") or [])
    return [str(method["method_id"]) for method in methods if method.get("method_category_id") in categories]


def _unique(values: list[str]) -> list[str]:
    seen: set[str] = set()
    unique_values: list[str] = []
    for value in values:
        if value not in seen:
            unique_values.append(value)
            seen.add(value)
    return unique_values


def _normalize_plant_row(row: dict[str, Any]) -> dict[str, Any]:
    for key in PLANT_FLAG_FIELDS:
        if key in row:
            row[key] = _flag_value(row.get(key))
    for key in PLANT_INTEGER_FIELDS - PLANT_FLAG_FIELDS:
        if key in row:
            row[key] = _integer_value(row.get(key))
    for key in PLANT_REAL_FIELDS:
        if key in row:
            row[key] = _number_value(row.get(key))
    return row


def _flag_value(value: Any) -> int | None:
    if value is None or value == "":
        return None
    if isinstance(value, bool):
        return 1 if value else 0
    token = str(value).strip().casefold()
    if token in {"1", "true", "yes", "y", "allowed", "ok"}:
        return 1
    if token in {"0", "false", "no", "n", "not_allowed", "none"}:
        return 0
    if token in {"1.0"}:
        return 1
    if token in {"0.0"}:
        return 0
    return None


def _integer_value(value: Any) -> Any:
    if value is None or value == "":
        return None
    if isinstance(value, bool):
        return 1 if value else 0
    if isinstance(value, int):
        return value
    try:
        parsed = float(str(value).strip())
    except ValueError:
        return value
    return int(parsed) if parsed.is_integer() else value


def _number_value(value: Any) -> int | float | None:
    if value is None or value == "":
        return None
    if isinstance(value, (int, float)):
        return value
    try:
        parsed = float(str(value).strip())
    except ValueError:
        return value
    return int(parsed) if parsed.is_integer() else parsed


def _controlled_crop_field_sources(row: dict[str, Any], crop: dict[str, Any], methods: list[dict[str, Any]]) -> list[dict[str, str]]:
    name = str(crop.get("plant_name") or crop.get("name") or row.get("plant_name") or "").strip()
    method_by_id = {str(method.get("method_id")): method for method in methods}
    fields: list[dict[str, str]] = []
    if name:
        fields.append({"field": "plant_name", "source": name})
    category = str(row.get("default_planting_method_category") or "").strip()
    if category:
        fields.append({"field": "default_planting_method_category", "source": category})
    method_id = str(row.get("default_planting_method") or "").strip()
    if method_id:
        method = method_by_id.get(method_id) or {}
        fields.append({"field": "default_planting_method", "source": str(method.get("method_name") or method_id)})
    if "direct_sow" in row:
        fields.append({"field": "direct_sow", "source": "direct_sow"})
    if "transplant" in row:
        fields.append({"field": "transplant", "source": "transplant"})
    return fields


def _merge_field_sources(existing: Any, additions: list[dict[str, str]]) -> list[dict[str, str]]:
    merged: list[dict[str, str]] = []
    seen: set[tuple[str, str]] = set()
    for field, sources in _field_source_map(existing).items():
        for source in sources:
            key = (field, source)
            if key not in seen:
                merged.append({"field": field, "source": source})
                seen.add(key)
    for item in additions:
        field = str(item.get("field") or "").strip()
        source = str(item.get("source") or "").strip()
        key = (field, source)
        if field and source and key not in seen:
            merged.append({"field": field, "source": source})
            seen.add(key)
    return merged


def _field_source_map(raw: Any) -> dict[str, list[str]]:
    if isinstance(raw, dict):
        return {str(key): [str(item) for item in (value if isinstance(value, list) else [value])] for key, value in raw.items()}
    if isinstance(raw, list):
        mapped: dict[str, list[str]] = {}
        for item in raw:
            if not isinstance(item, dict):
                continue
            field = str(item.get("field") or "").strip()
            source = item.get("source")
            if field and source is not None:
                mapped.setdefault(field, []).append(str(source))
        return mapped
    return {}


def _validate_crop_result(result: dict[str, Any], source_values: set[str], methods: list[dict[str, Any]] | None = None) -> list[str]:
    row = dict(result.get("row") or {})
    row["provenance"] = result.get("provenance") or {}
    report = validate_row("Plants", row, source_values=source_values, required_source_fields=CONTROLLED_CROP_SOURCE_FIELDS)
    errors = list(report["errors"])
    if not result.get("allowed_method_categories"):
        errors.append("allowed_method_categories is required.")
    errors.extend(_validate_allowed_method_ids(result, methods or []))
    errors.extend(_validate_varieties(result.get("varieties"), str(row.get("plant_name") or ""), source_values))  # CHANGED
    return errors


def _validate_varieties(varieties: Any, plant_name: str, source_values: set[str] | None = None) -> list[str]:  # CHANGED
    errors: list[str] = []
    if not isinstance(varieties, list):
        return ["varieties must be a list."]
    seen: set[str] = set()
    plant_key = normalize_key(plant_name)
    for index, variety in enumerate(varieties):
        prefix = f"varieties[{index}]"
        if not isinstance(variety, dict):
            errors.append(f"{prefix} must be an object.")
            continue
        name = str(variety.get("variety_name") or "").strip()
        key = normalize_key(name)
        if not name:
            errors.append(f"{prefix}.variety_name is required.")
            continue
        if key in seen:
            errors.append(f"{prefix}.variety_name duplicates another variety: {name}")
        seen.add(key)
        if key == plant_key:
            errors.append(f"{prefix}.variety_name must be a real cultivar/variety, not the crop name.")
        if _is_placeholder_variety_name(name, plant_name):
            errors.append(f"{prefix}.variety_name appears to be a placeholder: {name}")
        maturity_class = str(variety.get("maturity_class") or "").strip().casefold()  # ADDED
        if maturity_class and maturity_class not in {"early", "mid", "late"}:  # ADDED
            errors.append(f"{prefix}.maturity_class must be early, mid, or late.")  # ADDED
        if maturity_class in {"early", "mid", "late"}:  # ADDED
            errors.extend(_validate_variety_maturity_sources(prefix, variety, source_values))  # ADDED
    return errors


def _has_explicit_variety_sources(variety: dict[str, Any]) -> bool:  # ADDED
    return any(str(source).strip() for source in (variety.get("sources") or []))  # ADDED


def _validate_variety_maturity_sources(prefix: str, variety: dict[str, Any], source_values: set[str] | None) -> list[str]:  # ADDED
    sources = [str(source).strip() for source in (variety.get("sources") or []) if str(source).strip()]  # ADDED
    if not sources:  # ADDED
        return [f"{prefix}.maturity_class requires at least one explicit source in {prefix}.sources."]  # ADDED
    if source_values is None:  # ADDED
        return []  # ADDED
    return [  # ADDED
        f"{prefix}.sources references an input source/note that was not supplied: {source}"  # ADDED
        for source in sources  # ADDED
        if not source_ref_allowed(source, source_values)  # ADDED
    ]  # ADDED


def _is_placeholder_variety_name(name: str, plant_name: str) -> bool:
    key = normalize_key(name)
    plant_key = normalize_key(plant_name)
    if key in {"generic", "standard", "common", "default", "variety", "cultivar", "n/a", "na", "unknown"}:
        return True
    stripped = key.removeprefix(plant_key).strip()
    if stripped in {"variety", "cultivar", "type", "standard"}:
        return True
    tokens = stripped.replace("-", " ").split()
    if len(tokens) == 2 and tokens[0] in {"variety", "cultivar", "type"} and tokens[1].isdigit():
        return True
    if key.startswith(f"{plant_key} variety ") and key.rsplit(" ", 1)[-1].isdigit():
        return True
    if key.startswith(f"{plant_key} cultivar ") and key.rsplit(" ", 1)[-1].isdigit():
        return True
    return False


def _validate_allowed_method_ids(result: dict[str, Any], methods: list[dict[str, Any]]) -> list[str]:
    if not methods:
        return []
    errors: list[str] = []
    method_by_id = {str(method.get("method_id")): method for method in methods}
    allowed_ids = [str(method_id).strip() for method_id in (result.get("allowed_method_ids") or []) if str(method_id).strip()]
    if not result.get("_allowed_method_ids_explicit"):
        errors.append("allowed_method_ids is required.")
        return errors
    if not allowed_ids:
        errors.append("allowed_method_ids is required.")
        return errors
    categories = set(result.get("allowed_method_categories") or [])
    for method_id in allowed_ids:
        method = method_by_id.get(method_id)
        if not method:
            errors.append(f"allowed_method_ids has unknown method_id: {method_id}")
            continue
        category = str(method.get("method_category_id") or "")
        if categories and category not in categories:
            errors.append(f"allowed_method_ids method {method_id} is outside allowed_method_categories.")
    return errors


def _validate_template_result(result: dict[str, Any], source_values: set[str]) -> list[str]:
    template = {"version": result.get("version"), "rules": result.get("rules") or []}
    row = {"plant_name": "template-check", "method_id": "direct_sow.field", "template_json": compact_json(template), "provenance": result.get("provenance") or {}}
    report = validate_row("PlantTaskTemplates", row, source_values=source_values, required_source_fields={"rules"})
    return report["errors"]


def _validate_template_polish(result: dict[str, Any], source_values: set[str], skeleton: dict[str, Any]) -> list[str]:
    errors: list[str] = []
    rules = result.get("rules") if isinstance(result, dict) else None
    expected_count = len(skeleton.get("rules") or [])
    if not isinstance(rules, list):
        errors.append("Template polish must include a rules list.")
        return errors
    if len(rules) < expected_count:
        errors.append(f"Template polish must include {expected_count} rule(s); got {len(rules)}.")
        return errors
    errors.extend(_validate_template_result(_merge_template_polish(skeleton, result), source_values))
    return errors


def _validate_companion_result(result: dict[str, Any], source_values: set[str]) -> list[str]:
    companion = dict(result.get("companion") or {})
    evidence = dict(result.get("evidence") or {})
    errors = validate_row("Companions", companion)["errors"]
    evidence_row = {"p1": companion.get("p1"), "p2": companion.get("p2"), **evidence, "provenance": evidence.get("provenance") or result.get("provenance") or {}}
    errors.extend(validate_row("CompanionEvidence", evidence_row, source_values=source_values, required_source_fields={"summary"})["errors"])
    return errors
