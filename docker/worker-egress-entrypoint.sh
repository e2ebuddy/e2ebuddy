#!/usr/bin/env bash
#
# Network-layer egress guard for the production worker.
#
# The worker drives a real browser against untrusted, user-supplied URLs. The
# application layer (packages/executor/src/url-safety.ts) already rejects unsafe
# targets, but DNS rebinding / TOCTOU means the packet that finally leaves the
# box can still point at a private or cloud-metadata address. This entrypoint
# installs an nftables policy in the container's OWN network namespace as a
# final, kernel-enforced defence. Because the rules live inside the container
# netns, they can never touch the host's or another container's networking.
#
# The worker still needs its internal backplane (Postgres/Redis/MinIO) and the
# public internet (target sites + AI API), so we allow the backplane subnet and
# the public internet, and drop everything private/loopback/link-local/metadata.
#
# WORKER_EGRESS_FIREWALL:
#   enforce  (default) apply the policy; abort startup if it cannot be applied
#   warn     apply if possible, otherwise start anyway and log a warning
#   disabled skip the policy entirely (app-layer guard only)
# BACKPLANE_CIDR: the internal service subnet to allow (default 10.31.7.0/24)
set -euo pipefail

MODE="${WORKER_EGRESS_FIREWALL:-enforce}"
BACKPLANE_CIDR="${BACKPLANE_CIDR:-10.31.7.0/24}"

apply_rules() {
  nft -f - <<EOF
table inet egress_guard {
  chain output {
    type filter hook output priority filter; policy accept;

    # Container-local traffic, including Docker's embedded DNS at 127.0.0.11.
    oifname "lo" accept

    # Internal backplane services (Postgres/Redis/MinIO) live here.
    ip daddr ${BACKPLANE_CIDR} accept

    # Cloud metadata endpoint — called out explicitly as the highest-value target.
    ip daddr 169.254.169.254 drop

    # Loopback, RFC1918, CGNAT, link-local, benchmark/doc, multicast, reserved.
    ip daddr {
      0.0.0.0/8, 10.0.0.0/8, 100.64.0.0/10, 127.0.0.0/8, 169.254.0.0/16,
      172.16.0.0/12, 192.0.0.0/24, 192.0.2.0/24, 192.168.0.0/16,
      198.18.0.0/15, 198.51.100.0/24, 203.0.113.0/24, 224.0.0.0/4, 240.0.0.0/4
    } drop

    # IPv6 loopback, unique-local, link-local, multicast, documentation.
    ip6 daddr { ::1/128, fc00::/7, fe80::/10, ff00::/8, 2001:db8::/32 } drop
  }
}
EOF
}

install_guard() {
  nft delete table inet egress_guard 2>/dev/null || true
  apply_rules
}

case "${MODE}" in
  enforce)
    if install_guard; then
      echo "[egress-guard] enforced; backplane allowed: ${BACKPLANE_CIDR}"
    else
      echo "[egress-guard] FATAL: could not install nftables policy (need NET_ADMIN + nftables) while WORKER_EGRESS_FIREWALL=enforce" >&2
      exit 1
    fi
    ;;
  warn)
    if install_guard; then
      echo "[egress-guard] enforced (warn mode); backplane allowed: ${BACKPLANE_CIDR}"
    else
      echo "[egress-guard] WARNING: nftables policy not applied; relying on app-layer guard only" >&2
    fi
    ;;
  disabled)
    echo "[egress-guard] disabled by WORKER_EGRESS_FIREWALL=disabled; app-layer guard only" >&2
    ;;
  *)
    echo "[egress-guard] FATAL: unknown WORKER_EGRESS_FIREWALL='${MODE}' (expected enforce|warn|disabled)" >&2
    exit 1
    ;;
esac

exec "$@"
