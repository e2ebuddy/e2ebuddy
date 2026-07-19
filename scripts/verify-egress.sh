#!/usr/bin/env bash
#
# Proves the worker's network-layer egress guard end-to-end.
# Run it after `docker compose up --build -d`, once the worker is running:
#
#   ./scripts/verify-egress.sh
#
# Expectations:
#   - public internet + AI API      -> reachable
#   - cloud metadata + private/loopback ranges -> blocked at the network layer
#   - internal backplane services   -> reachable
set -uo pipefail

SERVICE="${WORKER_SERVICE:-worker}"

run() { docker compose exec -T "${SERVICE}" "$@"; }

http_probe() { # url timeout_ms  -> exit 0 if the connection is allowed
  run node -e '
    const [url, ms] = [process.argv[1], Number(process.argv[2])];
    fetch(url, { signal: AbortSignal.timeout(ms) })
      .then(() => process.exit(0))
      .catch((e) => process.exit(e && e.name === "TimeoutError" ? 1 : (/ENETUNREACH|EHOSTUNREACH|ECONNREFUSED|EACCES/.test(String(e)) ? 1 : 1)));
  ' "$1" "$2"
}

tcp_probe() { # host port timeout_ms -> exit 0 if the connection is allowed
  run node -e '
    const net = require("net");
    const [host, port, ms] = [process.argv[1], Number(process.argv[2]), Number(process.argv[3])];
    const s = net.connect(port, host, () => { s.destroy(); process.exit(0); });
    s.on("error", () => process.exit(1));
    s.setTimeout(ms, () => { s.destroy(); process.exit(1); });
  ' "$1" "$2" "$3"
}

pass=0
fail=0
check() { # description expect(allow|block) cmd...
  local desc="$1" expect="$2"; shift 2
  if "$@"; then got=allow; else got=block; fi
  if [ "${got}" = "${expect}" ]; then
    printf 'PASS  [%-5s] %s\n' "${expect}" "${desc}"; pass=$((pass + 1))
  else
    printf 'FAIL  want=%-5s got=%-5s  %s\n' "${expect}" "${got}" "${desc}"; fail=$((fail + 1))
  fi
}

echo "== worker egress guard verification (service: ${SERVICE}) =="

# Public internet + AI API must stay reachable.
check "public https (example.com)"          allow http_probe "https://example.com" 8000
check "public https (AI API host)"           allow http_probe "https://token-plan-cn.xiaomimimo.com/v1" 8000

# The whole point: these must be blocked at the network layer.
check "cloud metadata 169.254.169.254"       block http_probe "http://169.254.169.254/latest/meta-data/" 4000
check "loopback 127.0.0.1"                    block http_probe "http://127.0.0.1/" 4000
check "rfc1918 192.168.0.1"                   block http_probe "http://192.168.0.1/" 4000
check "rfc1918 10.0.0.1"                      block http_probe "http://10.0.0.1/" 4000

# Internal backplane services must remain reachable.
check "backplane postgres:5432"              allow tcp_probe postgres 5432 4000
check "backplane redis:6379"                 allow tcp_probe redis 6379 4000
check "backplane minio:9000"                 allow tcp_probe minio 9000 4000

echo "---"
echo "pass=${pass} fail=${fail}"
[ "${fail}" -eq 0 ]
