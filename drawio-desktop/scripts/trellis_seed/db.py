from __future__ import annotations

import json
import shutil
import sqlite3
from contextlib import closing
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from .jsonio import read_json, write_json
from .migrations import apply_migrations, pending_migrations
from .schema import CITY_COLUMNS, PLANT_COLUMNS, PLANTING_WINDOW_REFERENCE_COLUMNS, VARIETY_MATURITY_CLASSES, WEATHER_TABLES  # CHANGED
from .validator import normalize_key, validate_run
from .weather import checksum_rows


def connect(db_path: Path) -> sqlite3.Connection:
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON;")
    return conn


def load_methods(db_path: Path) -> list[dict[str, Any]]:
    with closing(connect(db_path)) as conn:
        return [dict(row) for row in conn.execute("SELECT method_id, method_category_id, method_name, tasks_required_json FROM PlantingMethods ORDER BY method_id")]


def load_method_categories(db_path: Path) -> set[str]:
    with closing(connect(db_path)) as conn:
        return {str(row[0]) for row in conn.execute("SELECT method_category_id FROM PlantingMethodCategories")}


def load_plants(db_path: Path) -> list[dict[str, Any]]:
    with closing(connect(db_path)) as conn:
        return [dict(row) for row in conn.execute("SELECT * FROM Plants ORDER BY plant_name")]


def load_cities(db_path: Path) -> list[dict[str, Any]]:
    with closing(connect(db_path)) as conn:
        return [dict(row) for row in conn.execute("SELECT * FROM Cities ORDER BY city_name")]


def load_plant_allowed_categories(db_path: Path) -> dict[str, list[str]]:
    with closing(connect(db_path)) as conn:
        rows = conn.execute(
            """
            SELECT p.plant_name, a.method_category_id
            FROM PlantAllowedMethodCategories a
            JOIN Plants p ON p.plant_id = a.plant_id
            ORDER BY p.plant_name, a.method_category_id
            """
        )
        grouped: dict[str, list[str]] = {}
        for row in rows:
            grouped.setdefault(normalize_key(row["plant_name"]), []).append(str(row["method_category_id"]))
        return grouped


def create_diff_report(run_dir: Path, db_path: Path) -> dict[str, Any]:
    generated_dir = run_dir / "generated"
    report: dict[str, Any] = {"tables": {}, "weather": {}, "summary": {"generated_files": 0, "generated_rows": 0, "db_changes": 0, "weather_rows": 0}}
    generated_index = _load_generated_index(generated_dir)
    with closing(connect(db_path)) as conn:
        for path in sorted(generated_dir.glob("*.json")):
            table = path.stem
            rows = read_json(path, []) or []
            report["summary"]["generated_files"] += 1
            report["summary"]["generated_rows"] += len(rows)
            if table in WEATHER_TABLES:
                report["weather"][table] = _weather_summary(rows)
                report["summary"]["weather_rows"] += len(rows)
            else:
                diffs = [_diff_row(conn, table, row, generated_index) for row in rows]
                report["tables"][table] = diffs
                report["summary"]["db_changes"] += sum(1 for diff in diffs if diff["action"] != "unchanged")
    write_json(run_dir / "diff_report.json", report)
    return report


def print_diff_report(report: dict[str, Any]) -> None:
    print("\nDiff preview")
    print("============")
    summary = report.get("summary") or {}
    if not summary.get("generated_rows"):
        print("No generated rows found for this run.")
        return
    for table, diffs in report.get("tables", {}).items():
        print(f"\n[{table}] {len(diffs)} row(s)")
        for diff in diffs:
            print(f"- {diff['action']} {diff['identity']}")
            for key, change in diff.get("changes", {}).items():
                print(f"    {key}: {change['old']!r} -> {change['new']!r}")
    for table, summary in report.get("weather", {}).items():
        print(f"\n[{table}] weather summary")
        print(f"  rows: {summary['count']}")
        print(f"  date range: {summary.get('date_min')} to {summary.get('date_max')}")
        print(f"  checksum: {summary['checksum']}")
        for sample in summary.get("samples", []):
            print(f"  sample: {sample}")
    if not (report.get("summary") or {}).get("db_changes") and not (report.get("summary") or {}).get("weather_rows"):
        print("No DB changes detected.")


