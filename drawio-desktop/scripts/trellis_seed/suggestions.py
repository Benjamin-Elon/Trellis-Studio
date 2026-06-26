from __future__ import annotations

import json
import sqlite3
from contextlib import closing
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from .artifacts import suggestion_summary_slug, unique_artifact_dir
from .config import Settings
from .jsonio import write_json
from .providers import OpenAIJsonClient, ProviderTrace
from .validator import normalize_key, validate_input


SUGGESTION_SECTIONS = {"crops", "cities", "companions"}


def load_suggestion_context(db_path: Path) -> dict[str, Any]:
    with closing(sqlite3.connect(db_path)) as conn:
        conn.row_factory = sqlite3.Row
        plants = _select_names(conn, "Plants", "plant_name")
        cities = _select_names(conn, "Cities", "city_name")
        companions = [
            {"p1": row["p1"], "p2": row["p2"]}
            for row in conn.execute("SELECT p1, p2 FROM Companions ORDER BY p1, p2")
        ]
        coverage_summary = {  # coverage-gap prompting
            "crop_categories": _select_counts(conn, "Plants", "crop_category"),
            "plant_families": _select_counts(conn, "Plants", "family"),
            "city_location_suffixes": _city_location_suffix_counts(cities),
            "companion_ratings": _select_counts(conn, "Companions", "rating"),
            "companion_types": _select_counts(conn, "Companions", "companion_type"),
        }
    return {
        "plants": plants,
        "plant_keys": sorted({normalize_key(name) for name in plants}),
        "cities": cities,
        "city_keys": sorted({normalize_key(name) for name in cities}),
        "companion_pairs": companions,
        "companion_pair_keys": sorted({_pair_key(row["p1"], row["p2"]) for row in companions}),
        "coverage_summary": coverage_summary,  # coverage-gap prompting
    }


def build_suggestion_request(section: str, requested_count: int, criteria: str, context: dict[str, Any]) -> dict[str, Any]:
    return {
        "section": _clean_section(section),
        "requested_count": requested_count,
        "criteria": criteria.strip(),
        "defaults": "Prioritize credible coverage gaps; return fewer than requested rather than weak or unsourced suggestions.",  # coverage-gap prompting
        "existing_database_context": context,
    }


def generate_suggestion_list(openai: OpenAIJsonClient, request: dict[str, Any]) -> tuple[dict[str, Any], ProviderTrace]:
    section = _clean_section(request["section"])
    result, trace = openai.generate_json(
        schema_name=f"trellis_{section}_suggestions",
        json_schema=suggestion_list_schema(section),
        system=(
            "Suggest Trellis seed input candidates. Exclude existing normalized entries when possible. "
            "Prioritize novel coverage gaps using existing_database_context.coverage_summary: underrepresented crop families/categories, "
            "underrepresented city regions, and missing companion relationship patterns. "
            "Prefer useful garden data with credible source hints; return fewer than requested if confidence or source hints are weak."
        ),
        user=json.dumps(request, indent=2),
    )
    errors = validate_suggestion_list(result, section, int(request["requested_count"]), request["existing_database_context"])
    if errors:
        raise ValueError("Suggestion list failed validation:\n" + "\n".join(errors))
    return result, trace


def generate_seed_input_draft(openai: OpenAIJsonClient, section: str, accepted_suggestions: list[dict[str, Any]], criteria: str, context: dict[str, Any]) -> tuple[dict[str, Any], ProviderTrace]:
    section = _clean_section(section)
    result, trace = openai.generate_json(
        schema_name=f"trellis_{section}_input_draft",
        json_schema=input_draft_schema(section),
        system=(
            "Convert accepted Trellis suggestions into seed input JSON. "
            "Crops and companions must include source URLs or explicit source notes. Cities do not require sources. "
            "Preserve the accepted suggestion identities exactly, add enough notes for high-quality downstream agronomy generation, "
            "and do not add suggestions that were not accepted."
        ),
        user=json.dumps({
            "section": section,
            "criteria": criteria,
            "accepted_suggestions": accepted_suggestions,
            "existing_database_context": context,
        }, indent=2),
    )
    errors = validate_input_draft(result, section, accepted_suggestions, context)
    if errors:
        raise ValueError("Suggested input JSON failed validation:\n" + "\n".join(errors))
    return result, trace


def write_suggestion_artifacts(
    settings: Settings,
    request: dict[str, Any],
    suggestion_list: dict[str, Any],
    accepted_suggestions: list[dict[str, Any]],
    draft: dict[str, Any],
    traces: list[ProviderTrace],
) -> Path:
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    summary = suggestion_summary_slug(str(request.get("section") or "suggestions"), len(accepted_suggestions), str(request.get("criteria") or ""))
    suggestion_dir = unique_artifact_dir(settings.runs_dir, "suggestion", timestamp, summary)
    write_json(suggestion_dir / "metadata.json", {
        "artifact_type": "suggestion",
        "status": "complete",
        "section": request.get("section"),
        "accepted_count": len(accepted_suggestions),
        "criteria": request.get("criteria") or "",
    })
    write_json(suggestion_dir / "suggestion_request.json", request)
    write_json(suggestion_dir / "suggestion_list.json", suggestion_list)
    write_json(suggestion_dir / "accepted_suggestions.json", accepted_suggestions)
    write_json(suggestion_dir / "suggested_input.json", draft)
    write_json(suggestion_dir / "traces.json", [trace.redacted() for trace in traces])
    return suggestion_dir


