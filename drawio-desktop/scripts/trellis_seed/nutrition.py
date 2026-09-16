from __future__ import annotations

import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from .jsonio import read_json, write_json
from .providers import FoodDataCentralClient, OpenAIJsonClient, ProviderError, ProviderTrace
from .schema import NUTRITION_NUTRIENT_KEYS
from .validator import normalize_key, validate_row


NUTRIENTS = [
    ("energy_kcal", "Calories", "kcal", 1),
    ("protein_g", "Protein", "g", 2),
    ("fiber_g", "Fiber", "g", 3),
    ("vitamin_a_rae_mcg", "Vitamin A", "mcg RAE", 4),
    ("vitamin_c_mg", "Vitamin C", "mg", 5),
    ("vitamin_k_mcg", "Vitamin K", "mcg", 6),
    ("folate_dfe_mcg", "Folate", "mcg DFE", 7),
    ("potassium_mg", "Potassium", "mg", 8),
    ("iron_mg", "Iron", "mg", 9),
    ("calcium_mg", "Calcium", "mg", 10),
]

REQUIREMENTS = {
    "adult_19_50": {
        "energy_kcal": 2200,
        "protein_g": 50,
        "fiber_g": 28,
        "vitamin_a_rae_mcg": 800,
        "vitamin_c_mg": 82.5,
        "vitamin_k_mcg": 105,
        "folate_dfe_mcg": 400,
        "potassium_mg": 3700,
        "iron_mg": 13.5,
        "calcium_mg": 1000,
    },
    "child_1_8": {
        "energy_kcal": 1200,
        "protein_g": 16,
        "fiber_g": 19.4,
        "vitamin_a_rae_mcg": 350,
        "vitamin_c_mg": 22.5,
        "vitamin_k_mcg": 45,
        "folate_dfe_mcg": 180,
        "potassium_mg": 2300,
        "iron_mg": 8.5,
        "calcium_mg": 800,
    },
}

NUTRIENT_IDS_BY_KEY = {
    "energy_kcal": {"1008", "208"},
    "protein_g": {"1003", "203"},
    "fiber_g": {"1079", "291"},
    "vitamin_a_rae_mcg": {"1106", "320"},
    "vitamin_c_mg": {"1162", "401"},
    "vitamin_k_mcg": {"1185", "430"},
    "folate_dfe_mcg": {"1177", "435"},
    "potassium_mg": {"1092", "306"},
    "iron_mg": {"1089", "303"},
    "calcium_mg": {"1087", "301"},
}

NUTRIENT_NAME_TOKENS = {
    "energy_kcal": ("energy", "kilocalorie"),
    "protein_g": ("protein",),
    "fiber_g": ("fiber", "fibre"),
    "vitamin_a_rae_mcg": ("vitamin a", "rae"),
    "vitamin_c_mg": ("vitamin c", "ascorbic"),
    "vitamin_k_mcg": ("vitamin k",),
    "folate_dfe_mcg": ("folate", "dfe"),
    "potassium_mg": ("potassium",),
    "iron_mg": ("iron",),
    "calcium_mg": ("calcium",),
}

