"""Read-only validation of saved MiniMax H3 workflows and model files."""

from __future__ import annotations

import argparse
import json
import pathlib
import sys


def resolve_inside(root: pathlib.Path, relative: str) -> pathlib.Path | None:
    candidate = (root / relative).resolve()
    try:
        candidate.relative_to(root.resolve())
    except ValueError:
        return None
    return candidate


def validate(profile: dict) -> tuple[dict, int]:
    root = pathlib.Path(profile.get("project_root", ""))
    root_ok = root.is_dir()
    workflow_checks = {}
    available_modes = []

    for mode, variants in profile.get("workflows", {}).items():
        missing = []
        checked = []
        for variant in ("standard", "spectrum"):
            relative = variants.get(variant)
            if not relative:
                continue
            path = resolve_inside(root, relative)
            checked.append(str(path) if path else relative)
            if path is None or not path.is_file():
                missing.append(relative)
        status = "pass" if root_ok and checked and not missing else "fail"
        workflow_checks[mode] = {"status": status, "paths": checked, "missing": missing}
        if status == "pass":
            available_modes.append(mode)

    model_checks = {}
    for name, relative in profile.get("models", {}).items():
        path = resolve_inside(root, relative)
        status = "pass" if root_ok and path is not None and path.is_file() else "fail"
        model_checks[name] = {"status": status, "path": str(path) if path else relative}

    ready = (
        root_ok
        and bool(workflow_checks)
        and bool(model_checks)
        and all(entry["status"] == "pass" for entry in workflow_checks.values())
        and all(entry["status"] == "pass" for entry in model_checks.values())
    )
    report = {
        "ready": ready,
        "project_root": {"status": "pass" if root_ok else "fail", "path": str(root)},
        "available_modes": sorted(available_modes),
        "workflows": workflow_checks,
        "models": model_checks,
        "limitations": profile.get("limitations", {}),
    }
    return report, 0 if ready else 1


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--profile", required=True, type=pathlib.Path)
    args = parser.parse_args()
    try:
        profile = json.loads(args.profile.read_text(encoding="utf-8"))
        report, code = validate(profile)
    except (OSError, json.JSONDecodeError) as exc:
        report, code = {"ready": False, "error": str(exc)}, 2
    json.dump(report, sys.stdout, ensure_ascii=False, indent=2)
    sys.stdout.write("\n")
    return code


if __name__ == "__main__":
    raise SystemExit(main())
