from __future__ import annotations

import json
import sqlite3
from contextlib import closing
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from .artifacts import slugify, unique_artifact_dir
from .config import Settings, read_openai_api_key
from .db import connect, create_diff_report, load_methods
from .generic_varieties import generic_maturity_varieties_for_plant
from .jsonio import read_json, write_json
from .nutrition import CachedFdcClient, ensure_reference_nutrition_rows, synthesize_nutrition_for_plant
from .providers import FoodDataCentralClient, OpenAIJsonClient, ProviderError, ProviderTrace
from .schema import NUTRITION_NUTRIENT_KEYS, PLANT_COLUMNS, PLANT_FIELD_TYPES
from .validator import normalize_key, validate_row, validate_run


VERIFY_STATE_FILENAME = "verify_state.json"
VERIFY_TABLES = [
    "Plants",
    "PlantAllowedMethodCategories",
    "PlantVarieties",
    "PlantGrowthStages",
    "PlantNutritionMappings",
    "PlantNutritionValues",
    "PlantingWindowReferences",
]


@dataclass(frozen=True)
class VerifyOptions:
    batch_size: int = 1
    use_openai: bool = True
    use_fdc: bool = True


def verify_database_sweep(
    settings: Settings,
    options: VerifyOptions | None = None,
    *,
    openai: OpenAIJsonClient | None = None,
    fdc: CachedFdcClient | None = None,
) -> Path:
    options = options or VerifyOptions()
    batch_size = max(1, int(options.batch_size or 1))
    state = load_verify_state(settings)
    with closing(connect(settings.db_path)) as conn:
        plants = _load_plants(conn)
        selected, selection = select_verify_batch(plants, state, batch_size)
        if not selected:
            raise RuntimeError("No plants found to verify.")
        run_dir = _create_verify_run(settings, selected, state, selection, batch_size)
        openai_client = openai or _default_openai(settings, enabled=options.use_openai)
        fdc_client = fdc or _default_fdc(settings, run_dir, enabled=options.use_fdc)
        generated: dict[str, list[dict[str, Any]]] = {}
        report: dict[str, Any] = {
            "mode": "verify",
            "created_at": _now(),
            "db_path": str(settings.db_path),
            "cursor_before": state,
            "selection": selection,
            "plants": [],
            "summary": {"checked": 0, "findings": 0, "generated_rows": 0},
        }
        provenance: dict[str, Any] = {"mode": "verify", "tables": {}, "traces": [], "skipped": []}
        for plant in selected:
            plant_report = _verify_one_plant(conn, settings, plant, generated, provenance, openai_client, fdc_client)
            report["plants"].append(plant_report)
        _write_generated(run_dir, generated)
        report["summary"] = _report_summary(report["plants"], generated)
        write_json(run_dir / "verify_report.json", report)
        write_json(run_dir / "provenance.json", provenance)
        validation = validate_run(run_dir, settings.db_path)
        create_diff_report(run_dir, settings.db_path)
        _update_metadata(run_dir, {
            "status": "complete",
            "validation_ok": validation.get("ok"),
            "generated_counts": {table: len(rows) for table, rows in generated.items() if rows},
        })
    save_verify_state(settings, advance_verify_state(state, selected, selection, run_dir))
    return run_dir


def load_verify_state(settings: Settings) -> dict[str, Any]:
    state = read_json(_state_path(settings), {}) or {}
    return state if isinstance(state, dict) else {}


def save_verify_state(settings: Settings, state: dict[str, Any]) -> None:
    settings.runs_dir.mkdir(parents=True, exist_ok=True)
    write_json(_state_path(settings), state)


def select_verify_batch(plants: list[dict[str, Any]], state: dict[str, Any], batch_size: int = 1) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    if not plants:
        return [], {"wrapped": False, "start_index": None, "batch_size": 0}
    ordered = sorted(plants, key=lambda row: int(row["plant_id"]))
    last_id = _optional_int(state.get("last_plant_id"))
    start_index = 0
    wrapped = False
    if last_id is not None:
        greater = [index for index, row in enumerate(ordered) if int(row["plant_id"]) > last_id]
        if greater:
            start_index = greater[0]
        else:
            wrapped = True
    count = min(max(1, int(batch_size or 1)), len(ordered))
    selected = []
    for offset in range(count):
        index = (start_index + offset) % len(ordered)
        if offset and index == 0:
            wrapped = True
        selected.append(ordered[index])
    return selected, {
        "wrapped": wrapped,
        "start_index": start_index,
        "batch_size": count,
        "plant_ids": [row["plant_id"] for row in selected],
        "plant_names": [row["plant_name"] for row in selected],
    }


