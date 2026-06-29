from __future__ import annotations

import subprocess
import time
from datetime import datetime
from pathlib import Path

from .artifacts import artifact_label, artifacts_after_keeping_latest, artifacts_older_than, list_artifacts, select_artifacts_by_indices
from .climate_benchmarks import generate_climate_benchmark, preflight_climate_benchmark
from .config import ensure_default_config, load_settings, read_openai_api_key, save_settings
from .db import apply_run_to_databases, create_diff_report, print_diff_report, show_pending_migrations
from .generator import GenerationOptions, estimate_openai_calls, generate_run, normalize_input, preflight
from .jsonio import read_json
from .paths import DEFAULT_CONFIG_PATH, DEFAULT_SAMPLE_INPUT_PATH
from .providers import OpenAIJsonClient
from .suggestions import (
    build_suggestion_request,
    generate_seed_input_draft,
    generate_suggestion_list,
    load_suggestion_context,
    parse_selection,
    write_suggestion_artifacts,
)
from .paths import PROJECT_DIR
from .validator import validate_input, validate_run


def run_menu() -> None:
    settings = ensure_default_config(DEFAULT_CONFIG_PATH)
    while True:
        print("\nTrellis Database Seeder")
        print("=======================")
        print("1. Suggest input JSON with AI")
        print("2. Generate from input JSON")
        print("3. Review/Validate run")
        print("4. Apply valid run to seed DB")
        print("5. Manage run folders")
        print("6. Settings and credentials")
        print("7. Run live tests")
        print("8. Compare scheduler to sowing-season references")  # terminology alignment
        print("9. Generate climate benchmark")  # ADDED
        print("10. Exit")  # CHANGED
        choice = input("Choose an option: ").strip()
        if choice == "1":
            _suggest_input_flow(settings)
        elif choice == "2":
            _generate_flow(settings)
        elif choice == "3":
            _review_flow(settings)
        elif choice == "4":
            _apply_flow(settings)
        elif choice == "5":
            _manage_runs(settings)
        elif choice == "6":
            settings = _settings_flow(settings.path)
        elif choice == "7":
            _live_tests_flow()
        elif choice == "8":
            _sowing_window_diagnostics_flow(settings)
        elif choice == "9":
            _climate_benchmark_flow(settings)  # ADDED
        elif choice == "10":
            return
        else:
            print("Unknown option.")


def _suggest_input_flow(settings) -> None:
    section = _choose_suggestion_section()
    if not section:
        return
    requested_count = _prompt_positive_int("How many suggestions? ")
    if requested_count is None:
        return
    criteria = input("Optional criteria, or press Enter for defaults: ").strip()
    print("Reading current database context...")
    context = load_suggestion_context(settings.db_path)
    request = build_suggestion_request(section, requested_count, criteria, context)
    openai = OpenAIJsonClient(read_openai_api_key(), settings.openai_model, settings.openai_reasoning_effort)
    traces = []
    try:
        if _prompt_yes_no("Run OpenAI preflight check before suggestions?", default=True):
            print("Running OpenAI preflight...")
            traces.append(openai.preflight())
        else:
            print("Skipping OpenAI preflight check.")
        print("Requesting suggestions...")
        suggestion_list, trace = generate_suggestion_list(openai, request)
        traces.append(trace)
    except Exception as exc:
        print(f"Suggestion failed: {exc}")
        return
    suggestions = suggestion_list.get("suggestions") or []
    if not suggestions:
        print("OpenAI did not return any source-confident suggestions.")
        return
    _print_suggestions(section, suggestions)
    raw = input("Accept all, or enter numbers/ranges like 1,3-4 [all]: ").strip()
    try:
        selected = parse_selection(raw, len(suggestions))
    except Exception as exc:
        print(f"Invalid selection: {exc}")
        return
    accepted = [suggestions[index] for index in selected]
    if not accepted:
        print("No suggestions selected.")
        return
    try:
        print("Generating source-backed input JSON draft...")
        draft, trace = generate_seed_input_draft(openai, section, accepted, criteria, context)
        traces.append(trace)
        suggestion_dir = write_suggestion_artifacts(settings, request, suggestion_list, accepted, draft, traces)
    except Exception as exc:
        print(f"Draft generation failed: {exc}")
        return
    suggested_input = suggestion_dir / "suggested_input.json"
    print(f"Suggested input written: {suggested_input}")
    if input("Continue into normal generation with this JSON? [y/N]: ").strip().lower() == "y":
        _run_generation_for_input(settings, suggested_input)


