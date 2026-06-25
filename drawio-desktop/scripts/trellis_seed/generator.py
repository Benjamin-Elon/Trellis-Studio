from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from .config import Settings, read_openai_api_key
from .db import load_method_categories, load_methods
from .jsonio import read_json, write_json
from .planner import effective_tables_from_input, selected_tables_warning
from .providers import OpenAIJsonClient, OpenMeteoClient, ProviderError, ProviderTrace
from .schema import OPENAI_PLANT_SCHEMA, OPENAI_TEMPLATE_SCHEMA, PROVENANCE_SCHEMA, compact_json
from .validator import source_values_from_input, validate_input, validate_row, validate_run
from .weather import forecast_rows, history_window, summarize_city_weather


def create_run(settings: Settings, input_path: Path) -> Path:
    input_data = read_json(input_path, None)
    if not isinstance(input_data, dict):
        raise ValueError(f"Input must be a JSON object: {input_path}")
    errors = validate_input(input_data)
    if errors:
        raise ValueError("Input validation failed:\n" + "\n".join(f"- {e}" for e in errors))

    run_id = datetime.now(timezone.utc).strftime("run-%Y%m%d-%H%M%S")
    run_dir = settings.runs_dir / run_id
    (run_dir / "generated").mkdir(parents=True, exist_ok=True)
    (run_dir / "traces").mkdir(parents=True, exist_ok=True)
    write_json(run_dir / "input.normalized.json", normalize_input(input_data, settings))
    effective_tables = effective_tables_from_input(normalize_input(input_data, settings))
    metadata = {
        "run_id": run_id,
        "input_path": str(input_path),
        "created_at": datetime.now(timezone.utc).isoformat(),
        "db_path": str(settings.db_path),
        "openai_model": settings.openai_model,
        "openai_reasoning_effort": settings.openai_reasoning_effort,
        "effective_tables": effective_tables,
    }
    warning = selected_tables_warning(input_data, effective_tables)
    if warning:
        metadata["tables_warning"] = warning
    write_json(run_dir / "metadata.json", metadata)
    return run_dir


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


def estimate_openai_calls(input_data: dict[str, Any], settings: Settings, db_path: Path) -> dict[str, int]:
    methods = load_methods(db_path)
    categories = load_method_categories(db_path)
    crop_count = len(input_data.get("crops") or [])
    companion_count = len(input_data.get("companions") or [])
    template_count = 0
    variety_override_count = 0
    for crop in input_data.get("crops", []) or []:
        requested_categories = crop.get("allowed_method_categories") or list(categories)
        crop_methods = [m for m in methods if m["method_category_id"] in requested_categories]
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


def generate_run(settings: Settings, input_path: Path) -> Path:
    input_data = normalize_input(read_json(input_path, {}), settings)
    run_dir = create_run(settings, input_path)
    provenance: dict[str, Any] = {"tables": {}, "traces": []}
    generated: dict[str, list[dict[str, Any]]] = {name: [] for name in [
        "Plants", "Cities", "CityWeatherDaily", "CityWeatherForecastDaily",
        "Companions", "CompanionEvidence", "PlantAllowedMethodCategories",
        "PlantVarieties", "PlantTaskTemplates", "VarietyTaskTemplates",
    ]}

    print("Running provider preflight checks...")
    for trace in preflight(settings, input_data):
        provenance["traces"].append(trace.redacted())

    openai = OpenAIJsonClient(read_openai_api_key(), settings.openai_model, settings.openai_reasoning_effort)
    meteo = OpenMeteoClient(settings.data["open_meteo"])
    methods = load_methods(settings.db_path)

    if input_data.get("cities"):
        _generate_cities(settings, input_data, meteo, generated, provenance)
    if input_data.get("crops"):
        _generate_crops(settings, input_data, openai, methods, generated, provenance)
    if input_data.get("companions"):
        _generate_companions(input_data, openai, generated, provenance)

    for table, rows in generated.items():
        if rows:
            write_json(run_dir / "generated" / f"{table}.json", rows)
    write_json(run_dir / "provenance.json", provenance)
    validate_run(run_dir, settings.db_path)
    return run_dir