def apply_run(run_dir: Path, db_path: Path) -> dict[str, Any]:
    report = validate_run(run_dir, db_path)
    if not report["ok"]:
        raise RuntimeError("Run is not valid. Review validation_report.json before applying.")
    backup_path = _backup_db(db_path)
    generated_dir = run_dir / "generated"
    applied: dict[str, Any] = {"backup_path": str(backup_path), "tables": {}}
    with closing(connect(db_path)) as conn:
        try:
            with conn:
                applied["migrations"] = apply_migrations(conn)
                for table in _apply_order():
                    rows = read_json(generated_dir / f"{table}.json", []) or []
                    if rows:
                        count = _apply_table(conn, table, rows)
                        applied["tables"][table] = count
        except Exception:
            raise
    write_json(run_dir / "apply_report.json", applied)
    return applied


def apply_run_to_databases(run_dir: Path, db_paths: list[Path], seed_db_path: Path | None = None) -> dict[str, Any]:
    targets = _unique_paths(db_paths)
    if not targets:
        raise RuntimeError("No database targets configured.")
    seed_db_path = seed_db_path or targets[0]
    for target in targets:
        _ensure_apply_target_exists(target, seed_db_path)
    validation_reports = {str(target): validate_run(run_dir, target) for target in targets}
    invalid = {path: report for path, report in validation_reports.items() if not report["ok"]}
    if invalid:
        details = []
        for path, report in invalid.items():
            details.append(path)
            details.extend(f"- {error}" for error in report["errors"])
        raise RuntimeError("Run is not valid for all database targets:\n" + "\n".join(details))
    reports = []
    for target in targets:
        report = apply_run(run_dir, target)
        report["db_path"] = str(target)
        reports.append(report)
    combined = {"targets": reports}
    write_json(run_dir / "apply_report.json", combined)
    return combined


def show_pending_migrations(db_path: Path) -> list[str]:
    with closing(connect(db_path)) as conn:
        return pending_migrations(conn)


def _backup_db(db_path: Path) -> Path:
    stamp = datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S")
    backup_path = db_path.with_suffix(f".{stamp}.bak.sqlite")
    shutil.copy2(db_path, backup_path)
    return backup_path


def _ensure_apply_target_exists(target: Path, seed_db_path: Path) -> None:
    if target.exists():
        return
    if not seed_db_path.exists():
        raise RuntimeError(f"Seed DB missing; cannot initialize apply target: {seed_db_path}")
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(seed_db_path, target)


def _unique_paths(paths: list[Path]) -> list[Path]:
    seen: set[str] = set()
    result: list[Path] = []
    for path in paths:
        resolved = path.resolve()
        key = str(resolved).casefold()
        if key in seen:
            continue
        seen.add(key)
        result.append(resolved)
    return result


def _apply_order() -> list[str]:
    return [
        "Plants", "Cities", "PlantAllowedMethodCategories", "PlantVarieties",
        "Companions", "CompanionEvidence", "PlantTaskTemplates",
        "VarietyTaskTemplates", "PlantingWindowReferences", "CityWeatherMonthly", "CityWeatherDaily", "CityWeatherForecastDaily",
    ]


def _apply_table(conn: sqlite3.Connection, table: str, rows: list[dict[str, Any]]) -> int:
    if table == "Plants":
        return _upsert_named(conn, "Plants", rows, "plant_id", "plant_name", PLANT_COLUMNS)
    if table == "Cities":
        return _upsert_cities(conn, rows)  # CHANGED
    if table == "PlantAllowedMethodCategories":
        return _replace_allowed_methods(conn, rows)
    if table == "PlantVarieties":
        return _upsert_varieties(conn, rows)
    if table == "Companions":
        return _upsert_companions(conn, rows)
    if table == "CompanionEvidence":
        return _upsert_evidence(conn, rows)
    if table == "PlantTaskTemplates":
        return _replace_plant_templates(conn, rows)
    if table == "VarietyTaskTemplates":
        return _replace_variety_templates(conn, rows)
    if table == "PlantingWindowReferences":
        return _replace_planting_window_references(conn, rows)
    if table == "CityWeatherMonthly":
        return _replace_weather(conn, table, rows, "weather_month", ["city_id", "weather_month", "provider", "dataset"])
    if table == "CityWeatherDaily":
        return _replace_weather(conn, table, rows, "weather_date", ["city_id", "weather_date", "provider", "dataset"])
    if table == "CityWeatherForecastDaily":
        return _replace_weather(conn, table, rows, "forecast_date", ["city_id", "forecast_date", "run_timestamp", "provider", "model"])
    return 0


