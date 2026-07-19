from __future__ import annotations

import json
import os
import shutil
import sqlite3
import sys
import tempfile
from contextlib import closing, redirect_stdout
from io import StringIO
from types import SimpleNamespace  # diagnostics subprocess stub
import unittest
from unittest.mock import patch  # focused menu regression mocks
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts"))

from trellis_seed.artifacts import (  # noqa: E402
    artifact_status,
    artifacts_after_keeping_latest,
    artifacts_older_than,
    input_summary_slug,
    list_artifacts,
    select_artifacts_by_indices,
    slugify,
    suggestion_summary_slug,
)
from trellis_seed.climate_benchmarks import (  # noqa: E402
    benchmarked_crop_keys,
    eligible_major_cities_by_band,
    preflight_climate_benchmark,
    select_benchmark_cities,
    select_benchmark_crop,
)
from trellis_seed.db import apply_run, apply_run_to_databases, create_diff_report, load_methods, print_diff_report  # noqa: E402
from trellis_seed.config import Settings, read_openai_api_key  # noqa: E402
from trellis_seed.generator import (
    GenerationOptions,
    _call_openai_with_retry,
    _crop_source_values,
    _generate_cities,
    _generate_companions,
    _generate_crops,
    _generate_sowing_windows,
    _generate_task_template,
    _merge_template_polish,
    _prepare_crop_result,
    _validate_crop_result,
    _validate_sowing_window_result,
    _validate_template_result,
    build_task_template_from_method,
    create_run,
    estimate_openai_calls,
    generate_run,
)  # noqa: E402
from trellis_seed.jsonio import read_json, write_json  # noqa: E402
from trellis_seed.menu import _preflight_provider_labels, _should_prompt_template_generation, _sowing_window_diagnostics_flow  # noqa: E402  # diagnostics command coverage
from trellis_seed.migrations import apply_migrations, pending_migrations  # noqa: E402
from trellis_seed.planner import effective_tables_from_input, selected_tables_warning  # noqa: E402
from trellis_seed.providers import NasaPowerClient, OpenAIJsonClient, OpenMeteoClient, ProviderTrace  # noqa: E402
from trellis_seed.schema import OPENAI_CITY_LABEL_SCHEMA, OPENAI_PLANT_SCHEMA, OPENAI_SOWING_WINDOW_SCHEMA, OPENAI_TEMPLATE_SCHEMA, PLANT_INTEGER_FIELDS, PLANT_REAL_FIELDS, PLANT_TEXT_FIELDS  # noqa: E402
from trellis_seed.sowing_windows import compare_window_references, load_planting_window_references, select_cities_for_crop  # noqa: E402
from trellis_seed.suggestions import (  # noqa: E402
    input_draft_schema,
    load_suggestion_context,
    parse_selection,
    suggestion_list_schema,
    validate_input_draft,
    validate_suggestion_list,
    write_suggestion_artifacts,
)
from trellis_seed.validator import normalize_key, validate_input, validate_row, validate_run  # noqa: E402
from trellis_seed.weather import summarize_city_monthly_weather  # noqa: E402