def _generate_cities(settings: Settings, input_data: dict[str, Any], meteo: OpenMeteoClient, generated: dict[str, list[dict[str, Any]]], provenance: dict[str, Any]) -> None:
    start_date, end_date, start_year, end_year = history_window(int(settings.data.get("city_history_years", 15)))
    for city in input_data.get("cities", []) or []:
        name = str(city.get("city_name") or city.get("name")).strip()
        print(f"Generating city weather: {name}")
        geo, trace = meteo.geocode(name)
        provenance["traces"].append(trace.redacted())
        timezone_name = str(city.get("timezone") or geo.get("timezone") or "UTC")
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
        provenance["tables"].setdefault("Cities", {})[name] = city_provenance | {"history_start_year": start_year, "history_end_year": end_year}


def _generate_crops(settings: Settings, input_data: dict[str, Any], openai: OpenAIJsonClient, methods: list[dict[str, Any]], generated: dict[str, list[dict[str, Any]]], provenance: dict[str, Any]) -> None:
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
            validator=lambda candidate: _validate_crop_result(candidate, source_values),
            progress_label=f"crop row: {name}",
            system="You convert source-backed horticulture notes into Trellis SQLite seed rows. Use only the supplied sources/notes. Return strict JSON. provenance.field_sources must include field/source entries for required fields using exact supplied source strings.",
            user=json.dumps({
                "crop": crop,
                "fixed_method_categories": sorted({m["method_category_id"] for m in methods}),
                "fixed_methods": methods,
                "default_variety_count": requested_varieties,
                "allowed_provenance_references": sorted(source_values),
            }, indent=2),
        )
        provenance["traces"].append(trace.redacted())
        row = dict(result["row"])
        row["plant_name"] = row.get("plant_name") or name
        row["provenance"] = result.get("provenance") or {}
        generated["Plants"].append(row)
        allowed_categories = result.get("allowed_method_categories") or crop.get("allowed_method_categories") or []
        print(f"  - Crop row accepted: {row['plant_name']}", flush=True)
        print(f"  - Allowed method categories: {', '.join(map(str, allowed_categories)) or '[none]'}", flush=True)
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
        crop_methods = [m for m in methods if m["method_category_id"] in set(allowed_categories)]
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
    return _call_openai_with_retry(
        openai,
        schema_name="trellis_task_template",
        json_schema=OPENAI_TEMPLATE_SCHEMA,
        validator=lambda candidate: _validate_template_result(candidate, source_values),
        progress_label=progress_label,
        system="Create a Trellis scheduler task template. Use version 2. Use only supported anchor stages: SOW, GERM, TRANSPLANT, HARVEST_START, HARVEST_END. provenance.field_sources must include a rules entry using an exact supplied source string.",
        user=json.dumps({
            "plant_row": plant_row,
            "method": method,
            "source_backed_crop_input": crop_input,
            "allowed_provenance_references": sorted(source_values),
        }, indent=2),
    )


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


def _crop_source_values(crop: dict[str, Any], methods: list[dict[str, Any]]) -> set[str]:
    values = set(source_values_from_input(crop))
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


def _validate_crop_result(result: dict[str, Any], source_values: set[str]) -> list[str]:
    row = dict(result.get("row") or {})
    row["provenance"] = result.get("provenance") or {}
    report = validate_row("Plants", row, source_values=source_values, required_source_fields={
        "plant_name", "default_planting_method_category", "default_planting_method", "direct_sow", "transplant"
    })
    errors = list(report["errors"])
    if not result.get("allowed_method_categories"):
        errors.append("allowed_method_categories is required.")
    return errors


def _validate_template_result(result: dict[str, Any], source_values: set[str]) -> list[str]:
    template = {"version": result.get("version"), "rules": result.get("rules") or []}
    row = {"plant_name": "template-check", "method_id": "direct_sow.field", "template_json": compact_json(template), "provenance": result.get("provenance") or {}}
    report = validate_row("PlantTaskTemplates", row, source_values=source_values, required_source_fields={"rules"})
    return report["errors"]


def _validate_companion_result(result: dict[str, Any], source_values: set[str]) -> list[str]:
    companion = dict(result.get("companion") or {})
    evidence = dict(result.get("evidence") or {})
    errors = validate_row("Companions", companion)["errors"]
    evidence_row = {"p1": companion.get("p1"), "p2": companion.get("p2"), **evidence, "provenance": evidence.get("provenance") or result.get("provenance") or {}}
    errors.extend(validate_row("CompanionEvidence", evidence_row, source_values=source_values, required_source_fields={"summary"})["errors"])
    return errors
