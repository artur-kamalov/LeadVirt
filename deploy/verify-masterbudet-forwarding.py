from pathlib import Path
import re
import sys


def require(condition: bool, message: str) -> None:
    if not condition:
        raise SystemExit(f"Master Budet forwarding verification failed: {message}")


def extract_unique_block(configuration: str, header: str) -> str:
    flexible_header = re.escape(header).replace(r"\ ", r"[ \t]+")
    pattern = re.compile(rf"(?m)^[ \t]*{flexible_header}[ \t]*\{{")
    matches = list(pattern.finditer(configuration))
    require(
        len(matches) == 1,
        f"{header} block must occur exactly once (found {len(matches)})",
    )

    opening_brace = matches[0].end() - 1
    depth = 0
    quote: str | None = None
    escaped = False
    in_comment = False

    for index in range(opening_brace, len(configuration)):
        character = configuration[index]
        if in_comment:
            if character == "\n":
                in_comment = False
            continue
        if quote is not None:
            if escaped:
                escaped = False
            elif character == "\\":
                escaped = True
            elif character == quote:
                quote = None
            continue
        if character == "#":
            in_comment = True
        elif character in {'"', "'"}:
            quote = character
        elif character == "{":
            depth += 1
        elif character == "}":
            depth -= 1
            if depth == 0:
                return configuration[opening_brace + 1 : index]

    require(False, f"{header} block is not closed")
    return ""


configuration_argument = sys.argv[1] if len(sys.argv) > 1 else "deploy/nginx.https.conf"
configuration = (
    sys.stdin.read()
    if configuration_argument == "-"
    else Path(configuration_argument).read_text(encoding="utf-8")
)

server_marker = "    server_name masterbudet.ru;"
require(configuration.count(server_marker) == 1, "apex HTTPS server must be unique")
server_marker_index = configuration.index(server_marker)
server_start = configuration.rfind("\n  server {", 0, server_marker_index)
server_end = configuration.find("\n  server {", server_marker_index)
require(server_start >= 0 and server_end > server_start, "apex HTTPS server is malformed")
server_block = configuration[server_start:server_end]

require(
    "$proxy_add_x_forwarded_for" not in server_block,
    "the Master Budet server must not append client-supplied forwarding chains",
)
require(
    re.search(r"(?m)^\s*limit_(?:req|conn)\b", server_block) is None,
    "new outer request/connection limits are outside this one-hop patch",
)

expected_locations = {
    "location = /health": "proxy_pass $masterbudet_backend;",
    "location /api/": "proxy_pass $masterbudet_backend;",
    "location /uploads/": "proxy_pass $masterbudet_backend;",
    "location /": "proxy_pass $masterbudet_frontend;",
}

for header, expected_proxy in expected_locations.items():
    location = extract_unique_block(server_block, header)
    directives = [
        line.strip()
        for line in location.splitlines()
        if line.strip() and not line.lstrip().startswith("#")
    ]
    for directive in (
        expected_proxy,
        "proxy_set_header X-Real-IP $remote_addr;",
        "proxy_set_header X-Forwarded-For $remote_addr;",
        "proxy_set_header X-Forwarded-Proto https;",
    ):
        require(
            directives.count(directive) == 1,
            f"{header} must contain exactly one `{directive}`",
        )
    forwarded_directives = [
        directive
        for directive in directives
        if directive.startswith("proxy_set_header X-Forwarded-For ")
    ]
    require(
        forwarded_directives == ["proxy_set_header X-Forwarded-For $remote_addr;"],
        f"{header} has an unexpected forwarding directive",
    )

require(
    server_block.count("proxy_set_header X-Forwarded-For $remote_addr;") == 4,
    "the four current Master Budet proxy locations must each replace X-Forwarded-For",
)
require(
    len(re.findall(r"(?m)^\s*proxy_pass \$masterbudet_(?:backend|frontend);\s*$", server_block))
    == 4,
    "the current Master Budet server must retain exactly four application proxies",
)

print("Master Budet one-hop forwarding replacement verified across four proxy locations.")
