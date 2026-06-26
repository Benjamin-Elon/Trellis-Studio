from __future__ import annotations

from typing import Any


SECTION_TABLES = {
    "cities": ["Cities", "CityWeatherMonthly", "CityWeatherForecastDaily"],
    "crops": ["Plants", "PlantAllowedMethodCategories", "PlantVarieties", "PlantTaskTemplates", "VarietyTaskTemplates"],
    "companions": ["Companions", "CompanionEvidence"],
    "sowing_windows": ["PlantingWindowReferences"],
}


def effective_tables_from_input(input_data: dict[str, Any]) -> list[str]:
    tables: list[str] = []
    for section, section_tables in SECTION_TABLES.items():
        if input_data.get(section) and (section != "sowing_windows" or (input_data.get("sowing_windows") or {}).get("enabled")):
            tables.extend(section_tables)
    seen: set[str] = set()
    return [table for table in tables if not (table in seen or seen.add(table))]


def selected_tables_warning(input_data: dict[str, Any], effective_tables: list[str]) -> str | None:
    selected = input_data.get("tables") or []
    if not selected:
        return None
    if set(map(str, selected)) == set(effective_tables):
        return None
    return "tables is accepted for compatibility, but generation is section-driven; effective tables come from populated input sections."