def _generate_flow(settings) -> None:
    default = DEFAULT_SAMPLE_INPUT_PATH
    raw = input(f"Input JSON path [{default}]: ").strip()
    input_path = Path(raw) if raw else default
    _run_generation_for_input(settings, input_path)


def _run_generation_for_input(settings, input_path: Path) -> None:
    data = read_json(input_path, None)
    if not isinstance(data, dict):
        print(f"Input file is missing or invalid: {input_path}")
        return
    errors = validate_input(data)
    if errors:
        print("Input validation failed:")
        for error in errors:
            print(f"- {error}")
        return
    normalized = normalize_input(data, settings)
    preflight_labels = _preflight_provider_labels(normalized)
    run_preflight = bool(preflight_labels) and _prompt_yes_no(f"Run provider preflight checks ({', '.join(preflight_labels)})?", default=True)
    if run_preflight:
        print("Running preflight checks...")
        try:
            for trace in preflight(settings, normalized):
                print(f"- {trace.provider}: ok")
        except Exception as exc:
            print(f"Preflight failed: {exc}")
            return
    elif preflight_labels:
        print("Skipping preflight checks.")
    else:
        print("No provider preflight checks needed.")
    generate_templates = False
    if _should_prompt_template_generation(normalized):
        generate_templates = input("Generate plant and variety task templates? Defaults usually suffice. [y/N]: ").strip().lower() == "y"
    options = GenerationOptions(generate_templates=generate_templates, run_preflight=False, preflight_already_run=run_preflight)  # run options
    estimate = estimate_openai_calls(normalized, settings, settings.db_path, options)
    print("Estimated generation work:")  # deterministic templates are not OpenAI calls
    for key, value in estimate.items():
        print(f"- {key}: {value}")
    if input("Start generation? [y/N]: ").strip().lower() != "y":
        return
    try:
        run_dir = generate_run(settings, input_path, options)
    except Exception as exc:
        print(f"Generation failed: {exc}")
        return
    print(f"Run generated: {run_dir}")
    report = read_json(run_dir / "validation_report.json", {})
    print("Validation:", "ok" if report.get("ok") else "failed")


def _choose_suggestion_section() -> str | None:
    print("1. Crops")
    print("2. Cities")
    print("3. Companions")
    choice = input("Choose section to suggest: ").strip()
    return {"1": "crops", "2": "cities", "3": "companions"}.get(choice)


def _prompt_positive_int(prompt: str) -> int | None:
    raw = input(prompt).strip()
    try:
        value = int(raw)
    except ValueError:
        print("Enter a whole number greater than zero.")
        return None
    if value <= 0:
        print("Enter a number greater than zero.")
        return None
    return value


def _prompt_nonnegative_int(prompt: str) -> int | None:
    raw = input(prompt).strip()
    try:
        value = int(raw)
    except ValueError:
        print("Enter a whole number zero or greater.")
        return None
    if value < 0:
        print("Enter a number zero or greater.")
        return None
    return value


def _prompt_yes_no(prompt: str, default: bool) -> bool:
    suffix = "[Y/n]" if default else "[y/N]"
    raw = input(f"{prompt} {suffix}: ").strip().casefold()
    if not raw:
        return default
    return raw in {"y", "yes"}


def _preflight_provider_labels(input_data: dict) -> list[str]:
    labels = []
    if input_data.get("crops") or input_data.get("cities") or input_data.get("companions") or (input_data.get("sowing_windows") or {}).get("enabled"):  # CHANGED
        labels.append("OpenAI")
    if input_data.get("cities"):
        labels.extend(["Open-Meteo", "NASA POWER"])
    return labels


def _should_prompt_template_generation(input_data: dict) -> bool:
    return bool(input_data.get("crops"))  # templates only apply to crop generation


def _print_suggestions(section: str, suggestions: list[dict]) -> None:
    print("Suggested entries:")
    for index, item in enumerate(suggestions, 1):
        if section == "companions":
            label = f"{item.get('p1')} / {item.get('p2')}"
        else:
            label = str(item.get("name") or "")
        rationale = str(item.get("rationale") or "").strip()
        print(f"{index}. {label}" + (f" - {rationale}" if rationale else ""))


