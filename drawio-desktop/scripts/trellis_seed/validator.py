from __future__ import annotations

import json
import sqlite3
from contextlib import closing
from pathlib import Path
from typing import Any

from .jsonio import read_json, write_json
from .schema import (
    CITY_CLIMATE_BANDS,
    CITY_COLUMNS,
    CITY_GEO_IDENTITY_COLUMNS,  # ADDED
    GENERATED_TABLES,
    PLANTING_WINDOW_CONFIDENCE,
    PLANTING_WINDOW_REFERENCE_COLUMNS,
    PLANTING_WINDOW_STAGES,
    PLANT_COLUMNS,
    PLANT_FIELD_TYPES,
    PLANT_FLAG_FIELDS,
    PLANT_INTEGER_FIELDS,
    PLANT_VARIETY_COLUMNS,  # ADDED
    PLANT_REAL_FIELDS,
    PLANT_TEXT_FIELDS,
    VARIETY_MATURITY_CLASSES,  # ADDED
)


HARD_PLANT_RANGES = {
    "yield_per_plant_kg": (0, 10000),
    "days_maturity": (0, 5000),
    "days_transplant": (0, 1000),
    "days_germ": (0, 365),
    "gdd_to_maturity": (0, 20000),
    "spacing_cm": (0, 10000),
    "tmin_c": (-80, 80),
    "tmax_c": (-80, 80),
    "tbase_c": (-80, 80),
    "killtemp_c": (-80, 80),
}

WARN_PLANT_RANGES = {
    "yield_per_plant_kg": (0, 250),
    "days_maturity": (0, 730),
    "days_germ": (0, 60),
    "spacing_cm": (0, 1000),
}


def normalize_key(value: Any) -> str:
    return " ".join(str(value or "").strip().casefold().split())


def validate_input(input_data: dict[str, Any]) -> list[str]:
    errors: list[str] = []
    selected = input_data.get("tables")
    if selected is not None:
        if not isinstance(selected, list) or not all(isinstance(x, str) for x in selected):
            errors.append("tables must be a list of table names.")
        else:
            unknown = sorted(set(selected) - set(GENERATED_TABLES))
            if unknown:
                errors.append(f"Unknown table selections: {', '.join(unknown)}")

    for crop in input_data.get("crops", []) or []:
        name = str(crop.get("name") or crop.get("plant_name") or "").strip()
        sources = crop.get("sources") or []
        notes = str(crop.get("notes") or "").strip()
        if not name:
            errors.append("Every crop input needs name or plant_name.")
        if not sources and not notes:
            errors.append(f"Crop '{name or '[missing]'}' needs at least one source URL or notes.")

    for companion in input_data.get("companions", []) or []:
        p1 = str(companion.get("p1") or "").strip()
        p2 = str(companion.get("p2") or "").strip()
        sources = companion.get("sources") or []
        notes = str(companion.get("notes") or "").strip()
        if not p1 or not p2:
            errors.append("Every companion input needs p1 and p2.")
        if not sources and not notes:
            errors.append(f"Companion '{p1} / {p2}' needs source URLs or notes.")

    for city in input_data.get("cities", []) or []:
        if not str(city.get("name") or city.get("city_name") or "").strip():
            errors.append("Every city input needs name or city_name.")
    return errors


def source_values_from_input(item: dict[str, Any]) -> set[str]:
    values = {str(source) for source in (item.get("sources") or [])}
    notes = str(item.get("notes") or "").strip()
    if notes:
        values.add(notes)
    return values


def validate_task_template(template: dict[str, Any], allowed_stages: set[str] | None = None) -> list[str]:
    errors: list[str] = []
    if not isinstance(template, dict):
        return ["Task template must be an object."]
    if template.get("version") != 2:
        errors.append("Task template version must be 2.")
    rules = template.get("rules")
    if not isinstance(rules, list) or not rules:
        errors.append("Task template must include at least one rule.")
        return errors
    allowed = allowed_stages or {"SOW", "GERM", "TRANSPLANT", "HARVEST_START", "HARVEST_END"}
    for index, rule in enumerate(rules):
        prefix = f"rule[{index}]"
        title = str(rule.get("title") or "").strip()
        stage = str(rule.get("startAnchorStage") or "").strip()
        end_stage = rule.get("endAnchorStage")
        cutoff_stage = str(rule.get("repeatUntilAnchorStage") or "HARVEST_END")
        if not title:
            errors.append(f"{prefix} title is required.")
        if stage not in allowed:
            errors.append(f"{prefix} startAnchorStage '{stage}' is not allowed.")
        if int(rule.get("startOffsetDays") or 0) < 0:
            errors.append(f"{prefix} startOffsetDays cannot be negative.")
        if rule.get("endMode") not in ("fixed_days", "anchor_range"):
            errors.append(f"{prefix} endMode must be fixed_days or anchor_range.")
        if rule.get("endMode") == "anchor_range" and end_stage not in allowed:
            errors.append(f"{prefix} endAnchorStage '{end_stage}' is not allowed.")
        if str(rule.get("repeatMode") or "none") == "interval" and cutoff_stage not in allowed:
            errors.append(f"{prefix} repeatUntilAnchorStage '{cutoff_stage}' is not allowed.")
    return errors