def advance_verify_state(state: dict[str, Any], selected: list[dict[str, Any]], selection: dict[str, Any], run_dir: Path) -> dict[str, Any]:
    if not selected:
        return dict(state)
    last = selected[-1]
    pass_number = int(state.get("pass_number") or 1)
    if selection.get("wrapped"):
        pass_number += 1
    return {
        "last_plant_id": int(last["plant_id"]),
        "last_plant_name": str(last["plant_name"]),
        "pass_number": pass_number,
        "checked_count": int(state.get("checked_count") or 0) + len(selected),
        "updated_at": _now(),
        "last_run_dir": str(run_dir),
    }


def classify_static_findings(conn: sqlite3.Connection, plant: dict[str, Any]) -> list[dict[str, Any]]:
    findings: list[dict[str, Any]] = []
    row_report = validate_row("Plants", plant)
    for error in row_report["errors"]:
        findings.append(_finding("Plants", "validation_error", "high", error, confidence="high"))
    for warning in row_report["warnings"]:
        findings.append(_finding("Plants", "validation_warning", "medium", warning, confidence="medium"))
    findings.extend(_temperature_findings(plant))
    findings.extend(_lifecycle_findings(plant))
    findings.extend(_method_findings(conn, plant))
    findings.extend(_timing_spacing_yield_findings(plant))
    return findings


def _verify_one_plant(
    conn: sqlite3.Connection,
    settings: Settings,
    plant: dict[str, Any],
    generated: dict[str, list[dict[str, Any]]],
    provenance: dict[str, Any],
    openai: OpenAIJsonClient | None,
    fdc: CachedFdcClient | None,
) -> dict[str, Any]:
    plant_name = str(plant.get("plant_name") or plant.get("plant_id"))
    context = _dependent_context(conn, plant)
    findings = classify_static_findings(conn, plant)
    findings.extend(_dependent_findings(settings, plant, context))
    skipped: list[dict[str, Any]] = []
    source_bundle = _source_bundle_for_plant(plant, findings, openai, provenance, skipped)
    proposed: dict[str, int] = {}
    _propose_plant_replacements(plant, findings, source_bundle, generated, proposed)
    _propose_allowed_categories(conn, plant, context, source_bundle, generated, proposed, findings)
    _propose_varieties(settings, plant, context, generated, proposed, findings)
    _propose_growth_stage(plant, context, source_bundle, generated, proposed, findings)
    _propose_nutrition(plant, context, generated, proposed, findings, provenance, fdc, openai)
    _report_planting_window_gap(settings, plant, context, findings)
    _report_recipe_gap(plant, context, findings)
    return {
        "plant_id": plant.get("plant_id"),
        "plant_name": plant_name,
        "findings": findings,
        "confidence": _overall_confidence(findings),
        "source_urls": source_bundle.get("source_urls") or [],
        "source_notes": source_bundle.get("source_notes") or [],
        "generated_rows": proposed,
        "skipped": skipped,
        "no_change_fields": _no_change_fields(plant, findings, proposed),
    }


def _source_bundle_for_plant(
    plant: dict[str, Any],
    findings: list[dict[str, Any]],
    openai: OpenAIJsonClient | None,
    provenance: dict[str, Any],
    skipped: list[dict[str, Any]],
) -> dict[str, Any]:
    if not findings:
        skipped.append({"provider": "openai_web_search", "reason": "static checks found no suspicious fields or missing essentials"})
        return {}
    if not openai:
        skipped.append({"provider": "openai_web_search", "reason": "OPENAI_API_KEY unavailable or OpenAI disabled"})
        return {}
    try:
        result, trace = openai.generate_json_with_web_search(
            schema_name="trellis_verify_crop_bundle",
            json_schema=_verify_bundle_schema(),
            system=(
                "You verify one existing Trellis crop row using live web sources. "
                "Return conservative, source-backed replacement values only where the supplied finding is suspicious. "
                "Use expert_estimate only when a source-backed value is unavailable, and mark it lower confidence."
            ),
            user=json.dumps({
                "plant": plant,
                "findings": findings,
                "instructions": {
                    "minimal_diffs": True,
                    "keep_plausible_existing_values": True,
                    "do_not_generate_task_recipes": True,
                    "required_tables": VERIFY_TABLES,
                },
            }, indent=2),
        )
        provenance.setdefault("traces", []).append(trace.redacted())
        return result
    except ProviderError as exc:
        skipped.append({"provider": "openai_web_search", "reason": str(exc)})
        provenance.setdefault("traces", []).append(ProviderTrace("openai", {"mode": "verify_web_search", "plant": plant.get("plant_name")}, error=str(exc)).redacted())
        return {}


