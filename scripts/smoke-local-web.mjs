#!/usr/bin/env node
/**
 * Smoke test for local web runtime (no Redis).
 * Starts e2ebuddy web, checks health / static / runs list, optional demo POST.
 *
 * Usage (from repo root):
 *   node scripts/smoke-local-web.mjs
 */
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.env.SMOKE_PORT ?? 6559);
const host = '127.0.0.1';
const base = `http://${host}:${port}`;

function fail(message) {
  console.error(`smoke FAIL: ${message}`);
  process.exitCode = 1;
}

async function waitForHealth(timeoutMs = 15_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const response = await fetch(`${base}/api/health`);
      if (response.ok) return response.json();
    } catch {
      // retry
    }
    await sleep(200);
  }
  throw new Error('health endpoint did not become ready');
}

const child = spawn(
  process.execPath,
  [path.join(root, 'packages/cli/dist/cli.js'), 'web', '--no-open', '--host', host, '--port', String(port)],
  {
    cwd: root,
    env: {
      ...process.env,
      // Prefer demo for fast smoke unless caller forces brain.
      E2EBUDDY_PIPELINE: process.env.E2EBUDDY_PIPELINE ?? 'demo',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  },
);

let stdout = '';
child.stdout.on('data', (chunk) => {
  stdout += chunk.toString('utf8');
});
child.stderr.on('data', (chunk) => {
  process.stderr.write(chunk);
});

try {
  const health = await waitForHealth();
  if (!health.ok) fail(`health.ok is false: ${JSON.stringify(health)}`);
  if (health.redis !== false) fail('health.redis must be false');
  if (health.persistence !== 'json-file') fail(`unexpected persistence: ${health.persistence}`);
  console.log('✓ health', health.pipeline, health.persistence);

  const index = await fetch(`${base}/`);
  const html = await index.text();
  if (!index.ok) fail(`GET / status ${index.status}`);
  if (!html.includes('e2ebuddy') || !html.includes('root')) {
    fail('GET / missing e2ebuddy or root');
  }
  console.log('✓ static index');

  const runsResponse = await fetch(`${base}/api/runs`);
  const runsBody = await runsResponse.json();
  if (!runsResponse.ok || !Array.isArray(runsBody.runs)) fail('GET /api/runs failed');
  console.log('✓ runs list', runsBody.runs.length);

  const create = await fetch(`${base}/api/runs`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ targetUrl: 'https://example.com', userBrief: 'smoke' }),
  });
  const created = await create.json();
  if (create.status !== 201 || !created.id) fail(`POST /api/runs failed: ${JSON.stringify(created)}`);
  console.log('✓ create run', created.id);

  // Wait for demo completion (brain runs are much longer — skip deep wait unless demo).
  if ((process.env.E2EBUDDY_PIPELINE ?? 'demo') === 'demo') {
    let status = created.status;
    for (let i = 0; i < 40 && !['completed', 'failed', 'cancelled'].includes(status); i += 1) {
      await sleep(100);
      const detail = await (await fetch(`${base}/api/runs/${created.id}`)).json();
      status = detail.status;
    }
    if (status !== 'completed') fail(`demo run did not complete, status=${status}`);
    console.log('✓ demo run completed');
  }

  console.log('smoke OK');
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
} finally {
  child.kill('SIGTERM');
  await sleep(300);
  if (!child.killed) child.kill('SIGKILL');
}
