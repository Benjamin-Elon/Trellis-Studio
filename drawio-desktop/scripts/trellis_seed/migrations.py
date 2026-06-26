from __future__ import annotations

import sqlite3
from datetime import datetime, timezone


def existing_tables(conn: sqlite3.Connection) -> set[str]:
    rows = conn.execute("SELECT name FROM sqlite_master WHERE type='table';").fetchall()
    return {str(row[0]) for row in rows}


def table_columns(conn: sqlite3.Connection, table: str) -> list[str]:
    return [str(row[1]) for row in conn.execute(f"PRAGMA table_info({table});").fetchall()]


def pending_migrations(conn: sqlite3.Connection) -> list[str]:
    tables = existing_tables(conn)
    pending = []
    if "CityWeatherMonthly" not in tables:
        pending.append("create CityWeatherMonthly")
    if "CityWeatherDaily" not in tables:
        pending.append("create CityWeatherDaily")
    if "CityWeatherForecastDaily" not in tables:
        pending.append("create CityWeatherForecastDaily")
    if "CompanionEvidence" not in tables:
        pending.append("create CompanionEvidence")
    if "PlantingWindowReferences" not in tables:
        pending.append("create PlantingWindowReferences")
    if "VarietyTaskTemplates" not in tables or "method_id" not in table_columns(conn, "VarietyTaskTemplates"):
        pending.append("repair VarietyTaskTemplates key to (variety_id, method_id)")
    return pending


def apply_migrations(conn: sqlite3.Connection) -> list[str]:
    applied = []
    tables = existing_tables(conn)
    if "VarietyTaskTemplates" in tables and "method_id" not in table_columns(conn, "VarietyTaskTemplates"):
        suffix = datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S")
        conn.execute(f"ALTER TABLE VarietyTaskTemplates RENAME TO VarietyTaskTemplates_legacy_{suffix};")
        applied.append("renamed legacy VarietyTaskTemplates")

    conn.executescript(
        """
        CREATE TABLE IF NOT EXISTS CityWeatherDaily (
            city_id INTEGER NOT NULL REFERENCES Cities(city_id) ON DELETE CASCADE,
            weather_date TEXT NOT NULL,
            provider TEXT NOT NULL,
            dataset TEXT NOT NULL,
            timezone TEXT,
            temp_min_c REAL,
            temp_max_c REAL,
            temp_mean_c REAL,
            precipitation_mm REAL,
            rain_mm REAL,
            snowfall_cm REAL,
            gdd_base_5c REAL,
            fetched_at TEXT NOT NULL,
            source_url TEXT,
            PRIMARY KEY (city_id, weather_date, provider, dataset)
        );
        CREATE INDEX IF NOT EXISTS idx_CityWeatherDaily_city_date
            ON CityWeatherDaily(city_id, weather_date);

        CREATE TABLE IF NOT EXISTS CityWeatherMonthly (
            city_id INTEGER NOT NULL REFERENCES Cities(city_id) ON DELETE CASCADE,
            weather_month TEXT NOT NULL,
            provider TEXT NOT NULL,
            dataset TEXT NOT NULL,
            timezone TEXT,
            temp_min_c REAL,
            temp_max_c REAL,
            temp_mean_c REAL,
            precipitation_mm REAL,
            gdd_base_5c REAL,
            fetched_at TEXT NOT NULL,
            source_url TEXT,
            PRIMARY KEY (city_id, weather_month, provider, dataset)
        );
        CREATE INDEX IF NOT EXISTS idx_CityWeatherMonthly_city_month
            ON CityWeatherMonthly(city_id, weather_month);

        CREATE TABLE IF NOT EXISTS CityWeatherForecastDaily (
            city_id INTEGER NOT NULL REFERENCES Cities(city_id) ON DELETE CASCADE,
            forecast_date TEXT NOT NULL,
            run_timestamp TEXT NOT NULL,
            provider TEXT NOT NULL,
            model TEXT NOT NULL,
            timezone TEXT,
            temp_min_c REAL,
            temp_max_c REAL,
            temp_mean_c REAL,
            precipitation_mm REAL,
            rain_mm REAL,
            precipitation_probability_max INTEGER,
            et0_fao_evapotranspiration_mm REAL,
            source_url TEXT,
            PRIMARY KEY (city_id, forecast_date, run_timestamp, provider, model)
        );
        CREATE INDEX IF NOT EXISTS idx_CityWeatherForecastDaily_city_date
            ON CityWeatherForecastDaily(city_id, forecast_date);

        CREATE TABLE IF NOT EXISTS CompanionEvidence (
            evidence_id INTEGER PRIMARY KEY AUTOINCREMENT,
            relation_id INTEGER NOT NULL REFERENCES Companions(relation_id) ON DELETE CASCADE,
            evidence_level TEXT NOT NULL,
            review_status TEXT NOT NULL,
            source_url TEXT,
            source_note TEXT,
            summary TEXT,
            created_at TEXT NOT NULL,
            UNIQUE (relation_id, source_url, source_note)
        );
        CREATE INDEX IF NOT EXISTS idx_CompanionEvidence_relation
            ON CompanionEvidence(relation_id);

        CREATE TABLE IF NOT EXISTS PlantingWindowReferences (
            reference_id INTEGER PRIMARY KEY AUTOINCREMENT,
            plant_id INTEGER NOT NULL REFERENCES Plants(plant_id) ON DELETE CASCADE,
            city_id INTEGER NOT NULL REFERENCES Cities(city_id) ON DELETE CASCADE,
            method_id TEXT NOT NULL REFERENCES PlantingMethods(method_id) ON DELETE CASCADE,
            stage TEXT NOT NULL,
            window_label TEXT NOT NULL,
            start_mm_dd TEXT NOT NULL,
            end_mm_dd TEXT NOT NULL,
            start_doy INTEGER NOT NULL,
            end_doy INTEGER NOT NULL,
            is_cross_year INTEGER NOT NULL DEFAULT 0,
            source_url TEXT,
            source_note TEXT,
            confidence TEXT NOT NULL,
            summary TEXT NOT NULL,
            UNIQUE (plant_id, city_id, method_id, stage, window_label, start_mm_dd, end_mm_dd)
        );
        CREATE INDEX IF NOT EXISTS idx_PlantingWindowReferences_lookup
            ON PlantingWindowReferences(plant_id, city_id, method_id, stage);

        CREATE TABLE IF NOT EXISTS VarietyTaskTemplates (
            variety_id INTEGER NOT NULL REFERENCES PlantVarieties(variety_id) ON DELETE CASCADE,
            method_id TEXT NOT NULL REFERENCES PlantingMethods(method_id) ON DELETE CASCADE,
            template_json TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            PRIMARY KEY (variety_id, method_id)
        );
        """
    )
    for label in ("CityWeatherMonthly", "CityWeatherDaily", "CityWeatherForecastDaily", "CompanionEvidence", "PlantingWindowReferences", "VarietyTaskTemplates"):
        if label not in tables or label == "VarietyTaskTemplates":
            applied.append(f"ensured {label}")
    return applied