def _propose_plant_replacements(
    plant: dict[str, Any],
    findings: list[dict[str, Any]],
    source_bundle: dict[str, Any],
    generated: dict[str, list[dict[str, Any]]],
    proposed: dict[str, int],
) -> None:
    suspicious_fields = _suspicious_plant_fields(findings)
    if not suspicious_fields:
        return
    candidate = dict(plant)
    bundle_row = source_bundle.get("plant_row") if isinstance(source_bundle.get("plant_row"), dict) else {}
    changed = []
    for field in sorted(suspicious_fields):
        value = bundle_row.get(field)
        if field in PLANT_COLUMNS and value not in (None, "") and value != plant.get(field):
            candidate[field] = value
            changed.append({"field": field, "confidence": source_bundle.get("confidence") or "medium", "source": "openai_web_search"})
    if candidate.get("gdd_to_maturity") in (None, "") and _finite_number(plant.get("days_maturity")) is not None:
        estimate = _estimate_gdd_to_maturity(plant)
        if estimate is not None:
            candidate["gdd_to_maturity"] = estimate
            changed.append({"field": "gdd_to_maturity", "confidence": "low", "source": "expert_estimate", "source_note": "Estimated from days_maturity and temperature base/optimum values."})
    if not changed:
        return
    candidate["provenance"] = {"field_sources": [{"field": item["field"], "source": item.get("source_note") or item["source"]} for item in changed]}
    if validate_row("Plants", candidate)["errors"]:
        return
    generated.setdefault("Plants", []).append(candidate)
    proposed["Plants"] = proposed.get("Plants", 0) + 1


def _propose_allowed_categories(
    conn: sqlite3.Connection,
    plant: dict[str, Any],
    context: dict[str, Any],
    source_bundle: dict[str, Any],
    generated: dict[str, list[dict[str, Any]]],
    proposed: dict[str, int],
    findings: list[dict[str, Any]],
) -> None:
    if context["allowed_categories"]:
        return
    categories = [str(value).strip() for value in source_bundle.get("allowed_method_categories") or [] if str(value).strip()]
    if not categories:
        method = _method_row(conn, plant.get("default_planting_method"))
        if method and method.get("method_category_id"):
            categories = [str(method["method_category_id"])]
    for category in sorted(set(categories)):
        generated.setdefault("PlantAllowedMethodCategories", []).append({"plant_name": plant["plant_name"], "method_category_id": category})
        proposed["PlantAllowedMethodCategories"] = proposed.get("PlantAllowedMethodCategories", 0) + 1
        findings.append(_finding("PlantAllowedMethodCategories", "missing_allowed_category", "medium", f"Proposed allowed method category {category}.", confidence="medium"))


def _propose_varieties(settings: Settings, plant: dict[str, Any], context: dict[str, Any], generated: dict[str, list[dict[str, Any]]], proposed: dict[str, int], findings: list[dict[str, Any]]) -> None:
    wanted = int(settings.data.get("default_variety_count", 5) or 5)
    existing_names = {normalize_key(row.get("variety_name")) for row in context["varieties"]}
    missing = [row for row in generic_maturity_varieties_for_plant(plant)[:wanted] if normalize_key(row.get("variety_name")) not in existing_names]
    if not missing:
        return
    generated.setdefault("PlantVarieties", []).extend(missing)
    proposed["PlantVarieties"] = proposed.get("PlantVarieties", 0) + len(missing)
    findings.append(_finding("PlantVarieties", "missing_generic_varieties", "medium", f"Missing {len(missing)} generic maturity variety row(s).", confidence="high"))