def _upsert_named(conn: sqlite3.Connection, table: str, rows: list[dict[str, Any]], id_col: str, name_col: str, columns: set[str]) -> int:
    count = 0
    for raw in rows:
        row = {k: v for k, v in raw.items() if k in columns}
        existing_id = row.get(id_col) or _find_id_by_name(conn, table, id_col, name_col, row.get(name_col))
        if existing_id:
            row[id_col] = existing_id
            assignments = [c for c in row if c != id_col]
            sql = f"UPDATE {table} SET " + ", ".join(f"{c}=?" for c in assignments) + f" WHERE {id_col}=?"
            conn.execute(sql, [row[c] for c in assignments] + [existing_id])
        else:
            if row.get(id_col) is None:
                row.pop(id_col, None)
            cols = list(row)
            conn.execute(f"INSERT INTO {table} ({', '.join(cols)}) VALUES ({', '.join('?' for _ in cols)})", [row[c] for c in cols])
        count += 1
    return count


def _upsert_cities(conn: sqlite3.Connection, rows: list[dict[str, Any]]) -> int:  # ADDED
    count = 0  # ADDED
    for raw in rows:  # ADDED
        row = {k: v for k, v in raw.items() if k in CITY_COLUMNS}  # ADDED
        existing_id = row.get("city_id") or _find_city_id(conn, row)  # ADDED
        if existing_id:  # ADDED
            row["city_id"] = existing_id  # ADDED
            assignments = [c for c in row if c != "city_id"]  # ADDED
            sql = "UPDATE Cities SET " + ", ".join(f"{c}=?" for c in assignments) + " WHERE city_id=?"  # ADDED
            conn.execute(sql, [row[c] for c in assignments] + [existing_id])  # ADDED
        else:  # ADDED
            if row.get("city_id") is None:  # ADDED
                row.pop("city_id", None)  # ADDED
            cols = list(row)  # ADDED
            conn.execute(f"INSERT INTO Cities ({', '.join(cols)}) VALUES ({', '.join('?' for _ in cols)})", [row[c] for c in cols])  # ADDED
        count += 1  # ADDED
    return count  # ADDED


def _replace_allowed_methods(conn: sqlite3.Connection, rows: list[dict[str, Any]]) -> int:
    grouped: dict[int, list[str]] = {}
    for row in rows:
        plant_id = _resolve_plant_id(conn, row)
        grouped.setdefault(plant_id, []).append(str(row["method_category_id"]))
    for plant_id, categories in grouped.items():
        conn.execute("DELETE FROM PlantAllowedMethodCategories WHERE plant_id=?", [plant_id])
        for category in sorted(set(categories)):
            conn.execute("INSERT OR IGNORE INTO PlantAllowedMethodCategories (plant_id, method_category_id) VALUES (?, ?)", [plant_id, category])
    return sum(len(v) for v in grouped.values())


