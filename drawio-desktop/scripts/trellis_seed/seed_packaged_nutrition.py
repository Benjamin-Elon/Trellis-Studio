from __future__ import annotations

import sqlite3
from contextlib import closing
from pathlib import Path

from .migrations import apply_migrations, pending_migrations
from .nutrition import NUTRIENTS, REQUIREMENTS

RAW_VALUES_PER_100G = {
    "Apple": (1102640, "Apple, raw", "Foundation", {"energy_kcal": 52, "protein_g": 0.26, "fiber_g": 2.4, "vitamin_a_rae_mcg": 3, "vitamin_c_mg": 4.6, "vitamin_k_mcg": 2.2, "folate_dfe_mcg": 3, "potassium_mg": 107, "iron_mg": 0.12, "calcium_mg": 6}),
    "Artichoke": (170084, "Artichokes, raw", "SR Legacy", {"energy_kcal": 47, "protein_g": 3.27, "fiber_g": 5.4, "vitamin_a_rae_mcg": 1, "vitamin_c_mg": 11.7, "vitamin_k_mcg": 14.8, "folate_dfe_mcg": 68, "potassium_mg": 370, "iron_mg": 1.28, "calcium_mg": 44}),
    "Asparagus": (168389, "Asparagus, raw", "SR Legacy", {"energy_kcal": 20, "protein_g": 2.2, "fiber_g": 2.1, "vitamin_a_rae_mcg": 38, "vitamin_c_mg": 5.6, "vitamin_k_mcg": 41.6, "folate_dfe_mcg": 52, "potassium_mg": 202, "iron_mg": 2.14, "calcium_mg": 24}),
    "Beet": (169145, "Beets, raw", "SR Legacy", {"energy_kcal": 43, "protein_g": 1.61, "fiber_g": 2.8, "vitamin_a_rae_mcg": 2, "vitamin_c_mg": 4.9, "vitamin_k_mcg": 0.2, "folate_dfe_mcg": 109, "potassium_mg": 325, "iron_mg": 0.8, "calcium_mg": 16}),
    "Blueberry": (171711, "Blueberries, raw", "SR Legacy", {"energy_kcal": 57, "protein_g": 0.74, "fiber_g": 2.4, "vitamin_a_rae_mcg": 3, "vitamin_c_mg": 9.7, "vitamin_k_mcg": 19.3, "folate_dfe_mcg": 6, "potassium_mg": 77, "iron_mg": 0.28, "calcium_mg": 6}),
    "Broccoli": (170379, "Broccoli, raw", "SR Legacy", {"energy_kcal": 34, "protein_g": 2.82, "fiber_g": 2.6, "vitamin_a_rae_mcg": 31, "vitamin_c_mg": 89.2, "vitamin_k_mcg": 101.6, "folate_dfe_mcg": 63, "potassium_mg": 316, "iron_mg": 0.73, "calcium_mg": 47}),
    "Chive": (168420, "Chives, raw", "SR Legacy", {"energy_kcal": 30, "protein_g": 3.27, "fiber_g": 2.5, "vitamin_a_rae_mcg": 218, "vitamin_c_mg": 58.1, "vitamin_k_mcg": 212.7, "folate_dfe_mcg": 105, "potassium_mg": 296, "iron_mg": 1.6, "calcium_mg": 92}),
    "Garlic": (169230, "Garlic, raw", "SR Legacy", {"energy_kcal": 149, "protein_g": 6.36, "fiber_g": 2.1, "vitamin_a_rae_mcg": 0, "vitamin_c_mg": 31.2, "vitamin_k_mcg": 1.7, "folate_dfe_mcg": 3, "potassium_mg": 401, "iron_mg": 1.7, "calcium_mg": 181}),
    "Mint": (173475, "Spearmint, fresh", "SR Legacy", {"energy_kcal": 44, "protein_g": 3.29, "fiber_g": 6.8, "vitamin_a_rae_mcg": 203, "vitamin_c_mg": 13.3, "vitamin_k_mcg": 0, "folate_dfe_mcg": 105, "potassium_mg": 458, "iron_mg": 11.87, "calcium_mg": 199}),
    "Raspberry": (167755, "Raspberries, raw", "SR Legacy", {"energy_kcal": 52, "protein_g": 1.2, "fiber_g": 6.5, "vitamin_a_rae_mcg": 2, "vitamin_c_mg": 26.2, "vitamin_k_mcg": 7.8, "folate_dfe_mcg": 21, "potassium_mg": 151, "iron_mg": 0.69, "calcium_mg": 25}),
    "Rhubarb": (167758, "Rhubarb, raw", "SR Legacy", {"energy_kcal": 21, "protein_g": 0.9, "fiber_g": 1.8, "vitamin_a_rae_mcg": 5, "vitamin_c_mg": 8, "vitamin_k_mcg": 29.3, "folate_dfe_mcg": 7, "potassium_mg": 288, "iron_mg": 0.22, "calcium_mg": 86}),
    "Strawberry": (167762, "Strawberries, raw", "SR Legacy", {"energy_kcal": 32, "protein_g": 0.67, "fiber_g": 2, "vitamin_a_rae_mcg": 1, "vitamin_c_mg": 58.8, "vitamin_k_mcg": 2.2, "folate_dfe_mcg": 24, "potassium_mg": 153, "iron_mg": 0.41, "calcium_mg": 16}),
    "Sweet Corn": (169998, "Corn, sweet, yellow, raw", "SR Legacy", {"energy_kcal": 86, "protein_g": 3.27, "fiber_g": 2, "vitamin_a_rae_mcg": 9, "vitamin_c_mg": 6.8, "vitamin_k_mcg": 0.3, "folate_dfe_mcg": 42, "potassium_mg": 270, "iron_mg": 0.52, "calcium_mg": 2}),
    "Thyme": (170204, "Thyme, fresh", "SR Legacy", {"energy_kcal": 101, "protein_g": 5.56, "fiber_g": 14, "vitamin_a_rae_mcg": 238, "vitamin_c_mg": 160.1, "vitamin_k_mcg": 1714.5, "folate_dfe_mcg": 45, "potassium_mg": 609, "iron_mg": 17.45, "calcium_mg": 405}),
}