def _propose_growth_stage(
    plant: dict[str, Any],
    context: dict[str, Any],
    source_bundle: dict[str, Any],
    generated: dict[str, list[dict[str, Any]]],
    proposed: dict[str, int],
    findings: list[dict[str, Any]],
) -> None:
    if any(normalize_key(row.get("stage_key")) == "mature" for row in context["growth_stages"]):
        return
    bundle_stages = [row for row in source_bundle.get("growth_stages") or [] if normalize_key(row.get("stage_key")) == "mature"]
    stage = dict(bundle_stages[0]) if bundle_stages else {
        "stage_key": "mature",
        "stage_label": "Mature",
        "gdd_ratio": 1.0,
        "spacing_ratio": 1.0,
        "plant_diameter_ratio": 1.0,
        "plant_height_ratio": 1.0,
        "sort_order": 100,
        "active": 1,
        "is_default": 0 if any(int(row.get("is_default") or 0) == 1 for row in context["growth_stages"]) else 1,
    }
    row = {"plant_name": plant["plant_name"], **stage}
    if validate_row("PlantGrowthStages", row)["errors"]:
        return
    generated.setdefault("PlantGrowthStages", []).append(row)
    proposed["PlantGrowthStages"] = proposed.get("PlantGrowthStages", 0) + 1
    findings.append(_finding("PlantGrowthStages", "missing_mature_stage", "medium", "Proposed Mature growth stage.", confidence="medium"))


def _propose_nutrition(
    plant: dict[str, Any],
    context: dict[str, Any],
    generated: dict[str, list[dict[str, Any]]],
    proposed: dict[str, int],
    findings: list[dict[str, Any]],
    provenance: dict[str, Any],
    fdc: CachedFdcClient | None,
    openai: OpenAIJsonClient | None,
) -> None:
    missing_values = sorted(NUTRITION_NUTRIENT_KEYS - context["nutrition_value_keys"])
    if context["nutrition_mapping"] and not missing_values:
        return
    if not fdc or not openai:
        provenance.setdefault("skipped", []).append({"provider": "fdc", "plant": plant.get("plant_name"), "reason": "FoodData Central or OpenAI fallback unavailable"})
        return
    try:
        ensure_reference_nutrition_rows(generated)
        mappings, values, traces = synthesize_nutrition_for_plant(plant_row=plant, aliases=[str(plant["plant_name"])], fdc=fdc, openai=openai)
        if mappings:
            generated.setdefault("PlantNutritionMappings", []).extend(mappings)
            proposed["PlantNutritionMappings"] = proposed.get("PlantNutritionMappings", 0) + len(mappings)
        if values:
            generated.setdefault("PlantNutritionValues", []).extend(values)
            proposed["PlantNutritionValues"] = proposed.get("PlantNutritionValues", 0) + len(values)
        provenance.setdefault("traces", []).extend(traces)
        findings.append(_finding("PlantNutritionValues", "missing_nutrition", "medium", "Proposed nutrition rows from FoodData Central with documented fallback when needed.", confidence="medium"))
    except Exception as exc:
        provenance.setdefault("skipped", []).append({"provider": "fdc", "plant": plant.get("plant_name"), "reason": str(exc)})


def _report_planting_window_gap(settings: Settings, plant: dict[str, Any], context: dict[str, Any], findings: list[dict[str, Any]]) -> None:
    if not (settings.data.get("sowing_windows") or {}).get("enabled"):
        return
    if not context["planting_windows"]:
        findings.append(_finding("PlantingWindowReferences", "missing_sowing_window_references", "medium", "No configured sowing-window references found; verify mode reports this gap but leaves generation to source-backed sowing-window runs.", confidence="high"))


def _report_recipe_gap(plant: dict[str, Any], context: dict[str, Any], findings: list[dict[str, Any]]) -> None:
    default_method = normalize_key(plant.get("default_planting_method"))
    has_recipe = any(default_method in _method_ids_from_recipe(row) for row in context["recipes"])
    if default_method and not has_recipe:
        findings.append(_finding("PlantTaskTemplates", "missing_recipe_coverage", "low", "No plant-default task recipe covers the default planting method; verify mode does not create recipes.", confidence="high"))