DATA_TYPE_PRIORITY = {
    "Foundation": 0,
    "SR Legacy": 1,
    "Survey (FNDDS)": 2,
}
CROP_ALIAS_OVERRIDES = {
    "basil": ["basil, fresh", "basil, raw"],
    "blackberry": ["blackberries, raw", "blackberry, raw"],
    "broad bean": ["fava beans, raw", "broadbeans, immature seeds, raw"],
    "brussels sprouts": ["brussels sprouts, raw"],
    "cabbage": ["cabbage, raw"],
    "carrot": ["carrots, raw"],
    "cauliflower": ["cauliflower, raw"],
    "celery": ["celery, raw"],
    "cilantro": ["coriander leaves, raw", "cilantro, raw"],
    "cucumber": ["cucumber, with peel, raw", "cucumber, raw"],
    "currant": ["currants, red and white, raw", "currants, raw"],
    "dill": ["dill weed, fresh", "dill, raw"],
    "kale": ["kale, raw"],
    "leek": ["leeks, raw"],
    "lettuce": ["lettuce, raw"],
    "onion": ["onions, raw"],
    "parsley": ["parsley, fresh", "parsley, raw"],
    "parsnip": ["parsnips, raw"],
    "pea": ["peas, green, raw"],
    "plum": ["plums, raw"],
    "pole bean": ["snap beans, raw", "green beans, raw"],
    "potato": ["potatoes, raw"],
    "pumpkin": ["pumpkin, raw"],
    "radish": ["radishes, raw"],
    "sage": ["sage, fresh", "sage, raw"],
    "spinach": ["spinach, raw"],
    "swiss chard": ["chard, swiss, raw", "swiss chard, raw"],
    "tomato": ["tomatoes, red, ripe, raw", "tomatoes, raw"],
    "turnip": ["turnips, raw"],
    "zucchini": ["squash, summer, zucchini, raw", "zucchini, raw"],
}
NON_IDENTITY_TOKENS = {
    "raw", "fresh", "ripe", "red", "green", "yellow", "white", "and", "or", "with",
    "without", "peel", "leaves", "leaf", "weed", "summer", "immature", "seeds",
}
FDC_SOURCE_URL = "https://fdc.nal.usda.gov/download-datasets/"
ESTIMATED_FDC_DESCRIPTION = "OpenAI estimated raw edible portion"
ESTIMATED_FDC_DATA_TYPE = "OpenAI estimate"
UPDATED_AT = "2026-09-15T00:00:00+00:00"

OPENAI_NUTRITION_ESTIMATE_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "properties": {
        "values": {
            "type": "object",
            "additionalProperties": False,
            "properties": {key: {"type": "number"} for key in sorted(NUTRITION_NUTRIENT_KEYS)},
            "required": sorted(NUTRITION_NUTRIENT_KEYS),
        },
        "source_note": {"type": "string"},
    },
    "required": ["values", "source_note"],
}


class CachedFdcClient:
    def __init__(self, client: FoodDataCentralClient, cache_dir: Path) -> None:
        self.client = client
        self.cache_dir = cache_dir

    def search(self, query: str) -> tuple[dict[str, Any], ProviderTrace]:
        key = _cache_key("search", {"query": query})
        cached = read_json(self.cache_dir / f"{key}.json", None)
        if isinstance(cached, dict):
            return cached, ProviderTrace("fdc", {"cached": True, "query": query}, {"cache_key": key})
        data, trace = self.client.search(query)
        write_json(self.cache_dir / f"{key}.json", data)
        return data, trace

    def food(self, fdc_id: int) -> tuple[dict[str, Any], ProviderTrace]:
        key = _cache_key("food", {"fdc_id": int(fdc_id)})
        cached = read_json(self.cache_dir / f"{key}.json", None)
        if isinstance(cached, dict):
            return cached, ProviderTrace("fdc", {"cached": True, "fdc_id": int(fdc_id)}, {"cache_key": key})
        data, trace = self.client.food(fdc_id)
        write_json(self.cache_dir / f"{key}.json", data)
        return data, trace


def reference_nutrient_rows() -> list[dict[str, Any]]:
    return [
        {"nutrient_key": key, "nutrient_name": name, "unit": unit, "sort_order": sort_order}
        for key, name, unit, sort_order in NUTRIENTS
    ]


def reference_requirement_rows() -> list[dict[str, Any]]:
    units = {key: unit for key, _name, unit, _order in NUTRIENTS}
    return [
        {
            "persona_key": persona,
            "nutrient_key": key,
            "amount_per_day": amount,
            "unit": units[key],
            "source_url": "https://www.nal.usda.gov/human-nutrition-and-food-safety/dri-calculator",
            "source_note": "Averaged planning persona requirement; not dietary advice.",
            "updated_at": UPDATED_AT,
        }
        for persona, values in REQUIREMENTS.items()
        for key, amount in values.items()
    ]


