from pathlib import Path
import subprocess
import sys


ROOT = Path(__file__).resolve().parents[1]
CONFIGURATION_PATH = ROOT / "deploy" / "nginx.https.conf"
VERIFIER_PATH = ROOT / "deploy" / "verify-masterbudet-forwarding.py"
WORKFLOW_PATH = ROOT / ".github" / "workflows" / "deploy-leadvirt-com.yml"
ENABLE_SCRIPT_PATH = ROOT / "deploy" / "enable-leadvirt-com-https.sh"


def verify(configuration: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [sys.executable, str(VERIFIER_PATH), "-"],
        input=configuration,
        capture_output=True,
        check=False,
        encoding="utf-8",
    )


def changed(configuration: str, old: str, new: str, label: str) -> str:
    candidate = configuration.replace(old, new, 1)
    if candidate == configuration:
        raise AssertionError(f"mutation did not change configuration: {label}")
    return candidate


def main() -> int:
    configuration = CONFIGURATION_PATH.read_text(encoding="utf-8")
    valid = verify(configuration)
    if valid.returncode != 0:
        raise AssertionError(valid.stderr)

    trusted = "proxy_set_header X-Forwarded-For $remote_addr;"
    appended = "proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;"
    locations = ["health", "api", "uploads", "frontend"]
    mutations: list[tuple[str, str]] = []
    for index, location in enumerate(locations):
        start = -1
        for _ in range(index + 1):
            start = configuration.find(trusted, start + 1)
        if start < 0:
            raise AssertionError(f"trusted forwarding directive missing for {location}")
        candidate = configuration[:start] + appended + configuration[start + len(trusted) :]
        mutations.append((f"{location} appends inbound forwarding", candidate))

    mutations.extend(
        [
            (
                "forwarding directive is removed",
                changed(configuration, trusted, "", "forwarding directive is removed"),
            ),
            (
                "forwarding directive is duplicated",
                changed(
                    configuration,
                    trusted,
                    f"{trusted}\n      {trusted}",
                    "forwarding directive is duplicated",
                ),
            ),
            (
                "health route is widened",
                changed(
                    configuration,
                    "location = /health {",
                    "location /health {",
                    "health route is widened",
                ),
            ),
            (
                "backend proxy is redirected",
                changed(
                    configuration,
                    "proxy_pass $masterbudet_backend;",
                    "proxy_pass http://leadvirt_api;",
                    "backend proxy is redirected",
                ),
            ),
            (
                "outer limiter is added",
                changed(
                    configuration,
                    "location /api/ {",
                    "location /api/ {\n      limit_req zone=unreviewed;",
                    "outer limiter is added",
                ),
            ),
        ]
    )

    for label, candidate in mutations:
        result = verify(candidate)
        if result.returncode == 0:
            raise AssertionError(f"verifier accepted mutation: {label}")

    workflow = WORKFLOW_PATH.read_text(encoding="utf-8")
    for command in (
        "python3 deploy/test-masterbudet-forwarding.py",
        "python3 deploy/verify-masterbudet-forwarding.py deploy/nginx.https.conf",
    ):
        if workflow.count(command) != 1:
            raise AssertionError(f"workflow must invoke exactly once: {command}")

    enable_script = ENABLE_SCRIPT_PATH.read_text(encoding="utf-8")
    verify_command = (
        'python3 "$RELEASE_ROOT/deploy/verify-masterbudet-forwarding.py" \\\n'
        '  "$RELEASE_ROOT/deploy/nginx.https.conf"'
    )
    copy_command = (
        'cp "$RELEASE_ROOT/deploy/nginx.https.conf" '
        '"$RELEASE_ROOT/deploy/nginx.conf"'
    )
    if enable_script.count(verify_command) != 1:
        raise AssertionError("HTTPS enable script is missing the exact forwarding verifier")
    if enable_script.index(verify_command) > enable_script.index(copy_command):
        raise AssertionError("forwarding verification must precede the canonical config copy")

    print(f"Master Budet forwarding mutation probes passed: {len(mutations)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