def _dependent_context(conn: sqlite3.Connection, plant: dict[str, Any]) -> dict[str, Any]:
    plant_id = int(plant["plant_id"])
    return {
        "allowed_categories": _rows(conn, "SELECT * FROM PlantAllowedMethodCategories WHERE plant_id=? ORDER BY method_category_id", [plant_id]),
        "varieties": _rows(conn, "SELECT * FROM PlantVarieties WHERE plant_id=? ORDER BY variety_name", [plant_id]),
        "growth_stages": _rows(conn, "SELECT * FROM PlantGrowthStages WHERE plant_id=? ORDER BY sort_order, stage_key", [plant_id], optional=True),
        "nutrition_mapping": _rows(conn, "SELECT * FROM PlantNutritionMappings WHERE plant_id=? AND food_form='raw'", [plant_id], optional=True),
        "nutrition_value_keys": {str(row["nutrient_key"]) for row in _rows(conn, "SELECT nutrient_key FROM PlantNutritionValues WHERE plant_id=?", [plant_id], optional=True)},
        "planting_windows": _rows(conn, "SELECT * FROM PlantingWindowReferences WHERE plant_id=?", [plant_id], optional=True),
        "recipes": _rows(conn, "SELECT * FROM PlantTaskTemplates WHERE plant_id=?", [plant_id], optional=True),
    }


def _dependent_findings(settings: Settings, plant: dict[str, Any], context: dict[str, Any]) -> list[dict[str, Any]]:
    findings = []
    if not context["allowed_categories"]:
        findings.append(_finding("PlantAllowedMethodCategories", "missing_allowed_categories", "medium", "Plant has no allowed method categories.", confidence="high"))
    if len(context["varieties"]) < int(settings.data.get("default_variety_count", 5) or 5):
        findings.append(_finding("PlantVarieties", "missing_varieties", "medium", "Plant has fewer generic maturity varieties than configured.", confidence="high"))
    if not any(normalize_key(row.get("stage_key")) == "mature" for row in context["growth_stages"]):
        findings.append(_finding("PlantGrowthStages", "missing_mature_stage", "medium", "Plant is missing a Mature growth stage.", confidence="high"))
    if not context["nutrition_mapping"] or len(context["nutrition_value_keys"]) < len(NUTRITION_NUTRIENT_KEYS):
        findings.append(_finding("PlantNutritionValues", "missing_nutrition_rows", "medium", "Plant is missing raw nutrition mapping or required nutrient values.", confidence="high"))
    return findings


def _temperature_findings(plant: dict[str, Any]) -> list[dict[str, Any]]:
    findings = []
    order = [("tmin_c", plant.get("tmin_c")), ("topt_low_c", plant.get("topt_low_c")), ("topt_high_c", plant.get("topt_high_c")), ("tmax_c", plant.get("tmax_c"))]
    numbers = [(field, _finite_number(value)) for field, value in order]
    if all(value is not None for _field, value in numbers):
        values = [value for _field, value in numbers]
        if values != sorted(values):
            findings.append(_finding("Plants", "temperature_order", "high", "Temperature fields should satisfy tmin_c <= topt_low_c <= topt_high_c <= tmax_c.", fields=[field for field, _value in numbers], confidence="high"))
    kill = _finite_number(plant.get("killtemp_c"))
    tmin = _finite_number(plant.get("tmin_c"))
    if kill is not None and tmin is not None and kill > tmin:
        findings.append(_finding("Plants", "killtemp_above_tmin", "medium", "killtemp_c is warmer than tmin_c, which is suspicious for cold-tolerance modeling.", fields=["killtemp_c", "tmin_c"], confidence="medium"))
    return findings


def _lifecycle_findings(plant: dict[str, Any]) -> list[dict[str, Any]]:
    count = sum(1 for key in ("annual", "biennial", "perennial") if _optional_int(plant.get(key)) == 1)
    return [] if count == 1 else [_finding("Plants", "lifecycle_flag_count", "medium", "Exactly one lifecycle flag should normally be set.", fields=["annual", "biennial", "perennial"], confidence="medium")]


def _method_findings(conn: sqlite3.Connection, plant: dict[str, Any]) -> list[dict[str, Any]]:
    default_method = str(plant.get("default_planting_method") or "").strip()
    if not default_method:
        return [_finding("Plants", "missing_default_method", "high", "default_planting_method is empty.", fields=["default_planting_method"], confidence="high")]
    method = _method_row(conn, default_method)
    if not method:
        return [_finding("Plants", "unknown_default_method", "high", f"default_planting_method is not a known PlantingMethods row: {default_method}", fields=["default_planting_method"], confidence="high")]
    category = str(method.get("method_category_id") or "")
    declared = str(plant.get("default_planting_method_category") or "").strip()
    if declared and category and declared != category:
        return [_finding("Plants", "default_method_category_mismatch", "high", f"default_planting_method_category {declared} does not match {default_method} category {category}.", fields=["default_planting_method_category", "default_planting_method"], confidence="high")]
    return []