def validate_run(run_dir: Path, db_path: Path | None = None, write_report: bool = True) -> dict[str, Any]:
    generated_dir = run_dir / "generated"
    errors: list[str] = []
    warnings: list[str] = []
    counts: dict[str, int] = {}

    if not generated_dir.exists():
        errors.append(f"Missing generated directory: {generated_dir}")
    else:
        for path in sorted(generated_dir.glob("*.json")):
            table = path.stem
            rows = read_json(path, [])
            if not isinstance(rows, list):
                errors.append(f"{path.name} must contain a list.")
                continue
            counts[table] = len(rows)
            for i, row in enumerate(rows):
                if not isinstance(row, dict):
                    errors.append(f"{table}[{i}] must be an object.")
                    continue
                row_report = validate_row(table, row, index=i)
                errors.extend(row_report["errors"])
                warnings.extend(row_report["warnings"])

    if db_path and db_path.exists():
        dep_report = _validate_db_dependencies(generated_dir, db_path)
        errors.extend(dep_report["errors"])
        warnings.extend(dep_report["warnings"])
    report = {"ok": not errors, "errors": errors, "warnings": warnings, "counts": counts}
    if write_report:
        write_json(run_dir / "validation_report.json", report)
    return report


def validate_row(
    table: str,
    row: dict[str, Any],
    index: int = 0,
    source_values: set[str] | None = None,
    required_source_fields: set[str] | None = None,
) -> dict[str, list[str]]:
    errors: list[str] = []
    warnings: list[str] = []
    prefix = f"{table}[{index}]"
    if table == "Plants":
        if not str(row.get("plant_name") or "").strip():
            errors.append(f"{prefix}.plant_name is required.")
        unknown = sorted(set(row) - PLANT_COLUMNS - {"provenance"})
        if unknown:
            errors.append(f"{prefix} has unknown plant columns: {unknown}")
        _validate_complete_plant_row(prefix, row, errors)
        _validate_ranges(prefix, row, HARD_PLANT_RANGES, errors, hard=True)
        _validate_ranges(prefix, row, WARN_PLANT_RANGES, warnings, hard=False)
        tmin = _coerce_number(row.get("tmin_c"))
        tmax = _coerce_number(row.get("tmax_c"))
        if tmin is not None and tmax is not None and tmin > tmax:
            errors.append(f"{prefix}.tmin_c cannot exceed tmax_c.")
        lifecycle_count = sum(1 for key in ("annual", "biennial", "perennial") if _coerce_integer(row.get(key)) == 1)
        if lifecycle_count > 1:
            warnings.append(f"{prefix} has multiple lifecycle flags set.")
    elif table == "Cities":
        if not str(row.get("city_name") or "").strip():
            errors.append(f"{prefix}.city_name is required.")
        if not str(row.get("country_name") or "").strip():
            errors.append(f"{prefix}.country_name is required.")  # ADDED
        if not str(row.get("region_name") or "").strip():
            errors.append(f"{prefix}.region_name is required.")  # ADDED
        unknown = sorted(set(row) - CITY_COLUMNS)
        if unknown:
            errors.append(f"{prefix} has unknown city columns: {unknown}")
        _number_between(prefix, row, "latitude", -90, 90, errors)
        _number_between(prefix, row, "longitude", -180, 180, errors)
        _number_between(prefix, row, "gdd_annual", 0, 20000, errors)
        _number_between(prefix, row, "gdd_base_c", -20, 30, errors)
        if row.get("is_major_city") is not None and _coerce_integer(row.get("is_major_city")) not in {0, 1}:  # ADDED
            errors.append(f"{prefix}.is_major_city must be 0 or 1.")  # ADDED
        if row.get("climate_band") not in (None, "") and str(row.get("climate_band")).strip().casefold() not in CITY_CLIMATE_BANDS:  # ADDED
            errors.append(f"{prefix}.climate_band must be one of: {', '.join(sorted(CITY_CLIMATE_BANDS))}.")  # ADDED
        for month in range(1, 13):
            low = row.get(f"avg_monthly_low_c{month}")
            high = row.get(f"avg_monthly_high_c{month}")
            _number_between(prefix, row, f"avg_monthly_low_c{month}", -90, 70, errors)
            _number_between(prefix, row, f"avg_monthly_high_c{month}", -90, 80, errors)
            if low is not None and high is not None and float(low) > float(high):
                errors.append(f"{prefix}.avg_monthly_low_c{month} cannot exceed avg_monthly_high_c{month}.")
        for key in ("last_spring_frost_doy", "first_fall_frost_doy", "first_fall_frost_p90_doy", "first_fall_frost_p50_doy", "first_fall_frost_p10_doy", "last_spring_frost_p90_doy", "last_spring_frost_p50_doy", "last_spring_frost_p10_doy"):
            _number_between(prefix, row, key, 1, 366, errors)
    elif table in ("PlantTaskTemplates", "VarietyTaskTemplates"):
        try:
            template = json.loads(str(row.get("template_json") or "{}"))
        except json.JSONDecodeError:
            errors.append(f"{prefix}.template_json is invalid JSON.")
        else:
            errors.extend(f"{prefix}.{e}" for e in validate_task_template(template))
    elif table == "Companions":
        if not row.get("p1") or not row.get("p2"):
            errors.append(f"{prefix} needs p1 and p2.")
    elif table == "PlantVarieties":
        unknown = sorted(set(row) - PLANT_VARIETY_COLUMNS)  # ADDED
        if unknown:
            errors.append(f"{prefix} has unknown columns: {unknown}")  # ADDED
        if not row.get("plant_id") and not str(row.get("plant_name") or "").strip():
            errors.append(f"{prefix} needs plant_id or plant_name.")  # ADDED
        if not str(row.get("variety_name") or "").strip():
            errors.append(f"{prefix}.variety_name is required.")  # ADDED
        maturity_class = str(row.get("maturity_class") or "").strip().casefold()  # ADDED
        if maturity_class and maturity_class not in VARIETY_MATURITY_CLASSES:
            errors.append(f"{prefix}.maturity_class must be one of: {', '.join(sorted(VARIETY_MATURITY_CLASSES))}.")  # ADDED
    elif table == "CompanionEvidence":
        if not row.get("relation_id") and not (row.get("p1") and row.get("p2")):
            errors.append(f"{prefix} needs relation_id or p1/p2.")
        if not row.get("source_url") and not row.get("source_note"):
            errors.append(f"{prefix} needs source_url or source_note.")
    elif table == "PlantingWindowReferences":
        unknown = sorted(set(row) - PLANTING_WINDOW_REFERENCE_COLUMNS)
        if unknown:
            errors.append(f"{prefix} has unknown columns: {unknown}")
        for key in ("plant_name", "city_name", "method_id", "stage", "window_label", "start_mm_dd", "end_mm_dd", "confidence", "summary"):
            if not str(row.get(key) or "").strip() and key not in {"plant_name", "city_name"}:
                errors.append(f"{prefix}.{key} is required.")
        if not row.get("plant_id") and not str(row.get("plant_name") or "").strip():
            errors.append(f"{prefix} needs plant_id or plant_name.")
        if not row.get("city_id") and not str(row.get("city_name") or "").strip():
            errors.append(f"{prefix} needs city_id or city_name.")
        if row.get("stage") not in PLANTING_WINDOW_STAGES:
            errors.append(f"{prefix}.stage must be one of {sorted(PLANTING_WINDOW_STAGES)}.")
        if row.get("confidence") not in PLANTING_WINDOW_CONFIDENCE:
            errors.append(f"{prefix}.confidence must be one of {sorted(PLANTING_WINDOW_CONFIDENCE)}.")
        if not row.get("source_url") and not row.get("source_note"):
            errors.append(f"{prefix} needs source_url or source_note.")
        start_doy = _mm_dd_to_doy(row.get("start_mm_dd"))
        end_doy = _mm_dd_to_doy(row.get("end_mm_dd"))
        if start_doy is None:
            errors.append(f"{prefix}.start_mm_dd must be MM-DD.")
        if end_doy is None:
            errors.append(f"{prefix}.end_mm_dd must be MM-DD.")
        _number_between(prefix, row, "start_doy", 1, 366, errors)
        _number_between(prefix, row, "end_doy", 1, 366, errors)
        if start_doy is not None and row.get("start_doy") is not None and int(row["start_doy"]) != start_doy:
            errors.append(f"{prefix}.start_doy does not match start_mm_dd.")
        if end_doy is not None and row.get("end_doy") is not None and int(row["end_doy"]) != end_doy:
            errors.append(f"{prefix}.end_doy does not match end_mm_dd.")
        if row.get("is_cross_year") not in (0, 1, "0", "1", True, False):
            errors.append(f"{prefix}.is_cross_year must be 0 or 1.")
    elif table == "CityWeatherMonthly":
        for key in ("city_name", "weather_month", "provider", "dataset"):
            if not row.get(key):
                errors.append(f"{prefix}.{key} is required.")
        _validate_weather_numbers(prefix, row, errors)
        if row.get("weather_month") and not _valid_month_token(row.get("weather_month")):
            errors.append(f"{prefix}.weather_month must be YYYY-MM.")
    elif table == "CityWeatherDaily":
        for key in ("city_name", "weather_date", "provider", "dataset"):
            if not row.get(key):
                errors.append(f"{prefix}.{key} is required.")
        _validate_weather_numbers(prefix, row, errors)
    elif table == "CityWeatherForecastDaily":
        for key in ("city_name", "forecast_date", "run_timestamp", "provider", "model"):
            if not row.get(key):
                errors.append(f"{prefix}.{key} is required.")
        _validate_weather_numbers(prefix, row, errors)
    if source_values is not None:
        errors.extend(validate_source_map(row, source_values, required_source_fields or set(), prefix))
    return {"errors": errors, "warnings": warnings}


