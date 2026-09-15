from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from trellis_seed.config import DEFAULT_CONFIG_PATH, load_settings
from trellis_seed.generic_varieties import replace_database_varieties_with_generic_profiles


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Replace Trellis cultivar rows with deterministic generic maturity profiles.")
    parser.add_argument("--config", type=Path, default=DEFAULT_CONFIG_PATH, help="Trellis seed config path.")
    parser.add_argument("--db", action="append", type=Path, default=[], help="Explicit database path. May be passed more than once.")
    parser.add_argument("--config-targets", action="store_true", help="Use configured packaged/live database targets.")
    args = parser.parse_args(argv)

    settings = load_settings(args.config)
    targets = list(args.db)
    if args.config_targets or not targets:
        targets.extend(settings.apply_db_paths)
    reports = []
    for target in _unique_paths(targets):
        reports.append(replace_database_varieties_with_generic_profiles(target))
    print(json.dumps({"targets": reports}, indent=2, sort_keys=True))
    return 0


def _unique_paths(paths: list[Path]) -> list[Path]:
    seen: set[str] = set()
    unique: list[Path] = []
    for path in paths:
        resolved = path.resolve()
        key = str(resolved).casefold()
        if key in seen:
            continue
        seen.add(key)
        unique.append(resolved)
    return unique


if __name__ == "__main__":
    sys.exit(main())
