#!/usr/bin/env node
/**
 * Copy apps/local-web/dist into packages/cli/web for npm packaging / offline serve.
 * Non-fatal if local-web has not been built yet.
 */
import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const cliRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = path.resolve(cliRoot, '../../apps/local-web/dist');
const dest = path.join(cliRoot, 'web');

if (!existsSync(path.join(source, 'index.html'))) {
  console.warn('[copy-web] apps/local-web/dist missing — skip (run pnpm --filter local-web build first)');
  process.exit(0);
}

rmSync(dest, { recursive: true, force: true });
mkdirSync(dest, { recursive: true });
cpSync(source, dest, { recursive: true });
console.log(`[copy-web] copied UI → ${dest}`);