def suggestion_list_schema(section: str) -> dict[str, Any]:
    section = _clean_section(section)
    item_properties = {
        "crops": {
            "name": {"type": "string"},
            "rationale": {"type": "string"},
            "source_hints": {"type": "array", "items": {"type": "string"}},
        },
        "cities": {
            "name": {"type": "string"},
            "rationale": {"type": "string"},
            "source_hints": {"type": "array", "items": {"type": "string"}},
        },
        "companions": {
            "p1": {"type": "string"},
            "p2": {"type": "string"},
            "rationale": {"type": "string"},
            "source_hints": {"type": "array", "items": {"type": "string"}},
        },
    }[section]
    return {
        "type": "object",
        "additionalProperties": False,
        "properties": {
            "section": {"type": "string", "enum": [section]},
            "requested_count": {"type": "integer"},
            "suggestions": {
                "type": "array",
                "items": {
                    "type": "object",
                    "additionalProperties": False,
                    "properties": item_properties,
                    "required": sorted(item_properties),
                },
            },
        },
        "required": ["section", "requested_count", "suggestions"],
    }


def input_draft_schema(section: str) -> dict[str, Any]:
    _clean_section(section)
    crop_item = {
        "type": "object",
        "additionalProperties": False,
        "properties": {
            "name": {"type": "string"},
            "sources": {"type": "array", "items": {"type": "string"}},
            "notes": {"type": "string"},
            "variety_count": {"type": ["integer", "null"]},
        },
        "required": ["name", "sources", "notes", "variety_count"],
    }
    city_item = {
        "type": "object",
        "additionalProperties": False,
        "properties": {
            "name": {"type": "string"},
            "city_name": {"type": "string"},
            "admin1": {"type": "string"},
            "country": {"type": "string"},
            "country_code": {"type": "string"},
        },
        "required": ["admin1", "city_name", "country", "country_code", "name"],
    }
    companion_item = {
        "type": "object",
        "additionalProperties": False,
        "properties": {
            "p1": {"type": "string"},
            "p2": {"type": "string"},
            "sources": {"type": "array", "items": {"type": "string"}},
            "notes": {"type": "string"},
        },
        "required": ["p1", "p2", "sources", "notes"],
    }
    return {
        "type": "object",
        "additionalProperties": False,
        "properties": {
            "crops": {"type": "array", "items": crop_item},
            "cities": {"type": "array", "items": city_item},
            "companions": {"type": "array", "items": companion_item},
        },
        "required": ["crops", "cities", "companions"],
    }


def validate_suggestion_list(result: dict[str, Any], section: str, requested_count: int, context: dict[str, Any]) -> list[str]:
    section = _clean_section(section)
    errors: list[str] = []
    if result.get("section") != section:
        errors.append(f"section must be {section}.")
    if result.get("requested_count") != requested_count:
        errors.append(f"requested_count must be {requested_count}.")
    suggestions = result.get("suggestions")
    if not isinstance(suggestions, list):
        return errors + ["suggestions must be a list."]
    seen: set[str] = set()
    for index, item in enumerate(suggestions, 1):
        errors.extend(_validate_suggestion_item(section, index, item, context, seen))
    return errors


def validate_input_draft(draft: dict[str, Any], section: str, accepted_suggestions: list[dict[str, Any]], context: dict[str, Any]) -> list[str]:
    section = _clean_section(section)
    if not isinstance(draft, dict):
        return ["Suggested input draft must be a JSON object."]
    errors = validate_input(draft)
    expected_count = len(accepted_suggestions)
    section_rows = draft.get(section) or []
    if len(section_rows) != expected_count:
        errors.append(f"{section} draft count must match accepted suggestions: {expected_count}.")
    for other in SUGGESTION_SECTIONS - {section}:
        if draft.get(other):
            errors.append(f"{other} must be empty for a {section} draft.")
    if section == "crops":
        expected = {normalize_key(item.get("name")) for item in accepted_suggestions}
        actual = {normalize_key(item.get("name")) for item in section_rows}
        if actual != expected:
            errors.append("Crop draft names must match accepted suggestions.")
    elif section == "cities":
        expected = {normalize_key(item.get("name")) for item in accepted_suggestions}
        actual = {normalize_key(item.get("name") or _city_display_name(item)) for item in section_rows}
        if actual != expected:
            errors.append("City draft names must match accepted suggestions.")
        for row in section_rows:
            for field in ("name", "city_name", "admin1", "country", "country_code"):
                if not str(row.get(field) or "").strip():
                    errors.append(f"City draft field is required: {field}")
    else:
        plant_keys = set(context.get("plant_keys") or [])
        expected = {_pair_key(item.get("p1"), item.get("p2")) for item in accepted_suggestions}
        actual = {_pair_key(item.get("p1"), item.get("p2")) for item in section_rows}
        if actual != expected:
            errors.append("Companion draft pairs must match accepted suggestions.")
        for row in section_rows:
            if normalize_key(row.get("p1")) not in plant_keys or normalize_key(row.get("p2")) not in plant_keys:
                errors.append(f"Companion draft references plants outside the DB: {row.get('p1')} / {row.get('p2')}")
    return errors


