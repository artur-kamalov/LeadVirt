from pathlib import Path
import re
import sys


def require(condition: bool, message: str) -> None:
    if not condition:
        raise SystemExit(f"Master Budet shared-edge verification failed: {message}")


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


def normalized_directives(block: str) -> list[str]:
    return [
        line.strip()
        for line in block.splitlines()
        if line.strip() and not line.lstrip().startswith("#")
    ]


configuration_argument = sys.argv[1] if len(sys.argv) > 1 else "deploy/nginx.https.conf"
configuration_path = Path(configuration_argument)
configuration = (
    sys.stdin.read()
    if configuration_argument == "-"
    else configuration_path.read_text(encoding="utf-8")
)
server_marker = "    server_name masterbudet.ru;"
server_marker_index = configuration.find(server_marker)

require(server_marker_index >= 0, "apex HTTPS server is missing")

server_start = configuration.rfind("\n  server {", 0, server_marker_index)
server_end = configuration.find("\n  server {", server_marker_index)
require(server_start >= 0 and server_end > server_start, "apex HTTPS server block is malformed")

server_block = configuration[server_start:server_end]
zone = "limit_req_zone $binary_remote_addr zone=masterbudet_customer_lookup:10m rate=12r/m;"
require(zone in configuration, "client-IP lookup rate zone is missing")
upload_map = "map $request_method $masterbudet_public_upload_key {"
require(configuration.count(upload_map) == 1, "public upload key map is not unique")
upload_map_start = configuration.find(upload_map)
upload_map_end = configuration.find("\n  }", upload_map_start)
require(
    upload_map_start >= 0 and upload_map_end > upload_map_start,
    "method-scoped public upload key map is missing",
)
upload_map_block = configuration[upload_map_start:upload_map_end]
require(
    [line.strip() for line in upload_map_block.splitlines()]
    == [upload_map, 'default "";', "POST $binary_remote_addr;"],
    "public upload key map must contain only the empty default and POST client IP",
)
upload_zone = "limit_req_zone $masterbudet_public_upload_key zone=masterbudet_public_upload:10m rate=1r/m;"
require(upload_zone in configuration, "client-IP public upload rate zone is missing")
require(configuration.count(upload_zone) == 1, "public upload rate zone is not unique")
auth_map_header = "map $request_method $masterbudet_customer_phone_auth_key"
auth_map = extract_unique_block(configuration, auth_map_header)
require(
    normalized_directives(auth_map) == ['default "";', "POST $binary_remote_addr;"],
    "customer auth key map must disable every method except POST and use the edge-observed IP",
)
auth_zone = (
    "limit_req_zone $masterbudet_customer_phone_auth_key "
    "zone=masterbudet_customer_phone_auth:10m rate=30r/m;"
)
require(configuration.count(auth_zone) == 1, "customer auth rate zone is not unique")
require(
    configuration.count("zone=masterbudet_customer_phone_auth") == 4,
    "customer auth zone must have one definition and three exact-route uses",
)
require(
    configuration.count("limit_req zone=masterbudet_customer_phone_auth") == 3,
    "customer auth limiter must occur only on the three exact OTP routes",
)
require(
    "error_page 429 = @masterbudet_customer_lookup_rate_limited;" in server_block,
    "stable lookup 429 handler is missing",
)
handler_marker = "    location @masterbudet_customer_lookup_rate_limited {"
handler_start = server_block.find(handler_marker)
handler_end = server_block.find("\n    }", handler_start)
require(handler_start >= 0 and handler_end > handler_start, "named lookup 429 location is missing")
handler_block = server_block[handler_start:handler_end]
require(
    "default_type application/json;" in handler_block,
    "lookup 429 content type is not JSON",
)
require(
    "add_header Retry-After 5 always;" in handler_block,
    "lookup 429 Retry-After header is missing",
)
require(
    "return 429 " in handler_block,
    "named lookup handler does not return status 429",
)
require(
    '"statusCode":429' in handler_block
    and '"code":"CUSTOMER_LOOKUP_RATE_LIMITED"' in handler_block
    and '"retryAfterSeconds":5' in handler_block,
    "stable lookup 429 JSON contract is incomplete",
)
upload_handler_marker = "    location @masterbudet_public_upload_rate_limited {"
require(configuration.count(upload_handler_marker) == 1, "public upload 429 handler is not unique")
upload_handler_start = server_block.find(upload_handler_marker)
upload_handler_end = server_block.find("\n    }", upload_handler_start)
require(
    upload_handler_start >= 0 and upload_handler_end > upload_handler_start,
    "named public upload 429 location is missing",
)
upload_handler_block = server_block[upload_handler_start:upload_handler_end]
require(
    "default_type application/json;" in upload_handler_block,
    "public upload 429 content type is not JSON",
)
require(
    "add_header Retry-After 60 always;" in upload_handler_block,
    "public upload 429 Retry-After header is missing",
)
require(
    "return 429 " in upload_handler_block,
    "named public upload handler does not return status 429",
)
require(
    '"statusCode":429' in upload_handler_block
    and '"code":"PUBLIC_UPLOAD_RATE_LIMITED"' in upload_handler_block
    and '"retryAfterSeconds":60' in upload_handler_block,
    "stable public upload 429 JSON contract is incomplete",
)
auth_handler_header = "location @masterbudet_customer_phone_auth_rate_limited"
auth_handler = extract_unique_block(server_block, auth_handler_header)
auth_rate_response = (
    "return 429 "
    "'{\"statusCode\":429,\"code\":\"CUSTOMER_AUTH_RATE_LIMITED\","
    "\"message\":\"Too many authentication attempts. Try again shortly.\","
    "\"retryAfterSeconds\":2}';"
)
require(
    normalized_directives(auth_handler)
    == [
        "default_type application/json;",
        'add_header Cache-Control "no-store" always;',
        "add_header Retry-After 2 always;",
        auth_rate_response,
    ],
    "customer auth 429 handler must contain only the stable no-store JSON response and Retry-After contract",
)
require(
    configuration.count("@masterbudet_customer_phone_auth_rate_limited") == 4,
    "customer auth 429 handler must have one location and exactly three route references",
)
upload_size_handler_marker = "    location @masterbudet_public_upload_too_large {"
require(configuration.count(upload_size_handler_marker) == 1, "public upload 413 handler is not unique")
upload_size_handler_start = server_block.find(upload_size_handler_marker)
upload_size_handler_end = server_block.find("\n    }", upload_size_handler_start)
require(
    upload_size_handler_start >= 0 and upload_size_handler_end > upload_size_handler_start,
    "named public upload 413 location is missing",
)
upload_size_handler_block = server_block[upload_size_handler_start:upload_size_handler_end]
require(
    "default_type application/json;" in upload_size_handler_block,
    "public upload 413 content type is not JSON",
)
require(
    "return 413 " in upload_size_handler_block
    and '"statusCode":413' in upload_size_handler_block
    and '"code":"PUBLIC_UPLOAD_TOO_LARGE"' in upload_size_handler_block
    and '"message":"Photo file must be no larger than 5 MB."' in upload_size_handler_block
    and '"maxFileSizeBytes":5242880' in upload_size_handler_block,
    "stable public upload 413 JSON contract is incomplete",
)
require(
    "proxy_set_header X-Forwarded-For $remote_addr;" in server_block,
    "trusted client IP is not forwarded from the direct edge",
)
require(
    "$proxy_add_x_forwarded_for" not in server_block,
    "untrusted inbound X-Forwarded-For is appended inside the Master Budet server",
)