def validate_source_map(row: dict[str, Any], source_values: set[str], required_fields: set[str], prefix: str) -> list[str]:
    errors: list[str] = []
    provenance = row.get("provenance") if isinstance(row.get("provenance"), dict) else {}
    field_sources = _source_map(provenance.get("field_sources"))
    for field in sorted(required_fields):
        refs = field_sources.get(field)
        if not isinstance(refs, list) or not refs:
            errors.append(f"{prefix}.provenance.field_sources.{field} is required.")
            continue
        for ref in refs:
            if not source_ref_allowed(str(ref), source_values):  # CHANGED
                errors.append(f"{prefix}.provenance.field_sources.{field} references an input source/note that was not supplied: {ref}")
    return errors


def source_ref_allowed(ref: str, source_values: set[str]) -> bool:  # ADDED
    return _source_ref_allowed(ref, source_values)  # ADDED


def _source_ref_allowed(ref: str, source_values: set[str]) -> bool:
    if ref in source_values:
        return True
    normalized_ref = _canonical_json_string(ref)
    if normalized_ref is None:
        return False
    return any(_canonical_json_string(value) == normalized_ref for value in source_values)


def _canonical_json_string(value: Any) -> str | None:
    try:
        parsed = json.loads(str(value))
    except Exception:
        return None
    return json.dumps(parsed, sort_keys=True, separators=(",", ":"))


