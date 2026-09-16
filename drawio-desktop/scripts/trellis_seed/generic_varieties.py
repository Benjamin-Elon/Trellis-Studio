from __future__ import annotations

import json
import math
import shutil
import sqlite3
from contextlib import closing
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


GENERIC_MATURITY_PROFILES = (
    {"variety_name": "Very early maturity", "maturity_class": "very_early", "multiplier": 0.75},
    {"variety_name": "Early maturity", "maturity_class": "early", "multiplier": 0.85},
    {"variety_name": "Mid maturity", "maturity_class": "mid", "multiplier": 1.0},
    {"variety_name": "Late maturity", "maturity_class": "late", "multiplier": 1.15},
    {"variety_name": "Very late maturity", "maturity_class": "very_late", "multiplier": 1.25},
)
GENERIC_MATURITY_PROFILE_NAMES = frozenset(profile["variety_name"] for profile in GENERIC_MATURITY_PROFILES)
GENERIC_MATURITY_CLASSES = frozenset(profile["maturity_class"] for profile in GENERIC_MATURITY_PROFILES)
TIMING_OVERRIDE_FIELDS = ("days_maturity", "gdd_to_maturity")


def is_generic_maturity_profile_name(value: Any) -> bool:
    return str(value or "").strip().casefold() in {name.casefold() for name in GENERIC_MATURITY_PROFILE_NAMES}


def generic_maturity_varieties_for_plant(plant: dict[str, Any]) -> list[dict[str, Any]]:
    """Build the deterministic built-in maturity profiles for one plant row."""
    plant_name = str(plant.get("plant_name") or "").strip()
    rows: list[dict[str, Any]] = []
    for profile in GENERIC_MATURITY_PROFILES:
        multiplier = float(profile["multiplier"])
        overrides = {} if multiplier == 1.0 else _timing_overrides(plant, multiplier)
        rows.append({
            "plant_name": plant_name,
            "variety_name": profile["variety_name"],
            "maturity_class": profile["maturity_class"],
            "overrides": overrides,
        })
    return rows


def replace_database_varieties_with_generic_profiles(db_path: Path) -> dict[str, Any]:
    """Backup one Trellis database and replace all variety rows with generic maturity profiles."""
    db_path = Path(db_path)
    if not db_path.exists():
        raise FileNotFoundError(db_path)
    backup_path = _backup_path(db_path)
    shutil.copy2(db_path, backup_path)
    now = datetime.now(timezone.utc).isoformat()
    with closing(sqlite3.connect(db_path)) as conn:
        conn.row_factory = sqlite3.Row
        with conn:
            plant_rows = list(conn.execute("SELECT plant_id, plant_name, days_maturity, gdd_to_maturity FROM Plants ORDER BY plant_id"))
            old_templates = _count_table(conn, "VarietyTaskTemplates")
            old_varieties = _count_table(conn, "PlantVarieties")
            conn.execute("DELETE FROM VarietyTaskTemplates")
            conn.execute("DELETE FROM PlantVarieties")
            inserted = 0
            for plant in plant_rows:
                for variety in generic_maturity_varieties_for_plant(dict(plant)):
                    conn.execute(
                        "INSERT INTO PlantVarieties (plant_id, variety_name, maturity_class, overrides_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
                        [
                            plant["plant_id"],
                            variety["variety_name"],
                            variety["maturity_class"],
                            json.dumps(variety.get("overrides") or {}, sort_keys=True),
                            now,
                            now,
                        ],
                    )
                    inserted += 1
    return {
        "db_path": str(db_path),
        "backup_path": str(backup_path),
        "plants": len(plant_rows),
        "deleted_varieties": old_varieties,
        "deleted_variety_templates": old_templates,
        "inserted_varieties": inserted,
    }


def _timing_overrides(plant: dict[str, Any], multiplier: float) -> dict[str, Any]:
    overrides: dict[str, Any] = {}
    for field in TIMING_OVERRIDE_FIELDS:
        value = _finite_number(plant.get(field))
        if value is None:
            continue
        adjusted = value * multiplier
        overrides[field] = int(round(adjusted)) if field == "days_maturity" else round(adjusted, 2)
    return overrides


def _finite_number(value: Any) -> float | None:
    if isinstance(value, bool) or value in (None, ""):
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) else None


def _backup_path(db_path: Path) -> Path:
    stamp = datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S")
    candidate = db_path.with_name(f"{db_path.stem}.{stamp}.bak{db_path.suffix}")
    suffix = 1
    while candidate.exists():
        candidate = db_path.with_name(f"{db_path.stem}.{stamp}.{suffix}.bak{db_path.suffix}")
        suffix += 1
    return candidate


def _count_table(conn: sqlite3.Connection, table: str) -> int:
    return int(conn.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0])