def _review_flow(settings) -> None:
    run_dir = _choose_run(settings, complete_only=True)
    if not run_dir:
        return
    report = validate_run(run_dir, settings.db_path)
    print("Validation:", "ok" if report["ok"] else "failed")
    for error in report["errors"]:
        print(f"- {error}")
    if report["ok"]:
        diff = create_diff_report(run_dir, settings.db_path)
        print_diff_report(diff)


def _apply_flow(settings) -> None:
    run_dir = _choose_run(settings, complete_only=True)
    if not run_dir:
        return
    report = validate_run(run_dir, settings.db_path)
    if not report["ok"]:
        print("Run is not valid:")
        for error in report["errors"]:
            print(f"- {error}")
        return
    targets = settings.apply_db_paths
    for target in targets:
        if not target.exists() and target != settings.db_path:
            print(f"Live/app DB does not exist and will be initialized from seed DB: {target}")
        if target.exists():
            pending = show_pending_migrations(target)
            if pending:
                print(f"Pending schema migrations for {target}:")
                for item in pending:
                    print(f"- {item}")
    diff = create_diff_report(run_dir, settings.db_path)
    print_diff_report(diff)
    print("Apply targets:")
    for target in targets:
        print(f"- {target}")
    if input("Apply this run to all targets above? [y/N]: ").strip().lower() != "y":
        return
    try:
        report = apply_run_to_databases(run_dir, targets, settings.db_path)
    except Exception as exc:
        print(f"Apply failed: {exc}")
        return
    print("Apply complete.")
    for target in report["targets"]:
        print(f"Backup ({target['db_path']}): {target['backup_path']}")


def _manage_runs(settings) -> None:
    settings.runs_dir.mkdir(parents=True, exist_ok=True)
    while True:
        runs = _list_runs(settings, complete_only=False)
        if not runs:
            print("No run folders found.")
            return
        _print_artifacts(runs)
        print("\nCleanup")
        print("=======")
        print("1. Delete selected artifacts")
        print("2. Delete artifacts older than N days")
        print("3. Keep latest N artifacts, delete the rest")
        print("4. Back")
        choice = input("Choose cleanup option: ").strip()
        if choice == "1":
            _delete_selected_artifacts(settings, runs)
        elif choice == "2":
            _delete_artifacts_older_than(settings, runs)
        elif choice == "3":
            _delete_after_keeping_latest(settings, runs)
        elif choice == "4" or not choice:
            return
        else:
            print("Unknown option.")


def _delete_selected_artifacts(settings, artifacts: list[Path]) -> None:
    raw = input("Delete artifact numbers/ranges, or 'all': ").strip()
    if not raw:
        return
    try:
        indices = parse_selection(raw, len(artifacts))
        targets = select_artifacts_by_indices(artifacts, indices, settings.runs_dir)
    except Exception as exc:
        print(f"Invalid selection: {exc}")
        return
    _confirm_and_delete(settings, targets)


def _delete_artifacts_older_than(settings, artifacts: list[Path]) -> None:
    days = _prompt_positive_int("Delete artifacts older than how many days? ")
    if days is None:
        return
    cutoff = time.time() - (days * 86400)
    _confirm_and_delete(settings, artifacts_older_than(artifacts, cutoff, settings.runs_dir))


def _delete_after_keeping_latest(settings, artifacts: list[Path]) -> None:
    keep = _prompt_nonnegative_int("How many latest artifacts should be kept? ")
    if keep is None:
        return
    _confirm_and_delete(settings, artifacts_after_keeping_latest(artifacts, keep, settings.runs_dir))


def _confirm_and_delete(settings, targets: list[Path]) -> None:
    if not targets:
        print("No matching artifacts to delete.")
        return
    print("Artifacts selected for deletion:")
    for target in targets:
        print(f"- {artifact_label(target)}")
    if input(f"Delete {len(targets)} artifact(s)? [y/N]: ").strip().lower() != "y":
        print("Delete cancelled.")
        return
    import shutil
    for target in targets:
        if target.resolve().parent == settings.runs_dir.resolve():
            shutil.rmtree(target)
    print(f"Deleted {len(targets)} artifact(s).")


def _print_artifacts(artifacts: list[Path]) -> None:
    for i, artifact in enumerate(artifacts, 1):
        print(f"{i}. {artifact_label(artifact)}")


