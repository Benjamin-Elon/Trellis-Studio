from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from .artifacts import input_summary_slug, unique_artifact_dir
from .config import Settings, read_openai_api_key
from .db import load_method_categories, load_methods
from .jsonio import read_json, write_json
from .planner import effective_tables_from_input, selected_tables_warning
from .providers import OpenAIJsonClient, OpenMeteoClient, ProviderError, ProviderTrace
from .schema import OPENAI_PLANT_SCHEMA, OPENAI_TEMPLATE_SCHEMA, PROVENANCE_SCHEMA, compact_json
from .validator import source_values_from_input, validate_input, validate_row, validate_run
from .weather import forecast_rows, history_window, summarize_city_weather


TASK_RULE_ORDER = ["prep", "sow", "start", "harden", "transplant", "thin", "harvest"]
VALID_STAGES = {"SOW", "GERM", "TRANSPLANT", "HARVEST_START", "HARVEST_END"}
PLANT_FLAG_FIELDS = {"annual", "biennial", "perennial", "direct_sow", "transplant", "succession", "overwinter_ok"}
PLANT_NUMERIC_FIELDS = {
    "lifespan_years", "sun_hours", "root_depth_cm", "root_diam_cm", "veg_height_cm", "veg_diameter_cm",
    "spacing_cm", "tmax_c", "topt_high_c", "topt_low_c", "tmin_c", "tbase_c", "spacing_y_cm",
    "spacing_x_cm", "yield_per_plant_kg", "soil_temp_min_plant_c", "harvest_window_days",
    "days_maturity", "days_transplant", "days_germ", "gdd_to_maturity", "start_cooling_threshold_c",
}
CONTROLLED_CROP_SOURCE_FIELDS = {
    "plant_name", "default_planting_method_category", "default_planting_method", "direct_sow", "transplant"
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

    timestamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    run_dir = unique_artifact_dir(settings.runs_dir, "run", timestamp, input_summary_slug(input_data, input_path))
    run_id = run_dir.name
    (run_dir / "generated").mkdir(parents=True, exist_ok=True)
    (run_dir / "traces").mkdir(parents=True, exist_ok=True)
    write_json(run_dir / "input.normalized.json", normalize_input(input_data, settings))
    effective_tables = _effective_tables_for_options(effective_tables_from_input(normalize_input(input_data, settings)), options)
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
    data.setdefault("settings", {})
    data["settings"].setdefault("variety_count", settings.data.get("default_variety_count", 5))
    data["effective_tables"] = effective_tables_from_input(data)
    return data


def estimate_openai_calls(input_data: dict[str, Any], settings: Settings, db_path: Path, options: GenerationOptions | None = None) -> dict[str, int]:
    options = options or GenerationOptions()
    methods = load_methods(db_path)
    categories = load_method_categories(db_path)
    crop_count = len(input_data.get("crops") or [])
    companion_count = len(input_data.get("companions") or [])
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
        "companion_rows": companion_count,
        "plant_task_templates": template_count,
        "variety_task_overrides": variety_override_count,
        "estimated_total": crop_count + companion_count + template_count + variety_override_count,
    }


def preflight(settings: Settings, input_data: dict[str, Any]) -> list[ProviderTrace]:
    traces = []
    if input_data.get("crops") or input_data.get("companions"):
        traces.append(OpenAIJsonClient(read_openai_api_key(), settings.openai_model, settings.openai_reasoning_effort).preflight())
    if input_data.get("cities"):
        traces.append(OpenMeteoClient(settings.data["open_meteo"]).preflight())
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
    generated: dict[str, list[dict[str, Any]]] = {name: [] for name in [
        "Plants", "Cities", "CityWeatherDaily", "CityWeatherForecastDaily",
        "Companions", "CompanionEvidence", "PlantAllowedMethodCategories",
        "PlantVarieties", "PlantTaskTemplates", "VarietyTaskTemplates",
    ]}

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
        methods = load_methods(settings.db_path)

        if input_data.get("cities"):
            _generate_cities(settings, input_data, meteo, generated, provenance)
        if input_data.get("crops"):
            _generate_crops(settings, input_data, openai, methods, generated, provenance, generate_templates=options.generate_templates)
        if input_data.get("companions"):
            _generate_companions(input_data, openai, generated, provenance)

        for table, rows in generated.items():
            if rows:
                write_json(run_dir / "generated" / f"{table}.json", rows)
        write_json(run_dir / "provenance.json", provenance)
        validate_run(run_dir, settings.db_path)
        _update_run_metadata(run_dir, {"status": "complete"})
        return run_dir
    except Exception as exc:
        _update_run_metadata(run_dir, {"status": "failed", "error": str(exc)})
        raise


