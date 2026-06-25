from __future__ import annotations

import shutil
import tempfile
from contextlib import closing

from .config import load_settings, read_openai_api_key
from .db import apply_run, create_diff_report
from .generator import preflight
from .jsonio import write_json
from .migrations import apply_migrations
from .paths import DEFAULT_CONFIG_PATH
from .providers import OpenAIJsonClient, OpenMeteoClient


def run_live_tests() -> bool:
    settings = load_settings(DEFAULT_CONFIG_PATH)
    api_key = read_openai_api_key()
    if not api_key:
        print("OPENAI_API_KEY is missing.")
        return False
    try:
        preflight(settings, {"crops": [{"name": "Lettuce", "sources": ["live test"]}], "cities": [{"name": "Vancouver"}]})
        openai = OpenAIJsonClient(api_key, settings.openai_model, settings.openai_reasoning_effort)
        result, _trace = openai.generate_json(
            system="Return only the requested JSON object.",
            user="Return {\"ok\": true} for a Trellis live test.",
            schema_name="trellis_live_test",
            json_schema={
                "type": "object",
                "additionalProperties": False,
                "required": ["ok"],
                "properties": {"ok": {"type": "boolean"}},
            },
        )
        if result.get("ok") is not True:
            raise RuntimeError("OpenAI live test returned an unexpected payload.")

        meteo = OpenMeteoClient(settings.data["open_meteo"])
        geocode, _geo_trace = meteo.geocode("Vancouver")
        meteo.historical_daily(
            latitude=float(geocode["latitude"]),
            longitude=float(geocode["longitude"]),
            timezone=str(geocode.get("timezone") or "UTC"),
            start_date="2025-01-01",
            end_date="2025-01-03",
        )
        meteo.forecast_daily(
            latitude=float(geocode["latitude"]),
            longitude=float(geocode["longitude"]),
            timezone=str(geocode.get("timezone") or "UTC"),
            forecast_days=1,
        )
        with tempfile.TemporaryDirectory() as tmp:
            from pathlib import Path
            tmp_path = Path(tmp)
            db_copy = tmp_path / "Trellis_database.sqlite"
            shutil.copy2(settings.db_path, db_copy)
            import sqlite3
            with closing(sqlite3.connect(db_copy)) as conn:
                with conn:
                    apply_migrations(conn)
            run_dir = tmp_path / "run-live-smoke"
            (run_dir / "generated").mkdir(parents=True)
            write_json(run_dir / "generated" / "Cities.json", [{
                "city_name": "Live Test City",
                "latitude": 49.0,
                "longitude": -123.0,
                "timezone": "America/Vancouver",
                "gdd_annual": 1000,
                "gdd_base_c": 5,
            }])
            create_diff_report(run_dir, db_copy)
            apply_run(run_dir, db_copy)
        return True
    except Exception as exc:
        print(f"Live test failed: {exc}")
        return False
