from __future__ import annotations

from pathlib import Path


PACKAGE_DIR = Path(__file__).resolve().parent
SCRIPTS_DIR = PACKAGE_DIR.parent
PROJECT_DIR = SCRIPTS_DIR.parent
DEFAULT_DB_PATH = PROJECT_DIR / "trellis_database" / "Trellis_database.sqlite"
DEFAULT_CONFIG_PATH = PROJECT_DIR / "trellis_seed.config.json"
DEFAULT_RUNS_DIR = PROJECT_DIR / "trellis_seed_runs"
DEFAULT_SAMPLE_INPUT_PATH = PROJECT_DIR / "trellis_seed.sample-input.json"