def complete_plant_row(**overrides):
    row = {}
    for field in PLANT_TEXT_FIELDS:
        row[field] = f"{field} value"
    for field in PLANT_INTEGER_FIELDS:
        row[field] = 1
    for field in PLANT_REAL_FIELDS:
        row[field] = 10.0
    row.update({
        "plant_name": "Lettuce",
        "abbr": "LET",
        "annual": 1,
        "biennial": 0,
        "perennial": 0,
        "direct_sow": 1,
        "transplant": 1,
        "succession": 1,
        "overwinter_ok": 0,
        "lifespan_years": 1,
        "harvest_window_days": 30,
        "days_maturity": 55,
        "days_transplant": 28,
        "days_germ": 7,
        "soil_ph_range": 6.5,
        "tmin_c": 4.0,
        "killtemp_c": -2.0,
        "tmax_c": 24.0,
        "topt_low_c": 16.0,
        "topt_high_c": 20.0,
        "tbase_c": 5.0,
        "default_planting_method_category": "direct_sow",
        "default_planting_method": "direct_sow.field",
    })
    row.update(overrides)
    return row


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
            with conn:
                apply_migrations(conn)
            after = pending_migrations(conn)
            self.assertEqual(after, [])
            tables = {row[0] for row in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}
            self.assertIn("CityWeatherMonthly", tables)
            self.assertIn("CityWeatherDaily", tables)
            self.assertIn("CityWeatherForecastDaily", tables)
            self.assertIn("CompanionEvidence", tables)
            self.assertIn("PlantingWindowReferences", tables)
            cols = [row[1] for row in conn.execute("PRAGMA table_info(VarietyTaskTemplates);")]
            self.assertIn("method_id", cols)
            self.assertIn("template_json", cols)
            city_cols = [row[1] for row in conn.execute("PRAGMA table_info(Cities);")]
            self.assertIn("is_major_city", city_cols)
            self.assertIn("climate_band", city_cols)
            plant_cols = [row[1] for row in conn.execute("PRAGMA table_info(Plants);")]
            self.assertIn("killtemp_c", plant_cols)
            variety_cols = [row[1] for row in conn.execute("PRAGMA table_info(PlantVarieties);")]  # ADDED
            self.assertIn("maturity_class", variety_cols)  # ADDED

    def test_input_validation_requires_crop_sources(self) -> None:
        errors = validate_input({"crops": [{"name": "Lettuce"}]})
        self.assertTrue(any("needs at least one source" in error for error in errors))

    def test_plant_variety_validation_accepts_only_known_maturity_classes(self) -> None:  # ADDED
        valid = validate_row("PlantVarieties", {  # ADDED
            "plant_name": "Lettuce",  # ADDED
            "variety_name": "Buttercrunch",  # ADDED
            "maturity_class": "early",  # ADDED
            "overrides": {"days_maturity": 45},  # ADDED
        })  # ADDED
        self.assertEqual(valid["errors"], [])  # ADDED
        invalid = validate_row("PlantVarieties", {  # ADDED
            "plant_name": "Lettuce",  # ADDED
            "variety_name": "Buttercrunch",  # ADDED
            "maturity_class": "extra late",  # ADDED
            "overrides": {"days_maturity": 45},  # ADDED
        })  # ADDED
        self.assertTrue(any("maturity_class" in error for error in invalid["errors"]))  # ADDED

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

    def test_sowing_window_diagnostics_flow_uses_existing_season_script(self) -> None:
        settings = Settings(self.tmp_path / "config.json", {"db_path": str(self.db_path), "runs_dir": str(self.tmp_path / "runs")})
        completed = SimpleNamespace(stdout="", stderr="", returncode=0)  # subprocess-compatible result
        with patch("builtins.input", side_effect=["2026", "14"]), patch("trellis_seed.menu.subprocess.run", return_value=completed) as run:
            with redirect_stdout(StringIO()):
                _sowing_window_diagnostics_flow(settings)
        cmd = run.call_args.args[0]  # command passed to Node bridge
        self.assertIn("trellis_seed_sowing_season_diagnostics.cjs", cmd[1])  # existing script name
        self.assertIn(str(self.tmp_path / "runs" / "sowing_season_diagnostics_report.json"), cmd)  # report name match

    def test_template_generation_option_removes_template_call_estimates(self) -> None:
        data = {
            "crops": [{
                "name": "Lettuce",
                "sources": ["source"],
                "allowed_method_categories": ["direct_sow"],
                "variety_task_overrides": [{"variety_name": "Test", "method_id": "direct_sow.field"}],
            }],
        }
        settings = Settings(self.tmp_path / "config.json", {"default_variety_count": 5})
        with_templates = estimate_openai_calls(data, settings, self.db_path, GenerationOptions(generate_templates=True))
        without_templates = estimate_openai_calls(data, settings, self.db_path, GenerationOptions(generate_templates=False))
        self.assertGreater(with_templates["plant_task_templates"], 0)
        self.assertEqual(without_templates["plant_task_templates"], 0)
        self.assertEqual(without_templates["variety_task_overrides"], 0)
        self.assertEqual(without_templates["estimated_total"], without_templates["crop_rows"] + without_templates["companion_rows"])

    def test_sowing_window_call_estimate_and_preflight_label(self) -> None:
        data = {"sowing_windows": {"enabled": True, "crop_allowlist": ["Lettuce"]}}
        settings = Settings(self.tmp_path / "config.json", {"db_path": str(self.db_path)})
        estimate = estimate_openai_calls(data, settings, self.db_path, GenerationOptions(generate_templates=False))
        self.assertEqual(estimate["sowing_window_crops"], 1)
        self.assertEqual(estimate["estimated_total"], 1)
        self.assertEqual(_preflight_provider_labels(data), ["OpenAI"])

    def test_create_run_metadata_omits_template_tables_when_templates_disabled(self) -> None:
        input_path = self.tmp_path / "input.json"
        write_json(input_path, {"crops": [{"name": "Lettuce", "sources": ["source"]}]})
        settings = Settings(self.tmp_path / "config.json", {
            "db_path": str(self.db_path),
            "runs_dir": str(self.tmp_path / "runs"),
            "openai_model": "fake",
            "openai_reasoning_effort": "low",
        })
        run_dir = create_run(settings, input_path, GenerationOptions(generate_templates=False, run_preflight=False))
        metadata = json.loads((run_dir / "metadata.json").read_text(encoding="utf-8"))
        self.assertFalse(metadata["generation_options"]["generate_templates"])
        self.assertFalse(metadata["generation_options"]["run_preflight"])
        self.assertFalse(metadata["generation_options"]["preflight_already_run"])
        self.assertNotIn("PlantTaskTemplates", metadata["effective_tables"])
        self.assertNotIn("VarietyTaskTemplates", metadata["effective_tables"])

    def test_artifact_slugs_and_future_run_names_are_identifiable(self) -> None:
        self.assertEqual(slugify("Canadian Cities! 10"), "canadian-cities-10")
        self.assertEqual(suggestion_summary_slug("cities", 10, "Canadian Cities"), "cities-10-canadian-cities")
        input_path = self.tmp_path / "mixed.json"
        data = {"crops": [{"name": "Parsnip", "sources": ["source"]}], "cities": [{"name": "Victoria, BC"}]}
        write_json(input_path, data)
        settings = Settings(self.tmp_path / "config.json", {
            "db_path": str(self.db_path),
            "runs_dir": str(self.tmp_path / "runs"),
            "openai_model": "fake",
            "openai_reasoning_effort": "low",
        })
        run_dir = create_run(settings, input_path, GenerationOptions(generate_templates=False))
        self.assertIn("crops-1-cities-1", run_dir.name)
        self.assertEqual(input_summary_slug(data, input_path), "crops-1-cities-1")

    def test_artifact_listing_excludes_suggestions_and_incomplete_runs_from_complete_runs(self) -> None:
        runs_dir = self.tmp_path / "runs"
        suggestion = runs_dir / "suggestion-20260625-010101-cities-1-test"
        complete = runs_dir / "run-20260625-010102-cities-1-test"
        incomplete = runs_dir / "run-20260625-010103-cities-1-failed"
        failed = runs_dir / "run-20260625-010104-cities-1-failed"
        for path in (suggestion, complete, incomplete, failed):
            (path / "generated").mkdir(parents=True, exist_ok=True)
        write_json(suggestion / "suggested_input.json", {"cities": [{"name": "Victoria, BC"}]})
        write_json(complete / "generated" / "Cities.json", [{"city_name": "Victoria, BC"}])
        write_json(complete / "validation_report.json", {"ok": True, "errors": []})
        write_json(failed / "metadata.json", {"status": "failed"})

        self.assertEqual(artifact_status(suggestion), "suggestion")
        self.assertEqual(artifact_status(complete), "complete")
        self.assertEqual(artifact_status(incomplete), "incomplete")
        self.assertEqual(artifact_status(failed), "failed")
        self.assertEqual(list_artifacts(runs_dir, complete_runs_only=True), [complete])

    def test_cleanup_candidate_selection_is_limited_to_direct_children(self) -> None:
        runs_dir = self.tmp_path / "runs"
        first = runs_dir / "run-1"
        second = runs_dir / "run-2"
        nested = first / "nested"
        outside = self.tmp_path / "outside"
        for path in (first, second, nested, outside):
            path.mkdir(parents=True, exist_ok=True)
        artifacts = [first, second, nested, outside]
        selected = select_artifacts_by_indices(artifacts, [0, 2, 3], runs_dir)
        self.assertEqual(selected, [first])

    def test_cleanup_candidates_older_than_cutoff(self) -> None:
        runs_dir = self.tmp_path / "runs"
        old = runs_dir / "run-old"
        new = runs_dir / "run-new"
        for path in (old, new):
            path.mkdir(parents=True, exist_ok=True)
        os.utime(old, (100, 100))
        os.utime(new, (300, 300))
        self.assertEqual(artifacts_older_than([new, old], 200, runs_dir), [old])
        self.assertEqual(artifacts_older_than([new], 50, runs_dir), [])

    def test_cleanup_candidates_after_keeping_latest(self) -> None:
        runs_dir = self.tmp_path / "runs"
        oldest = runs_dir / "run-oldest"
        middle = runs_dir / "run-middle"
        newest = runs_dir / "run-newest"
        for path, stamp in ((oldest, 100), (middle, 200), (newest, 300)):
            path.mkdir(parents=True, exist_ok=True)
            os.utime(path, (stamp, stamp))
        self.assertEqual(artifacts_after_keeping_latest([oldest, newest, middle], 1, runs_dir), [middle, oldest])
        self.assertEqual(artifacts_after_keeping_latest([oldest, newest, middle], 3, runs_dir), [])

    def test_menu_preflight_labels_are_section_relevant(self) -> None:
        self.assertEqual(_preflight_provider_labels({"cities": [{"name": "Vancouver, BC"}]}), ["OpenAI", "Open-Meteo", "NASA POWER"])  # CHANGED
        self.assertEqual(_preflight_provider_labels({"companions": [{"p1": "Apple", "p2": "Carrot", "sources": ["source"]}]}), ["OpenAI"])
        self.assertEqual(_preflight_provider_labels({"crops": [{"name": "Parsnip", "sources": ["source"]}], "cities": [{"name": "Victoria, BC"}]}), ["OpenAI", "Open-Meteo", "NASA POWER"])

    def test_menu_template_prompt_only_applies_to_crops(self) -> None:
        self.assertFalse(_should_prompt_template_generation({"cities": [{"name": "Vancouver, BC"}]}))
        self.assertFalse(_should_prompt_template_generation({"companions": [{"p1": "Apple", "p2": "Carrot", "sources": ["source"]}]}))
        self.assertTrue(_should_prompt_template_generation({"crops": [{"name": "Parsnip", "sources": ["source"]}]}))

    def test_suggestion_context_extracts_normalized_existing_db_values(self) -> None:
        context = load_suggestion_context(self.db_path)
        self.assertIn("lettuce", context["plant_keys"])
        self.assertIn("vancouver, bc", context["city_keys"])
        self.assertTrue(context["companion_pair_keys"])

    def test_suggestion_validation_rejects_duplicates_and_bad_companion_endpoints(self) -> None:
        context = load_suggestion_context(self.db_path)
        crop_result = {
            "section": "crops",
            "requested_count": 2,
            "suggestions": [
                {"name": "Lettuce", "rationale": "already exists", "source_hints": ["source"]},
                {"name": "Parsnip", "rationale": "new root crop", "source_hints": ["source"]},
            ],
        }
        self.assertTrue(any("already exists" in error for error in validate_suggestion_list(crop_result, "crops", 2, context)))

        companion_result = {
            "section": "companions",
            "requested_count": 1,
            "suggestions": [{"p1": "Lettuce", "p2": "Missing Plant", "rationale": "bad endpoint", "source_hints": ["source"]}],
        }
        self.assertTrue(any("must already exist" in error for error in validate_suggestion_list(companion_result, "companions", 1, context)))

    def test_suggestion_validation_accepts_fewer_than_requested(self) -> None:
        context = load_suggestion_context(self.db_path)
        result = {
            "section": "cities",
            "requested_count": 5,
            "suggestions": [{"name": "Whitehorse, YT", "rationale": "regional climate coverage", "source_hints": []}],  # fixture-safe city
        }
        self.assertEqual(validate_suggestion_list(result, "cities", 5, context), [])

    def test_parse_selection_accepts_all_numbers_and_ranges(self) -> None:
        self.assertEqual(parse_selection("", 4), [0, 1, 2, 3])
        self.assertEqual(parse_selection("all", 4), [0, 1, 2, 3])
        self.assertEqual(parse_selection("1,3-4", 4), [0, 2, 3])
        with self.assertRaisesRegex(ValueError, "out of range"):
            parse_selection("5", 4)

    def test_sowing_window_city_sampling_is_deterministic_and_overrideable(self) -> None:
        cities = [{"city_name": name} for name in ["Vancouver, BC", "Calgary, AB", "Toronto, ON", "Montreal, QC", "Victoria, BC", "Winnipeg, MB"]]
        first = select_cities_for_crop("Lettuce", cities, 3, "seed")
        second = select_cities_for_crop("Lettuce", cities, 3, "seed")
        self.assertEqual(first, second)
        override = select_cities_for_crop("Lettuce", cities, 3, "seed", {"Lettuce": ["Toronto, ON", "Vancouver, BC"]})
        self.assertEqual([row["city_name"] for row in override], ["Vancouver, BC", "Toronto, ON"])

    def test_input_draft_validation_for_sources_and_companion_endpoints(self) -> None:
        context = load_suggestion_context(self.db_path)
        accepted_crop = [{"name": "Parsnip", "rationale": "new crop", "source_hints": ["source"]}]
        valid_crop_draft = {
            "crops": [{"name": "Parsnip", "sources": ["https://example.test/parsnip"], "notes": "", "variety_count": 5}],
            "cities": [],
            "companions": [],
        }
        self.assertEqual(validate_input_draft(valid_crop_draft, "crops", accepted_crop, context), [])

        invalid_crop_draft = {
            "crops": [{"name": "Parsnip", "sources": [], "notes": "", "variety_count": 5}],
            "cities": [],
            "companions": [],
        }
        self.assertTrue(any("needs at least one source" in error for error in validate_input_draft(invalid_crop_draft, "crops", accepted_crop, context)))

        accepted_companion = [{"p1": "Apple", "p2": "Carrot", "rationale": "existing endpoints", "source_hints": ["source"]}]
        companion_draft = {
            "crops": [],
            "cities": [],
            "companions": [{"p1": "Apple", "p2": "Carrot", "sources": ["https://example.test/apple-carrot"], "notes": ""}],
        }
        self.assertEqual(validate_input_draft(companion_draft, "companions", accepted_companion, context), [])

    def test_city_input_draft_validation_requires_structured_location_fields(self) -> None:
        context = load_suggestion_context(self.db_path)
        accepted_city = [{"name": "Victoria, British Columbia, Canada", "rationale": "mild climate", "source_hints": []}]
        valid_city_draft = {
            "crops": [],
            "cities": [{
                "name": "Victoria, British Columbia, Canada",
                "city_name": "Victoria",
                "admin1": "British Columbia",
                "country": "Canada",
                "country_code": "CA",
            }],
            "companions": [],
        }
        self.assertEqual(validate_input_draft(valid_city_draft, "cities", accepted_city, context), [])

        invalid_city_draft = {
            "crops": [],
            "cities": [{"name": "Victoria, BC"}],
            "companions": [],
        }
        self.assertTrue(any("City draft field is required" in error for error in validate_input_draft(invalid_city_draft, "cities", accepted_city, context)))

    def test_sowing_window_reference_validation_rejects_bad_shape(self) -> None:
        bad = {
            "plant_name": "Lettuce",
            "city_name": "Vancouver, BC",
            "method_id": "direct_sow.field",
            "stage": "plant-ish",
            "window_label": "spring",
            "start_mm_dd": "02-30",
            "end_mm_dd": "03-10",
            "start_doy": 99,
            "end_doy": 70,
            "is_cross_year": 0,
            "confidence": "certain",
            "summary": "Bad row.",
        }
        errors = validate_row("PlantingWindowReferences", bad)["errors"]
        self.assertTrue(any(".stage" in error for error in errors))
        self.assertTrue(any("start_mm_dd" in error for error in errors))
        self.assertTrue(any("source_url or source_note" in error for error in errors))
        self.assertTrue(any(".confidence" in error for error in errors))

    def test_sowing_window_openai_result_validation_enforces_selected_context(self) -> None:
        result = {"windows": [{
            "city_name": "Vancouver, BC",
            "method_id": "direct_sow.field",
            "stage": "sow",
            "window_label": "spring",
            "start_mm_dd": "03-15",
            "end_mm_dd": "04-30",
            "source_url": None,
            "source_note": "expert estimate",
            "confidence": "medium",
            "summary": "Typical cool-season spring sowing.",
        }]}
        self.assertEqual(
            _validate_sowing_window_result(result, "Lettuce", {"expert estimate"}, {"Vancouver, BC"}, {"direct_sow.field"}),
            [],
        )
        errors = _validate_sowing_window_result(result, "Lettuce", {"expert estimate"}, {"Calgary, AB"}, {"transplant.indoor"})
        self.assertTrue(any("city_name is outside selected cities" in error for error in errors))
        self.assertTrue(any("method_id is outside selected methods" in error for error in errors))

    def test_sowing_window_generation_skips_failed_crop_and_continues(self) -> None:
        class FakeOpenAI:
            model = "fake"
            reasoning_effort = "low"

            def __init__(self) -> None:
                self.calls = 0

            def generate_json(self, **kwargs):
                self.calls += 1
                trace = ProviderTrace("fake", {"call": self.calls})
                if self.calls <= 2:
                    return {"windows": []}, trace
                request = json.loads(kwargs["user"])
                city_name = request["allowed_city_names"][0]
                method_id = request["allowed_method_ids"][0]
                return {"windows": [{
                    "city_name": city_name,
                    "method_id": method_id,
                    "stage": "sow",
                    "window_label": "spring",
                    "start_mm_dd": "04-01",
                    "end_mm_dd": "05-15",
                    "source_url": None,
                    "source_note": "expert estimate",
                    "confidence": "medium",
                    "summary": "Generated reference.",
                }]}, trace

        run_dir = self.tmp_path / "run-window-continue"
        (run_dir / "generated").mkdir(parents=True)
        settings = Settings(self.tmp_path / "config.json", {
            "db_path": str(self.db_path),
            "runs_dir": str(self.tmp_path / "runs"),
            "sowing_windows": {
                "enabled": True,
                "crop_allowlist": ["Window Fail Crop", "Window Good Crop"],
                "cities_per_crop": 1,
            },
        })
        methods = load_methods(self.db_path)
        generated = {
            "Plants": [
                complete_plant_row(plant_name="Window Fail Crop", abbr="WFC"),
                complete_plant_row(plant_name="Window Good Crop", abbr="WGC"),
            ],
            "Cities": [],
            "PlantAllowedMethodCategories": [],
            "PlantingWindowReferences": [],
        }
        provenance = {"traces": [], "tables": {}}

        _generate_sowing_windows(settings, {"sowing_windows": {"enabled": True}}, FakeOpenAI(), methods, generated, provenance, run_dir)

        self.assertEqual(len(generated["PlantingWindowReferences"]), 1)
        self.assertEqual(generated["PlantingWindowReferences"][0]["plant_name"], "Window Good Crop")
        self.assertEqual(provenance["failures"]["sowing_window"][0]["label"], "Window Fail Crop")

    def test_suggestion_artifact_draft_can_be_used_to_create_run(self) -> None:
        settings = Settings(self.tmp_path / "config.json", {
            "db_path": str(self.db_path),
            "runs_dir": str(self.tmp_path / "runs"),
            "openai_model": "fake",
            "openai_reasoning_effort": "low",
        })
        request = {"section": "cities", "requested_count": 1}
        suggestion_list = {"section": "cities", "requested_count": 1, "suggestions": [{"name": "Victoria, British Columbia, Canada", "rationale": "nearby", "source_hints": []}]}
        draft = {
            "crops": [],
            "cities": [{
                "name": "Victoria, British Columbia, Canada",
                "city_name": "Victoria",
                "admin1": "British Columbia",
                "country": "Canada",
                "country_code": "CA",
            }],
            "companions": [],
        }
        suggestion_dir = write_suggestion_artifacts(settings, request, suggestion_list, suggestion_list["suggestions"], draft, [ProviderTrace("fake", {})])
        self.assertIn("suggestion-", suggestion_dir.name)
        self.assertIn("cities-1-default", suggestion_dir.name)
        run_dir = create_run(settings, suggestion_dir / "suggested_input.json", GenerationOptions(generate_templates=False))
        self.assertIn("cities-1-default", run_dir.name)
        metadata = json.loads((run_dir / "metadata.json").read_text(encoding="utf-8"))
        self.assertIn("Cities", metadata["effective_tables"])

    def test_diff_output_reports_empty_and_unchanged_runs(self) -> None:
        empty_run = self.tmp_path / "empty-run"
        (empty_run / "generated").mkdir(parents=True)
        empty_report = create_diff_report(empty_run, self.db_path)
        out = StringIO()
        with redirect_stdout(out):
            print_diff_report(empty_report)
        self.assertIn("No generated rows found for this run.", out.getvalue())

        with closing(sqlite3.connect(self.db_path)) as conn:
            existing_city = conn.execute("SELECT city_name FROM Cities ORDER BY city_name LIMIT 1").fetchone()[0]
        unchanged_run = self.tmp_path / "unchanged-run"
        write_json(unchanged_run / "generated" / "Cities.json", [{"city_name": existing_city}])
        unchanged_report = create_diff_report(unchanged_run, self.db_path)
        out = StringIO()
        with redirect_stdout(out):
            print_diff_report(unchanged_report)
        self.assertIn("No DB changes detected.", out.getvalue())

    def test_diff_output_summarizes_weather_only_runs(self) -> None:
        run_dir = self.tmp_path / "weather-run"
        write_json(run_dir / "generated" / "CityWeatherDaily.json", [{
            "city_name": "Weather Test City",
            "weather_date": "2026-01-01",
            "provider": "test",
            "dataset": "test",
            "temp_min_c": 1,
            "temp_max_c": 5,
        }])
        report = create_diff_report(run_dir, self.db_path)
        out = StringIO()
        with redirect_stdout(out):
            print_diff_report(report)
        self.assertIn("[CityWeatherDaily] weather summary", out.getvalue())
        self.assertIn("rows: 1", out.getvalue())

    def test_nasa_power_monthly_weather_summarizes_city_and_rows(self) -> None:
        city, rows, provenance = summarize_city_monthly_weather(
            "Victoria",
            {"latitude": 48.4284, "longitude": -123.3656, "timezone": "America/Vancouver", "country": "Canada", "country_code": "CA", "admin1": "British Columbia"},
            {
                "properties": {
                    "parameter": {
                        "T2M": {"202501": 6.0, "202502": 7.0},
                        "T2M_MAX": {"202501": 9.0, "202502": 10.0},
                        "T2M_MIN": {"202501": 3.0, "202502": 4.0},
                        "PRECTOTCORR": {"202501": 120.0, "202502": 90.0},
                    }
                }
            },
            5,
        )
        self.assertEqual(city["avg_monthly_low_c1"], 3)
        self.assertEqual(city["avg_monthly_high_c2"], 10)
        self.assertEqual(city["country_name"], "Canada")
        self.assertEqual(city["region_name"], "British Columbia")
        self.assertEqual(city["region_code"], "BC")
        self.assertIsNone(city["last_spring_frost_doy"])
        self.assertEqual(rows[0]["weather_month"], "2025-01")
        self.assertEqual(rows[0]["provider"], "nasa-power")
        self.assertGreater(city["gdd_annual"], 0)
        self.assertEqual(provenance["provider"], "nasa-power")

    def test_city_generation_checkpoint_distinguishes_duplicate_city_names_by_region(self) -> None:
        class FakeMeteo:
            def __init__(self) -> None:
                self.geocode_calls = 0

            def geocode(self, name, qualifiers):
                self.geocode_calls += 1
                region = qualifiers["admin1"]
                longitude = -89.65 if region == "Illinois" else -93.29
                return {
                    "latitude": 39.78 if region == "Illinois" else 37.20,
                    "longitude": longitude,
                    "timezone": "America/Chicago",
                    "country": "United States",
                    "country_code": "US",
                    "admin1": region,
                }, ProviderTrace("fake-meteo", {"name": name, "qualifiers": qualifiers})

            def forecast_daily(self, **kwargs):
                return {
                    "timezone": kwargs.get("timezone"),
                    "daily": {
                        "time": ["2026-01-01"],
                        "temperature_2m_min": [1.0],
                        "temperature_2m_max": [8.0],
                        "temperature_2m_mean": [4.5],
                        "precipitation_sum": [0.0],
                    },
                }, ProviderTrace("fake-meteo", {"forecast": kwargs})

        class FakeNasa:
            def monthly_history(self, **kwargs):
                return {
                    "properties": {
                        "parameter": {
                            "T2M": {"202501": 4.0},
                            "T2M_MAX": {"202501": 8.0},
                            "T2M_MIN": {"202501": 0.0},
                            "PRECTOTCORR": {"202501": 30.0},
                        }
                    }
                }, ProviderTrace("fake-nasa", {"monthly": kwargs})

        class FakeOpenAI:
            model = "fake-model"
            reasoning_effort = "low"

            def generate_json(self, **kwargs):
                return {"is_major_city": 1, "climate_band": "temperate"}, ProviderTrace("fake-openai", {"schema_name": kwargs.get("schema_name")})

        run_dir = self.tmp_path / "run-duplicate-city-generation"
        (run_dir / "generated").mkdir(parents=True)
        settings = Settings(self.tmp_path / "config.json", {
            "db_path": str(self.db_path),
            "city_history_years": 1,
            "forecast_days": 1,
            "gdd_base_c": 5,
            "open_meteo": {"forecast_model": "best_match"},
            "nasa_power": {"dataset": "nasa-power-monthly"},
        })
        input_data = {
            "cities": [
                {"city_name": "Springfield", "admin1": "Illinois", "country": "United States", "country_code": "US"},
                {"city_name": "Springfield", "admin1": "Missouri", "country": "United States", "country_code": "US"},
            ]
        }
        generated = {"Cities": [], "CityWeatherMonthly": [], "CityWeatherForecastDaily": []}
        provenance = {"traces": [], "tables": {}}
        meteo = FakeMeteo()

        _generate_cities(settings, input_data, meteo, FakeNasa(), FakeOpenAI(), generated, provenance, run_dir)
        _generate_cities(settings, input_data, meteo, FakeNasa(), FakeOpenAI(), generated, provenance, run_dir)

        self.assertEqual(meteo.geocode_calls, 2)
        self.assertEqual([row["region_name"] for row in generated["Cities"]], ["Illinois", "Missouri"])
        self.assertEqual([row["is_major_city"] for row in generated["Cities"]], [1, 1])
        self.assertEqual([row["climate_band"] for row in generated["Cities"]], ["temperate", "temperate"])
        self.assertEqual([row["region_name"] for row in generated["CityWeatherMonthly"]], ["Illinois", "Missouri"])
        self.assertEqual([row["region_name"] for row in generated["CityWeatherForecastDaily"]], ["Illinois", "Missouri"])

    def test_city_generation_skips_failed_city_and_continues(self) -> None:
        class FakeMeteo:
            def geocode(self, name, qualifiers):
                if "Vernon" in name:
                    raise RuntimeError("Open-Meteo did not verify location")
                return {
                    "latitude": 50.03,
                    "longitude": -125.24,
                    "timezone": "America/Vancouver",
                    "country": "Canada",
                    "country_code": "CA",
                    "admin1": "British Columbia",
                }, ProviderTrace("fake-meteo", {"name": name, "qualifiers": qualifiers})

            def forecast_daily(self, **kwargs):
                return {
                    "timezone": kwargs.get("timezone"),
                    "daily": {
                        "time": ["2026-01-01"],
                        "temperature_2m_min": [2.0],
                        "temperature_2m_max": [7.0],
                        "temperature_2m_mean": [4.5],
                        "precipitation_sum": [1.0],
                    },
                }, ProviderTrace("fake-meteo", {"forecast": kwargs})

        class FakeNasa:
            def monthly_history(self, **kwargs):
                return {
                    "properties": {
                        "parameter": {
                            "T2M": {"202501": 5.0},
                            "T2M_MAX": {"202501": 9.0},
                            "T2M_MIN": {"202501": 1.0},
                            "PRECTOTCORR": {"202501": 40.0},
                        }
                    }
                }, ProviderTrace("fake-nasa", {"monthly": kwargs})

        class FakeOpenAI:
            model = "fake-model"
            reasoning_effort = "low"

            def generate_json(self, **kwargs):
                return {"is_major_city": 0, "climate_band": "temperate"}, ProviderTrace("fake-openai", {"schema_name": kwargs.get("schema_name")})

        run_dir = self.tmp_path / "run-city-continue"
        (run_dir / "generated").mkdir(parents=True)
        settings = Settings(self.tmp_path / "config.json", {
            "db_path": str(self.db_path),
            "city_history_years": 1,
            "forecast_days": 1,
            "gdd_base_c": 5,
            "open_meteo": {"forecast_model": "best_match"},
            "nasa_power": {"dataset": "nasa-power-monthly"},
        })
        input_data = {
            "cities": [
                {"city_name": "Vernon", "admin1": "British Columbia", "country": "Canada", "country_code": "CA"},
                {"city_name": "Campbell River", "admin1": "British Columbia", "country": "Canada", "country_code": "CA"},
            ]
        }
        generated = {"Cities": [], "CityWeatherMonthly": [], "CityWeatherForecastDaily": []}
        provenance = {"traces": [], "tables": {}}

        _generate_cities(settings, input_data, FakeMeteo(), FakeNasa(), FakeOpenAI(), generated, provenance, run_dir)

        self.assertEqual([row["city_name"] for row in generated["Cities"]], ["Campbell River"])
        self.assertEqual(provenance["failures"]["city"][0]["label"], "Vernon, British Columbia, Canada")
        metadata = read_json(run_dir / "metadata.json", {})
        self.assertEqual(metadata["failure_count"], 1)
        self.assertEqual(metadata["failures"]["city"][0]["scope"], "city")  # ADDED

    def test_generate_run_marks_failed_when_all_items_fail(self) -> None:
        class FakeMeteo:
            def __init__(self, _settings):
                pass

            def geocode(self, *_args, **_kwargs):
                raise RuntimeError("geocode failed")

        class FakeNasa:
            def __init__(self, _settings):
                pass

        class FakeOpenAI:
            def __init__(self, *_args):
                pass

        runs_dir = self.tmp_path / "runs"
        settings = Settings(self.tmp_path / "config.json", {
            "db_path": str(self.db_path),
            "runs_dir": str(runs_dir),
            "openai_model": "fake",
            "openai_reasoning_effort": "low",
            "open_meteo": {},  # ADDED
            "nasa_power": {},  # ADDED
        })
        input_path = self.tmp_path / "all-fail-input.json"
        write_json(input_path, {
            "cities": [{
                "name": "Vernon, British Columbia, Canada",
                "city_name": "Vernon",
                "admin1": "British Columbia",
                "country": "Canada",
                "country_code": "CA",
            }]
        })

        with patch("trellis_seed.generator.OpenMeteoClient", FakeMeteo), \
                patch("trellis_seed.generator.NasaPowerClient", FakeNasa), \
                patch("trellis_seed.generator.OpenAIJsonClient", FakeOpenAI), \
                self.assertRaisesRegex(Exception, "All requested generation items failed"):
            generate_run(settings, input_path, GenerationOptions(generate_templates=False, run_preflight=False))

        run_dirs = [path for path in runs_dir.iterdir() if path.is_dir()]
        self.assertEqual(len(run_dirs), 1)
        metadata = read_json(run_dirs[0] / "metadata.json", {})
        provenance = read_json(run_dirs[0] / "provenance.json", {})
        self.assertEqual(metadata["status"], "failed")
        self.assertEqual(provenance["failures"]["city"][0]["label"], "Vernon, British Columbia, Canada")

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

    def test_open_meteo_geocode_handles_canadian_province_abbreviations(self) -> None:
        class FakeMeteo(OpenMeteoClient):
            def __init__(self) -> None:
                super().__init__({"geocoding_url": "https://example.test/geocode"})

            def _get_json(self, _url: str) -> dict:
                return {
                    "results": [
                        {
                            "name": "Toronto",
                            "admin1": "Ohio",
                            "country": "United States",
                            "country_code": "US",
                            "latitude": 40.46,
                            "longitude": -80.6,
                        },
                        {
                            "name": "Toronto",
                            "admin1": "Ontario",
                            "country": "Canada",
                            "country_code": "CA",
                            "latitude": 43.65,
                            "longitude": -79.38,
                        },
                    ]
                }

        result, _trace = FakeMeteo().geocode("Toronto, ON")
        self.assertEqual(result["admin1"], "Ontario")

    def test_open_meteo_geocode_uses_structured_city_qualifiers(self) -> None:
        class FakeMeteo(OpenMeteoClient):
            def __init__(self) -> None:
                super().__init__({"geocoding_url": "https://example.test/geocode"})
                self.urls: list[str] = []

            def _get_json(self, url: str) -> dict:
                self.urls.append(url)
                return {
                    "results": [
                        {
                            "name": "Toronto",
                            "admin1": "Ohio",
                            "country": "United States",
                            "country_code": "US",
                            "latitude": 40.46,
                            "longitude": -80.6,
                        },
                        {
                            "name": "Toronto",
                            "admin1": "Ontario",
                            "country": "Canada",
                            "country_code": "CA",
                            "latitude": 43.65,
                            "longitude": -79.38,
                        },
                    ]
                }

        client = FakeMeteo()
        result, trace = client.geocode("Toronto", {
            "display_name": "Toronto, Ontario, Canada",
            "admin1": "Ontario",
            "country": "Canada",
            "country_code": "CA",
        })
        self.assertEqual(result["admin1"], "Ontario")
        self.assertIn("name=Toronto", client.urls[0])
        self.assertEqual(trace.request["qualifiers"]["admin1"], "Ontario")

    def test_nasa_power_monthly_history_uses_monthly_point_endpoint(self) -> None:
        class FakeNasa(NasaPowerClient):
            def __init__(self) -> None:
                super().__init__({
                    "monthly_url": "https://example.test/power",
                    "parameters": "T2M,T2M_MAX,T2M_MIN,PRECTOTCORR",
                    "community": "AG",
                })
                self.urls: list[str] = []

            def _get_json(self, url: str) -> dict:
                self.urls.append(url)
                return {"properties": {"parameter": {"T2M": {"202501": 1.0}}}}

        data, trace = FakeNasa().monthly_history(latitude=49.0, longitude=-123.0, start_year=2024, end_year=2025)
        self.assertIn("parameters=T2M%2CT2M_MAX%2CT2M_MIN%2CPRECTOTCORR", trace.request["url"])
        self.assertIn("start=2024", trace.request["url"])
        self.assertIn("end=2025", trace.request["url"])
        self.assertEqual(data["properties"]["parameter"]["T2M"]["202501"], 1.0)
        self.assertEqual(trace.provider, "nasa-power")

    def test_open_meteo_get_json_retries_transient_connection_reset(self) -> None:
        calls = {"count": 0}
        original_urlopen = OpenMeteoClient._get_json.__globals__["urllib"].request.urlopen
        original_sleep = OpenMeteoClient._get_json.__globals__["time"].sleep

        class FakeResponse:
            def __enter__(self):
                return self

            def __exit__(self, *_args):
                return False

            def read(self):
                return b'{"ok": true}'

        def fake_urlopen(_url, timeout):
            calls["count"] += 1
            if calls["count"] == 1:
                raise ConnectionResetError("reset")
            return FakeResponse()

        try:
            OpenMeteoClient._get_json.__globals__["urllib"].request.urlopen = fake_urlopen
            OpenMeteoClient._get_json.__globals__["time"].sleep = lambda _seconds: None
            client = OpenMeteoClient({"rate_limit_max_attempts": 8})
            self.assertEqual(client._get_json("https://example.test"), {"ok": True})
            self.assertEqual(calls["count"], 2)
        finally:
            OpenMeteoClient._get_json.__globals__["urllib"].request.urlopen = original_urlopen
            OpenMeteoClient._get_json.__globals__["time"].sleep = original_sleep

    def test_climate_benchmark_preflight_and_city_selection_require_all_bands(self) -> None:
        settings = Settings(self.tmp_path / "config.json", {
            "db_path": str(self.db_path),
            "runs_dir": str(self.tmp_path / "runs"),
        })
        with closing(sqlite3.connect(self.db_path)) as conn:
            with conn:
                apply_migrations(conn)
                conn.execute("UPDATE Cities SET is_major_city=1, climate_band='hot' WHERE city_name LIKE 'Toronto%'")  # CHANGED
                conn.execute("UPDATE Cities SET is_major_city=1, climate_band='temperate' WHERE city_name LIKE 'Vancouver%'")  # CHANGED
        missing = preflight_climate_benchmark(settings)
        self.assertFalse(missing["ok"])
        self.assertIn("cold", missing["missing_bands"])

        with closing(sqlite3.connect(self.db_path)) as conn:
            with conn:
                conn.execute("UPDATE Cities SET is_major_city=1, climate_band='cold' WHERE city_name LIKE 'Winnipeg%'")  # CHANGED
        ready = preflight_climate_benchmark(settings)
        self.assertTrue(ready["ok"], ready)
        cities = select_benchmark_cities(settings, "seed")
        self.assertEqual(set(cities), {"hot", "temperate", "cold"})
        self.assertTrue(cities["cold"]["city_name"].startswith("Winnipeg"))  # CHANGED
        self.assertTrue(eligible_major_cities_by_band(settings)["hot"][0]["city_name"].startswith("Toronto"))  # CHANGED

    def test_climate_benchmark_crop_selection_skips_artifact_covered_crops(self) -> None:
        runs_dir = self.tmp_path / "runs"
        runs_dir.mkdir()
        settings = Settings(self.tmp_path / "config.json", {
            "db_path": str(self.db_path),
            "runs_dir": str(runs_dir),
        })
        annual_names = []
        with closing(sqlite3.connect(self.db_path)) as conn:
            for row in conn.execute("SELECT plant_name FROM Plants WHERE annual=1 AND COALESCE(biennial,0)<>1 AND COALESCE(perennial,0)<>1 ORDER BY plant_name"):
                annual_names.append(row[0])
        selected_name = "Lettuce" if "Lettuce" in annual_names else annual_names[0]
        for index, name in enumerate(name for name in annual_names if name != selected_name):
            artifact_dir = runs_dir / f"climate-benchmark-{index}"
            artifact_dir.mkdir()
            write_json(artifact_dir / "climate_benchmark.json", {"crop": {"plant_name": name}})

        covered = benchmarked_crop_keys(runs_dir)
        self.assertNotIn(normalize_key(selected_name), covered)
        crop = select_benchmark_crop(settings, "seed")
        self.assertEqual(crop["plant_name"], selected_name)

    def test_openai_schemas_are_strict_output_compatible(self) -> None:
        for schema in (
            OPENAI_PLANT_SCHEMA,
            OPENAI_CITY_LABEL_SCHEMA,
            OPENAI_SOWING_WINDOW_SCHEMA,
            OPENAI_TEMPLATE_SCHEMA,
            suggestion_list_schema("crops"),
            suggestion_list_schema("cities"),
            suggestion_list_schema("companions"),
            input_draft_schema("crops"),
            input_draft_schema("cities"),
            input_draft_schema("companions"),
        ):
            self._assert_strict_schema(schema)

    def test_openai_plant_schema_uses_typed_non_nullable_fields(self) -> None:
        row_schema = OPENAI_PLANT_SCHEMA["properties"]["row"]["properties"]
        for field in PLANT_TEXT_FIELDS:
            self.assertEqual(row_schema[field]["type"], "string", field)
            self.assertEqual(row_schema[field]["minLength"], 1, field)
        for field in PLANT_INTEGER_FIELDS:
            self.assertEqual(row_schema[field]["type"], "integer", field)
        for field in PLANT_REAL_FIELDS:
            self.assertEqual(row_schema[field]["type"], "number", field)
        for field_schema in row_schema.values():
            self.assertNotIn("null", field_schema.get("type") if isinstance(field_schema.get("type"), list) else [field_schema.get("type")])

    def test_openai_plant_schema_declares_variety_maturity_class_enum(self) -> None:  # ADDED
        variety_schema = OPENAI_PLANT_SCHEMA["properties"]["varieties"]["items"]  # ADDED
        maturity_schema = variety_schema["properties"]["maturity_class"]  # ADDED
        self.assertIn("maturity_class", variety_schema["required"])  # ADDED
        self.assertEqual(maturity_schema["enum"], ["early", "mid", "late", "", None])  # ADDED

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

        city_tables = effective_tables_from_input({"cities": [{"name": "Victoria, BC"}]})
        self.assertIn("CityWeatherMonthly", city_tables)
        self.assertIn("CityWeatherForecastDaily", city_tables)
        self.assertNotIn("CityWeatherDaily", city_tables)

    def test_validation_uses_source_maps_and_hard_bounds(self) -> None:
        row = complete_plant_row(
            plant_name="Bad Crop",
            yield_per_plant_kg=-1,
            provenance={"field_sources": {"plant_name": ["source-a"]}},
        )
        report = validate_row("Plants", row, source_values={"source-a"}, required_source_fields={"plant_name", "yield_per_plant_kg"})
        self.assertTrue(any("yield_per_plant_kg outside hard bounds" in error for error in report["errors"]))
        self.assertTrue(any("field_sources.yield_per_plant_kg" in error for error in report["errors"]))

    def test_plant_validation_rejects_incomplete_null_and_bad_types(self) -> None:
        report = validate_row("Plants", {"plant_name": "Sparse Crop"})
        self.assertTrue(any("family is required" in error for error in report["errors"]))

        null_report = validate_row("Plants", complete_plant_row(family=None))
        self.assertTrue(any("family cannot be null" in error for error in null_report["errors"]))

        empty_text_report = validate_row("Plants", complete_plant_row(family=""))
        self.assertTrue(any("family must be a non-empty string" in error for error in empty_text_report["errors"]))

        numeric_string_report = validate_row("Plants", complete_plant_row(tmin_c="4", days_maturity="55"))
        self.assertFalse(any("tmin_c must be numeric" in error or "days_maturity must be an integer" in error for error in numeric_string_report["errors"]))

        invalid_number_report = validate_row("Plants", complete_plant_row(tmin_c="warm"))
        self.assertTrue(any("tmin_c must be numeric" in error for error in invalid_number_report["errors"]))

        invalid_killtemp_report = validate_row("Plants", complete_plant_row(killtemp_c="cold"))
        self.assertTrue(any("killtemp_c must be numeric" in error for error in invalid_killtemp_report["errors"]))

        out_of_range_killtemp_report = validate_row("Plants", complete_plant_row(killtemp_c=-100))
        self.assertTrue(any("killtemp_c outside hard bounds" in error for error in out_of_range_killtemp_report["errors"]))

        bad_flag_report = validate_row("Plants", complete_plant_row(direct_sow=2))
        self.assertTrue(any("direct_sow must be 0 or 1" in error for error in bad_flag_report["errors"]))

    def test_city_validation_accepts_benchmark_labels_and_rejects_bad_values(self) -> None:
        valid = validate_row("Cities", {
            "city_name": "Benchmark City",
            "country_name": "Canada",
            "region_name": "British Columbia",
            "latitude": 49.25,
            "longitude": -123.1,
            "gdd_annual": 1500,
            "gdd_base_c": 5,
            "is_major_city": 1,
            "climate_band": "temperate",
        })
        self.assertEqual(valid["errors"], [])

        invalid = validate_row("Cities", {
            "city_name": "Benchmark City",
            "country_name": "Canada",
            "region_name": "British Columbia",
            "is_major_city": 2,
            "climate_band": "humid",
        })
        self.assertTrue(any("is_major_city must be 0 or 1" in error for error in invalid["errors"]))
        self.assertTrue(any("climate_band must be one of" in error for error in invalid["errors"]))

    def test_crop_validation_accepts_controlled_input_provenance_references(self) -> None:
        methods = [{
            "method_id": "direct_sow.field",
            "method_category_id": "direct_sow",
            "method_name": "Direct sow (field)",
        }]
        source_values = _crop_source_values({"name": "Lettuce", "sources": ["https://example.test/lettuce"]}, methods)
        result = {
            "row": complete_plant_row(),
            "allowed_method_categories": ["direct_sow"],
            "varieties": [{"variety_name": "Buttercrunch", "overrides": [], "sources": []}],
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

    def test_crop_validation_requires_sourced_variety_maturity_class(self) -> None:  # ADDED
        methods = [{  # ADDED
            "method_id": "direct_sow.field",  # ADDED
            "method_category_id": "direct_sow",  # ADDED
            "method_name": "Direct sow (field)",  # ADDED
        }]  # ADDED
        crop = {"name": "Lettuce", "sources": ["https://example.test/lettuce"]}  # ADDED
        source_values = _crop_source_values(crop, methods)  # ADDED

        def errors_for(variety: dict[str, object]) -> list[str]:  # ADDED
            result = {  # ADDED
                "row": complete_plant_row(),  # ADDED
                "allowed_method_categories": ["direct_sow"],  # ADDED
                "allowed_method_ids": ["direct_sow.field"],  # ADDED
                "varieties": [variety],  # ADDED
                "provenance": {"field_sources": []},  # ADDED
            }  # ADDED
            prepared = _prepare_crop_result(result, crop, methods)  # ADDED
            return _validate_crop_result(prepared, source_values, methods)  # ADDED

        unsourced = errors_for({"variety_name": "Buttercrunch", "maturity_class": "early", "overrides": [], "sources": []})  # ADDED
        self.assertTrue(any("maturity_class requires at least one explicit source" in error for error in unsourced))  # ADDED
        unknown_source = errors_for({"variety_name": "Romaine", "maturity_class": "mid", "overrides": [], "sources": ["https://example.test/other"]})  # ADDED
        self.assertTrue(any("was not supplied" in error for error in unknown_source))  # ADDED
        invalid_class = errors_for({"variety_name": "Looseleaf", "maturity_class": "extra late", "overrides": [], "sources": ["https://example.test/lettuce"]})  # ADDED
        self.assertTrue(any("maturity_class must be early, mid, or late" in error for error in invalid_class))  # ADDED
        self.assertEqual(errors_for({"variety_name": "Oakleaf", "maturity_class": "late", "overrides": [], "sources": ["https://example.test/lettuce"]}), [])  # ADDED

    def test_crop_validation_rejects_placeholder_varieties(self) -> None:
        result = {
            "row": complete_plant_row(),
            "allowed_method_categories": ["direct_sow"],
            "allowed_method_ids": ["direct_sow.field"],
            "varieties": [
                {"variety_name": "Lettuce variety 1", "overrides": [], "sources": []},
                {"variety_name": "Generic", "overrides": [], "sources": []},
            ],
            "provenance": {"field_sources": []},
        }
        methods = [{"method_id": "direct_sow.field", "method_category_id": "direct_sow", "method_name": "Direct sow (field)"}]
        prepared = _prepare_crop_result(result, {"name": "Lettuce"}, methods)
        errors = _validate_crop_result(prepared, _crop_source_values({"name": "Lettuce"}, methods), methods)
        self.assertTrue(any("placeholder" in error for error in errors))

    def test_crop_generation_repair_handles_incomplete_typed_rows(self) -> None:
        class FakeOpenAI:
            model = "fake"
            reasoning_effort = "low"

            def __init__(self) -> None:
                self.calls = 0

            def generate_json(self, **_kwargs):
                self.calls += 1
                trace = ProviderTrace("fake", {"call": self.calls})
                if self.calls == 1:
                    return {
                        "row": {"plant_name": "Lettuce", "family": None},
                        "allowed_method_categories": ["direct_sow"],
                        "allowed_method_ids": ["direct_sow.field"],
                        "varieties": [{"variety_name": "Lettuce variety 1", "overrides": [], "sources": []}],
                        "provenance": {"field_sources": []},
                    }, trace
                return {
                    "row": complete_plant_row(),
                    "allowed_method_categories": ["direct_sow"],
                    "allowed_method_ids": ["direct_sow.field"],
                    "varieties": [{"variety_name": "Buttercrunch", "overrides": [], "sources": []}],
                    "provenance": {"field_sources": []},
                }, trace

        methods = [{"method_id": "direct_sow.field", "method_category_id": "direct_sow", "method_name": "Direct sow (field)"}]
        crop = {"name": "Lettuce"}
        source_values = _crop_source_values(crop, methods)
        fake = FakeOpenAI()
        result, trace = _call_openai_with_retry(
            fake,
            schema_name="trellis_crop_row",
            json_schema=OPENAI_PLANT_SCHEMA,
            system="",
            user="",
            validator=lambda candidate: _validate_crop_result(_prepare_crop_result(candidate, crop, methods), source_values, methods),
        )
        self.assertEqual(fake.calls, 2)
        self.assertIn("repair_for", trace.request)
        self.assertEqual(result["varieties"][0]["variety_name"], "Buttercrunch")

    def test_crop_generation_unrepaired_incomplete_row_fails(self) -> None:
        class FakeOpenAI:
            model = "fake"
            reasoning_effort = "low"

            def generate_json(self, **_kwargs):
                return {
                    "row": {"plant_name": "Lettuce", "family": None},
                    "allowed_method_categories": ["direct_sow"],
                    "allowed_method_ids": ["direct_sow.field"],
                    "varieties": [{"variety_name": "Lettuce variety 1", "overrides": [], "sources": []}],
                    "provenance": {"field_sources": []},
                }, ProviderTrace("fake", {})

        methods = [{"method_id": "direct_sow.field", "method_category_id": "direct_sow", "method_name": "Direct sow (field)"}]
        crop = {"name": "Lettuce"}
        source_values = _crop_source_values(crop, methods)
        with self.assertRaisesRegex(Exception, "OpenAI repair output failed validation"):
            _call_openai_with_retry(
                FakeOpenAI(),
                schema_name="trellis_crop_row",
                json_schema=OPENAI_PLANT_SCHEMA,
                system="",
                user="",
                validator=lambda candidate: _validate_crop_result(_prepare_crop_result(candidate, crop, methods), source_values, methods),
            )

    def test_crop_generation_skips_failed_crop_and_continues(self) -> None:
        class FakeOpenAI:
            model = "fake"
            reasoning_effort = "low"

            def __init__(self) -> None:
                self.calls = 0

            def generate_json(self, **_kwargs):
                self.calls += 1
                trace = ProviderTrace("fake", {"call": self.calls})
                if self.calls <= 2:
                    return {
                        "row": {"plant_name": "Broken Crop", "family": None},
                        "allowed_method_categories": ["direct_sow"],
                        "allowed_method_ids": ["direct_sow.field"],
                        "varieties": [{"variety_name": "Generic", "overrides": [], "sources": []}],
                        "provenance": {"field_sources": []},
                    }, trace
                return {
                    "row": complete_plant_row(plant_name="Good Crop", abbr="GDC"),
                    "allowed_method_categories": ["direct_sow"],
                    "allowed_method_ids": ["direct_sow.field"],
                    "varieties": [{"variety_name": "Good Crop Select", "overrides": [], "sources": []}],
                    "provenance": {"field_sources": []},
                }, trace

        run_dir = self.tmp_path / "run-crop-continue"
        run_dir.mkdir()
        settings = Settings(self.tmp_path / "config.json", {"db_path": str(self.db_path), "runs_dir": str(self.tmp_path / "runs")})
        methods = [{"method_id": "direct_sow.field", "method_category_id": "direct_sow", "method_name": "Direct sow (field)"}]
        generated = {table: [] for table in ("Plants", "PlantAllowedMethodCategories", "PlantVarieties", "PlantTaskTemplates", "VarietyTaskTemplates")}
        provenance = {"traces": [], "tables": {}}
        input_data = {
            "crops": [
                {"name": "Broken Crop", "notes": "source"},
                {"name": "Good Crop", "notes": "source"},
            ]
        }

        _generate_crops(settings, input_data, FakeOpenAI(), methods, generated, provenance, run_dir, generate_templates=False)

        self.assertEqual([row["plant_name"] for row in generated["Plants"]], ["Good Crop"])
        self.assertEqual(provenance["failures"]["crop"][0]["label"], "Broken Crop")

    def test_crop_generation_emits_only_explicit_sourced_maturity_classes(self) -> None:  # ADDED
        class FakeOpenAI:  # ADDED
            model = "fake"  # ADDED
            reasoning_effort = "low"  # ADDED

            def generate_json(self, **_kwargs):  # ADDED
                return {  # ADDED
                    "row": complete_plant_row(),  # ADDED
                    "allowed_method_categories": ["direct_sow"],  # ADDED
                    "allowed_method_ids": ["direct_sow.field"],  # ADDED
                    "varieties": [  # ADDED
                        {"variety_name": "Buttercrunch", "maturity_class": "early", "overrides": [], "sources": ["https://example.test/lettuce"]},  # ADDED
                        {"variety_name": "Romaine", "maturity_class": "", "overrides": [], "sources": ["https://example.test/lettuce"]},  # ADDED
                        {"variety_name": "Oakleaf", "overrides": [], "sources": []},  # ADDED
                    ],  # ADDED
                    "provenance": {"field_sources": []},  # ADDED
                }, ProviderTrace("fake", {})  # ADDED

        run_dir = self.tmp_path / "run-crop-maturity-class"  # ADDED
        run_dir.mkdir()  # ADDED
        settings = Settings(self.tmp_path / "config.json", {"db_path": str(self.db_path), "runs_dir": str(self.tmp_path / "runs")})  # ADDED
        methods = [{"method_id": "direct_sow.field", "method_category_id": "direct_sow", "method_name": "Direct sow (field)"}]  # ADDED
        generated = {table: [] for table in ("Plants", "PlantAllowedMethodCategories", "PlantVarieties", "PlantTaskTemplates", "VarietyTaskTemplates")}  # ADDED
        provenance = {"traces": [], "tables": {}}  # ADDED
        input_data = {"crops": [{"name": "Lettuce", "sources": ["https://example.test/lettuce"], "variety_count": 3}]}  # ADDED

        _generate_crops(settings, input_data, FakeOpenAI(), methods, generated, provenance, run_dir, generate_templates=False)  # ADDED

        varieties = {row["variety_name"]: row for row in generated["PlantVarieties"]}  # ADDED
        self.assertEqual(varieties["Buttercrunch"]["maturity_class"], "early")  # ADDED
        self.assertNotIn("maturity_class", varieties["Romaine"])  # ADDED
        self.assertNotIn("maturity_class", varieties["Oakleaf"])  # ADDED

    def test_companion_generation_skips_failed_pair_and_continues(self) -> None:
        class FakeOpenAI:
            model = "fake"
            reasoning_effort = "low"

            def __init__(self) -> None:
                self.calls = 0

            def generate_json(self, **_kwargs):
                self.calls += 1
                trace = ProviderTrace("fake", {"call": self.calls})
                if self.calls <= 2:
                    return {"companion": {}, "evidence": {}, "provenance": {"field_sources": []}}, trace
                return {
                    "companion": {"p1": "Apple", "p2": "Carrot", "rating": 1, "companion_type": "growth", "companion_type_id": None},
                    "evidence": {
                        "evidence_level": "extension",
                        "review_status": "unreviewed",
                        "source_url": "https://example.test/apple-carrot",
                        "source_note": None,
                        "summary": "Source-backed companion note.",
                    },
                    "provenance": {"field_sources": [{"field": "summary", "source": "https://example.test/apple-carrot"}]},
                }, trace

        run_dir = self.tmp_path / "run-companion-continue"
        run_dir.mkdir()
        generated = {"Companions": [], "CompanionEvidence": []}
        provenance = {"traces": [], "tables": {}}
        input_data = {
            "companions": [
                {"p1": "Bad", "p2": "Pair", "sources": ["https://example.test/bad"]},
                {"p1": "Apple", "p2": "Carrot", "sources": ["https://example.test/apple-carrot"]},
            ]
        }

        _generate_companions(input_data, FakeOpenAI(), generated, provenance, run_dir)

        self.assertEqual([(row["p1"], row["p2"]) for row in generated["Companions"]], [("Apple", "Carrot")])
        self.assertEqual(provenance["failures"]["companion"][0]["label"], "Bad / Pair")

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

    def test_deterministic_templates_from_all_db_methods_validate_without_openai(self) -> None:
        for method in load_methods(self.db_path):
            template = build_task_template_from_method(method)
            row = {
                "plant_name": "Lettuce",
                "method_id": method["method_id"],
                "template_json": json.dumps({"version": 2, "rules": template["rules"]}),
                "provenance": template["provenance"],
            }
            report = validate_row("PlantTaskTemplates", row, source_values=_crop_source_values({"name": "Lettuce"}, [method]), required_source_fields={"rules"})
            self.assertEqual(report["errors"], [], method["method_id"])

    def test_template_polish_normalization_avoids_repair(self) -> None:
        method = {
            "method_id": "direct_sow.field",
            "method_category_id": "direct_sow",
            "method_name": "Direct sow (field)",
            "tasks_required_json": '{"sow": true, "harvest": true}',
        }
        skeleton = build_task_template_from_method(method)
        polished = _merge_template_polish(skeleton, {
            "version": 2,
            "rules": [{
                "id": "sow",
                "title": "Sow lettuce",
                "startAnchorStage": "sowing",
                "startOffsetDays": "0",
                "startOffsetDirection": "later",
                "endMode": "fixed",
                "durationDays": "2",
                "endAnchorStage": "none",
                "endAnchorOffsetDays": "0",
                "endAnchorOffsetDirection": "later",
                "repeatMode": "no repeat",
                "repeatEveryDays": "1",
                "repeatUntilMode": "x times",
                "repeatTimes": "1",
                "repeatUntilAnchorStage": "harvest end",
                "repeatCutoffOffsetDays": "0",
                "repeatCutoffOffsetDirection": "later",
            }],
            "provenance": {"field_sources": []},
        })
        self.assertEqual(_validate_template_result(polished, _crop_source_values({"name": "Lettuce"}, [method])), [])
        self.assertEqual(polished["rules"][0]["id"], "sow")
        self.assertEqual(polished["rules"][0]["endMode"], "fixed_days")

    def test_template_polish_repair_path_is_used_once(self) -> None:
        class FakeOpenAI:
            model = "fake"
            reasoning_effort = "low"

            def __init__(self) -> None:
                self.calls = 0

            def generate_json(self, **_kwargs):
                self.calls += 1
                trace = ProviderTrace("fake", {"call": self.calls})
                if self.calls == 1:
                    return {"version": 2, "rules": []}, trace
                return {"version": 2, "rules": [{"id": "sow", "title": "Repaired sow"}, {"id": "harvest", "title": "Repaired harvest"}], "provenance": {"field_sources": []}}, trace

        method = {
            "method_id": "direct_sow.field",
            "method_category_id": "direct_sow",
            "method_name": "Direct sow (field)",
            "tasks_required_json": '{"sow": true}',
        }
        fake = FakeOpenAI()
        result, trace = _generate_task_template(fake, {"plant_name": "Lettuce"}, method, {"name": "Lettuce"}, "")
        self.assertEqual(fake.calls, 2)
        self.assertEqual(result["rules"][0]["title"], "Repaired sow")
        self.assertIn("repair_for", trace.request)

    def test_template_polish_unrepaired_invalid_output_fails(self) -> None:
        class FakeOpenAI:
            model = "fake"
            reasoning_effort = "low"

            def generate_json(self, **_kwargs):
                return {"version": 2, "rules": []}, ProviderTrace("fake", {})

        method = {
            "method_id": "direct_sow.field",
            "method_category_id": "direct_sow",
            "method_name": "Direct sow (field)",
            "tasks_required_json": '{"sow": true}',
        }
        with self.assertRaisesRegex(Exception, "OpenAI repair output failed validation"):
            _generate_task_template(FakeOpenAI(), {"plant_name": "Lettuce"}, method, {"name": "Lettuce"}, "")

    def test_controlled_crop_provenance_is_added_by_code(self) -> None:
        result = {
            "row": complete_plant_row(direct_sow="yes", transplant="true"),
            "allowed_method_categories": ["direct_sow"],
            "varieties": [{"variety_name": "Buttercrunch", "overrides": [], "sources": []}],
            "provenance": {"field_sources": []},
        }
        methods = [{"method_id": "direct_sow.field", "method_category_id": "direct_sow", "method_name": "Direct sow (field)"}]
        prepared = _prepare_crop_result(result, {"name": "Lettuce"}, methods)
        self.assertEqual(prepared["row"]["direct_sow"], 1)
        self.assertEqual(prepared["row"]["transplant"], 1)
        self.assertEqual(_validate_crop_result(prepared, _crop_source_values({"name": "Lettuce"}, methods)), [])

    def test_concrete_allowed_methods_prevent_category_over_expansion(self) -> None:
        methods = [
            {"method_id": "transplant.cutting", "method_category_id": "transplant", "method_name": "Transplant from cutting"},
            {"method_id": "transplant.indoor", "method_category_id": "transplant", "method_name": "Indoor seed start"},
            {"method_id": "transplant.purchased", "method_category_id": "transplant", "method_name": "Purchased transplant"},
        ]
        result = {
            "row": complete_plant_row(direct_sow=0, transplant=1, default_planting_method_category="transplant", default_planting_method="transplant.indoor"),
            "allowed_method_categories": ["transplant"],
            "allowed_method_ids": ["transplant.indoor", "transplant.purchased"],
            "varieties": [{"variety_name": "Buttercrunch", "overrides": [], "sources": []}],
            "provenance": {"field_sources": []},
        }
        prepared = _prepare_crop_result(result, {"name": "Lettuce"}, methods)
        self.assertEqual(prepared["allowed_method_ids"], ["transplant.indoor", "transplant.purchased"])
        self.assertNotIn("transplant.cutting", prepared["allowed_method_ids"])
        self.assertEqual(_validate_crop_result(prepared, _crop_source_values({"name": "Lettuce"}, methods), methods), [])

    def test_crop_validation_rejects_missing_or_invalid_concrete_methods(self) -> None:
        methods = [
            {"method_id": "direct_sow.field", "method_category_id": "direct_sow", "method_name": "Direct sow (field)"},
            {"method_id": "transplant.indoor", "method_category_id": "transplant", "method_name": "Indoor seed start"},
        ]
        base = {
            "row": complete_plant_row(),
            "allowed_method_categories": ["direct_sow"],
            "varieties": [{"variety_name": "Buttercrunch", "overrides": [], "sources": []}],
            "provenance": {"field_sources": []},
        }
        missing = _prepare_crop_result(dict(base), {"name": "Lettuce"}, methods)
        self.assertIn("allowed_method_ids is required.", _validate_crop_result(missing, _crop_source_values({"name": "Lettuce"}, methods), methods))

        unknown = _prepare_crop_result(base | {"allowed_method_ids": ["direct_sow.unknown"]}, {"name": "Lettuce"}, methods)
        self.assertIn("allowed_method_ids has unknown method_id: direct_sow.unknown", _validate_crop_result(unknown, _crop_source_values({"name": "Lettuce"}, methods), methods))

        mismatch = _prepare_crop_result(base | {"allowed_method_ids": ["transplant.indoor"]}, {"name": "Lettuce"}, methods)
        self.assertIn("allowed_method_ids method transplant.indoor is outside allowed_method_categories.", _validate_crop_result(mismatch, _crop_source_values({"name": "Lettuce"}, methods), methods))

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
        write_json(generated / "Plants.json", [complete_plant_row(
            plant_name="Seeder Test Crop",
            abbr="STC",
            transplant=0,
            yield_unit="kg",
            yield_per_plant_kg=1.0,
        )])
        write_json(generated / "PlantAllowedMethodCategories.json", [{
            "plant_name": "Seeder Test Crop",
            "method_category_id": "direct_sow",
        }])
        write_json(generated / "PlantVarieties.json", [{
            "plant_name": "Seeder Test Crop",
            "variety_name": "Seeder Test Variety",
            "maturity_class": "early",  # ADDED
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
            "country_name": "Canada",
            "country_code": "CA",
            "region_name": "British Columbia",
            "region_code": "BC",
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
        write_json(generated / "CityWeatherMonthly.json", [{
            "city_name": "Seeder Test City",
            "weather_month": "2025-01",
            "provider": "nasa-power",
            "dataset": "nasa-power-monthly",
            "timezone": "America/Vancouver",
            "temp_min_c": 1.0,
            "temp_max_c": 6.0,
            "temp_mean_c": 3.5,
            "precipitation_mm": 120.0,
            "gdd_base_5c": 0.0,
            "fetched_at": "2026-01-01T00:00:00+00:00",
            "source_url": "https://power.larc.nasa.gov/",
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
        write_json(generated / "PlantingWindowReferences.json", [{
            "plant_name": "Seeder Test Crop",
            "city_name": "Seeder Test City",
            "method_id": "direct_sow.field",
            "stage": "sow",
            "window_label": "spring",
            "start_mm_dd": "04-01",
            "end_mm_dd": "05-15",
            "start_doy": 92,
            "end_doy": 136,
            "is_cross_year": 0,
            "source_url": None,
            "source_note": "expert estimate",
            "confidence": "medium",
            "summary": "Seeder test reference window.",
        }])

        report = validate_run(run_dir, self.db_path)
        self.assertTrue(report["ok"], report)
        diff = create_diff_report(run_dir, self.db_path)
        self.assertIn("Plants", diff["tables"])
        self.assertIn("PlantingWindowReferences", diff["tables"])
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
            monthly_count = conn.execute("SELECT COUNT(*) FROM CityWeatherMonthly WHERE city_id=?", [city_id]).fetchone()[0]
            evidence_count = conn.execute("SELECT COUNT(*) FROM CompanionEvidence").fetchone()[0]
            window_count = conn.execute("SELECT COUNT(*) FROM PlantingWindowReferences WHERE plant_id=? AND city_id=?", [plant_id, city_id]).fetchone()[0]
            variety_class = conn.execute("SELECT maturity_class FROM PlantVarieties WHERE plant_id=? AND variety_name='Seeder Test Variety'", [plant_id]).fetchone()[0]  # ADDED
            variety_template_count = conn.execute("SELECT COUNT(*) FROM VarietyTaskTemplates").fetchone()[0]
            self.assertEqual(weather_count, 1)
            self.assertEqual(monthly_count, 1)
            self.assertGreaterEqual(evidence_count, 1)
            self.assertEqual(window_count, 1)
            self.assertEqual(variety_class, "early")  # ADDED
            self.assertGreaterEqual(variety_template_count, 1)
        references = load_planting_window_references(self.db_path)
        self.assertTrue(any(row["plant_name"] == "Seeder Test Crop" and row["city_name"] == "Seeder Test City" for row in references))

    def test_apply_run_resolves_duplicate_city_names_by_geography(self) -> None:
        run_dir = self.tmp_path / "run-duplicate-city-import"
        generated = run_dir / "generated"
        generated.mkdir(parents=True)
        write_json(generated / "Plants.json", [complete_plant_row(
            plant_name="Duplicate City Crop",
            abbr="DCC",
            transplant=0,
            yield_unit="kg",
            yield_per_plant_kg=1.0,
        )])
        write_json(generated / "Cities.json", [
            {
                "city_name": "Springfield",
                "country_name": "United States",
                "country_code": "US",
                "region_name": "Illinois",
                "region_code": "IL",
                "latitude": 39.78,
                "longitude": -89.65,
                "timezone": "America/Chicago",
                "gdd_annual": 1200,
                "gdd_base_c": 5,
            },
            {
                "city_name": "Springfield",
                "country_name": "United States",
                "country_code": "US",
                "region_name": "Missouri",
                "region_code": "MO",
                "latitude": 37.20,
                "longitude": -93.29,
                "timezone": "America/Chicago",
                "gdd_annual": 1500,
                "gdd_base_c": 5,
            },
        ])
        write_json(generated / "CityWeatherMonthly.json", [
            {
                "city_name": "Springfield",
                "country_name": "United States",
                "country_code": "US",
                "region_name": "Illinois",
                "region_code": "IL",
                "weather_month": "2025-01",
                "provider": "nasa-power",
                "dataset": "nasa-power-monthly",
                "timezone": "America/Chicago",
                "temp_min_c": 0.0,
                "temp_max_c": 8.0,
                "temp_mean_c": 4.0,
                "precipitation_mm": 30.0,
                "gdd_base_5c": 0.0,
                "fetched_at": "2026-01-01T00:00:00+00:00",
                "source_url": "https://power.larc.nasa.gov/",
            },
            {
                "city_name": "Springfield",
                "country_name": "United States",
                "country_code": "US",
                "region_name": "Missouri",
                "region_code": "MO",
                "weather_month": "2025-01",
                "provider": "nasa-power",
                "dataset": "nasa-power-monthly",
                "timezone": "America/Chicago",
                "temp_min_c": 2.0,
                "temp_max_c": 10.0,
                "temp_mean_c": 6.0,
                "precipitation_mm": 35.0,
                "gdd_base_5c": 31.0,
                "fetched_at": "2026-01-01T00:00:00+00:00",
                "source_url": "https://power.larc.nasa.gov/",
            },
        ])
        write_json(generated / "PlantingWindowReferences.json", [
            {
                "plant_name": "Duplicate City Crop",
                "city_name": "Springfield",
                "country_name": "United States",
                "country_code": "US",
                "region_name": "Illinois",
                "region_code": "IL",
                "method_id": "direct_sow.field",
                "stage": "sow",
                "window_label": "spring",
                "start_mm_dd": "04-01",
                "end_mm_dd": "05-15",
                "start_doy": 92,
                "end_doy": 136,
                "is_cross_year": 0,
                "source_url": None,
                "source_note": "expert estimate",
                "confidence": "medium",
                "summary": "Illinois window.",
            },
            {
                "plant_name": "Duplicate City Crop",
                "city_name": "Springfield",
                "country_name": "United States",
                "country_code": "US",
                "region_name": "Missouri",
                "region_code": "MO",
                "method_id": "direct_sow.field",
                "stage": "sow",
                "window_label": "spring",
                "start_mm_dd": "03-15",
                "end_mm_dd": "05-01",
                "start_doy": 75,
                "end_doy": 122,
                "is_cross_year": 0,
                "source_url": None,
                "source_note": "expert estimate",
                "confidence": "medium",
                "summary": "Missouri window.",
            },
        ])

        report = validate_run(run_dir, self.db_path)
        self.assertTrue(report["ok"], report)
        apply_run(run_dir, self.db_path)

        with closing(sqlite3.connect(self.db_path)) as conn:
            rows = {
                row[0]: row[1]
                for row in conn.execute("SELECT region_code, city_id FROM Cities WHERE city_name='Springfield'")
            }
            self.assertEqual(set(rows), {"IL", "MO"})
            il_monthly = conn.execute("SELECT temp_mean_c FROM CityWeatherMonthly WHERE city_id=?", [rows["IL"]]).fetchone()[0]
            mo_monthly = conn.execute("SELECT temp_mean_c FROM CityWeatherMonthly WHERE city_id=?", [rows["MO"]]).fetchone()[0]
            self.assertEqual(il_monthly, 4.0)
            self.assertEqual(mo_monthly, 6.0)
            il_window = conn.execute("SELECT summary FROM PlantingWindowReferences WHERE city_id=?", [rows["IL"]]).fetchone()[0]
            mo_window = conn.execute("SELECT summary FROM PlantingWindowReferences WHERE city_id=?", [rows["MO"]]).fetchone()[0]
            self.assertEqual(il_window, "Illinois window.")
            self.assertEqual(mo_window, "Missouri window.")

    def test_apply_run_rejects_bare_city_name_when_generated_cities_are_ambiguous(self) -> None:
        run_dir = self.tmp_path / "run-ambiguous-city-import"
        generated = run_dir / "generated"
        generated.mkdir(parents=True)
        write_json(generated / "Cities.json", [
            {
                "city_name": "Springfield",
                "country_name": "United States",
                "country_code": "US",
                "region_name": "Illinois",
                "region_code": "IL",
                "latitude": 39.78,
                "longitude": -89.65,
                "timezone": "America/Chicago",
                "gdd_annual": 1200,
                "gdd_base_c": 5,
            },
            {
                "city_name": "Springfield",
                "country_name": "United States",
                "country_code": "US",
                "region_name": "Missouri",
                "region_code": "MO",
                "latitude": 37.20,
                "longitude": -93.29,
                "timezone": "America/Chicago",
                "gdd_annual": 1500,
                "gdd_base_c": 5,
            },
        ])
        write_json(generated / "CityWeatherMonthly.json", [{
            "city_name": "Springfield",
            "weather_month": "2025-01",
            "provider": "nasa-power",
            "dataset": "nasa-power-monthly",
            "timezone": "America/Chicago",
            "temp_min_c": 0.0,
            "temp_max_c": 8.0,
            "temp_mean_c": 4.0,
            "precipitation_mm": 30.0,
            "gdd_base_5c": 0.0,
            "fetched_at": "2026-01-01T00:00:00+00:00",
            "source_url": "https://power.larc.nasa.gov/",
        }])

        with self.assertRaisesRegex(RuntimeError, "Ambiguous city name"):
            apply_run(run_dir, self.db_path)

    def test_apply_run_to_databases_updates_seed_and_live_copy(self) -> None:
        run_dir = self.tmp_path / "run-multi-db"
        generated = run_dir / "generated"
        generated.mkdir(parents=True)
        live_db = self.tmp_path / "appdata" / "draw.io" / "trellis_database" / "Trellis_database.sqlite"
        write_json(generated / "Cities.json", [{
            "city_name": "Multi Target City",
            "country_name": "Canada",
            "country_code": "CA",
            "region_name": "British Columbia",
            "region_code": "BC",
            "latitude": 49.0,
            "longitude": -123.0,
            "timezone": "America/Vancouver",
            "gdd_annual": 1000,
            "gdd_base_c": 5,
        }])

        report = apply_run_to_databases(run_dir, [self.db_path, live_db], self.db_path)
        self.assertEqual(len(report["targets"]), 2)
        self.assertTrue(live_db.exists())
        for db_path in (self.db_path, live_db):
            with closing(sqlite3.connect(db_path)) as conn:
                found = conn.execute("SELECT city_name FROM Cities WHERE city_name='Multi Target City'").fetchone()
                self.assertIsNotNone(found)

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

    def test_sowing_window_dependency_validation_fails_for_unknown_endpoints(self) -> None:
        run_dir = self.tmp_path / "run-missing-window-dep"
        generated = run_dir / "generated"
        generated.mkdir(parents=True)
        write_json(generated / "PlantingWindowReferences.json", [{
            "plant_name": "Missing Plant",
            "city_name": "Missing City",
            "method_id": "missing.method",
            "stage": "sow",
            "window_label": "spring",
            "start_mm_dd": "04-01",
            "end_mm_dd": "05-15",
            "start_doy": 92,
            "end_doy": 136,
            "is_cross_year": 0,
            "source_url": None,
            "source_note": "expert estimate",
            "confidence": "medium",
            "summary": "Bad dependencies.",
        }])
        report = validate_run(run_dir, self.db_path)
        self.assertFalse(report["ok"])
        self.assertTrue(any("unknown method_id" in error for error in report["errors"]))
        self.assertTrue(any("cannot resolve plant" in error for error in report["errors"]))
        self.assertTrue(any("cannot resolve city" in error for error in report["errors"]))

    def test_sowing_window_diagnostic_comparison_is_report_only(self) -> None:
        references = [{
            "plant_name": "Lettuce",
            "city_name": "Vancouver, BC",
            "method_id": "direct_sow.field",
            "stage": "sow",
            "window_label": "spring",
            "start_doy": 75,
            "end_doy": 120,
        }]
        scheduler = [{
            "plant_name": "Lettuce",
            "city_name": "Vancouver, BC",
            "method_id": "direct_sow.field",
            "stage": "sow",
            "start_doy": 95,
            "end_doy": 140,
        }]
        report = compare_window_references(references, scheduler, tolerance_days=7)
        self.assertTrue(report["ok"])
        self.assertEqual(report["summary"]["outside_tolerance"], 1)


if __name__ == "__main__":
    unittest.main()
