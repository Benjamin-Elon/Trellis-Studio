from __future__ import annotations

import json
import re  # NEW: sanitize secrets embedded in URLs and provider messages.
from pathlib import Path
from typing import Any
from urllib.parse import quote, quote_plus  # NEW

_active_secrets: set[str] = set()  # NEW: include keys loaded from encrypted storage, not only environment variables.


def register_secret(value: str) -> None:
    """Remember active credentials only in memory so free-text errors can be sanitized."""  # NEW
    if value and value != "DEMO_KEY":
        _active_secrets.add(value)


def is_secret_field(key: str) -> bool:
    """Recognize legacy credential fields without removing ordinary model settings."""  # NEW
    normalized = re.sub(r"[^a-z0-9]", "", str(key).lower())
    return any(part in normalized for part in ("authorization", "apikey", "secret")) or normalized in {"password", "accesstoken", "refreshtoken"}


def strip_secret_fields(value: Any) -> Any:
    """Return a secret-free settings copy; leave the caller's configuration untouched."""  # NEW
    if isinstance(value, dict):
        return {key: strip_secret_fields(item) for key, item in value.items() if not is_secret_field(key)}
    if isinstance(value, list):
        return [strip_secret_fields(item) for item in value]
    return value


def read_json(path: Path, default: Any = None) -> Any:
    if not path.exists():
        return default
    with path.open("r", encoding="utf-8") as f:
        return json.load(f)


def write_json(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as f:
        json.dump(redact_secrets(data), f, indent=2, sort_keys=True)  # CHANGE: all seeder artifacts pass the same redaction boundary.
        f.write("\n")


def redact_secrets(value: Any, secrets: tuple[str, ...] = ()) -> Any:  # CHANGE: providers can supply their actual in-memory credential.
    """Redact structured fields and embedded credentials while retaining useful diagnostics."""  # NEW
    if isinstance(value, dict):
        out = {}
        for key, item in value.items():
            if is_secret_field(key):  # CHANGE
                out[key] = "[REDACTED]"
            else:
                out[key] = redact_secrets(item, secrets)  # CHANGE
        return out
    if isinstance(value, list):
        return [redact_secrets(item, secrets) for item in value]  # CHANGE
    if isinstance(value, str):  # NEW
        for secret in sorted(_active_secrets | set(secrets), key=len, reverse=True):
            if secret and secret != "DEMO_KEY":
                for encoded in {secret, quote(secret, safe=""), quote_plus(secret)}:
                    value = value.replace(encoded, "[REDACTED]")
        value = re.sub(r"(?i)((?:api[_%-]*(?:5f)?key|apikey|access_token|secret)(?:=|%3d))[^&\s\"'<>]+", r"\1[REDACTED]", value)
        value = re.sub(r"(?i)(\b(?:Bearer|Basic)\s+)[A-Za-z0-9_+.~/-]+={0,2}", r"\1[REDACTED]", value)
        value = re.sub(r"\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{20,}", "[REDACTED]", value)
    return value