def _timing_spacing_yield_findings(plant: dict[str, Any]) -> list[dict[str, Any]]:
    findings = []
    if _finite_number(plant.get("gdd_to_maturity")) is None:
        findings.append(_finding("Plants", "missing_gdd_to_maturity", "high", "gdd_to_maturity is missing or non-numeric.", fields=["gdd_to_maturity"], confidence="high"))
    for field in ("days_maturity", "spacing_cm", "yield_per_plant_kg"):
        value = _finite_number(plant.get(field))
        if value is not None and value <= 0:
            findings.append(_finding("Plants", f"nonpositive_{field}", "high", f"{field} should be positive.", fields=[field], confidence="high"))
    return findings


def _create_verify_run(settings: Settings, plants: list[dict[str, Any]], state: dict[str, Any], selection: dict[str, Any], batch_size: int) -> Path:
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    slug = slugify("-".join(str(row.get("plant_name") or row.get("plant_id")) for row in plants))
    run_dir = unique_artifact_dir(settings.runs_dir, "verify", timestamp, slug)
    (run_dir / "generated").mkdir(parents=True, exist_ok=True)
    (run_dir / "traces").mkdir(parents=True, exist_ok=True)
    write_json(run_dir / "metadata.json", {
        "run_id": run_dir.name,
        "status": "running",
        "mode": "verify",
        "created_at": _now(),
        "db_path": str(settings.db_path),
        "openai_model": settings.openai_model,
        "openai_reasoning_effort": settings.openai_reasoning_effort,
        "verify_options": {"batch_size": batch_size},
        "cursor_before": state,
        "selection": selection,
        "effective_tables": VERIFY_TABLES,
    })
    write_json(run_dir / "input.normalized.json", {"mode": "verify", "plants": selection.get("plant_names") or []})
    return run_dir


def _write_generated(run_dir: Path, generated: dict[str, list[dict[str, Any]]]) -> None:
    for table, rows in generated.items():
        if rows:
            write_json(run_dir / "generated" / f"{table}.json", rows)


def _update_metadata(run_dir: Path, updates: dict[str, Any]) -> None:
    metadata = read_json(run_dir / "metadata.json", {}) or {}
    metadata.update(updates)
    write_json(run_dir / "metadata.json", metadata)


def _load_plants(conn: sqlite3.Connection) -> list[dict[str, Any]]:
    return [dict(row) for row in conn.execute("SELECT * FROM Plants ORDER BY plant_id")]


def _rows(conn: sqlite3.Connection, sql: str, params: list[Any], optional: bool = False) -> list[dict[str, Any]]:
    try:
        return [dict(row) for row in conn.execute(sql, params)]
    except sqlite3.OperationalError:
        if optional:
            return []
        raise


def _method_row(conn: sqlite3.Connection, method_id: Any) -> dict[str, Any] | None:
    method = str(method_id or "").strip()
    if not method:
        return None
    row = conn.execute("SELECT * FROM PlantingMethods WHERE method_id=?", [method]).fetchone()
    return dict(row) if row else None


def _method_ids_from_recipe(row: dict[str, Any]) -> set[str]:
    values = _parse_json_list(row.get("method_ids_json"))
    if not values and row.get("method_id"):
        values = [row.get("method_id")]
    return {normalize_key(value) for value in values}


def _parse_json_list(value: Any) -> list[str]:
    try:
        parsed = json.loads(str(value or "[]"))
    except json.JSONDecodeError:
        return []
    return [str(item).strip() for item in parsed if str(item).strip()] if isinstance(parsed, list) else []


def _suspicious_plant_fields(findings: list[dict[str, Any]]) -> set[str]:
    fields: set[str] = set()
    for finding in findings:
        if finding.get("table") != "Plants":
            continue
        fields.update(str(field) for field in finding.get("fields") or [])
        message = str(finding.get("message") or "")
        for field in PLANT_COLUMNS:
            if f".{field}" in message or message.startswith(field):
                fields.add(field)
    return fields