generic_api_index = server_block.find("    location /api/ {")
require(generic_api_index >= 0, "generic API proxy is missing")

for location in (
    "    location = /api/v1/orders/lookup {",
    "    location ^~ /api/v1/orders/ {",
    "    location ^~ /api/v1/client/ {",
):
    start = server_block.find(location)
    end = server_block.find("\n    }", start)
    require(start >= 0 and end > start, f"protected location is missing: {location.strip()}")
    require(start < generic_api_index, f"protected location follows generic proxy: {location.strip()}")
    location_block = server_block[start:end]
    require(
        "limit_req zone=masterbudet_customer_lookup burst=4 nodelay;" in location_block,
        f"lookup limiter is missing: {location.strip()}",
    )
    require("limit_req_status 429;" in location_block, f"429 status is missing: {location.strip()}")

auth_routes = (
    "/api/v1/auth/customer/otp/request",
    "/api/v1/auth/customer/otp/verify/web",
    "/api/v1/auth/customer/otp/verify/mobile",
)
auth_directives = [
    "limit_req zone=masterbudet_customer_phone_auth burst=10 nodelay;",
    "limit_req_status 429;",
    "error_page 429 = @masterbudet_customer_phone_auth_rate_limited;",
    "proxy_pass $masterbudet_backend;",
    "proxy_http_version 1.1;",
    "proxy_set_header Host $host;",
    "proxy_set_header X-Real-IP $remote_addr;",
    "proxy_set_header X-Forwarded-For $remote_addr;",
    "proxy_set_header X-Forwarded-Proto https;",
]
for route in auth_routes:
    header = f"location = {route}"
    require(
        configuration.count(f"{header} {{") == 1,
        f"exact customer auth route is not globally unique: {route}",
    )
    block = extract_unique_block(server_block, header)
    start = server_block.find(f"    {header} {{")
    require(0 <= start < generic_api_index, f"exact customer auth route follows generic proxy: {route}")
    require(
        normalized_directives(block) == auth_directives,
        f"exact customer auth route has non-canonical directives: {route}",
    )

