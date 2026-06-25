from __future__ import annotations

from pathlib import Path

from .config import ensure_default_config, load_settings, read_openai_api_key, save_settings
from .db import apply_run, create_diff_report, print_diff_report, show_pending_migrations
from .generator import estimate_openai_calls, generate_run, normalize_input, preflight
from .jsonio import read_json
from .paths import DEFAULT_CONFIG_PATH, DEFAULT_SAMPLE_INPUT_PATH
from .validator import validate_input, validate_run


def run_menu() -> None:
    settings = ensure_default_config(DEFAULT_CONFIG_PATH)
    while True:
        print("\nTrellis Database Seeder")
        print("=======================")
        print("1. Generate from input JSON")
        print("2. Review/Validate run")
        print("3. Apply valid run to seed DB")
        print("4. Manage run folders")
        print("5. Settings and credentials")
        print("6. Run live tests")
        print("7. Exit")
        choice = input("Choose an option: ").strip()
        if choice == "1":
            _generate_flow(settings)
        elif choice == "2":
            _review_flow(settings)
        elif choice == "3":
            _apply_flow(settings)
        elif choice == "4":
            _manage_runs(settings)
        elif choice == "5":
            settings = _settings_flow(settings.path)
        elif choice == "6":
            _live_tests_flow()
        elif choice == "7":
            return
        else:
            print("Unknown option.")


def _generate_flow(settings) -> None:
    default = DEFAULT_SAMPLE_INPUT_PATH
    raw = input(f"Input JSON path [{default}]: ").strip()
    input_path = Path(raw) if raw else default
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
    print("Running preflight checks...")
    try:
        for trace in preflight(settings, normalized):
            print(f"- {trace.provider}: ok")
    except Exception as exc:
        print(f"Preflight failed: {exc}")
        return
    estimate = estimate_openai_calls(normalized, settings, settings.db_path)
    print("Estimated OpenAI calls:")
    for key, value in estimate.items():
        print(f"- {key}: {value}")
    if input("Start generation? [y/N]: ").strip().lower() != "y":
        return
    try:
        run_dir = generate_run(settings, input_path)
    except Exception as exc:
        print(f"Generation failed: {exc}")
        return
    print(f"Run generated: {run_dir}")
    report = read_json(run_dir / "validation_report.json", {})
    print("Validation:", "ok" if report.get("ok") else "failed")


def _review_flow(settings) -> None:
    run_dir = _choose_run(settings)
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
    run_dir = _choose_run(settings)
    if not run_dir:
        return
    report = validate_run(run_dir, settings.db_path)
    if not report["ok"]:
        print("Run is not valid:")
        for error in report["errors"]:
            print(f"- {error}")
        return
    pending = show_pending_migrations(settings.db_path)
    if pending:
        print("Pending schema migrations:")
        for item in pending:
            print(f"- {item}")
    diff = create_diff_report(run_dir, settings.db_path)
    print_diff_report(diff)
    if input(f"Apply this run to {settings.db_path}? [y/N]: ").strip().lower() != "y":
        return
    try:
        report = apply_run(run_dir, settings.db_path)
    except Exception as exc:
        print(f"Apply failed: {exc}")
        return
    print("Apply complete.")
    print(f"Backup: {report['backup_path']}")


def _manage_runs(settings) -> None:
    settings.runs_dir.mkdir(parents=True, exist_ok=True)
    runs = _list_runs(settings)
    if not runs:
        print("No run folders found.")
        return
    for i, run in enumerate(runs, 1):
        print(f"{i}. {run.name}")
    raw = input("Delete a run number, or press Enter to return: ").strip()
    if not raw:
        return
    try:
        run = runs[int(raw) - 1]
    except Exception:
        print("Invalid run number.")
        return
    if input(f"Delete {run}? [y/N]: ").strip().lower() == "y":
        import shutil
        shutil.rmtree(run)
        print("Deleted.")


def _settings_flow(config_path: Path):
    settings = load_settings(config_path)
    while True:
        print("\nSettings")
        print("========")
        print(f"1. DB path: {settings.data['db_path']}")
        print(f"2. Runs dir: {settings.data['runs_dir']}")
        print(f"3. OpenAI model: {settings.openai_model} (OPENAI_MODEL overrides config)")
        print(f"4. OpenAI reasoning effort: {settings.openai_reasoning_effort} (OPENAI_REASONING_EFFORT overrides config)")
        print(f"5. OPENAI_API_KEY: {'set' if read_openai_api_key() else 'missing'}")
        print("6. Back")
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
            print("Set OPENAI_API_KEY in your shell environment before launching this menu.")
        elif choice == "6":
            save_settings(settings)
            return settings


def _live_tests_flow() -> None:
    print("Running live tests requires network access and an OpenAI API key.")
    if input("Continue? [y/N]: ").strip().lower() != "y":
        return
    from .live_tests import run_live_tests
    ok = run_live_tests()
    print("Live tests:", "ok" if ok else "failed")


def _choose_run(settings) -> Path | None:
    runs = _list_runs(settings)
    if not runs:
        print("No run folders found.")
        return None
    for i, run in enumerate(runs, 1):
        print(f"{i}. {run.name}")
    raw = input("Run number: ").strip()
    try:
        return runs[int(raw) - 1]
    except Exception:
        print("Invalid run number.")
        return None


def _list_runs(settings) -> list[Path]:
    if not settings.runs_dir.exists():
        return []
    return sorted([p for p in settings.runs_dir.iterdir() if p.is_dir()], reverse=True)