def _source_map(raw: Any) -> dict[str, list[str]]:
    if isinstance(raw, dict):
        return {str(key): value if isinstance(value, list) else [value] for key, value in raw.items()}
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


def _validate_db_dependencies(generated_dir: Path, db_path: Path) -> dict[str, list[str]]:
    errors: list[str] = []
    warnings: list[str] = []
    if not generated_dir.exists():
        return {"errors": errors, "warnings": warnings}
    with closing(sqlite3.connect(db_path)) as conn:
        conn.row_factory = sqlite3.Row
        methods = {row[0] for row in conn.execute("SELECT method_id FROM PlantingMethods")}
        categories = {row[0] for row in conn.execute("SELECT method_category_id FROM PlantingMethodCategories")}
        db_plants = {_norm(row["plant_name"]) for row in conn.execute("SELECT plant_name FROM Plants")}
        db_cities = _load_db_city_rows(conn)  # CHANGED
        db_varieties = {(_norm(row["plant_name"]), _norm(row["variety_name"])) for row in conn.execute("SELECT p.plant_name, v.variety_name FROM PlantVarieties v JOIN Plants p ON p.plant_id = v.plant_id")}
        db_companions = {(_norm(row["p1"]), _norm(row["p2"])) for row in conn.execute("SELECT p1, p2 FROM Companions")}

    generated_plants = {_norm(row.get("plant_name")) for row in read_json(generated_dir / "Plants.json", []) or []}
    generated_cities = read_json(generated_dir / "Cities.json", []) or []  # CHANGED
    generated_varieties = {(_norm(row.get("plant_name")), _norm(row.get("variety_name"))) for row in read_json(generated_dir / "PlantVarieties.json", []) or []}
    generated_companions = {(_norm(row.get("p1")), _norm(row.get("p2"))) for row in read_json(generated_dir / "Companions.json", []) or []}

    for row in read_json(generated_dir / "PlantAllowedMethodCategories.json", []) or []:
        if row.get("method_category_id") not in categories:
            errors.append(f"Unknown method_category_id: {row.get('method_category_id')}")
        if _norm(row.get("plant_name")) not in generated_plants | db_plants and not row.get("plant_id"):
            errors.append(f"PlantAllowedMethodCategories cannot resolve plant: {row.get('plant_name')}")
    for table in ("PlantTaskTemplates", "VarietyTaskTemplates"):
        for row in read_json(generated_dir / f"{table}.json", []) or []:
            if row.get("method_id") not in methods:
                errors.append(f"{table} has unknown method_id: {row.get('method_id')}")
            if table == "PlantTaskTemplates" and _norm(row.get("plant_name")) not in generated_plants | db_plants and not row.get("plant_id"):
                errors.append(f"{table} cannot resolve plant: {row.get('plant_name')}")
            if table == "VarietyTaskTemplates":
                key = (_norm(row.get("plant_name")), _norm(row.get("variety_name")))
                if key not in generated_varieties | db_varieties and not row.get("variety_id"):
                    errors.append(f"{table} cannot resolve variety: {row.get('plant_name')} / {row.get('variety_name')}")
    for table in ("CityWeatherMonthly", "CityWeatherDaily", "CityWeatherForecastDaily"):
        for row in read_json(generated_dir / f"{table}.json", []) or []:
            if not _city_reference_resolves(row, generated_cities, db_cities):  # CHANGED
                errors.append(f"{table} cannot resolve city: {row.get('city_name')}")
    for row in read_json(generated_dir / "CompanionEvidence.json", []) or []:
        key = (_norm(row.get("p1")), _norm(row.get("p2")))
        if key not in generated_companions | db_companions and not row.get("relation_id"):
            errors.append(f"CompanionEvidence cannot resolve companion relation: {row.get('p1')} / {row.get('p2')}")
    for row in read_json(generated_dir / "PlantingWindowReferences.json", []) or []:
        if row.get("method_id") not in methods:
            errors.append(f"PlantingWindowReferences has unknown method_id: {row.get('method_id')}")
        if _norm(row.get("plant_name")) not in generated_plants | db_plants and not row.get("plant_id"):
            errors.append(f"PlantingWindowReferences cannot resolve plant: {row.get('plant_name')}")
        if not _city_reference_resolves(row, generated_cities, db_cities):  # CHANGED
            errors.append(f"PlantingWindowReferences cannot resolve city: {row.get('city_name')}")
    return {"errors": errors, "warnings": warnings}