explicit_auth_locations = re.findall(
    r"(?m)^[ \t]*location[ \t]+([^\n{]*?/api/v1/auth/customer/otp[^\n{]*)[ \t]*\{",
    configuration,
)
require(
    sorted(item.strip() for item in explicit_auth_locations)
    == sorted(f"= {route}" for route in auth_routes),
    "only the three case-sensitive, trailing-slash-sensitive exact OTP locations are allowed",
)

upload_location = "    location = /api/v1/uploads/order-photos {"
require(configuration.count(upload_location) == 1, "public upload location is not unique")
upload_start = server_block.find(upload_location)
upload_end = server_block.find("\n    }", upload_start)
require(upload_start >= 0 and upload_end > upload_start, "public upload location is missing")
require(upload_start < generic_api_index, "public upload location follows generic proxy")
upload_block = server_block[upload_start:upload_end]
require("client_max_body_size 6m;" in upload_block, "public upload body limit is missing")
require(configuration.count("client_max_body_size 6m;") == 1, "public upload body limit escaped its scope")
require(
    "limit_req zone=masterbudet_public_upload burst=7 nodelay;" in upload_block,
    "public upload limiter is missing",
)
require(
    configuration.count("limit_req zone=masterbudet_public_upload burst=7 nodelay;") == 1,
    "public upload limiter escaped its scope",
)
require(
    configuration.count("limit_req zone=masterbudet_public_upload") == 1,
    "a public upload limiter variant escaped into another scope",
)
require("limit_req_status 429;" in upload_block, "public upload 429 status is missing")
require(
    "error_page 429 = @masterbudet_public_upload_rate_limited;" in upload_block,
    "public upload-specific 429 handler is missing",
)
require(
    configuration.count("error_page 429 = @masterbudet_public_upload_rate_limited;") == 1,
    "public upload-specific 429 handler escaped its scope",
)
require(
    "error_page 413 = @masterbudet_public_upload_too_large;" in upload_block,
    "public upload-specific 413 handler is missing",
)
require(
    configuration.count("error_page 413 = @masterbudet_public_upload_too_large;") == 1,
    "public upload-specific 413 handler escaped its scope",
)
require("proxy_pass $masterbudet_backend;" in upload_block, "public upload proxy is missing")
require(
    "proxy_set_header X-Forwarded-For $remote_addr;" in upload_block,
    "public upload does not overwrite inbound X-Forwarded-For",
)
trailing_upload_location = "    location = /api/v1/uploads/order-photos/ {"
require(
    configuration.count(trailing_upload_location) == 1,
    "trailing-slash public upload rejection is not unique",
)
trailing_upload_start = server_block.find(trailing_upload_location)
trailing_upload_end = server_block.find("\n    }", trailing_upload_start)
require(
    trailing_upload_start >= 0 and trailing_upload_end > trailing_upload_start,
    "trailing-slash public upload rejection is missing",
)
trailing_upload_block = server_block[trailing_upload_start:trailing_upload_end]
require("return 404;" in trailing_upload_block, "trailing-slash public upload is not rejected")
generic_api_end = server_block.find("\n    }", generic_api_index)
generic_api_block = server_block[generic_api_index:generic_api_end]
require(
    "masterbudet_public_upload" not in generic_api_block
    and "client_max_body_size 6m;" not in generic_api_block
    and "masterbudet_customer_phone_auth" not in generic_api_block,
    "public upload or customer auth policy leaked into the generic Master Budet API proxy",
)

print("Master Budet shared-edge lookup, public upload, and customer auth throttles verified.")