def ensure_reference_nutrition_rows(generated: dict[str, list[dict[str, Any]]]) -> None:
    _merge_unique(generated.setdefault("NutritionNutrients", []), reference_nutrient_rows(), ("nutrient_key",))
    _merge_unique(generated.setdefault("NutritionRequirements", []), reference_requirement_rows(), ("persona_key", "nutrient_key"))


def synthesize_nutrition_for_plant(
    *,
    plant_row: dict[str, Any],
    aliases: list[str],
    fdc: CachedFdcClient,
    openai: OpenAIJsonClient,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]], list[dict[str, Any]]]:
    traces: list[dict[str, Any]] = []
    plant_name = str(plant_row.get("plant_name") or "").strip()
    for alias in _candidate_aliases(plant_name, aliases):
        try:
            search_data, search_trace = fdc.search(alias)
            traces.append(search_trace.redacted())
            candidate = best_fdc_candidate(plant_name, alias, search_data.get("foods") or [])
            if not candidate:
                continue
            food_data, food_trace = fdc.food(int(candidate["fdcId"]))
            traces.append(food_trace.redacted())
            values = nutrient_values_from_fdc(food_data)
            if len(values) < 5:
                continue
            if set(values) != NUTRITION_NUTRIENT_KEYS:
                mapping, value_rows, estimate_trace = _rows_with_estimated_missing_values(plant_name, aliases, plant_row, candidate, food_data, values, openai)
                traces.append(estimate_trace.redacted())
                return [mapping], value_rows, traces
            return _fdc_rows(plant_name, candidate, food_data, values)[0:1], _value_rows(plant_name, values, int(candidate["fdcId"])), traces
        except ProviderError as exc:
            traces.append(ProviderTrace("fdc", {"alias": alias}, error=str(exc)).redacted())
            continue
    mapping, values, estimate_trace = _openai_estimated_rows(plant_name, aliases, plant_row, openai)
    traces.append(estimate_trace.redacted())
    return [mapping], values, traces


def best_fdc_candidate(plant_name: str, alias: str, foods: list[dict[str, Any]]) -> dict[str, Any] | None:
    scored: list[tuple[int, dict[str, Any]]] = []
    for food in foods:
        data_type = str(food.get("dataType") or "")
        if data_type not in DATA_TYPE_PRIORITY:
            continue
        description = str(food.get("description") or "")
        lowered = description.casefold()
        if not _looks_raw_commodity(lowered):
            continue
        alias_tokens = _identity_tokens(alias)
        plant_tokens = _identity_tokens(plant_name)
        description_tokens = _identity_tokens(description)
        if not _has_identity_overlap(alias_tokens | plant_tokens, description_tokens):
            continue
        score = 100 - DATA_TYPE_PRIORITY[data_type] * 10
        score += 5 * len(alias_tokens & description_tokens)
        score += 3 * len(plant_tokens & description_tokens)
        if "raw" in description_tokens:
            score += 8
        if any(term in lowered for term in ("canned", "cooked", "frozen", "dried", "juice", "sauce", "babyfood")):
            score -= 25
        scored.append((score, food))
    scored.sort(key=lambda item: item[0], reverse=True)
    return scored[0][1] if scored and scored[0][0] >= 90 else None


