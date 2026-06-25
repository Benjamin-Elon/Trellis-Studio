from __future__ import annotations

import re
from pathlib import Path
from typing import Any

from .jsonio import read_json


def slugify(value: str, max_length: int = 60) -> str:
    text = str(value or "").casefold()
    text = re.sub(r"[^a-z0-9]+", "-", text).strip("-")
    return (text[:max_length].strip("-") or "default")


def input_summary_slug(input_data: dict[str, Any], input_path: Path | None = None) -> str:
    suggestion = _suggestion_summary_from_input_path(input_path)
    if suggestion:
        return suggestion
    parts: list[str] = []
    for section in ("crops", "cities", "companions"):
        count = len(input_data.get(section) or [])
        if count:
            parts.append(f"{section}-{count}")
    return slugify("-".join(parts) or "empty-input")


def suggestion_summary_slug(section: str, accepted_count: int, criteria: str) -> str:
    criteria_slug = slugify(criteria) if str(criteria or "").strip() else "default"
    return slugify(f"{section}-{accepted_count}-{criteria_slug}")


def unique_artifact_dir(base_dir: Path, prefix: str, timestamp: str, summary_slug: str) -> Path:
    base_name = f"{prefix}-{timestamp}-{summary_slug}"
    candidate = base_dir / base_name
    counter = 1
    while candidate.exists():
        counter += 1
        candidate = base_dir / f"{base_name}-{counter}"
    return candidate


def artifact_status(path: Path) -> str:
    if path.name.startswith("suggestion-"):
        return "suggestion"
    if not path.name.startswith("run-"):
        return "unknown"
    generated_dir = path / "generated"
    metadata = read_json(path / "metadata.json", {}) or {}
    if metadata.get("status") == "failed":
        return "failed"
    if not generated_dir.exists() or not any(generated_dir.glob("*.json")):
        return "incomplete"
    if not (path / "validation_report.json").exists():
        return "incomplete"
    return "complete"


def list_artifacts(runs_dir: Path, *, complete_runs_only: bool = False) -> list[Path]:
    if not runs_dir.exists():
        return []
    folders = sorted([path for path in runs_dir.iterdir() if path.is_dir()], reverse=True)
    if complete_runs_only:
        return [path for path in folders if artifact_status(path) == "complete"]
    return folders


def select_artifacts_by_indices(artifacts: list[Path], indices: list[int], runs_dir: Path) -> list[Path]:
    selected = [artifacts[index] for index in indices]
    return [path for path in selected if _is_direct_child(path, runs_dir)]


def artifacts_older_than(artifacts: list[Path], cutoff_timestamp: float, runs_dir: Path) -> list[Path]:
    return [path for path in artifacts if _is_direct_child(path, runs_dir) and path.stat().st_mtime < cutoff_timestamp]


def artifacts_after_keeping_latest(artifacts: list[Path], keep_count: int, runs_dir: Path) -> list[Path]:
    if keep_count < 0:
        keep_count = 0
    ordered = sorted([path for path in artifacts if _is_direct_child(path, runs_dir)], key=lambda path: path.stat().st_mtime, reverse=True)
    return ordered[keep_count:]


def artifact_label(path: Path) -> str:
    status = artifact_status(path)
    if status == "complete":
        return f"{path.name} [complete]"
    return f"{path.name} [{status}]"


def _is_direct_child(path: Path, parent: Path) -> bool:
    try:
        return path.resolve().parent == parent.resolve() and path.is_dir()
    except OSError:
        return False


def _suggestion_summary_from_input_path(input_path: Path | None) -> str | None:
    if not input_path:
        return None
    suggestion_dir = input_path.parent
    if not suggestion_dir.name.startswith("suggestion-"):
        return None
    request = read_json(suggestion_dir / "suggestion_request.json", {}) or {}
    accepted = read_json(suggestion_dir / "accepted_suggestions.json", []) or []
    section = str(request.get("section") or "").strip()
    if not section:
        return None
    return suggestion_summary_slug(section, len(accepted), str(request.get("criteria") or ""))
