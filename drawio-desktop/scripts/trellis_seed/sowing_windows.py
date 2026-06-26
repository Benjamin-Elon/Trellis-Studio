from __future__ import annotations

import hashlib
import random
import sqlite3
from contextlib import closing
from pathlib import Path
from typing import Any

from .validator import normalize_key


JUNK_CROP_TOKENS = {"test", "junk", "zero", "ballsack", "barf", "dsff", "sadas"}


def mm_dd_to_doy(value: Any) -> int | None:
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
    if month < 1 or month > 12 or day < 1 or day > month_days[month - 1]:
        return None
    return sum(month_days[:month - 1]) + day


def normalize_window_row(row: dict[str, Any], plant_name: str) -> dict[str, Any]:
    out = dict(row)
    out["plant_name"] = plant_name
    out["stage"] = str(out.get("stage") or "").strip().casefold()
    out["window_label"] = str(out.get("window_label") or "primary").strip().casefold().replace(" ", "_")
    out["start_mm_dd"] = _normalize_mm_dd(out.get("start_mm_dd"))
    out["end_mm_dd"] = _normalize_mm_dd(out.get("end_mm_dd"))
    out["start_doy"] = mm_dd_to_doy(out["start_mm_dd"])
    out["end_doy"] = mm_dd_to_doy(out["end_mm_dd"])
    out["is_cross_year"] = 1 if out["start_doy"] and out["end_doy"] and out["end_doy"] < out["start_doy"] else 0
    out["confidence"] = str(out.get("confidence") or "medium").strip().casefold()
    out["summary"] = str(out.get("summary") or "").strip()
    out["source_url"] = _empty_to_none(out.get("source_url"))
    out["source_note"] = _empty_to_none(out.get("source_note"))
    return out


def usable_crop_for_sowing_windows(row: dict[str, Any], methods_by_id: dict[str, dict[str, Any]]) -> bool:
    name = str(row.get("plant_name") or "").strip()
    key = normalize_key(name)
    if not key or any(token in key for token in JUNK_CROP_TOKENS):
        return False
    method_id = str(row.get("default_planting_method") or "").strip()
    if method_id and method_id in methods_by_id:
        return True
    return bool(int(row.get("direct_sow") or 0) or int(row.get("transplant") or 0))


def select_cities_for_crop(
    crop_name: str,
    cities: list[dict[str, Any]],
    count: int,
    seed: str,
    overrides: dict[str, list[str]] | None = None,
) -> list[dict[str, Any]]:
    overrides = overrides or {}
    override_names = overrides.get(crop_name) or overrides.get(normalize_key(crop_name))
    if override_names:
        wanted = {normalize_key(name) for name in override_names}
        selected = [city for city in cities if normalize_key(city.get("city_name")) in wanted]
        return selected[:count]
    ordered = list(cities)
    digest = hashlib.sha256(f"{seed}|{normalize_key(crop_name)}".encode("utf-8")).hexdigest()
    rng = random.Random(int(digest[:16], 16))
    rng.shuffle(ordered)
    return ordered[:count]


def compare_window_references(
    references: list[dict[str, Any]],
    scheduler_windows: list[dict[str, Any]],
    tolerance_days: int = 14,
) -> dict[str, Any]:
    scheduler_by_key = {
        _comparison_key(row): row
        for row in scheduler_windows
        if row.get("plant_name") and row.get("city_name") and row.get("method_id") and row.get("stage")
    }
    rows = []
    for reference in references:
        key = _comparison_key(reference)
        scheduler = scheduler_by_key.get(key)
        status = "missing_scheduler_window"
        delta_start = None
        delta_end = None
        if scheduler:
            delta_start = _day_delta(scheduler.get("start_doy"), reference.get("start_doy"))
            delta_end = _day_delta(scheduler.get("end_doy"), reference.get("end_doy"))
            ok = (
                delta_start is not None and abs(delta_start) <= tolerance_days and
                delta_end is not None and abs(delta_end) <= tolerance_days
            )
            status = "within_tolerance" if ok else "outside_tolerance"
        rows.append({
            "plant_name": reference.get("plant_name"),
            "city_name": reference.get("city_name"),
            "method_id": reference.get("method_id"),
            "stage": reference.get("stage"),
            "window_label": reference.get("window_label"),
            "status": status,
            "delta_start_days": delta_start,
            "delta_end_days": delta_end,
        })
    return {
        "ok": True,
        "summary": {
            "references": len(references),
            "within_tolerance": sum(1 for row in rows if row["status"] == "within_tolerance"),
            "outside_tolerance": sum(1 for row in rows if row["status"] == "outside_tolerance"),
            "missing_scheduler_window": sum(1 for row in rows if row["status"] == "missing_scheduler_window"),
        },
        "rows": rows,
    }


def load_planting_window_references(db_path: Path) -> list[dict[str, Any]]:
    with closing(sqlite3.connect(db_path)) as conn:
        conn.row_factory = sqlite3.Row
        rows = conn.execute(
            """
            SELECT p.plant_name, c.city_name, r.method_id, r.stage, r.window_label,
                   r.start_mm_dd, r.end_mm_dd, r.start_doy, r.end_doy,
                   r.is_cross_year, r.confidence, r.summary
            FROM PlantingWindowReferences r
            JOIN Plants p ON p.plant_id = r.plant_id
            JOIN Cities c ON c.city_id = r.city_id
            ORDER BY p.plant_name, c.city_name, r.method_id, r.stage, r.window_label
            """
        )
        return [dict(row) for row in rows]


def _normalize_mm_dd(value: Any) -> str:
    text = str(value or "").strip()
    parts = text.split("-")
    if len(parts) != 2:
        return text
    try:
        return f"{int(parts[0]):02d}-{int(parts[1]):02d}"
    except ValueError:
        return text


def _empty_to_none(value: Any) -> str | None:
    text = str(value or "").strip()
    return text or None


def _comparison_key(row: dict[str, Any]) -> tuple[str, str, str, str]:
    return (
        normalize_key(row.get("plant_name")),
        normalize_key(row.get("city_name")),
        str(row.get("method_id") or "").strip(),
        str(row.get("stage") or "").strip(),
    )


def _day_delta(left: Any, right: Any) -> int | None:
    try:
        return int(left) - int(right)
    except (TypeError, ValueError):
        return None