def nutrient_values_from_fdc(food_data: dict[str, Any]) -> dict[str, float]:
    values: dict[str, float] = {}
    for item in food_data.get("foodNutrients") or []:
        nutrient = item.get("nutrient") or {}
        nutrient_id = str(nutrient.get("id") or nutrient.get("number") or "").strip()
        nutrient_number = str(nutrient.get("number") or "").strip()
        nutrient_name = str(nutrient.get("name") or "").casefold()
        amount = item.get("amount")
        if amount is None:
            amount = item.get("value")
        for key in sorted(NUTRITION_NUTRIENT_KEYS):
            if key in values:
                continue
            if nutrient_id in NUTRIENT_IDS_BY_KEY[key] or nutrient_number in NUTRIENT_IDS_BY_KEY[key] or _nutrient_name_matches(key, nutrient_name):
                try:
                    values[key] = round(float(amount), 4)
                except (TypeError, ValueError):
                    pass
    return values


def _fdc_rows(plant_name: str, candidate: dict[str, Any], food_data: dict[str, Any], values: dict[str, float]) -> list[dict[str, Any]]:
    fdc_id = int(candidate["fdcId"])
    description = str(food_data.get("description") or candidate.get("description") or "").strip()
    data_type = str(food_data.get("dataType") or candidate.get("dataType") or "").strip()
    mapping = {
        "plant_name": plant_name,
        "fdc_id": fdc_id,
        "fdc_description": description,
        "fdc_data_type": data_type,
        "food_form": "raw",
        "match_confidence": "medium",
        "match_status": "pending",
        "source_url": FDC_SOURCE_URL,
        "source_note": "Auto-matched raw generic produce record; review before treating as curated.",
        "updated_at": UPDATED_AT,
    }
    return [mapping]


def _rows_with_estimated_missing_values(
    plant_name: str,
    aliases: list[str],
    plant_row: dict[str, Any],
    candidate: dict[str, Any],
    food_data: dict[str, Any],
    fdc_values: dict[str, float],
    openai: OpenAIJsonClient,
) -> tuple[dict[str, Any], list[dict[str, Any]], ProviderTrace]:
    estimate_mapping, estimate_values, trace = _openai_estimated_rows(plant_name, aliases, plant_row, openai)
    estimated_by_key = {row["nutrient_key"]: row["amount_per_100g"] for row in estimate_values}
    fdc_id = int(candidate["fdcId"])
    mapping = _fdc_rows(plant_name, candidate, food_data, fdc_values)[0]
    missing = sorted(NUTRITION_NUTRIENT_KEYS - set(fdc_values))
    mapping["source_note"] = (
        "Auto-matched raw generic produce record; USDA values are used where available, "
        f"with OpenAI estimates filling missing nutrients: {', '.join(missing)}."
    )
    value_rows = []
    for key in sorted(NUTRITION_NUTRIENT_KEYS):
        if key in fdc_values:
            value_rows.append({
                "plant_name": plant_name,
                "nutrient_key": key,
                "amount_per_100g": fdc_values[key],
                "source_fdc_id": fdc_id,
                "updated_at": UPDATED_AT,
            })
        else:
            value_rows.append({
                "plant_name": plant_name,
                "nutrient_key": key,
                "amount_per_100g": estimated_by_key[key],
                "source_fdc_id": None,
                "updated_at": estimate_mapping["updated_at"],
            })
    return mapping, value_rows, trace


def _value_rows(plant_name: str, values: dict[str, float], source_fdc_id: int | None) -> list[dict[str, Any]]:
    return [
        {
            "plant_name": plant_name,
            "nutrient_key": key,
            "amount_per_100g": values[key],
            "source_fdc_id": source_fdc_id,
            "updated_at": UPDATED_AT,
        }
        for key in sorted(NUTRITION_NUTRIENT_KEYS)
    ]