def _load_db_city_rows(conn: sqlite3.Connection) -> list[dict[str, Any]]:  # ADDED
    columns = {str(row[1]) for row in conn.execute("PRAGMA table_info(Cities)").fetchall()}  # ADDED
    selected = [column if column in columns else f"NULL AS {column}" for column in ("city_id", "city_name", *sorted(CITY_GEO_IDENTITY_COLUMNS))]  # ADDED
    return [dict(row) for row in conn.execute(f"SELECT {', '.join(selected)} FROM Cities")]  # ADDED


def _city_reference_resolves(row: dict[str, Any], generated_cities: list[dict[str, Any]], db_cities: list[dict[str, Any]]) -> bool:  # ADDED
    if row.get("city_id"):  # ADDED
        return True  # ADDED
    city_name = _norm(row.get("city_name"))  # ADDED
    if not city_name:  # ADDED
        return False  # ADDED
    candidates = [city for city in [*generated_cities, *db_cities] if _norm(city.get("city_name")) == city_name]  # ADDED
    if not candidates:  # ADDED
        return False  # ADDED
    if not any(_norm(row.get(field)) for field in CITY_GEO_IDENTITY_COLUMNS):  # ADDED
        return True  # ADDED
    return any(_city_geo_matches(city, row, "country_name", "country_code") and _city_geo_matches(city, row, "region_name", "region_code") for city in candidates)  # ADDED


