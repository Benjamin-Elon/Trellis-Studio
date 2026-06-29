from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from .jsonio import read_json, write_json
from .paths import DEFAULT_CONFIG_PATH, DEFAULT_DB_PATH, DEFAULT_RUNS_DIR


DEFAULT_CONFIG = {
    "db_path": str(DEFAULT_DB_PATH),
    "apply_to_live_app_db": True,
    "live_app_db_path": "",
    "runs_dir": str(DEFAULT_RUNS_DIR),
    "openai_model": os.getenv("OPENAI_MODEL", "gpt-5.5"),
    "openai_reasoning_effort": os.getenv("OPENAI_REASONING_EFFORT", "high"),
    "gdd_base_c": 5,
    "city_history_years": 15,
    "forecast_days": 16,
    "default_variety_count": 5,
    "sowing_windows": {
        "enabled": False,
        "cities_per_crop": 5,
        "random_seed": "trellis-sowing-windows",
        "crop_allowlist": [],
        "city_allowlist": [],
        "city_overrides_by_crop": {},
    },
    "climate_benchmark": {  # ADDED
        "random_seed": "trellis-climate-benchmark",  # ADDED
        "tolerance_days": 14,  # ADDED
    },  # ADDED
    "open_meteo": {
        "geocoding_url": "https://geocoding-api.open-meteo.com/v1/search",
        "archive_url": "https://archive-api.open-meteo.com/v1/archive",
        "forecast_url": "https://api.open-meteo.com/v1/forecast",
        "historical_dataset": "open-meteo-archive",
        "forecast_model": "best_match",
        "rate_limit_max_attempts": 8,
        "rate_limit_max_wait_seconds": 900,
        "rate_limit_base_wait_seconds": 60,
    },
    "nasa_power": {
        "monthly_url": "https://power.larc.nasa.gov/api/temporal/monthly/point",
        "community": "AG",
        "parameters": "T2M,T2M_MAX,T2M_MIN,PRECTOTCORR",
        "dataset": "nasa-power-monthly",
        "rate_limit_max_attempts": 8,
        "rate_limit_max_wait_seconds": 900,
        "rate_limit_base_wait_seconds": 60,
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
    def live_app_db_path(self) -> Path | None:
        configured = str(self.data.get("live_app_db_path") or "").strip()
        if configured:
            return _resolve_project_path(self.path, configured)
        appdata = os.environ.get("APPDATA")
        if not appdata:
            return None
        return Path(appdata) / "draw.io" / "trellis_database" / "Trellis_database.sqlite"

    @property
    def apply_to_live_app_db(self) -> bool:
        return bool(self.data.get("apply_to_live_app_db", True))

    @property
    def apply_db_paths(self) -> list[Path]:
        paths = [self.db_path]
        live_path = self.live_app_db_path
        if self.apply_to_live_app_db and live_path:
            resolved = live_path.resolve()
            if resolved != self.db_path.resolve():
                paths.append(resolved)
        return paths

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
    data["nasa_power"] = DEFAULT_CONFIG["nasa_power"] | (data.get("nasa_power") or {})
    data["sowing_windows"] = DEFAULT_CONFIG["sowing_windows"] | (data.get("sowing_windows") or {})
    data["climate_benchmark"] = DEFAULT_CONFIG["climate_benchmark"] | (data.get("climate_benchmark") or {})  # ADDED
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
