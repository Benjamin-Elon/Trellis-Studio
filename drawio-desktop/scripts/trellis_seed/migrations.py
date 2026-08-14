from __future__ import annotations

import sqlite3
from datetime import datetime, timezone


def existing_tables(conn: sqlite3.Connection) -> set[str]:
    rows = conn.execute("SELECT name FROM sqlite_master WHERE type='table';").fetchall()
    return {str(row[0]) for row in rows}


def table_columns(conn: sqlite3.Connection, table: str) -> list[str]:
    return [str(row[1]) for row in conn.execute(f"PRAGMA table_info({table});").fetchall()]


def city_has_unique_name_constraint(conn: sqlite3.Connection) -> bool:
    if "Cities" not in existing_tables(conn):
        return False
    for index in conn.execute("PRAGMA index_list(Cities);").fetchall():
        if not int(index[2]):
            continue
        columns = [str(row[2]) for row in conn.execute(f"PRAGMA index_info({index[1]});").fetchall()]
        if columns == ["city_name"]:
            return True
    return False


def pending_migrations(conn: sqlite3.Connection) -> list[str]:
    tables = existing_tables(conn)
    pending = []
    if "Cities" in tables and any(column not in table_columns(conn, "Cities") for column in ("country_name", "country_code", "region_name", "region_code")):
        pending.append("add city geography columns")
    if "Cities" in tables and any(column not in table_columns(conn, "Cities") for column in ("is_major_city", "climate_band")):
        pending.append("add city benchmark label columns")
    if "Plants" in tables and "killtemp_c" not in table_columns(conn, "Plants"):
        pending.append("add plant kill temperature column")
    if "PlantVarieties" in tables and "maturity_class" not in table_columns(conn, "PlantVarieties"):
        pending.append("add variety maturity class column")
    if "PlantGrowthStages" not in tables:
        pending.append("create PlantGrowthStages")
    if city_has_unique_name_constraint(conn):
        pending.append("replace city name unique constraint with geography identity")
    if "CityWeatherMonthly" not in tables:
        pending.append("create CityWeatherMonthly")
    if "CityWeatherDaily" not in tables:
        pending.append("create CityWeatherDaily")
    if "CityWeatherForecastDaily" not in tables:
        pending.append("create CityWeatherForecastDaily")
    if "CompanionEvidence" not in tables:
        pending.append("create CompanionEvidence")
    if "CompanionLayoutGroupDefaults" not in tables:
        pending.append("create CompanionLayoutGroupDefaults")
    if "Companions" in tables and any(column not in table_columns(conn, "Companions") for column in ("source_plant_id", "companion_plant_id", "start_offset_days", "layout_template", "layout_spacing_x_cm", "layout_spacing_y_cm", "layout_offset_x_cm", "layout_offset_y_cm")):
        pending.append("add companion timing and layout columns")
    if "PlantingWindowReferences" not in tables:
        pending.append("create PlantingWindowReferences")
    if "VarietyTaskTemplates" not in tables or "method_id" not in table_columns(conn, "VarietyTaskTemplates"):
        pending.append("repair VarietyTaskTemplates key to (variety_id, method_id)")
    return pending