def _upsert_varieties(conn: sqlite3.Connection, rows: list[dict[str, Any]]) -> int:
    now = datetime.now(timezone.utc).isoformat()
    for row in rows:
        plant_id = _resolve_plant_id(conn, row)
        variety_id = row.get("variety_id") or _find_variety_id(conn, plant_id, row.get("variety_name"))
        maturity_class = _normalize_maturity_class(row.get("maturity_class"))  # ADDED
        overrides_json = row.get("overrides_json")
        if overrides_json is None:
            overrides_json = json.dumps(row.get("overrides") or {}, sort_keys=True)
        if variety_id:
            conn.execute(
                "UPDATE PlantVarieties SET plant_id=?, variety_name=?, maturity_class=?, overrides_json=?, updated_at=? WHERE variety_id=?",
                [plant_id, row["variety_name"], maturity_class, overrides_json, now, variety_id],
            )
        else:
            conn.execute(
                "INSERT INTO PlantVarieties (plant_id, variety_name, maturity_class, overrides_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
                [plant_id, row["variety_name"], maturity_class, overrides_json, now, now],
            )
    return len(rows)


def _normalize_maturity_class(value: Any) -> str | None:  # ADDED
    normalized = str(value or "").strip().casefold()  # ADDED
    if normalized and normalized not in VARIETY_MATURITY_CLASSES:  # ADDED
        raise ValueError(f"Invalid PlantVarieties.maturity_class: {value}")  # ADDED
    return normalized if normalized in VARIETY_MATURITY_CLASSES else None  # ADDED


def _upsert_companions(conn: sqlite3.Connection, rows: list[dict[str, Any]]) -> int:
    for row in rows:
        relation_id = row.get("relation_id") or _find_companion_id(conn, row.get("p1"), row.get("p2"))
        values = [row.get("p1"), row.get("p2"), row.get("rating"), row.get("companion_type"), row.get("companion_type_id")]
        if relation_id:
            conn.execute("UPDATE Companions SET p1=?, p2=?, rating=?, companion_type=?, companion_type_id=? WHERE relation_id=?", values + [relation_id])
        else:
            conn.execute("INSERT OR IGNORE INTO Companions (p1, p2, rating, companion_type, companion_type_id) VALUES (?, ?, ?, ?, ?)", values)
    return len(rows)