def _settings_flow(config_path: Path):
    settings = load_settings(config_path)
    while True:
        print("\nSettings")
        print("========")
        print(f"1. DB path: {settings.data['db_path']}")
        print(f"2. Runs dir: {settings.data['runs_dir']}")
        print(f"3. OpenAI model: {settings.openai_model} (OPENAI_MODEL overrides config)")
        print(f"4. OpenAI reasoning effort: {settings.openai_reasoning_effort} (OPENAI_REASONING_EFFORT overrides config)")
        print(f"5. Apply to live AppData DB: {'yes' if settings.apply_to_live_app_db else 'no'}")
        print(f"6. Live AppData DB path: {settings.live_app_db_path or '[unavailable]'}")
        print(f"7. OPENAI_API_KEY: {'set' if read_openai_api_key() else 'missing'}")
        print("8. Back")
        choice = input("Choose setting: ").strip()
        if choice == "1":
            settings.data["db_path"] = input("DB path: ").strip() or settings.data["db_path"]
        elif choice == "2":
            settings.data["runs_dir"] = input("Runs dir: ").strip() or settings.data["runs_dir"]
        elif choice == "3":
            settings.data["openai_model"] = input("OpenAI model: ").strip() or settings.data["openai_model"]
        elif choice == "4":
            settings.data["openai_reasoning_effort"] = input("OpenAI reasoning effort: ").strip() or settings.data["openai_reasoning_effort"]
        elif choice == "5":
            settings.data["apply_to_live_app_db"] = _prompt_yes_no("Apply future runs to the live AppData DB too?", default=settings.apply_to_live_app_db)
        elif choice == "6":
            current = str(settings.data.get("live_app_db_path") or settings.live_app_db_path or "")
            settings.data["live_app_db_path"] = input(f"Live AppData DB path [{current}]: ").strip() or settings.data.get("live_app_db_path", "")
        elif choice == "7":
            print("Set OPENAI_API_KEY in your shell environment before launching this menu.")
        elif choice == "8":
            save_settings(settings)
            return settings
        save_settings(settings)
        settings = load_settings(config_path)


def _live_tests_flow() -> None:
    print("Running live tests requires network access and an OpenAI API key.")
    if input("Continue? [y/N]: ").strip().lower() != "y":
        return
    from .live_tests import run_live_tests
    ok = run_live_tests()
    print("Live tests:", "ok" if ok else "failed")


def _sowing_window_diagnostics_flow(settings) -> None:
    default_year = datetime.now().year
    raw_year = input(f"Diagnostic year [{default_year}]: ").strip()
    try:
        year = int(raw_year) if raw_year else default_year
    except ValueError:
        print("Enter a whole-number year.")
        return
    raw_tolerance = input("Tolerance days [14]: ").strip()
    try:
        tolerance_days = int(raw_tolerance) if raw_tolerance else 14
    except ValueError:
        print("Enter a whole-number tolerance.")
        return
    report_path = settings.runs_dir / "sowing_season_diagnostics_report.json"  # match diagnostics script
    script_path = PROJECT_DIR / "scripts" / "trellis_seed_sowing_season_diagnostics.cjs"  # existing diagnostics entrypoint
    cmd = [
        "node",
        str(script_path),
        "--db",
        str(settings.db_path),
        "--year",
        str(year),
        "--tolerance-days",
        str(tolerance_days),
        "--out",
        str(report_path),
    ]
    try:
        completed = subprocess.run(cmd, cwd=PROJECT_DIR, text=True, capture_output=True, check=False)  # diagnostic bridge
    except FileNotFoundError:
        print("Node.js was not found on PATH; run this from the drawio-desktop npm environment.")
        return
    if completed.stdout:
        print(completed.stdout.strip())
    if completed.stderr:
        print(completed.stderr.strip())
    if completed.returncode:
        print(f"Sowing-season diagnostics failed with exit code {completed.returncode}.")  # terminology alignment
    else:
        print("Sowing-season diagnostics complete.")  # terminology alignment


