import { access, constants as fsConstants } from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';

import {
  ensureUserDataDirectories,
  type UserDataLayout,
} from '../lib/paths.js';

export type SetupResult = {
  layout: UserDataLayout;
  playwrightOk: boolean;
  playwrightMessage: string;
};

function print(message: string): void {
  process.stdout.write(`${message}\n`);
}

async function playwrightChromiumInstalled(): Promise<boolean> {
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
    return true;
  } catch {
    return false;
  }
}

function runPlaywrightInstall(): Promise<{ ok: boolean; message: string }> {
  return new Promise((resolve) => {
    try {
      const require = createRequire(import.meta.url);
      const playwrightCli = require.resolve('playwright/cli.js');
      const installer = spawn(process.execPath, [playwrightCli, 'install', 'chromium'], {
        stdio: ['ignore', 'pipe', 'pipe'],
        env: process.env,
      });
      let stderr = '';
      installer.stderr?.on('data', (chunk: Buffer) => {
        stderr += chunk.toString('utf8');
      });
      installer.on('error', (error) => {
        resolve({ ok: false, message: error.message });
      });
      installer.on('close', (code) => {
        if (code === 0) {
          resolve({ ok: true, message: 'Playwright Chromium installed.' });
          return;
        }
        resolve({
          ok: false,
          message: `Playwright install exited with code ${code ?? 'unknown'}.${stderr ? ` ${stderr.trim()}` : ''}`,
        });
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      resolve({ ok: false, message: `Could not resolve playwright CLI: ${message}` });
    }
  });
}

/** Idempotent first-run setup: user data dirs + Playwright browser check. */
export async function runSetup(options?: { silent?: boolean }): Promise<SetupResult> {
  const silent = options?.silent === true;
  const out = (message: string) => {
    if (!silent) print(message);
  };

  out('e2ebuddy setup');
  out('');

  const layout = await ensureUserDataDirectories();
  out(`User data directory: ${layout.root}`);
  out(`  config:      ${layout.config}`);
  out(`  storage:     ${layout.storage}`);
  out(`  branding:    ${layout.branding}`);
  out(`  reports:     ${layout.reports}`);
  out(`  screenshots: ${layout.screenshots}`);
  out(`  recordings:  ${layout.recordings}`);
  out(`  db:          ${layout.db}`);

  let playwrightOk = await playwrightChromiumInstalled();
  let playwrightMessage: string;

  if (playwrightOk) {
    playwrightMessage = 'Playwright Chromium is already available.';
    out(`✓ ${playwrightMessage}`);
  } else {
    out('Playwright Chromium not found; installing…');
    const install = await runPlaywrightInstall();
    playwrightOk = install.ok;
    playwrightMessage = install.message;
    out(playwrightOk ? `✓ ${playwrightMessage}` : `✗ ${playwrightMessage}`);
  }

  out('');
  out('Setup complete.');
  out('Next:');
  out('  e2ebuddy doctor');
  out('  e2ebuddy web');
  out('  e2ebuddy test <url> --brief "..."');

  return { layout, playwrightOk, playwrightMessage };
}