def apply_migrations(conn: sqlite3.Connection) -> list[str]:
    applied = []
    tables = existing_tables(conn)
    if "Cities" in tables:
        if city_has_unique_name_constraint(conn):
            conn.execute("PRAGMA foreign_keys = OFF;")
        city_columns = set(table_columns(conn, "Cities"))
        for column in ("country_name", "country_code", "region_name", "region_code"):
            if column not in city_columns:
                conn.execute(f"ALTER TABLE Cities ADD COLUMN {column} TEXT;")
                applied.append(f"added Cities.{column}")
        if "is_major_city" not in city_columns:
            conn.execute("ALTER TABLE Cities ADD COLUMN is_major_city INTEGER;")
            applied.append("added Cities.is_major_city")
        if "climate_band" not in city_columns:
            conn.execute("ALTER TABLE Cities ADD COLUMN climate_band TEXT;")
            applied.append("added Cities.climate_band")
        if city_has_unique_name_constraint(conn):
            _rebuild_cities_without_unique_name(conn)
            applied.append("replaced Cities.city_name uniqueness with city geography identity")
        conn.execute(
            """
            CREATE UNIQUE INDEX IF NOT EXISTS idx_Cities_city_geo_identity
                ON Cities(
                    lower(trim(city_name)),
                    lower(trim(coalesce(country_name, ''))),
                    lower(trim(coalesce(country_code, ''))),
                    lower(trim(coalesce(region_name, ''))),
                    lower(trim(coalesce(region_code, '')))
                );
            """
        )
        conn.execute("CREATE INDEX IF NOT EXISTS idx_Cities_city_name ON Cities(city_name);")
    if "Plants" in tables and "killtemp_c" not in table_columns(conn, "Plants"):
        conn.execute("ALTER TABLE Plants ADD COLUMN killtemp_c REAL;")
        applied.append("added Plants.killtemp_c")
    if "PlantVarieties" in tables and "maturity_class" not in table_columns(conn, "PlantVarieties"):
        conn.execute("ALTER TABLE PlantVarieties ADD COLUMN maturity_class TEXT;")
        applied.append("added PlantVarieties.maturity_class")
    if "PlantGrowthStages" not in tables:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS PlantGrowthStages (
                stage_id INTEGER PRIMARY KEY AUTOINCREMENT,
                plant_id INTEGER NOT NULL REFERENCES Plants(plant_id) ON DELETE CASCADE,
                stage_key TEXT NOT NULL,
                stage_label TEXT NOT NULL,
                gdd_ratio REAL NOT NULL,
                spacing_ratio REAL,
                plant_diameter_ratio REAL,
                plant_height_ratio REAL,
                sort_order INTEGER NOT NULL DEFAULT 0,
                active INTEGER NOT NULL DEFAULT 1,
                is_default INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                UNIQUE(plant_id, stage_key)
            );
            CREATE INDEX IF NOT EXISTS idx_PlantGrowthStages_plant_id ON PlantGrowthStages(plant_id);
            """
        )
        applied.append("created PlantGrowthStages")
    if "Companions" in tables:
        companion_columns = set(table_columns(conn, "Companions"))
        for column, column_type in (("source_plant_id", "INTEGER"), ("companion_plant_id", "INTEGER"), ("start_offset_days", "INTEGER"), ("layout_template", "TEXT"), ("layout_spacing_x_cm", "REAL"), ("layout_spacing_y_cm", "REAL"), ("layout_offset_x_cm", "REAL"), ("layout_offset_y_cm", "REAL")):
            if column not in companion_columns:
                conn.execute(f"ALTER TABLE Companions ADD COLUMN {column} {column_type};")
                applied.append(f"added Companions.{column}")
        if {"source_plant_id", "companion_plant_id"}.issubset(set(table_columns(conn, "Companions"))) and "Plants" in tables:
            resolved = _backfill_companion_plant_ids(conn)
            if resolved:
                applied.append(f"backfilled {resolved} companion plant id pair(s)")
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

        CREATE TABLE IF NOT EXISTS CompanionLayoutGroupDefaults (
            group_default_id INTEGER PRIMARY KEY AUTOINCREMENT,
            plant_set_key TEXT NOT NULL,
            anchor_plant_id INTEGER NOT NULL REFERENCES Plants(plant_id) ON DELETE CASCADE,
            layout_json TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            UNIQUE (plant_set_key, anchor_plant_id)
        );
        CREATE INDEX IF NOT EXISTS idx_CompanionLayoutGroupDefaults_anchor
            ON CompanionLayoutGroupDefaults(anchor_plant_id);

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
    for label in ("CityWeatherMonthly", "CityWeatherDaily", "CityWeatherForecastDaily", "CompanionEvidence", "CompanionLayoutGroupDefaults", "PlantingWindowReferences", "VarietyTaskTemplates"):
        if label not in tables or label == "VarietyTaskTemplates":
            applied.append(f"ensured {label}")
    return applied


def _normalize_name(value: object) -> str:
    return str(value or "").strip().casefold()


def _plant_ids_by_name(conn: sqlite3.Connection) -> dict[str, int]:
    out: dict[str, int] = {}
    if "Plants" not in existing_tables(conn):
        return out
    for row in conn.execute("SELECT plant_id, plant_name FROM Plants WHERE plant_name IS NOT NULL;"):
        key = _normalize_name(row[1])
        if key and key not in out:
            out[key] = int(row[0])
    return out


def _backfill_companion_plant_ids(conn: sqlite3.Connection) -> int:
    plant_ids = _plant_ids_by_name(conn)
    if not plant_ids:
        return 0
    resolved = 0
    for row in conn.execute("SELECT relation_id, p1, p2, source_plant_id, companion_plant_id FROM Companions;"):
        if row[3] is not None and row[4] is not None:
            continue
        source_id = plant_ids.get(_normalize_name(row[1]))
        companion_id = plant_ids.get(_normalize_name(row[2]))
        next_source_id = row[3] if row[3] is not None else source_id
        next_companion_id = row[4] if row[4] is not None else companion_id
        if next_source_id is None and next_companion_id is None:
            continue
        conn.execute(
            "UPDATE Companions SET source_plant_id=?, companion_plant_id=? WHERE relation_id=?;",
            [next_source_id, next_companion_id, row[0]],
        )
        resolved += 1
    return resolved


def _rebuild_cities_without_unique_name(conn: sqlite3.Connection) -> None:
    columns = conn.execute("PRAGMA table_info(Cities);").fetchall()
    column_defs = [_column_definition(column) for column in columns]
    names = [str(column[1]) for column in columns]
    quoted_names = ", ".join(_quote_identifier(name) for name in names)
    conn.execute("PRAGMA foreign_keys = OFF;")
    conn.execute(f"CREATE TABLE Cities_new ({', '.join(column_defs)});")
    conn.execute(f"INSERT INTO Cities_new ({quoted_names}) SELECT {quoted_names} FROM Cities;")
    conn.execute("DROP TABLE Cities;")
    conn.execute("ALTER TABLE Cities_new RENAME TO Cities;")
    conn.execute("PRAGMA foreign_keys = ON;")


def _column_definition(column: sqlite3.Row | tuple) -> str:
    name = str(column[1])
    col_type = str(column[2] or "TEXT")
    not_null = bool(column[3])
    default = column[4]
    primary_key = bool(column[5])
    parts = [_quote_identifier(name), col_type]
    if primary_key:
        parts.append("PRIMARY KEY")
    if not_null and not primary_key:
        parts.append("NOT NULL")
    if default is not None:
        parts.append(f"DEFAULT {default}")
    return " ".join(parts)


def _quote_identifier(value: str) -> str:
    return '"' + value.replace('"', '""') + '"'
