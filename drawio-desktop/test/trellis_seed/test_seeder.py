from __future__ import annotations

import json
import os
import shutil
import sqlite3
import sys
import tempfile
from contextlib import closing
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts"))

from trellis_seed.db import apply_run, create_diff_report  # noqa: E402
from trellis_seed.config import Settings, read_openai_api_key  # noqa: E402
from trellis_seed.generator import _call_openai_with_retry, _crop_source_values, _validate_crop_result, _validate_template_result  # noqa: E402
from trellis_seed.jsonio import write_json  # noqa: E402
from trellis_seed.migrations import apply_migrations, pending_migrations  # noqa: E402
from trellis_seed.planner import effective_tables_from_input, selected_tables_warning  # noqa: E402
from trellis_seed.providers import OpenAIJsonClient, OpenMeteoClient, ProviderTrace  # noqa: E402
from trellis_seed.schema import OPENAI_PLANT_SCHEMA, OPENAI_TEMPLATE_SCHEMA  # noqa: E402
from trellis_seed.validator import validate_input, validate_row, validate_run  # noqa: E402


class TrellisSeederTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.tmp_path = Path(self.tmp.name)
        self.db_path = self.tmp_path / "Trellis_database.sqlite"
        shutil.copy2(ROOT / "trellis_database" / "Trellis_database.sqlite", self.db_path)

    def tearDown(self) -> None:
        self.tmp.cleanup()

    def test_migrations_create_weather_evidence_and_repair_variety_templates(self) -> None:
        with closing(sqlite3.connect(self.db_path)) as conn:
            before = pending_migrations(conn)
            self.assertIn("create CityWeatherDaily", before)
            with conn:
                apply_migrations(conn)
            after = pending_migrations(conn)
            self.assertEqual(after, [])
            cols = [row[1] for row in conn.execute("PRAGMA table_info(VarietyTaskTemplates);")]
            self.assertIn("method_id", cols)
            self.assertIn("template_json", cols)

    def test_input_validation_requires_crop_sources(self) -> None:
        errors = validate_input({"crops": [{"name": "Lettuce"}]})
        self.assertTrue(any("needs at least one source" in error for error in errors))

    def test_openai_settings_come_from_environment(self) -> None:
        original = {key: os.environ.get(key) for key in ("OPENAI_API_KEY", "OPENAI_MODEL", "OPENAI_REASONING_EFFORT")}
        try:
            os.environ["OPENAI_API_KEY"] = "env-key"
            os.environ["OPENAI_MODEL"] = "env-model"
            os.environ["OPENAI_REASONING_EFFORT"] = "high"
            settings = Settings(self.tmp_path / "config.json", {
                "openai_model": "config-model",
                "openai_reasoning_effort": "low",
            })
            self.assertEqual(read_openai_api_key(), "env-key")
            self.assertEqual(settings.openai_model, "env-model")
            self.assertEqual(settings.openai_reasoning_effort, "high")
        finally:
            for key, value in original.items():
                if value is None:
                    os.environ.pop(key, None)
                else:
                    os.environ[key] = value

    def test_open_meteo_geocode_handles_region_qualified_city_names(self) -> None:
        class FakeMeteo(OpenMeteoClient):
            def __init__(self) -> None:
                super().__init__({"geocoding_url": "https://example.test/geocode"})
                self.urls: list[str] = []

            def _get_json(self, url: str) -> dict:
                self.urls.append(url)
                return {
                    "results": [
                        {
                            "name": "Vancouver",
                            "admin1": "Washington",
                            "country": "United States",
                            "country_code": "US",
                            "latitude": 45.64,
                            "longitude": -122.66,
                        },
                        {
                            "name": "Vancouver",
                            "admin1": "British Columbia",
                            "country": "Canada",
                            "country_code": "CA",
                            "latitude": 49.25,
                            "longitude": -123.12,
                        },
                    ]
                }

        client = FakeMeteo()
        result, trace = client.geocode("Vancouver, BC")
        self.assertEqual(result["admin1"], "British Columbia")
        self.assertIn("name=Vancouver", client.urls[0])
        self.assertEqual(trace.request["input"], "Vancouver, BC")

    def test_openai_schemas_are_strict_output_compatible(self) -> None:
        for schema in (OPENAI_PLANT_SCHEMA, OPENAI_TEMPLATE_SCHEMA):
            self._assert_strict_schema(schema)

    def test_openai_client_does_not_mask_responses_api_errors(self) -> None:
        class FakeResponses:
            def create(self, **_kwargs):
                raise RuntimeError("responses schema error")

        class FakeChat:
            def create(self, **_kwargs):
                raise RuntimeError("chat should not be called")

        client = object.__new__(OpenAIJsonClient)
        client.api_key = "test-key"
        client.model = "gpt-5.5"
        client.reasoning_effort = "high"
        fake_openai = type("FakeOpenAI", (), {"responses": FakeResponses(), "chat": type("Chat", (), {"completions": FakeChat()})()})()
        original_import = __import__
        try:
            import builtins
            builtins.__import__ = lambda name, *args, **kwargs: type("Module", (), {"OpenAI": lambda api_key: fake_openai}) if name == "openai" else original_import(name, *args, **kwargs)
            with self.assertRaisesRegex(Exception, "responses schema error"):
                client.generate_json(system="", user="", schema_name="test", json_schema={"type": "object", "properties": {}, "required": [], "additionalProperties": False})
        finally:
            import builtins
            builtins.__import__ = original_import

    def test_effective_tables_are_section_driven(self) -> None:
        data = {
            "tables": ["Cities"],
            "crops": [{"name": "Lettuce", "sources": ["source"]}],
        }
        tables = effective_tables_from_input(data)
        self.assertIn("Plants", tables)
        self.assertIn("PlantTaskTemplates", tables)
        self.assertNotIn("Cities", tables)
        self.assertIsNotNone(selected_tables_warning(data, tables))

    def test_validation_uses_source_maps_and_hard_bounds(self) -> None:
        row = {
            "plant_name": "Bad Crop",
            "yield_per_plant_kg": -1,
            "provenance": {"field_sources": {"plant_name": ["source-a"]}},
        }
        report = validate_row("Plants", row, source_values={"source-a"}, required_source_fields={"plant_name", "yield_per_plant_kg"})
        self.assertTrue(any("yield_per_plant_kg outside hard bounds" in error for error in report["errors"]))
        self.assertTrue(any("field_sources.yield_per_plant_kg" in error for error in report["errors"]))

    def test_crop_validation_accepts_controlled_input_provenance_references(self) -> None:
        methods = [{
            "method_id": "direct_sow.field",
            "method_category_id": "direct_sow",
            "method_name": "Direct sow (field)",
        }]
        source_values = _crop_source_values({"name": "Lettuce", "sources": ["https://example.test/lettuce"]}, methods)
        result = {
            "row": {
                "plant_name": "Lettuce",
                "abbr": "LET",
                "direct_sow": 1,
                "transplant": 1,
                "default_planting_method_category": "direct_sow",
                "default_planting_method": "direct_sow.field",
            },
            "allowed_method_categories": ["direct_sow"],
            "provenance": {
                "field_sources": [
                    {"field": "plant_name", "source": "Lettuce"},
                    {"field": "direct_sow", "source": "direct_sow"},
                    {"field": "transplant", "source": "method_category_id: direct_sow"},
                    {"field": "default_planting_method_category", "source": "direct_sow"},
                    {"field": "default_planting_method", "source": "Direct sow (field)"},
                ]
            },
        }
        self.assertEqual(_validate_crop_result(result, source_values), [])

    def test_template_validation_accepts_method_task_json_provenance_reference(self) -> None:
        task_json = '{\n  "prep": { "offsetDays": 5, "offsetDirection": "before" },\n  "sow": { "offsetDays": 0 },\n  "transplant": { "offsetDays": 30, "offsetDirection": "after" },\n  "harvest": true\n}'
        source_values = _crop_source_values({"name": "Lettuce", "sources": ["https://example.test/lettuce"]}, [{
            "method_id": "transplant.outdoor",
            "method_category_id": "transplant",
            "method_name": "Outdoor transplant",
            "tasks_required_json": task_json,
        }])
        result = {
            "version": 2,
            "rules": [{
                "id": "prep",
                "title": "Prepare bed",
                "startAnchorStage": "SOW",
                "startOffsetDays": 5,
                "startOffsetDirection": "before",
                "endMode": "fixed_days",
                "durationDays": 0,
                "endAnchorStage": None,
                "endAnchorOffsetDays": 0,
                "endAnchorOffsetDirection": "after",
                "repeatMode": "none",
                "repeatEveryDays": 0,
                "repeatUntilMode": "x_times",
                "repeatTimes": 0,
                "repeatUntilAnchorStage": "HARVEST_END",
                "repeatCutoffOffsetDays": 0,
                "repeatCutoffOffsetDirection": "after",
            }],
            "provenance": {
                "field_sources": [{
                    "field": "rules",
                    "source": '{\n  "harvest": true,\n  "prep": { "offsetDirection": "before", "offsetDays": 5 },\n  "sow": { "offsetDays": 0 },\n  "transplant": { "offsetDirection": "after", "offsetDays": 30 }\n}',
                }]
            },
        }
        self.assertEqual(_validate_template_result(result, source_values), [])

    def test_model_retry_uses_row_local_validation_errors(self) -> None:
        class FakeOpenAI:
            def __init__(self) -> None:
                self.calls = 0

            def generate_json(self, **kwargs):
                self.calls += 1
                trace = ProviderTrace("fake", {"call": self.calls})
                if self.calls == 1:
                    return {"value": "bad"}, trace
                return {"value": "ok"}, trace

        fake = FakeOpenAI()
        result, trace = _call_openai_with_retry(
            fake,
            schema_name="fake",
            json_schema={},
            system="",
            user="",
            validator=lambda candidate: [] if candidate.get("value") == "ok" else ["value must be ok"],
        )
        self.assertEqual(result["value"], "ok")
        self.assertEqual(fake.calls, 2)
        self.assertIn("repair_for", trace.request)

    def _assert_strict_schema(self, schema: dict) -> None:
        if schema.get("type") == "object":
            properties = schema.get("properties") or {}
            self.assertEqual(schema.get("additionalProperties"), False)
            self.assertEqual(set(schema.get("required") or []), set(properties))
        if schema.get("type") == "array":
            self._assert_strict_schema(schema.get("items") or {})
        for value in (schema.get("properties") or {}).values():
            self._assert_strict_schema(value)

    def test_apply_run_upserts_core_rows_and_weather_to_copy(self) -> None:
        run_dir = self.tmp_path / "run-test"
        generated = run_dir / "generated"
        generated.mkdir(parents=True)
        template = {
            "version": 2,
            "rules": [{
                "id": "sow",
                "title": "Sow - Test Crop",
                "startAnchorStage": "SOW",
                "startOffsetDays": 0,
                "startOffsetDirection": "after",
                "endMode": "fixed_days",
                "durationDays": 1,
                "endAnchorStage": None,
                "endAnchorOffsetDays": 0,
                "endAnchorOffsetDirection": "after",
                "repeatMode": "none",
                "repeatEveryDays": 1,
                "repeatUntilMode": "x_times",
                "repeatTimes": 1,
                "repeatUntilAnchorStage": "HARVEST_END",
                "repeatCutoffOffsetDays": 0,
                "repeatCutoffOffsetDirection": "after",
            }],
        }
        write_json(generated / "Plants.json", [{
            "plant_name": "Seeder Test Crop",
            "abbr": "STC",
            "default_planting_method_category": "direct_sow",
            "default_planting_method": "direct_sow.field",
            "annual": 1,
            "biennial": 0,
            "perennial": 0,
            "yield_unit": "kg",
            "yield_per_plant_kg": 1.0,
            "direct_sow": 1,
            "transplant": 0,
        }])
        write_json(generated / "PlantAllowedMethodCategories.json", [{
            "plant_name": "Seeder Test Crop",
            "method_category_id": "direct_sow",
        }])
        write_json(generated / "PlantVarieties.json", [{
            "plant_name": "Seeder Test Crop",
            "variety_name": "Seeder Test Variety",
            "overrides": {"days_maturity": 30},
        }])
        write_json(generated / "PlantTaskTemplates.json", [{
            "plant_name": "Seeder Test Crop",
            "method_id": "direct_sow.field",
            "template_json": json.dumps(template),
        }])
        write_json(generated / "VarietyTaskTemplates.json", [{
            "plant_name": "Seeder Test Crop",
            "variety_name": "Seeder Test Variety",
            "method_id": "direct_sow.field",
            "template_json": json.dumps(template),
        }])
        write_json(generated / "Cities.json", [{
            "city_name": "Seeder Test City",
            "latitude": 49.0,
            "longitude": -123.0,
            "timezone": "America/Vancouver",
            "gdd_annual": 1000,
            "gdd_base_c": 5,
        }])
        write_json(generated / "CityWeatherDaily.json", [{
            "city_name": "Seeder Test City",
            "weather_date": "2025-01-01",
            "provider": "open-meteo",
            "dataset": "open-meteo-archive",
            "timezone": "America/Vancouver",
            "temp_min_c": 1.0,
            "temp_max_c": 6.0,
            "temp_mean_c": 3.5,
            "precipitation_mm": 2.0,
            "rain_mm": 2.0,
            "snowfall_cm": 0.0,
            "gdd_base_5c": 0.0,
            "fetched_at": "2026-01-01T00:00:00+00:00",
            "source_url": "https://open-meteo.com/",
        }])
        write_json(generated / "Companions.json", [{
            "p1": "Seeder Test Crop",
            "p2": "Lettuce",
            "rating": 1,
            "companion_type": "growth",
            "companion_type_id": 5,
        }])
        write_json(generated / "CompanionEvidence.json", [{
            "p1": "Seeder Test Crop",
            "p2": "Lettuce",
            "evidence_level": "extension",
            "review_status": "unreviewed",
            "source_url": "https://example.com/source",
            "source_note": None,
            "summary": "Seeder test evidence.",
        }])

        report = validate_run(run_dir, self.db_path)
        self.assertTrue(report["ok"], report)
        diff = create_diff_report(run_dir, self.db_path)
        self.assertIn("Plants", diff["tables"])
        variety_template_diff = diff["tables"]["VarietyTaskTemplates"][0]
        self.assertIn("Seeder Test Crop / Seeder Test Variety / direct_sow.field", variety_template_diff["identity"])
        apply_report = apply_run(run_dir, self.db_path)
        self.assertTrue(Path(apply_report["backup_path"]).exists())

        with closing(sqlite3.connect(self.db_path)) as conn:
            plant_id = conn.execute("SELECT plant_id FROM Plants WHERE plant_name='Seeder Test Crop'").fetchone()[0]
            city_id = conn.execute("SELECT city_id FROM Cities WHERE city_name='Seeder Test City'").fetchone()[0]
            self.assertIsNotNone(plant_id)
            self.assertIsNotNone(city_id)
            weather_count = conn.execute("SELECT COUNT(*) FROM CityWeatherDaily WHERE city_id=?", [city_id]).fetchone()[0]
            evidence_count = conn.execute("SELECT COUNT(*) FROM CompanionEvidence").fetchone()[0]
            variety_template_count = conn.execute("SELECT COUNT(*) FROM VarietyTaskTemplates").fetchone()[0]
            self.assertEqual(weather_count, 1)
            self.assertGreaterEqual(evidence_count, 1)
            self.assertGreaterEqual(variety_template_count, 1)

    def test_apply_validation_fails_for_missing_child_dependencies(self) -> None:
        run_dir = self.tmp_path / "run-missing-dep"
        generated = run_dir / "generated"
        generated.mkdir(parents=True)
        write_json(generated / "PlantTaskTemplates.json", [{
            "plant_name": "Missing Plant",
            "method_id": "direct_sow.field",
            "template_json": json.dumps({"version": 2, "rules": [{"id": "sow", "title": "Sow", "startAnchorStage": "SOW", "startOffsetDays": 0, "startOffsetDirection": "after", "endMode": "fixed_days"}]}),
        }])
        report = validate_run(run_dir, self.db_path)
        self.assertFalse(report["ok"])
        self.assertTrue(any("cannot resolve plant" in error for error in report["errors"]))


if __name__ == "__main__":
    unittest.main()
