from __future__ import annotations

import json
from typing import Any


GENERATED_TABLES = [
    "Plants",
    "Cities",
    "CityWeatherDaily",
    "CityWeatherForecastDaily",
    "Companions",
    "CompanionEvidence",
    "PlantAllowedMethodCategories",
    "PlantVarieties",
    "PlantTaskTemplates",
    "VarietyTaskTemplates",
]

WEATHER_TABLES = {"CityWeatherDaily", "CityWeatherForecastDaily"}

PLANT_COLUMNS = {
    "plant_id", "plant_name", "family", "genus", "crop_category", "preferred_soil",
    "organic_matter", "soil_ph_range", "ideal_NPK", "known_companions",
    "incompatible_with", "default_planting_method_category", "default_planting_method",
    "annual", "biennial", "perennial", "lifespan_years", "sun_hours", "water",
    "temp_range", "root_type", "root_depth_cm", "root_diam_cm", "veg_height_cm",
    "veg_diameter_cm", "spacing_cm", "nutrients", "fertilizer_notes",
    "planting_depth", "improve_yield", "maintenance_pruning_thinning",
    "harvest_notes", "amount_shade_provides", "general_care", "propagation",
    "storage", "diseases", "pests", "abbr", "tmax_c", "topt_high_c",
    "topt_low_c", "tmin_c", "tbase_c", "spacing_y_cm", "spacing_x_cm",
    "yield_unit", "yield_per_plant_kg", "soil_temp_min_plant_c",
    "harvest_window_days", "days_maturity", "days_transplant", "days_germ",
    "gdd_to_maturity", "direct_sow", "transplant", "succession",
    "overwinter_ok", "start_cooling_threshold_c",
}

FIELD_SOURCES_SCHEMA = {
    "type": "array",
    "items": {
        "type": "object",
        "additionalProperties": False,
        "properties": {
            "field": {"type": "string"},
            "source": {"type": "string"},
        },
        "required": ["field", "source"],
    },
}

PROVENANCE_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "properties": {
        "field_sources": FIELD_SOURCES_SCHEMA,
    },
    "required": ["field_sources"],
}

OVERRIDE_ENTRY_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "properties": {
        "field": {"type": "string"},
        "value": {"type": ["string", "number", "integer", "boolean", "null"]},
    },
    "required": ["field", "value"],
}

CITY_COLUMNS = {
    "city_id", "city_name", "latitude", "longitude", "timezone", "gdd_annual",
    "last_spring_frost_doy", "first_fall_frost_doy", "first_fall_frost_p90_doy",
    "first_fall_frost_p50_doy", "first_fall_frost_p10_doy",
    "last_spring_frost_p90_doy", "last_spring_frost_p50_doy",
    "last_spring_frost_p10_doy", "gdd_base_c",
    *{f"avg_monthly_low_c{i}" for i in range(1, 13)},
    *{f"avg_monthly_high_c{i}" for i in range(1, 13)},
}

OPENAI_PLANT_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "properties": {
        "row": {
            "type": "object",
            "additionalProperties": False,
            "properties": {key: {"type": ["string", "number", "integer", "null"]} for key in sorted(PLANT_COLUMNS - {"plant_id"})},
            "required": sorted(PLANT_COLUMNS - {"plant_id"}),
        },
        "allowed_method_categories": {"type": "array", "items": {"type": "string"}},
        "allowed_method_ids": {"type": "array", "items": {"type": "string"}},  # concrete crop methods
        "varieties": {
            "type": "array",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "properties": {
                    "variety_name": {"type": "string"},
                    "overrides": {"type": "array", "items": OVERRIDE_ENTRY_SCHEMA},
                    "sources": {"type": "array", "items": {"type": "string"}},
                },
                "required": ["variety_name", "overrides", "sources"],
            },
        },
        "provenance": PROVENANCE_SCHEMA,
    },
    "required": ["row", "allowed_method_categories", "allowed_method_ids", "varieties", "provenance"],
}

OPENAI_TEMPLATE_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "properties": {
        "version": {"type": "integer"},
        "rules": {
            "type": "array",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "properties": {
                    "id": {"type": "string"},
                    "title": {"type": "string"},
                    "startAnchorStage": {"type": "string", "enum": ["SOW", "GERM", "TRANSPLANT", "HARVEST_START", "HARVEST_END"]},
                    "startOffsetDays": {"type": "integer"},
                    "startOffsetDirection": {"type": "string", "enum": ["before", "after"]},
                    "endMode": {"type": "string", "enum": ["fixed_days", "anchor_range"]},
                    "durationDays": {"type": ["integer", "null"]},
                    "endAnchorStage": {"type": ["string", "null"], "enum": ["SOW", "GERM", "TRANSPLANT", "HARVEST_START", "HARVEST_END", None]},
                    "endAnchorOffsetDays": {"type": "integer"},
                    "endAnchorOffsetDirection": {"type": "string", "enum": ["before", "after"]},
                    "repeatMode": {"type": "string", "enum": ["none", "interval"]},
                    "repeatEveryDays": {"type": "integer"},
                    "repeatUntilMode": {"type": "string", "enum": ["x_times", "until_anchor"]},
                    "repeatTimes": {"type": "integer"},
                    "repeatUntilAnchorStage": {"type": "string", "enum": ["SOW", "GERM", "TRANSPLANT", "HARVEST_START", "HARVEST_END"]},
                    "repeatCutoffOffsetDays": {"type": "integer"},
                    "repeatCutoffOffsetDirection": {"type": "string", "enum": ["before", "after"]},
                },
                "required": [
                    "id", "title", "startAnchorStage", "startOffsetDays", "startOffsetDirection",
                    "endMode", "durationDays", "endAnchorStage", "endAnchorOffsetDays",
                    "endAnchorOffsetDirection", "repeatMode", "repeatEveryDays",
                    "repeatUntilMode", "repeatTimes", "repeatUntilAnchorStage",
                    "repeatCutoffOffsetDays", "repeatCutoffOffsetDirection",
                ],
            },
        },
        "provenance": PROVENANCE_SCHEMA,
    },
    "required": ["version", "rules", "provenance"],
}


def compact_json(value: Any) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"))