def _update_run_metadata(run_dir: Path, updates: dict[str, Any]) -> None:
    metadata = read_json(run_dir / "metadata.json", {}) or {}
    metadata.update(updates)
    write_json(run_dir / "metadata.json", metadata)


def _generate_cities(settings: Settings, input_data: dict[str, Any], meteo: OpenMeteoClient, generated: dict[str, list[dict[str, Any]]], provenance: dict[str, Any]) -> None:
    start_date, end_date, start_year, end_year = history_window(int(settings.data.get("city_history_years", 15)))
    for city in input_data.get("cities", []) or []:
        name = _city_display_name(city)
        geocode_query = str(city.get("city_name") or city.get("name")).strip()
        geocode_qualifiers = _city_geocode_qualifiers(city, name)
        print(f"Generating city weather: {name}", flush=True)
        print("  - Geocoding city", flush=True)
        geo, trace = meteo.geocode(geocode_query, geocode_qualifiers)
        provenance["traces"].append(trace.redacted())
        timezone_name = str(city.get("timezone") or geo.get("timezone") or "UTC")
        print(f"  - Fetching historical daily weather: {start_date} to {end_date}", flush=True)
        daily, trace = meteo.historical_daily(
            latitude=float(geo["latitude"]),
            longitude=float(geo["longitude"]),
            timezone=timezone_name,
            start_date=start_date,
            end_date=end_date,
        )
        provenance["traces"].append(trace.redacted())
        city_row, weather_rows, city_provenance = summarize_city_weather(name, geo, daily, float(settings.data.get("gdd_base_c", 5)))
        generated["Cities"].append(city_row)
        generated["CityWeatherDaily"].extend(weather_rows)
        print(f"  - Historical weather rows: {len(weather_rows)}", flush=True)
        print(f"  - Fetching {int(settings.data.get('forecast_days', 16))}-day forecast", flush=True)
        forecast, trace = meteo.forecast_daily(
            latitude=float(geo["latitude"]),
            longitude=float(geo["longitude"]),
            timezone=timezone_name,
            forecast_days=int(settings.data.get("forecast_days", 16)),
        )
        provenance["traces"].append(trace.redacted())
        generated["CityWeatherForecastDaily"].extend(
            forecast_rows(name, forecast, str(settings.data["open_meteo"].get("forecast_model", "best_match")))
        )
        print("  - City weather complete", flush=True)
        provenance["tables"].setdefault("Cities", {})[name] = city_provenance | {"history_start_year": start_year, "history_end_year": end_year}


def _city_display_name(city: dict[str, Any]) -> str:
    explicit_name = str(city.get("name") or "").strip()
    if explicit_name:
        return explicit_name
    parts = [str(city.get(field) or "").strip() for field in ("city_name", "admin1", "country")]
    return ", ".join(part for part in parts if part)


def _city_geocode_qualifiers(city: dict[str, Any], display_name: str) -> dict[str, str]:
    return {
        "display_name": display_name,
        "admin1": str(city.get("admin1") or "").strip(),
        "country": str(city.get("country") or "").strip(),
        "country_code": str(city.get("country_code") or "").strip(),
    }


