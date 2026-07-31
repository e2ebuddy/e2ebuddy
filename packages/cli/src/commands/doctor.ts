import { createRequire } from 'node:module';
import { access, constants as fsConstants } from 'node:fs/promises';
import path from 'node:path';

import {
  ensureUserDataDirectories,
  isWritableDirectory,
  resolveUserDataLayout,
} from '../lib/paths.js';
import { isPortFree } from '../lib/port.js';

type CheckStatus = 'ok' | 'warn' | 'fail';

type CheckResult = {
  name: string;
  status: CheckStatus;
  detail: string;
};

function statusMark(status: CheckStatus): string {
  if (status === 'ok') return '✓';
  if (status === 'warn') return '!';
  return '✗';
}

function checkVersion(): CheckResult {
  return {
    name: 'Version',
    status: 'ok',
    detail: '0.1.1 (npm package e2ebuddy)',
  };
}

function checkPlatform(): CheckResult {
  const platform = process.platform;
  const arch = process.arch;
  const supported =
    (platform === 'darwin' && (arch === 'x64' || arch === 'arm64')) ||
    (platform === 'win32' && arch === 'x64') ||
    platform === 'linux';
  if (!supported) {
    return {
      name: 'Platform',
      status: 'warn',
      detail: `${platform}/${arch} — primary targets are macOS x64/arm64 and Windows x64`,
    };
  }
  return {
    name: 'Platform',
    status: 'ok',
    detail: `${platform}/${arch}`,
  };
}

async function checkNode(): Promise<CheckResult> {
  const version = process.versions.node;
  const major = Number(version.split('.')[0] ?? 0);
  if (major >= 20) {
    return { name: 'Node.js', status: 'ok', detail: `v${version}` };
  }
  return {
    name: 'Node.js',
    status: 'fail',
    detail: `v${version} (need >= 20)`,
  };
}

async function checkPlaywright(): Promise<CheckResult> {
  try {
    const require = createRequire(import.meta.url);
    const playwrightPath = require.resolve('playwright/package.json');
    const playwrightRoot = path.dirname(playwrightPath);
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { chromium } = require(path.join(playwrightRoot, 'index.js')) as {
      chromium: { executablePath: () => string };
    };
    const executable = chromium.executablePath();
    await access(executable, fsConstants.X_OK);
    return {
      name: 'Playwright Chromium',
      status: 'ok',
      detail: executable,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      name: 'Playwright Chromium',
      status: 'fail',
      detail: `Missing or not executable. Run: e2ebuddy setup (${message})`,
    };
  }
}

async function checkPort(host: string, port: number): Promise<CheckResult> {
  const free = await isPortFree(host, port);
  if (free) {
    return {
      name: 'Web port',
      status: 'ok',
      detail: `${host}:${port} is free`,
    };
  }
  return {
    name: 'Web port',
    status: 'warn',
    detail: `${host}:${port} is in use — e2ebuddy web will pick a free port automatically`,
  };
}

async function checkDataDirs(): Promise<CheckResult> {
  const layout = await ensureUserDataDirectories();
  const targets = [
    layout.root,
    layout.config,
    layout.storage,
    layout.db,
    layout.branding,
  ];
  for (const directory of targets) {
    const writable = await isWritableDirectory(directory);
    if (!writable) {
      return {
        name: 'User data directories',
        status: 'fail',
        detail: `Not writable: ${directory}`,
      };
    }
  }
  return {
    name: 'User data directories',
    status: 'ok',
    detail: layout.root,
  };
}

async function checkPersistence(): Promise<CheckResult> {
  const layout = resolveUserDataLayout();
  const writable = await isWritableDirectory(layout.db);
  const runsFile = path.join(layout.db, 'runs.json');
  if (!writable) {
    return {
      name: 'Run persistence',
      status: 'fail',
      detail: `Not writable: ${layout.db}`,
    };
  }
  return {
    name: 'Run persistence',
    status: 'ok',
    detail: `${runsFile} (JSON file store; native SQLite not wired yet)`,
  };
}

function checkAiConfig(): CheckResult {
  const provider = (process.env.AI_PROVIDER ?? '').trim() || 'anthropic (default when no AI_API_KEY)';
  const hasOpenAiKey = Boolean(process.env.AI_API_KEY?.trim());
  const hasAnthropicKey = Boolean(process.env.ANTHROPIC_API_KEY?.trim());
  const hasBaseUrl = Boolean(process.env.AI_BASE_URL?.trim());
  const hasAgentModel = Boolean(
    process.env.AI_AGENT_MODEL?.trim() || process.env.ANTHROPIC_AGENT_MODEL?.trim(),
  );

  if (hasOpenAiKey || hasAnthropicKey) {
    const bits = [
      `provider=${process.env.AI_PROVIDER?.trim() || (hasOpenAiKey ? 'openai-compatible' : 'anthropic')}`,
      hasOpenAiKey ? 'AI_API_KEY=set' : undefined,
      hasAnthropicKey ? 'ANTHROPIC_API_KEY=set' : undefined,
      hasBaseUrl ? 'AI_BASE_URL=set' : undefined,
      hasAgentModel ? 'agent model=set' : 'agent model=missing',
    ].filter(Boolean);
    if (!hasAgentModel) {
      return {
        name: 'AI configuration',
        status: 'warn',
        detail: `${bits.join(', ')} — set AI_AGENT_MODEL or configure in Web settings`,
      };
    }
    return {
      name: 'AI configuration',
      status: 'ok',
      detail: bits.join(', '),
    };
  }

  return {
    name: 'AI configuration',
    status: 'warn',
    detail: `No API key in environment (${provider}). Configure via Web settings or .env before running tests.`,
  };
}

/** Run environment diagnostics. Set silent to skip printing (for MCP). */
export async function runDoctor(options?: {
  silent?: boolean;
}): Promise<{ ok: boolean; checks: CheckResult[] }> {
  const host = process.env.E2EBUDDY_WEB_HOST?.trim() || '127.0.0.1';
  const port = Number(process.env.E2EBUDDY_WEB_PORT ?? 6558);
  const silent = options?.silent === true;

  const checks: CheckResult[] = [
    checkVersion(),
    checkPlatform(),
    await checkNode(),
    await checkPlaywright(),
    await checkPort(host, Number.isFinite(port) && port > 0 ? port : 6558),
    await checkDataDirs(),
    await checkPersistence(),
    checkAiConfig(),
  ];

  if (!silent) {
    process.stdout.write('e2ebuddy doctor\n\n');
    for (const check of checks) {
      process.stdout.write(
        `${statusMark(check.status)} ${check.name}: ${check.detail}\n`,
      );
    }

    const failedPrint = checks.filter((c) => c.status === 'fail');
    const warnedPrint = checks.filter((c) => c.status === 'warn');
    process.stdout.write('\n');
    if (failedPrint.length === 0 && warnedPrint.length === 0) {
      process.stdout.write('All checks passed.\n');
    } else if (failedPrint.length === 0) {
      process.stdout.write(`${warnedPrint.length} warning(s). You can still start the Web UI.\n`);
    } else {
      process.stdout.write(
        `${failedPrint.length} failure(s), ${warnedPrint.length} warning(s). Run e2ebuddy setup and fix the failures above.\n`,
      );
    }
  }

  return { ok: checks.every((c) => c.status !== 'fail'), checks };
}