def _upsert_evidence(conn: sqlite3.Connection, rows: list[dict[str, Any]]) -> int:
    now = datetime.now(timezone.utc).isoformat()
    for row in rows:
        relation_id = row.get("relation_id") or _find_companion_id(conn, row.get("p1"), row.get("p2"))
        if not relation_id:
            raise RuntimeError(f"Cannot resolve companion evidence relation for {row}")
        conn.execute(
            """
            INSERT OR REPLACE INTO CompanionEvidence
            (relation_id, evidence_level, review_status, source_url, source_note, summary, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            [relation_id, row.get("evidence_level", "source_backed"), row.get("review_status", "unreviewed"), row.get("source_url"), row.get("source_note"), row.get("summary"), now],
        )
    return len(rows)


def _replace_plant_templates(conn: sqlite3.Connection, rows: list[dict[str, Any]]) -> int:
    now = datetime.now(timezone.utc).isoformat()
    for row in rows:
        plant_id = _resolve_plant_id(conn, row)
        method_id = str(row["method_id"])
        conn.execute("DELETE FROM PlantTaskTemplates WHERE plant_id=? AND method_id=?", [plant_id, method_id])
        conn.execute("INSERT INTO PlantTaskTemplates (plant_id, method_id, template_json, updated_at) VALUES (?, ?, ?, ?)", [plant_id, method_id, row["template_json"], now])
    return len(rows)


def _replace_variety_templates(conn: sqlite3.Connection, rows: list[dict[str, Any]]) -> int:
    now = datetime.now(timezone.utc).isoformat()
    for row in rows:
        variety_id = row.get("variety_id")
        if not variety_id:
            plant_id = _resolve_plant_id(conn, row)
            variety_id = _find_variety_id(conn, plant_id, row.get("variety_name"))
        if not variety_id:
            raise RuntimeError(f"Cannot resolve variety template row: {row}")
        method_id = str(row["method_id"])
        conn.execute("DELETE FROM VarietyTaskTemplates WHERE variety_id=? AND method_id=?", [variety_id, method_id])
        conn.execute("INSERT INTO VarietyTaskTemplates (variety_id, method_id, template_json, updated_at) VALUES (?, ?, ?, ?)", [variety_id, method_id, row["template_json"], now])
    return len(rows)


def _replace_planting_window_references(conn: sqlite3.Connection, rows: list[dict[str, Any]]) -> int:
    for raw in rows:
        row = dict(raw)
        plant_id = _resolve_plant_id(conn, row)
        city_id = _resolve_city_id(conn, row)
        payload = {k: row.get(k) for k in PLANTING_WINDOW_REFERENCE_COLUMNS if k in row}
        payload["plant_id"] = plant_id
        payload["city_id"] = city_id
        payload.pop("plant_name", None)
        payload.pop("city_name", None)
        payload.pop("reference_id", None)
        cols = [
            "plant_id", "city_id", "method_id", "stage", "window_label",
            "start_mm_dd", "end_mm_dd", "start_doy", "end_doy", "is_cross_year",
            "source_url", "source_note", "confidence", "summary",
        ]
        key_cols = ["plant_id", "city_id", "method_id", "stage", "window_label", "start_mm_dd", "end_mm_dd"]
        assignments = [c for c in cols if c not in key_cols]
        sql = (
            f"INSERT INTO PlantingWindowReferences ({', '.join(cols)}) VALUES ({', '.join('?' for _ in cols)}) "
            f"ON CONFLICT({', '.join(key_cols)}) DO UPDATE SET " + ", ".join(f"{c}=excluded.{c}" for c in assignments)
        )
        conn.execute(sql, [payload.get(c) for c in cols])
    return len(rows)


def _replace_weather(conn: sqlite3.Connection, table: str, rows: list[dict[str, Any]], date_col: str, key_cols: list[str]) -> int:
    if not rows:
        return 0
    cols = [row[1] for row in conn.execute(f"PRAGMA table_info({table})")]
    for row in rows:
        row = dict(row)
        row["city_id"] = _resolve_city_id(conn, row)
        row.pop("city_name", None)
        payload = {k: row.get(k) for k in cols if k in row}
        assignments = [c for c in cols if c in payload and c not in key_cols]
        insert_cols = list(payload)
        sql = (
            f"INSERT INTO {table} ({', '.join(insert_cols)}) VALUES ({', '.join('?' for _ in insert_cols)}) "
            f"ON CONFLICT({', '.join(key_cols)}) DO UPDATE SET " + ", ".join(f"{c}=excluded.{c}" for c in assignments)
        )
        conn.execute(sql, [payload[c] for c in insert_cols])
    return len(rows)


def _diff_row(conn: sqlite3.Connection, table: str, row: dict[str, Any], generated_index: dict[str, Any]) -> dict[str, Any]:
    existing = _existing_row(conn, table, row)
    identity = _identity_label(conn, table, row, generated_index)
    if existing is None:
        return {"action": "insert", "identity": identity, "changes": {k: {"old": None, "new": v} for k, v in row.items()}}
    changes = {}
    for key, value in row.items():
        if key in existing.keys() and existing[key] != value:
            changes[key] = {"old": existing[key], "new": value}
    return {"action": "update" if changes else "unchanged", "identity": identity, "changes": changes}


def _existing_row(conn: sqlite3.Connection, table: str, row: dict[str, Any]) -> sqlite3.Row | None:
    try:
        if table == "Plants":
            return _find_row(conn, "Plants", "plant_id", "plant_name", row)
        if table == "Cities":
            return _find_row(conn, "Cities", "city_id", "city_name", row)
        if table == "Companions":
            relation_id = row.get("relation_id") or _find_companion_id(conn, row.get("p1"), row.get("p2"))
            return conn.execute("SELECT * FROM Companions WHERE relation_id=?", [relation_id]).fetchone() if relation_id else None
        if table == "PlantVarieties":
            plant_id = row.get("plant_id") or _find_id_by_name(conn, "Plants", "plant_id", "plant_name", row.get("plant_name"))
            variety_id = row.get("variety_id") or (_find_variety_id(conn, int(plant_id), row.get("variety_name")) if plant_id else None)
            return conn.execute("SELECT * FROM PlantVarieties WHERE variety_id=?", [variety_id]).fetchone() if variety_id else None
        if table == "PlantAllowedMethodCategories":
            plant_id = row.get("plant_id") or _find_id_by_name(conn, "Plants", "plant_id", "plant_name", row.get("plant_name"))
            return conn.execute("SELECT * FROM PlantAllowedMethodCategories WHERE plant_id=? AND method_category_id=?", [plant_id, row.get("method_category_id")]).fetchone() if plant_id else None
        if table == "PlantTaskTemplates":
            plant_id = row.get("plant_id") or _find_id_by_name(conn, "Plants", "plant_id", "plant_name", row.get("plant_name"))
            return conn.execute("SELECT * FROM PlantTaskTemplates WHERE plant_id=? AND method_id=?", [plant_id, row.get("method_id")]).fetchone() if plant_id else None
        if table == "VarietyTaskTemplates":
            variety_id = row.get("variety_id")
            if not variety_id:
                plant_id = row.get("plant_id") or _find_id_by_name(conn, "Plants", "plant_id", "plant_name", row.get("plant_name"))
                variety_id = _find_variety_id(conn, int(plant_id), row.get("variety_name")) if plant_id else None
            return conn.execute("SELECT * FROM VarietyTaskTemplates WHERE variety_id=? AND method_id=?", [variety_id, row.get("method_id")]).fetchone() if variety_id else None
        if table == "CompanionEvidence":
            relation_id = row.get("relation_id") or _find_companion_id(conn, row.get("p1"), row.get("p2"))
            if not relation_id:
                return None
            return conn.execute(
                "SELECT * FROM CompanionEvidence WHERE relation_id=? AND COALESCE(source_url,'')=COALESCE(?,'') AND COALESCE(source_note,'')=COALESCE(?,'')",
                [relation_id, row.get("source_url"), row.get("source_note")]
            ).fetchone()
        if table == "PlantingWindowReferences":
            plant_id = row.get("plant_id") or _find_id_by_name(conn, "Plants", "plant_id", "plant_name", row.get("plant_name"))
            city_id = row.get("city_id") or _find_city_id(conn, row)  # CHANGED
            if not plant_id or not city_id:
                return None
            return conn.execute(
                """
                SELECT * FROM PlantingWindowReferences
                WHERE plant_id=? AND city_id=? AND method_id=? AND stage=? AND window_label=? AND start_mm_dd=? AND end_mm_dd=?
                """,
                [plant_id, city_id, row.get("method_id"), row.get("stage"), row.get("window_label"), row.get("start_mm_dd"), row.get("end_mm_dd")]
            ).fetchone()
    except sqlite3.OperationalError:
        return None
    return None


def _find_row(conn: sqlite3.Connection, table: str, id_col: str, name_col: str, row: dict[str, Any]) -> sqlite3.Row | None:
    if row.get(id_col):
        found = conn.execute(f"SELECT * FROM {table} WHERE {id_col}=?", [row[id_col]]).fetchone()
        if found:
            return found
    if table == "Cities":  # ADDED
        row_id = _find_city_id(conn, row)  # ADDED
        return conn.execute("SELECT * FROM Cities WHERE city_id=?", [row_id]).fetchone() if row_id else None  # ADDED
    row_id = _find_id_by_name(conn, table, id_col, name_col, row.get(name_col))
    return conn.execute(f"SELECT * FROM {table} WHERE {id_col}=?", [row_id]).fetchone() if row_id else None


def _weather_summary(rows: list[dict[str, Any]]) -> dict[str, Any]:
    date_key = "weather_month" if rows and "weather_month" in rows[0] else ("weather_date" if rows and "weather_date" in rows[0] else "forecast_date")
    dates = sorted(str(r.get(date_key)) for r in rows if r.get(date_key))
    return {
        "count": len(rows),
        "date_min": dates[0] if dates else None,
        "date_max": dates[-1] if dates else None,
        "checksum": checksum_rows(rows),
        "samples": rows[:3],
    }


def _load_generated_index(generated_dir: Path) -> dict[str, Any]:
    plants = {normalize_key(row.get("plant_name")): row for row in read_json(generated_dir / "Plants.json", []) or []}
    cities = {_city_identity_key(row): row for row in read_json(generated_dir / "Cities.json", []) or []}  # CHANGED
    varieties = {(normalize_key(row.get("plant_name")), normalize_key(row.get("variety_name"))): row for row in read_json(generated_dir / "PlantVarieties.json", []) or []}
    companions = {(normalize_key(row.get("p1")), normalize_key(row.get("p2"))): row for row in read_json(generated_dir / "Companions.json", []) or []}
    return {"plants": plants, "cities": cities, "varieties": varieties, "companions": companions}


def _identity_label(conn: sqlite3.Connection, table: str, row: dict[str, Any], generated_index: dict[str, Any]) -> str:
    if table == "PlantVarieties":
        return f"{row.get('plant_name') or _db_plant_name(conn, row.get('plant_id'))} / {row.get('variety_name') or row.get('variety_id')}"
    if table == "PlantAllowedMethodCategories":
        return f"{row.get('plant_name') or _db_plant_name(conn, row.get('plant_id'))} / {row.get('method_category_id')}"
    if table == "PlantTaskTemplates":
        return f"{row.get('plant_name') or _db_plant_name(conn, row.get('plant_id'))} / {row.get('method_id')}"
    if table == "VarietyTaskTemplates":
        plant_name = row.get("plant_name")
        variety_name = row.get("variety_name")
        if not variety_name and row.get("variety_id"):
            found = conn.execute("SELECT p.plant_name, v.variety_name FROM PlantVarieties v JOIN Plants p ON p.plant_id=v.plant_id WHERE v.variety_id=?", [row.get("variety_id")]).fetchone()
            if found:
                plant_name, variety_name = found["plant_name"], found["variety_name"]
        return f"{plant_name or row.get('plant_id')} / {variety_name or row.get('variety_id')} / {row.get('method_id')}"
    if table == "CompanionEvidence":
        return f"{row.get('p1')} / {row.get('p2')} / {row.get('source_url') or row.get('source_note')}"
    if table == "PlantingWindowReferences":
        return f"{row.get('plant_name') or _db_plant_name(conn, row.get('plant_id'))} / {_city_identity_label(row) or _db_city_name(conn, row.get('city_id'))} / {row.get('method_id')} / {row.get('stage')} / {row.get('window_label')}"  # CHANGED
    return str(row.get("plant_name") or _city_identity_label(row) or row.get("variety_name") or row.get("method_id") or f"{row.get('p1')} / {row.get('p2')}")  # CHANGED


def _db_plant_name(conn: sqlite3.Connection, plant_id: Any) -> str:
    if not plant_id:
        return ""
    row = conn.execute("SELECT plant_name FROM Plants WHERE plant_id=?", [plant_id]).fetchone()
    return str(row["plant_name"]) if row else str(plant_id)


def _db_city_name(conn: sqlite3.Connection, city_id: Any) -> str:
    if not city_id:
        return ""
    row = conn.execute("SELECT city_name FROM Cities WHERE city_id=?", [city_id]).fetchone()
    return str(row["city_name"]) if row else str(city_id)


def _find_id_by_name(conn: sqlite3.Connection, table: str, id_col: str, name_col: str, name: Any) -> int | None:
    key = normalize_key(name)
    for row in conn.execute(f"SELECT {id_col}, {name_col} FROM {table}"):
        if normalize_key(row[1]) == key:
            return int(row[0])
    return None


def _norm_city_part(value: Any) -> str:  # ADDED
    return normalize_key(value)  # ADDED


def _city_identity_key(row: dict[str, Any]) -> tuple[str, str, str]:  # ADDED
    return (  # ADDED
        _norm_city_part(row.get("city_name")),  # ADDED
        _norm_city_part(row.get("country_code")) or _norm_city_part(row.get("country_name")),  # CHANGED
        _norm_city_part(row.get("region_name")) or _norm_city_part(row.get("region_code")),  # CHANGED
    )  # ADDED


def _city_identity_label(row: dict[str, Any]) -> str:  # ADDED
    city_name = str(row.get("city_name") or "").strip()  # ADDED
    if not city_name:  # ADDED
        return ""  # ADDED
    country = str(row.get("country_name") or row.get("country_code") or "").strip()  # ADDED
    region = str(row.get("region_name") or row.get("region_code") or "").strip()  # ADDED
    return " / ".join(part for part in (city_name, country, region) if part)  # ADDED


def _city_part_matches(existing: sqlite3.Row, row: dict[str, Any], name_key: str, code_key: str) -> bool:  # ADDED
    wanted_code = _norm_city_part(row.get(code_key))  # ADDED
    wanted_name = _norm_city_part(row.get(name_key))  # ADDED
    if not wanted_code and not wanted_name:  # ADDED
        return False  # ADDED
    existing_code = _norm_city_part(existing[code_key])  # ADDED
    existing_name = _norm_city_part(existing[name_key])  # ADDED
    return bool((wanted_code and existing_code == wanted_code) or (wanted_name and existing_name == wanted_name))  # ADDED


def _find_city_id(conn: sqlite3.Connection, row: dict[str, Any]) -> int | None:  # ADDED
    if row.get("city_id"):  # ADDED
        return int(row["city_id"])  # ADDED
    city_key = _norm_city_part(row.get("city_name"))  # ADDED
    if not city_key:  # ADDED
        return None  # ADDED
    existing_columns = {str(info[1]) for info in conn.execute("PRAGMA table_info(Cities)").fetchall()}  # ADDED
    select_cols = [column if column in existing_columns else f"NULL AS {column}" for column in ("city_id", "city_name", "country_name", "country_code", "region_name", "region_code")]  # ADDED
    candidates = [candidate for candidate in conn.execute(f"SELECT {', '.join(select_cols)} FROM Cities") if _norm_city_part(candidate["city_name"]) == city_key]  # CHANGED
    if not candidates:  # ADDED
        return None  # ADDED
    has_geo = any(_norm_city_part(row.get(key)) for key in ("country_name", "country_code", "region_name", "region_code"))  # ADDED
    if has_geo:  # ADDED
        matches = [candidate for candidate in candidates if _city_part_matches(candidate, row, "country_name", "country_code") and _city_part_matches(candidate, row, "region_name", "region_code")]  # ADDED
        if len(matches) == 1:  # ADDED
            return int(matches[0]["city_id"])  # ADDED
        if len(matches) > 1:  # ADDED
            raise RuntimeError(f"Ambiguous city identity: {row}")  # ADDED
        return None  # ADDED
    if len(candidates) == 1:  # ADDED
        return int(candidates[0]["city_id"])  # ADDED
    raise RuntimeError(f"Ambiguous city name; include country/region or city_id: {row.get('city_name')}")  # ADDED


def _resolve_plant_id(conn: sqlite3.Connection, row: dict[str, Any]) -> int:
    plant_id = row.get("plant_id") or _find_id_by_name(conn, "Plants", "plant_id", "plant_name", row.get("plant_name"))
    if not plant_id:
        raise RuntimeError(f"Cannot resolve plant row: {row}")
    return int(plant_id)


def _resolve_city_id(conn: sqlite3.Connection, row: dict[str, Any]) -> int:
    city_id = row.get("city_id") or _find_city_id(conn, row)  # CHANGED
    if not city_id:
        raise RuntimeError(f"Cannot resolve city row: {row}")
    return int(city_id)


def _find_variety_id(conn: sqlite3.Connection, plant_id: int, variety_name: Any) -> int | None:
    key = normalize_key(variety_name)
    for row in conn.execute("SELECT variety_id, variety_name FROM PlantVarieties WHERE plant_id=?", [plant_id]):
        if normalize_key(row["variety_name"]) == key:
            return int(row["variety_id"])
    return None


def _find_companion_id(conn: sqlite3.Connection, p1: Any, p2: Any) -> int | None:
    key1 = normalize_key(p1)
    key2 = normalize_key(p2)
    for row in conn.execute("SELECT relation_id, p1, p2 FROM Companions"):
        if normalize_key(row["p1"]) == key1 and normalize_key(row["p2"]) == key2:
            return int(row["relation_id"])
    return None