def parse_selection(raw: str, item_count: int) -> list[int]:
    text = raw.strip().casefold()
    if not text or text in {"a", "all"}:
        return list(range(item_count))
    selected: set[int] = set()
    for part in text.split(","):
        token = part.strip()
        if not token:
            continue
        if "-" in token:
            start_text, end_text = token.split("-", 1)
            start = int(start_text)
            end = int(end_text)
            if start > end:
                start, end = end, start
            selected.update(range(start - 1, end))
        else:
            selected.add(int(token) - 1)
    invalid = [index + 1 for index in selected if index < 0 or index >= item_count]
    if invalid:
        raise ValueError(f"Selection out of range: {', '.join(map(str, sorted(invalid)))}")
    return sorted(selected)


def _validate_suggestion_item(section: str, index: int, item: Any, context: dict[str, Any], seen: set[str]) -> list[str]:
    if not isinstance(item, dict):
        return [f"suggestions[{index}] must be an object."]
    errors: list[str] = []
    if section == "companions":
        p1 = str(item.get("p1") or "").strip()
        p2 = str(item.get("p2") or "").strip()
        key = _pair_key(p1, p2)
        plant_keys = set(context.get("plant_keys") or [])
        if normalize_key(p1) not in plant_keys or normalize_key(p2) not in plant_keys:
            errors.append(f"suggestions[{index}] companion endpoints must already exist in Plants: {p1} / {p2}")
        if key in set(context.get("companion_pair_keys") or []):
            errors.append(f"suggestions[{index}] companion pair already exists: {p1} / {p2}")
    else:
        name = str(item.get("name") or "").strip()
        key = normalize_key(name)
        existing_key = "plant_keys" if section == "crops" else "city_keys"
        if not key:
            errors.append(f"suggestions[{index}] name is required.")
        if key in set(context.get(existing_key) or []):
            errors.append(f"suggestions[{index}] already exists: {name}")
    if key in seen:
        errors.append(f"suggestions[{index}] duplicates another suggestion.")
    seen.add(key)
    if section != "cities" and not item.get("source_hints"):
        errors.append(f"suggestions[{index}] needs at least one source hint.")
    return errors


def _select_names(conn: sqlite3.Connection, table: str, column: str) -> list[str]:
    return [row[0] for row in conn.execute(f"SELECT {column} FROM {table} ORDER BY {column}") if row[0]]


def _select_counts(conn: sqlite3.Connection, table: str, column: str, limit: int = 25) -> list[dict[str, Any]]:
    rows = conn.execute(
        f"SELECT {column} AS value, COUNT(1) AS count FROM {table} GROUP BY {column} ORDER BY COUNT(1) DESC, {column} LIMIT ?",
        [limit],
    )
    return [{"value": _context_value(row["value"]), "count": int(row["count"])} for row in rows]  # coverage-gap prompting


def _city_location_suffix_counts(cities: list[str]) -> list[dict[str, Any]]:
    counts: dict[str, int] = {}
    for city in cities:
        parts = [part.strip() for part in str(city or "").split(",") if part.strip()]
        suffix = ", ".join(parts[1:]) if len(parts) > 1 else "[unspecified]"
        counts[suffix] = counts.get(suffix, 0) + 1
    return [
        {"value": value, "count": count}
        for value, count in sorted(counts.items(), key=lambda item: (-item[1], item[0]))[:25]
    ]  # coverage-gap prompting


def _context_value(value: Any) -> str:
    text = str(value or "").strip()
    return text if text else "[unspecified]"  # coverage-gap prompting


def _pair_key(p1: Any, p2: Any) -> str:
    first, second = sorted([normalize_key(p1), normalize_key(p2)])
    return f"{first}|{second}"


def _city_display_name(row: dict[str, Any]) -> str:
    return ", ".join(str(row.get(field) or "").strip() for field in ("city_name", "admin1", "country") if str(row.get(field) or "").strip())


def _clean_section(section: str) -> str:
    cleaned = str(section or "").strip().casefold()
    if cleaned not in SUGGESTION_SECTIONS:
        raise ValueError(f"Unknown suggestion section: {section}")
    return cleaned