def _openai_estimated_rows(
    plant_name: str,
    aliases: list[str],
    plant_row: dict[str, Any],
    openai: OpenAIJsonClient,
) -> tuple[dict[str, Any], list[dict[str, Any]], ProviderTrace]:
    result, trace = openai.generate_json(
        schema_name="trellis_nutrition_estimate",
        json_schema=OPENAI_NUTRITION_ESTIMATE_SCHEMA,
        system=(
            "Estimate raw edible-portion nutrition per 100g for a garden crop only when USDA FoodData Central matching failed. "
            "Return conservative approximate values for the fixed nutrient keys. This is not dietary advice."
        ),
        user=json.dumps({"plant": plant_row, "nutrition_aliases": aliases, "nutrient_keys": sorted(NUTRITION_NUTRIENT_KEYS)}, indent=2),
    )
    values = {key: round(max(0.0, float(result["values"][key])), 4) for key in sorted(NUTRITION_NUTRIENT_KEYS)}
    source_note = str(result.get("source_note") or f"OpenAI estimate for raw {plant_name}; USDA FoodData Central match not found.").strip()
    mapping = {
        "plant_name": plant_name,
        "fdc_id": None,
        "fdc_description": ESTIMATED_FDC_DESCRIPTION,
        "fdc_data_type": ESTIMATED_FDC_DATA_TYPE,
        "food_form": "raw",
        "match_confidence": "low",
        "match_status": "pending",
        "source_url": None,
        "source_note": source_note,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    value_rows = _value_rows(plant_name, values, None)
    errors = validate_row("PlantNutritionMappings", mapping)["errors"]
    for row in value_rows:
        errors.extend(validate_row("PlantNutritionValues", row)["errors"])
    if errors:
        raise ProviderError("OpenAI nutrition estimate failed validation: " + "; ".join(errors))
    return mapping, value_rows, trace


def _candidate_aliases(plant_name: str, aliases: list[str]) -> list[str]:
    candidates = [plant_name, f"{plant_name}, raw", f"raw {plant_name}"]
    candidates.extend(CROP_ALIAS_OVERRIDES.get(normalize_key(plant_name), []))
    candidates.extend(str(alias).strip() for alias in aliases if str(alias).strip())
    return _unique(candidates)


def _looks_raw_commodity(description: str) -> bool:
    if any(term in description for term in ("branded", "babyfood", "restaurant", "fast food")):
        return False
    return "raw" in description or not any(term in description for term in ("cooked", "canned", "fried", "prepared", "juice"))


def _nutrient_name_matches(key: str, nutrient_name: str) -> bool:
    tokens = NUTRIENT_NAME_TOKENS[key]
    return all(token in nutrient_name for token in tokens)


def _word_tokens(value: str) -> set[str]:
    return {_singular_token(token) for token in normalize_key(value).replace(",", " ").split() if len(token) > 1}


def _identity_tokens(value: str) -> set[str]:
    return {token for token in _word_tokens(value) if token not in NON_IDENTITY_TOKENS}


def _has_identity_overlap(wanted: set[str], description: set[str]) -> bool:
    if not wanted:
        return False
    overlap = wanted & description
    required = 2 if len(wanted) >= 2 else 1
    return len(overlap) >= required


def _singular_token(token: str) -> str:
    if token.endswith("ies") and len(token) > 4:
        return token[:-3] + "y"
    if token.endswith("oes") and len(token) > 4:
        return token[:-2]
    if token.endswith("s") and not token.endswith("ss") and len(token) > 3:
        return token[:-1]
    return token


def _merge_unique(target: list[dict[str, Any]], rows: list[dict[str, Any]], keys: tuple[str, ...]) -> None:
    existing = {tuple(str(row.get(key) or "") for key in keys) for row in target}
    for row in rows:
        identity = tuple(str(row.get(key) or "") for key in keys)
        if identity not in existing:
            target.append(row)
            existing.add(identity)


def _cache_key(kind: str, payload: dict[str, Any]) -> str:
    raw = json.dumps(payload, sort_keys=True, separators=(",", ":"))
    digest = hashlib.sha256(raw.encode("utf-8")).hexdigest()[:16]
    return f"{kind}-{digest}"


def _unique(values: list[str]) -> list[str]:
    seen: set[str] = set()
    out: list[str] = []
    for value in values:
        key = normalize_key(value)
        if key and key not in seen:
            out.append(value)
            seen.add(key)
    return out