def _city_geo_matches(city: dict[str, Any], row: dict[str, Any], name_key: str, code_key: str) -> bool:  # ADDED
    wanted_name = _norm(row.get(name_key))  # ADDED
    wanted_code = _norm(row.get(code_key))  # ADDED
    if not wanted_name and not wanted_code:  # ADDED
        return False  # ADDED
    city_name = _norm(city.get(name_key))  # ADDED
    city_code = _norm(city.get(code_key))  # ADDED
    return bool((wanted_name and wanted_name == city_name) or (wanted_code and wanted_code == city_code))  # ADDED


def _validate_ranges(prefix: str, row: dict[str, Any], ranges: dict[str, tuple[float, float]], out: list[str], hard: bool) -> None:
    for key, (lo, hi) in ranges.items():
        if row.get(key) is None:
            continue
        value = _coerce_number(row.get(key))
        if value is None:
            out.append(f"{prefix}.{key} must be numeric.")
            continue
        if value < lo or value > hi:
            kind = "outside hard bounds" if hard else "outside typical range"
            out.append(f"{prefix}.{key} {kind}: {value} not in [{lo}, {hi}].")


def _validate_weather_numbers(prefix: str, row: dict[str, Any], errors: list[str]) -> None:
    _number_between(prefix, row, "temp_min_c", -90, 70, errors)
    _number_between(prefix, row, "temp_max_c", -90, 80, errors)
    _number_between(prefix, row, "precipitation_mm", 0, 5000, errors)
    _number_between(prefix, row, "rain_mm", 0, 5000, errors)
    if row.get("temp_min_c") is not None and row.get("temp_max_c") is not None and float(row["temp_min_c"]) > float(row["temp_max_c"]):
        errors.append(f"{prefix}.temp_min_c cannot exceed temp_max_c.")


def _mm_dd_to_doy(value: Any) -> int | None:
    text = str(value or "").strip()
    parts = text.split("-")
    if len(parts) != 2:
        return None
    try:
        month = int(parts[0])
        day = int(parts[1])
    except ValueError:
        return None
    month_days = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
    if month < 1 or month > 12:
        return None
    if day < 1 or day > month_days[month - 1]:
        return None
    return sum(month_days[:month - 1]) + day


def _number_between(prefix: str, row: dict[str, Any], key: str, lo: float, hi: float, errors: list[str]) -> None:
    if row.get(key) is None:
        return
    try:
        value = float(row[key])
    except (TypeError, ValueError):
        errors.append(f"{prefix}.{key} must be numeric.")
        return
    if value < lo or value > hi:
        errors.append(f"{prefix}.{key} outside hard bounds: {value} not in [{lo}, {hi}].")


def _norm(value: Any) -> str:
    return normalize_key(value)


def _validate_complete_plant_row(prefix: str, row: dict[str, Any], errors: list[str]) -> None:
    for field in sorted(PLANT_FIELD_TYPES):
        if field not in row:
            errors.append(f"{prefix}.{field} is required.")
            continue
        value = row.get(field)
        if value is None:
            errors.append(f"{prefix}.{field} cannot be null.")
            continue
        if field in PLANT_TEXT_FIELDS:
            if not isinstance(value, str) or not value.strip():
                errors.append(f"{prefix}.{field} must be a non-empty string.")
        elif field in PLANT_INTEGER_FIELDS:
            integer = _coerce_integer(value)
            if integer is None:
                errors.append(f"{prefix}.{field} must be an integer.")
            elif field in PLANT_FLAG_FIELDS and integer not in (0, 1):
                errors.append(f"{prefix}.{field} must be 0 or 1.")
        elif field in PLANT_REAL_FIELDS and _coerce_number(value) is None:
            errors.append(f"{prefix}.{field} must be numeric.")


def _coerce_integer(value: Any) -> int | None:
    if isinstance(value, bool):
        return 1 if value else 0
    if isinstance(value, int):
        return value
    if isinstance(value, float):
        return int(value) if value.is_integer() else None
    try:
        parsed = float(str(value).strip())
    except (TypeError, ValueError):
        return None
    return int(parsed) if parsed.is_integer() else None


def _coerce_number(value: Any) -> float | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return float(value)
    try:
        return float(str(value).strip())
    except (TypeError, ValueError):
        return None


def _valid_month_token(value: Any) -> bool:
    token = str(value or "")
    if len(token) != 7 or token[4] != "-":
        return False
    year, month = token[:4], token[5:]
    return year.isdigit() and month.isdigit() and 1 <= int(month) <= 12