def _climate_benchmark_flow(settings) -> None:  # ADDED
    preflight = preflight_climate_benchmark(settings)  # ADDED
    if not preflight["ok"]:  # ADDED
        print("Cannot generate climate benchmark yet.")  # ADDED
        print("Missing major-city climate bands: " + ", ".join(preflight["missing_bands"]))  # ADDED
        print("Current eligible major-city counts:")  # ADDED
        for band, count in preflight["city_counts"].items():  # ADDED
            print(f"- {band}: {count}")  # ADDED
        return  # ADDED
    benchmark_config = settings.data.get("climate_benchmark") or {}  # ADDED
    default_seed = str(benchmark_config.get("random_seed") or "trellis-climate-benchmark")  # ADDED
    random_seed = input(f"Random seed [{default_seed}]: ").strip() or default_seed  # ADDED
    print("Generating climate benchmark references...")  # ADDED
    openai = OpenAIJsonClient(read_openai_api_key(), settings.openai_model, settings.openai_reasoning_effort)  # ADDED
    try:  # ADDED
        result = generate_climate_benchmark(settings, openai, random_seed=random_seed)  # ADDED
    except Exception as exc:  # ADDED
        print(f"Climate benchmark generation failed: {exc}")  # ADDED
        return  # ADDED
    print(f"Benchmark artifacts written: {result.run_dir}")  # ADDED
    if not _prompt_yes_no("Run scheduler diagnostics for this benchmark now?", default=False):  # ADDED
        return  # ADDED
    default_year = datetime.now().year  # ADDED
    raw_year = input(f"Diagnostic year [{default_year}]: ").strip()  # ADDED
    try:  # ADDED
        year = int(raw_year) if raw_year else default_year  # ADDED
    except ValueError:  # ADDED
        print("Enter a whole-number year.")  # ADDED
        return  # ADDED
    default_tolerance = int(benchmark_config.get("tolerance_days") or 14)  # ADDED
    raw_tolerance = input(f"Tolerance days [{default_tolerance}]: ").strip()  # ADDED
    try:  # ADDED
        tolerance_days = int(raw_tolerance) if raw_tolerance else default_tolerance  # ADDED
    except ValueError:  # ADDED
        print("Enter a whole-number tolerance.")  # ADDED
        return  # ADDED
    report_path = result.run_dir / "climate_benchmark_diagnostics_report.json"  # ADDED
    _run_sowing_window_diagnostics(settings, report_path, year, tolerance_days, references_path=result.references_path)  # ADDED


def _run_sowing_window_diagnostics(settings, report_path: Path, year: int, tolerance_days: int, references_path: Path | None = None) -> None:  # ADDED
    script_path = PROJECT_DIR / "scripts" / "trellis_seed_sowing_season_diagnostics.cjs"  # ADDED
    cmd = [  # ADDED
        "node",  # ADDED
        str(script_path),  # ADDED
        "--db",  # ADDED
        str(settings.db_path),  # ADDED
        "--year",  # ADDED
        str(year),  # ADDED
        "--tolerance-days",  # ADDED
        str(tolerance_days),  # ADDED
        "--out",  # ADDED
        str(report_path),  # ADDED
    ]  # ADDED
    if references_path is not None:  # ADDED
        cmd.extend(["--references", str(references_path)])  # ADDED
    try:  # ADDED
        completed = subprocess.run(cmd, cwd=PROJECT_DIR, text=True, capture_output=True, check=False)  # ADDED
    except FileNotFoundError:  # ADDED
        print("Node.js was not found on PATH; run this from the drawio-desktop npm environment.")  # ADDED
        return  # ADDED
    if completed.stdout:  # ADDED
        print(completed.stdout.strip())  # ADDED
    if completed.stderr:  # ADDED
        print(completed.stderr.strip())  # ADDED
    if completed.returncode:  # ADDED
        print(f"Sowing-season diagnostics failed with exit code {completed.returncode}.")  # ADDED
    else:  # ADDED
        print("Sowing-season diagnostics complete.")  # ADDED


def _choose_run(settings, complete_only: bool = False) -> Path | None:
    runs = _list_runs(settings, complete_only=complete_only)
    if not runs:
        print("No completed run folders found." if complete_only else "No run folders found.")
        return None
    for i, run in enumerate(runs, 1):
        print(f"{i}. {artifact_label(run)}")
    raw = input("Run number: ").strip()
    try:
        return runs[int(raw) - 1]
    except Exception:
        print("Invalid run number.")
        return None


def _list_runs(settings, complete_only: bool = False) -> list[Path]:
    return list_artifacts(settings.runs_dir, complete_runs_only=complete_only)
