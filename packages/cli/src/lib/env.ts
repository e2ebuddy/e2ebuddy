import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Candidate .env locations for monorepo + global install layouts.
 * Order: explicit env, cwd, INIT_CWD (pnpm), walk up from cwd, walk up from this package.
 */
export function resolveEnvFilePaths(): string[] {
  const candidates: string[] = [];
  const explicit = process.env.E2EBUDDY_ENV_FILE?.trim();
  if (explicit) candidates.push(path.resolve(explicit));

  const cwd = process.cwd();
  candidates.push(path.resolve(cwd, '.env'));

  const initCwd = process.env.INIT_CWD?.trim();
  if (initCwd) candidates.push(path.resolve(initCwd, '.env'));

  // Walk up from cwd (pnpm -F e2ebuddy exec runs with package cwd).
  let dir = cwd;
  for (let i = 0; i < 6; i += 1) {
    candidates.push(path.join(dir, '.env'));
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  // Walk up from bundled cli location: dist/cli.js → packages/cli → repo root.
  try {
    let fromPackage = path.dirname(fileURLToPath(import.meta.url));
    for (let i = 0; i < 8; i += 1) {
      candidates.push(path.join(fromPackage, '.env'));
      const parent = path.dirname(fromPackage);
      if (parent === fromPackage) break;
      fromPackage = parent;
    }
  } catch {
    // ignore
  }

  return [...new Set(candidates)];
}

/**
 * Load KEY=VALUE pairs from the first existing .env into process.env
 * without overriding already-set variables. No dotenv dependency.
 */
export function loadEnvFile(filePath?: string): string | undefined {
  const paths = filePath ? [path.resolve(filePath)] : resolveEnvFilePaths();
  for (const candidate of paths) {
    if (!existsSync(candidate)) continue;
    let raw: string;
    try {
      raw = readFileSync(candidate, 'utf8');
    } catch {
      continue;
    }
    applyEnvText(raw);
    return candidate;
  }
  return undefined;
}

function applyEnvText(raw: string): void {
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    if (process.env[key] !== undefined) continue;
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

export function hasAiConfiguration(): boolean {
  return Boolean(process.env.AI_API_KEY?.trim() || process.env.ANTHROPIC_API_KEY?.trim());
}
