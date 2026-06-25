from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from .jsonio import read_json, write_json
from .paths import DEFAULT_CONFIG_PATH, DEFAULT_DB_PATH, DEFAULT_RUNS_DIR


DEFAULT_CONFIG = {
    "db_path": str(DEFAULT_DB_PATH),
    "runs_dir": str(DEFAULT_RUNS_DIR),
    "openai_model": os.getenv("OPENAI_MODEL", "gpt-5.5"),
    "openai_reasoning_effort": os.getenv("OPENAI_REASONING_EFFORT", "high"),
    "gdd_base_c": 5,
    "city_history_years": 15,
    "forecast_days": 16,
    "default_variety_count": 5,
    "open_meteo": {
        "geocoding_url": "https://geocoding-api.open-meteo.com/v1/search",
        "archive_url": "https://archive-api.open-meteo.com/v1/archive",
        "forecast_url": "https://api.open-meteo.com/v1/forecast",
        "historical_dataset": "open-meteo-archive",
        "forecast_model": "best_match",
    },
}


@dataclass
class Settings:
    path: Path
    data: dict[str, Any]

    @property
    def db_path(self) -> Path:
        return _resolve_project_path(self.path, self.data["db_path"])

    @property
    def runs_dir(self) -> Path:
        return _resolve_project_path(self.path, self.data["runs_dir"])

    @property
    def openai_model(self) -> str:
        return os.getenv("OPENAI_MODEL", str(self.data.get("openai_model") or DEFAULT_CONFIG["openai_model"]))

    @property
    def openai_reasoning_effort(self) -> str:
        return os.getenv("OPENAI_REASONING_EFFORT", str(self.data.get("openai_reasoning_effort") or DEFAULT_CONFIG["openai_reasoning_effort"]))


def load_settings(path: Path = DEFAULT_CONFIG_PATH) -> Settings:
    data = DEFAULT_CONFIG | (read_json(path, {}) or {})
    data["open_meteo"] = DEFAULT_CONFIG["open_meteo"] | (data.get("open_meteo") or {})
    return Settings(path=path, data=data)


def save_settings(settings: Settings) -> None:
    write_json(settings.path, settings.data)


def ensure_default_config(path: Path = DEFAULT_CONFIG_PATH) -> Settings:
    settings = load_settings(path)
    if not path.exists():
        save_settings(settings)
    return settings


def read_openai_api_key() -> str:
    return os.environ.get("OPENAI_API_KEY", "").strip()


def _resolve_project_path(config_path: Path, value: str) -> Path:
    path = Path(value).expanduser()
    if path.is_absolute():
        return path
    return (config_path.parent / path).resolve()