def _generate_crops(settings: Settings, input_data: dict[str, Any], openai: OpenAIJsonClient, methods: list[dict[str, Any]], generated: dict[str, list[dict[str, Any]]], provenance: dict[str, Any], generate_templates: bool) -> None:
    default_variety_count = int(input_data.get("settings", {}).get("variety_count", settings.data.get("default_variety_count", 5)))
    crops = input_data.get("crops", []) or []
    for crop_index, crop in enumerate(crops, 1):
        name = str(crop.get("plant_name") or crop.get("name")).strip()
        requested_varieties = int(crop.get("variety_count") or default_variety_count)
        print(f"Generating crop {crop_index}/{len(crops)}: {name}", flush=True)
        source_values = _crop_source_values(crop, methods)
        print(f"  - Source/provenance references available: {len(source_values)}", flush=True)
        print(f"  - Requested varieties: {requested_varieties}", flush=True)
        result, trace = _call_openai_with_retry(
            openai,
            schema_name="trellis_crop_row",
            json_schema=OPENAI_PLANT_SCHEMA,
            validator=lambda candidate: _validate_crop_result(_prepare_crop_result(candidate, crop, methods), source_values, methods),
            progress_label=f"crop row: {name}",
            system="You convert source-backed horticulture notes into Trellis SQLite seed rows. Use only the supplied sources/notes. Return strict JSON. allowed_method_categories are broad capabilities; allowed_method_ids must include only concrete fixed_methods that are actual planting methods for this crop. Do not include propagation-by-cutting unless the crop is normally grown from cuttings. provenance.field_sources must include field/source entries for required fields using exact supplied source strings.",
            user=json.dumps({
                "crop": crop,
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
            generated["PlantVarieties"].append({
                "plant_name": row["plant_name"],
                "variety_name": variety["variety_name"],
                "overrides": _override_pairs_to_dict(variety.get("overrides") or {}),
            })
        crop_methods = [m for m in methods if m["method_id"] in set(allowed_method_ids)]
        if not generate_templates:
            print("  - Plant task templates skipped; scheduler defaults will be used", flush=True)  # template opt-in
            if crop.get("variety_task_overrides"):
                print("  - Variety task overrides skipped because template generation is disabled", flush=True)
            provenance["tables"].setdefault("Plants", {})[row["plant_name"]] = result.get("provenance") or {}
            print(f"Finished crop {crop_index}/{len(crops)}: {row['plant_name']}", flush=True)
            continue
        print(f"  - Plant task templates to generate: {len(crop_methods)}", flush=True)
        for method_index, method in enumerate(crop_methods, 1):
            print(f"    * Template {method_index}/{len(crop_methods)}: {method['method_id']}", flush=True)
            template, trace = _generate_task_template(
                openai,
                row,
                method,
                crop,
                progress_label=f"plant task template: {row['plant_name']} / {method['method_id']}",
            )
            provenance["traces"].append(trace.redacted())
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
            template, trace = _generate_task_template(
                openai,
                row,
                method,
                crop | {"variety_override": override},
                progress_label=f"variety task template: {row['plant_name']} / {override.get('variety_name')} / {override.get('method_id')}",
            )
            provenance["traces"].append(trace.redacted())
            generated["VarietyTaskTemplates"].append({
                "plant_name": row["plant_name"],
                "variety_name": override["variety_name"],
                "method_id": override["method_id"],
                "template_json": compact_json({"version": 2, "rules": template["rules"]}),
            })
        provenance["tables"].setdefault("Plants", {})[row["plant_name"]] = result.get("provenance") or {}
        print(f"Finished crop {crop_index}/{len(crops)}: {row['plant_name']}", flush=True)


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


def _generate_companions(input_data: dict[str, Any], openai: OpenAIJsonClient, generated: dict[str, list[dict[str, Any]]], provenance: dict[str, Any]) -> None:
    for item in input_data.get("companions", []) or []:
        p1 = str(item["p1"]).strip()
        p2 = str(item["p2"]).strip()
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
            system="Convert source-backed companion planting evidence into Trellis companion rows. Do not invent unsupported relationships. provenance.field_sources must include a summary entry using an exact supplied source string.",
            user=json.dumps(item, indent=2),
        )
        provenance["traces"].append(trace.redacted())
        companion = result["companion"]
        evidence = result["evidence"]
        generated["Companions"].append(companion)
        generated["CompanionEvidence"].append({"p1": companion["p1"], "p2": companion["p2"], **evidence})


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
    for key in PLANT_NUMERIC_FIELDS:
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
    try:
        return 1 if float(token) else 0
    except ValueError:
        return None


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
    return errors


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