def seed_packaged_nutrition(db_path: Path) -> None:
    now = "2026-09-07T00:00:00+00:00"
    source_url = "https://fdc.nal.usda.gov/download-datasets/"
    with closing(sqlite3.connect(db_path)) as conn:
        with conn:
            apply_migrations(conn)
            conn.executemany(
                "INSERT INTO NutritionNutrients(nutrient_key,nutrient_name,unit,sort_order) VALUES(?,?,?,?) "
                "ON CONFLICT(nutrient_key) DO UPDATE SET nutrient_name=excluded.nutrient_name, unit=excluded.unit, sort_order=excluded.sort_order",
                NUTRIENTS,
            )
            units = {key: unit for key, _name, unit, _order in NUTRIENTS}
            requirement_rows = [
                (persona, key, amount, units[key], "https://www.nal.usda.gov/human-nutrition-and-food-safety/dri-calculator", "Averaged planning persona requirement; not dietary advice.", now)
                for persona, values in REQUIREMENTS.items()
                for key, amount in values.items()
            ]
            conn.executemany(
                "INSERT INTO NutritionRequirements(persona_key,nutrient_key,amount_per_day,unit,source_url,source_note,updated_at) VALUES(?,?,?,?,?,?,?) "
                "ON CONFLICT(persona_key,nutrient_key) DO UPDATE SET amount_per_day=excluded.amount_per_day, unit=excluded.unit, source_url=excluded.source_url, source_note=excluded.source_note, updated_at=excluded.updated_at",
                requirement_rows,
            )
            plant_ids = {name: plant_id for plant_id, name in conn.execute("SELECT plant_id, plant_name FROM Plants")}
            missing_snapshot = sorted(set(plant_ids) - set(RAW_VALUES_PER_100G))
            if missing_snapshot:
                raise RuntimeError(f"Missing packaged raw nutrition values for plants: {', '.join(missing_snapshot)}")
            mapping_rows = []
            value_rows = []
            for plant_name, (fdc_id, description, data_type, values) in RAW_VALUES_PER_100G.items():
                plant_id = plant_ids[plant_name]
                mapping_rows.append((plant_id, fdc_id, description, data_type, "raw", "medium", "pending", source_url, "Auto-matched raw generic produce record; review before treating as curated.", now))
                value_rows.extend((plant_id, key, amount, fdc_id, now) for key, amount in values.items())
            conn.executemany(
                "INSERT INTO PlantNutritionMappings(plant_id,fdc_id,fdc_description,fdc_data_type,food_form,match_confidence,match_status,source_url,source_note,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?) "
                "ON CONFLICT(plant_id,food_form) DO UPDATE SET fdc_id=excluded.fdc_id, fdc_description=excluded.fdc_description, fdc_data_type=excluded.fdc_data_type, match_confidence=excluded.match_confidence, match_status=excluded.match_status, source_url=excluded.source_url, source_note=excluded.source_note, updated_at=excluded.updated_at",
                mapping_rows,
            )
            conn.executemany(
                "INSERT INTO PlantNutritionValues(plant_id,nutrient_key,amount_per_100g,source_fdc_id,updated_at) VALUES(?,?,?,?,?) "
                "ON CONFLICT(plant_id,nutrient_key) DO UPDATE SET amount_per_100g=excluded.amount_per_100g, source_fdc_id=excluded.source_fdc_id, updated_at=excluded.updated_at",
                value_rows,
            )
        remaining = pending_migrations(conn)
        if remaining:
            raise RuntimeError(f"Pending migrations after nutrition seed: {remaining}")


if __name__ == "__main__":
    seed_packaged_nutrition(Path(__file__).resolve().parents[2] / "trellis_database" / "Trellis_database.sqlite")
