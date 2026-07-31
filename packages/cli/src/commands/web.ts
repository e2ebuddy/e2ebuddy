import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { ensureUserDataDirectories } from '../lib/paths.js';
import { openBrowser } from '../lib/open-browser.js';
import { resolveListenAddress } from '../lib/port.js';
import { startLocalRuntime } from '../runtime/server.js';

function resolveStaticDirectory(): string | undefined {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    // Packaged next to dist/cli.js (npm publish path)
    path.resolve(here, 'web'),
    path.resolve(here, '../web'),
    path.resolve(here, '../../../apps/local-web/dist'),
    path.resolve(process.cwd(), 'apps/local-web/dist'),
    path.resolve(process.cwd(), '../../apps/local-web/dist'),
  ];
  for (const candidate of candidates) {
    if (existsSync(path.join(candidate, 'index.html'))) return candidate;
  }
  return undefined;
}

export type WebCommandOptions = {
  host: string;
  port: number;
  open: boolean;
};

function parsePositiveInt(value: string | undefined, fallback: number): number {
  if (value === undefined || value.trim().length === 0) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 65_535) {
    throw new Error(`Invalid port: ${value}`);
  }
  return parsed;
}

export function parseWebOptions(arguments_: readonly string[]): WebCommandOptions {
  let host = process.env.E2EBUDDY_WEB_HOST?.trim() || '127.0.0.1';
  let port = parsePositiveInt(process.env.E2EBUDDY_WEB_PORT, 6558);
  let open = true;

  for (let index = 0; index < arguments_.length; index += 1) {
    const arg = arguments_[index];
    if (arg === '--help' || arg === '-h') {
      printWebHelp();
      process.exitCode = 0;
      throw new WebHelpPrinted();
    }
    if (arg === '--no-open') {
      open = false;
      continue;
    }
    if (arg === '--host') {
      const value = arguments_[index + 1];
      if (value === undefined) throw new Error('--host requires a value');
      host = value;
      index += 1;
      continue;
    }
    if (arg?.startsWith('--host=')) {
      host = arg.slice('--host='.length);
      continue;
    }
    if (arg === '--port') {
      const value = arguments_[index + 1];
      if (value === undefined) throw new Error('--port requires a value');
      port = parsePositiveInt(value, port);
      index += 1;
      continue;
    }
    if (arg?.startsWith('--port=')) {
      port = parsePositiveInt(arg.slice('--port='.length), port);
      continue;
    }
    throw new Error(`Unknown web option: ${arg}`);
  }

  return { host, port, open };
}

export class WebHelpPrinted extends Error {
  constructor() {
    super('help printed');
    this.name = 'WebHelpPrinted';
  }
}

export function printWebHelp(): void {
  process.stdout.write(`e2ebuddy web

Start the local Web UI (single Node process, no Redis/Docker).

Usage:
  e2ebuddy web [options]

Options:
  --host <host>   Bind address (default: 127.0.0.1 or E2EBUDDY_WEB_HOST)
  --port <port>   Preferred port (default: 6558 or E2EBUDDY_WEB_PORT)
  --no-open       Do not open the default browser
  -h, --help      Show this help

Notes:
  If the preferred port is busy, e2ebuddy picks the next free port and prints the URL.
`);
}

/** Start the local web runtime and keep the process alive until signal. */
export async function runWeb(options: WebCommandOptions): Promise<void> {
  const layout = await ensureUserDataDirectories();
  const listen = await resolveListenAddress({ host: options.host, port: options.port });

  const staticDirectory = resolveStaticDirectory();
  const runtime = await startLocalRuntime({
    host: listen.host,
    port: listen.port,
    layout,
    staticDirectory,
  });

  const { resolvePipelineMode } = await import('../runtime/pipeline.js');
  process.stdout.write(`e2ebuddy web\n`);
  process.stdout.write(`  URL:      ${runtime.url}\n`);
  process.stdout.write(`  data:     ${layout.root}\n`);
  process.stdout.write(`  storage:  ${layout.storage}\n`);
  process.stdout.write(`  db:       ${layout.db}\n`);
  process.stdout.write(`  ui:       ${staticDirectory ?? 'placeholder (build apps/local-web)'}\n`);
  process.stdout.write(`  pipeline: ${resolvePipelineMode()}\n`);
  process.stdout.write(`  redis:    disabled (local runtime)\n`);
  if (listen.port !== options.port) {
    process.stdout.write(
      `  note:     preferred port ${options.port} was busy; using ${listen.port}\n`,
    );
  }
  process.stdout.write(`  stop:     Ctrl+C\n`);

  if (options.open) {
    openBrowser(runtime.url);
  }

  await new Promise<void>((resolve) => {
    const shutdown = () => {
      process.stdout.write('\nShutting down…\n');
      void runtime.close().finally(() => resolve());
    };
    process.once('SIGINT', shutdown);
    process.once('SIGTERM', shutdown);
  });
}
