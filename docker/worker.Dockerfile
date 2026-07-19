FROM mcr.microsoft.com/playwright:v1.61.1-noble
WORKDIR /app
ENV NODE_ENV=production PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
# nftables backs the network-layer egress guard (see worker-egress-entrypoint.sh).
# Retry apt to tolerate intermittent upstream mirror failures (e.g. 502s).
RUN set -eux; \
    echo 'Acquire::Retries "8";' > /etc/apt/apt.conf.d/80-retries; \
    ok=0; \
    for i in $(seq 1 6); do \
      if apt-get update && apt-get install -y --no-install-recommends nftables; then ok=1; break; fi; \
      echo "apt attempt $i failed; retrying in 5s"; sleep 5; \
    done; \
    [ "$ok" = 1 ]; \
    nft --version; \
    rm -rf /var/lib/apt/lists/*
RUN corepack enable && corepack prepare pnpm@11.8.0 --activate
COPY . .
RUN pnpm install --frozen-lockfile && pnpm -F db db:generate && pnpm build
RUN cp docker/worker-egress-entrypoint.sh /usr/local/bin/worker-egress-entrypoint \
    && chmod +x /usr/local/bin/worker-egress-entrypoint
# The entrypoint installs a network-layer egress guard (see the script) and then
# execs CMD. Services that reuse this image but must skip the guard (e.g. the
# migrate job) set WORKER_EGRESS_FIREWALL=disabled.
ENTRYPOINT ["/usr/local/bin/worker-egress-entrypoint"]
CMD ["pnpm", "-F", "worker", "start"]