def _no_change_fields(plant: dict[str, Any], findings: list[dict[str, Any]], proposed: dict[str, int]) -> list[str]:
    if proposed.get("Plants"):
        return []
    suspicious = _suspicious_plant_fields(findings)
    return sorted(field for field in PLANT_COLUMNS if field not in suspicious and field in plant)


def _report_summary(plant_reports: list[dict[str, Any]], generated: dict[str, list[dict[str, Any]]]) -> dict[str, int]:
    return {
        "checked": len(plant_reports),
        "findings": sum(len(report.get("findings") or []) for report in plant_reports),
        "generated_rows": sum(len(rows) for rows in generated.values()),
    }


def _finding(table: str, code: str, severity: str, message: str, *, fields: list[str] | None = None, confidence: str = "medium") -> dict[str, Any]:
    return {"table": table, "code": code, "severity": severity, "confidence": confidence, "message": message, "fields": fields or []}


def _overall_confidence(findings: list[dict[str, Any]]) -> str:
    if any(item.get("confidence") == "low" for item in findings):
        return "low"
    if any(item.get("confidence") == "medium" for item in findings):
        return "medium"
    return "high"


def _estimate_gdd_to_maturity(plant: dict[str, Any]) -> float | None:
    days = _finite_number(plant.get("days_maturity"))
    if days is None:
        return None
    tbase = _finite_number(plant.get("tbase_c")) or 5.0
    topt_low = _finite_number(plant.get("topt_low_c"))
    topt_high = _finite_number(plant.get("topt_high_c"))
    if topt_low is None or topt_high is None:
        daily_gdd = 10.0
    else:
        daily_gdd = max(1.0, ((topt_low + topt_high) / 2.0) - tbase)
    return round(days * daily_gdd, 1)


def _finite_number(value: Any) -> float | None:
    if value in (None, "") or isinstance(value, bool):
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _optional_int(value: Any) -> int | None:
    if value in (None, ""):
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _default_openai(settings: Settings, *, enabled: bool) -> OpenAIJsonClient | None:
    api_key = read_openai_api_key()
    if not enabled or not api_key:
        return None
    return OpenAIJsonClient(api_key, settings.openai_model, settings.openai_reasoning_effort)


def _default_fdc(settings: Settings, run_dir: Path, *, enabled: bool) -> CachedFdcClient | None:
    if not enabled:
        return None
    return CachedFdcClient(FoodDataCentralClient(settings.data.get("fdc") or {}), run_dir / "traces" / "fdc")


def _state_path(settings: Settings) -> Path:
    return settings.runs_dir / VERIFY_STATE_FILENAME


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _verify_bundle_schema() -> dict[str, Any]:
    plant_properties = {
        key: ({"type": "string"} if field_type == "string" else {"type": field_type})
        for key, field_type in sorted(PLANT_FIELD_TYPES.items())
    }
    return {
        "type": "object",
        "additionalProperties": False,
        "properties": {
            "confidence": {"type": "string", "enum": ["low", "medium", "high"]},
            "source_urls": {"type": "array", "items": {"type": "string"}},
            "source_notes": {"type": "array", "items": {"type": "string"}},
            "plant_row": {
                "type": "object",
                "additionalProperties": False,
                "properties": plant_properties,
                "required": sorted(PLANT_COLUMNS - {"plant_id"}),
            },
            "allowed_method_categories": {"type": "array", "items": {"type": "string"}},
            "growth_stages": {
                "type": "array",
                "items": {
                    "type": "object",
                    "additionalProperties": False,
                    "properties": {
                        "stage_key": {"type": "string"},
                        "stage_label": {"type": "string"},
                        "gdd_ratio": {"type": "number"},
                        "spacing_ratio": {"type": ["number", "null"]},
                        "plant_diameter_ratio": {"type": ["number", "null"]},
                        "plant_height_ratio": {"type": ["number", "null"]},
                        "sort_order": {"type": "integer"},
                        "active": {"type": "integer"},
                        "is_default": {"type": "integer"},
                    },
                    "required": ["stage_key", "stage_label", "gdd_ratio", "spacing_ratio", "plant_diameter_ratio", "plant_height_ratio", "sort_order", "active", "is_default"],
                },
            },
        },
        "required": ["confidence", "source_urls", "source_notes", "plant_row", "allowed_method_categories", "growth_stages"],
    }
