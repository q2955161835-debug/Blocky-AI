"""Read-only validation for the local ComfyUI MCP profile."""

from __future__ import annotations

import argparse
import json
import pathlib
import sys
import urllib.error
import urllib.parse
import urllib.request


def item(status: str, detail: str) -> dict[str, str]:
    return {"status": status, "detail": detail}


def validate(profile: dict, skip_server: bool) -> tuple[dict, int]:
    checks: dict[str, dict[str, str]] = {}

    for key in ("project_root", "output_dir"):
        path = pathlib.Path(profile.get(key, ""))
        checks[key] = item("pass", str(path)) if path.is_dir() else item("fail", f"missing directory: {path}")

    for key in ("python", "comfy_bin", "mcp_bin"):
        path = pathlib.Path(profile.get(key, ""))
        checks[key] = item("pass", str(path)) if path.is_file() else item("fail", f"missing file: {path}")

    parsed = urllib.parse.urlparse(profile.get("local_url", ""))
    loopback = parsed.scheme == "http" and parsed.hostname in {"127.0.0.1", "localhost", "::1"}
    checks["local_url"] = item("pass", profile.get("local_url", "")) if loopback else item(
        "fail", "local_url must be an http loopback address"
    )

    telemetry_off = profile.get("telemetry") is False
    checks["telemetry"] = item("pass", "disabled") if telemetry_off else item("fail", "telemetry must be false")

    if skip_server:
        checks["server"] = item("skipped", "server probe disabled")
    elif loopback:
        url = profile["local_url"].rstrip("/") + "/system_stats"
        try:
            with urllib.request.urlopen(url, timeout=3) as response:
                checks["server"] = item("pass", f"HTTP {response.status} from {url}")
        except (OSError, urllib.error.URLError) as exc:
            checks["server"] = item("fail", f"unreachable: {exc}")
    else:
        checks["server"] = item("fail", "not probed because local_url is invalid")

    ready = all(check["status"] in {"pass", "skipped"} for check in checks.values())
    return {"ready": ready, "checks": checks}, 0 if ready else 1


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--profile", required=True, type=pathlib.Path)
    parser.add_argument("--skip-server", action="store_true")
    args = parser.parse_args()

    try:
        profile = json.loads(args.profile.read_text(encoding="utf-8"))
        report, code = validate(profile, args.skip_server)
    except (OSError, json.JSONDecodeError) as exc:
        report, code = {"ready": False, "error": str(exc)}, 2
    json.dump(report, sys.stdout, ensure_ascii=False, indent=2)
    sys.stdout.write("\n")
    return code


if __name__ == "__main__":
    raise SystemExit(main())
