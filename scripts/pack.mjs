#!/usr/bin/env node
/**
 * Per-host packaging for e2ebuddy (inspired by AICore ADE pack-desktop.mjs).
 *
 * e2ebuddy is a Node CLI + local Web UI (not Electron). Packaging means:
 *   1) build monorepo CLI stack + UI on the current host
 *   2) verify bin + static UI
 *   3) npm pack into release/
 *   4) write platform buildinfo (host OS/arch) like ADE's per-host dist feeds
 *
 * Usage:
 *   node scripts/pack.mjs --mac
 *   node scripts/pack.mjs --mac --x64
 *   node scripts/pack.mjs --mac --arm64
 *   node scripts/pack.mjs --win --x64
 *   node scripts/pack.mjs --linux --x64
 *   node scripts/pack.mjs --mac --skip-build
 *   node scripts/pack.mjs --mac --skip-smoke
 *
 * Env:
 *   E2EBUDDY_SKIP_SMOKE=1   same as --skip-smoke
 */
import { spawnSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cliPackageDir = path.join(projectRoot, 'packages', 'cli');
const releaseDir = path.join(projectRoot, 'release');

function parseArgs(argv) {
  const platforms = [];
  const arches = [];
  let skipBuild = false;
  let skipSmoke = process.env.E2EBUDDY_SKIP_SMOKE === '1';
  let help = false;

  for (const arg of argv) {
    if (arg === '--') continue;
    if (arg === '--mac' || arg === '--win' || arg === '--linux') {
      platforms.push(arg.slice(2));
      continue;
    }
    if (arg === '--x64' || arg === 'x64') {
      arches.push('x64');
      continue;
    }
    if (arg === '--arm64' || arg === 'arm64') {
      arches.push('arm64');
      continue;
    }
    if (arg === '--skip-build') {
      skipBuild = true;
      continue;
    }
    if (arg === '--skip-smoke') {
      skipSmoke = true;
      continue;
    }
    if (arg === '-h' || arg === '--help') {
      help = true;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  if (help || platforms.length === 0) {
    return { help: true };
  }

  const uniqueArches = [...new Set(arches)];
  if (uniqueArches.length === 0) {
    uniqueArches.push(process.arch === 'arm64' ? 'arm64' : 'x64');
  }

  return { platforms, arches: uniqueArches, skipBuild, skipSmoke, help: false };
}

function usage() {
  console.log(`Usage: node scripts/pack.mjs --mac|--win|--linux [--x64|--arm64] [--skip-build] [--skip-smoke]

  --mac / --win / --linux   Target family (must match host OS for verification)
  --x64 / --arm64           Target arch label in buildinfo (default: host arch)
  --skip-build              Only pack existing dist/web (no turbo rebuild)
  --skip-smoke              Skip local-web smoke after build

Artifacts:
  release/e2ebuddy-<version>.tgz
  release/e2ebuddy-<version>-<platform>-<arch>-buildinfo.json
`);
}

function info(message) {
  console.log(`[e2ebuddy pack] ${message}`);
}

function err(message) {
  console.error(`[e2ebuddy pack] ERROR: ${message}`);
}

function run(command, args, options = {}) {
  info(`› ${command} ${args.join(' ')}`);
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? projectRoot,
    env: { ...process.env, ...options.env },
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  if (result.status !== 0) {
    throw new Error(`Command failed (${result.status}): ${command} ${args.join(' ')}`);
  }
}

function assertHostMatchesPlatform(platform) {
  const host = process.platform; // darwin | win32 | linux
  const expected =
    platform === 'mac' ? 'darwin' : platform === 'win' ? 'win32' : platform === 'linux' ? 'linux' : null;
  if (expected === null) throw new Error(`Unknown platform: ${platform}`);
  if (host !== expected) {
    throw new Error(
      `${platform} packaging must run on ${expected} (this host is ${host}). ` +
        `Cross-compile is not used — like ADE, pack on the target OS.`,
    );
  }
}

function assertHostArch(arch) {
  // Soft check: allow building x64 labels on arm64 via Rosetta messaging, but warn.
  if (arch !== process.arch) {
    info(
      `warning: pack arch label is ${arch} but host arch is ${process.arch}. ` +
        `npm tarball is arch-independent; Playwright browsers install per-host via setup.`,
    );
  }
}

function readCliVersion() {
  const pkg = JSON.parse(readFileSync(path.join(cliPackageDir, 'package.json'), 'utf8'));
  return String(pkg.version);
}

function applyVersionFlags(versionArgs) {
  if (versionArgs.length === 0) return;
  // Minimal --keep / --bump / --set like ADE select-build-version
  const pkgPath = path.join(cliPackageDir, 'package.json');
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
  let next = pkg.version;
  if (versionArgs.includes('--keep')) {
    info(`version keep ${next}`);
    return;
  }
  const setIndex = versionArgs.findIndex((a) => a === '--set' || a === '--version');
  if (setIndex >= 0) {
    next = versionArgs[setIndex + 1];
    if (!next) throw new Error('--set requires a version');
  } else if (versionArgs.includes('--bump')) {
    const parts = String(pkg.version).split('.').map(Number);
    if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) {
      throw new Error(`Cannot bump version: ${pkg.version}`);
    }
    parts[2] += 1;
    next = parts.join('.');
  }
  pkg.version = next;
  writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
  info(`version → ${next}`);
}

function buildAll() {
  run('pnpm', ['--filter', 'shared', 'build']);
  run('pnpm', ['--filter', 'storage', 'build']);
  run('pnpm', ['--filter', 'executor', 'build']);
  run('pnpm', ['--filter', 'brain', 'build']);
  run('pnpm', ['--filter', 'local-web', 'build']);
  run('pnpm', ['--filter', 'e2ebuddy', 'build']);
}

function verifyArtifacts() {
  const cliJs = path.join(cliPackageDir, 'dist', 'cli.js');
  const webIndex = path.join(cliPackageDir, 'web', 'index.html');
  if (!existsSync(cliJs)) throw new Error(`Missing ${cliJs}`);
  if (!existsSync(webIndex)) {
    throw new Error(`Missing ${webIndex} — run local-web build / copy-web first`);
  }
  // bin boots
  run(process.execPath, [cliJs, '--help'], { cwd: cliPackageDir });
  run(process.execPath, [cliJs, 'doctor'], { cwd: projectRoot });
}

function smokeOptional(skipSmoke) {
  if (skipSmoke) {
    info('skip smoke');
    return;
  }
  run(process.execPath, [path.join(projectRoot, 'scripts', 'smoke-local-web.mjs')]);
}

function npmPack(version, platform, arch) {
  mkdirSync(releaseDir, { recursive: true });
  // npm pack writes e2ebuddy-<version>.tgz into cwd
  run('npm', ['pack', '--pack-destination', releaseDir], { cwd: cliPackageDir });
  const tarball = path.join(releaseDir, `e2ebuddy-${version}.tgz`);
  if (!existsSync(tarball)) {
    // npm may nest differently; find latest matching
    const found = readdirSync(releaseDir).filter(
      (name) => name.startsWith('e2ebuddy-') && name.endsWith('.tgz'),
    );
    if (found.length === 0) throw new Error('npm pack produced no tarball');
    info(`packed candidates: ${found.join(', ')}`);
  }

  const buildinfo = {
    name: 'e2ebuddy',
    version,
    platform,
    arch,
    host: {
      platform: process.platform,
      arch: process.arch,
      node: process.versions.node,
    },
    package: path.basename(tarball),
    notes: [
      'npm tarball is JavaScript-only and portable across OS/arch.',
      'Playwright Chromium is installed per-host by `e2ebuddy setup`.',
      'Packaged on this host for verification and release attestation.',
    ],
    createdAt: new Date().toISOString(),
  };
  const infoPath = path.join(
    releaseDir,
    `e2ebuddy-${version}-${platform}-${arch}-buildinfo.json`,
  );
  writeFileSync(infoPath, `${JSON.stringify(buildinfo, null, 2)}\n`);
  info(`wrote ${infoPath}`);

  // Also stamp a platform-named copy for ADE-like multi-feed uploads.
  const stamped = path.join(releaseDir, `e2ebuddy-${version}-${platform}-${arch}.tgz`);
  if (existsSync(tarball)) {
    copyFileSync(tarball, stamped);
    info(`wrote ${stamped}`);
  }

  return { tarball, stamped, infoPath };
}

function packOne({ platform, arch, skipBuild, skipSmoke }) {
  assertHostMatchesPlatform(platform);
  assertHostArch(arch);
  info(`packing platform=${platform} arch=${arch}`);

  if (!skipBuild) {
    buildAll();
  } else {
    info('skip build — using existing dist');
  }

  verifyArtifacts();
  smokeOptional(skipSmoke);

  const version = readCliVersion();
  const artifacts = npmPack(version, platform, arch);
  info(`done ${platform}/${arch} version=${version}`);
  info(`  tarball: ${artifacts.tarball}`);
  info(`  stamp:   ${artifacts.stamped}`);
  info(`  info:    ${artifacts.infoPath}`);
}

function main(argv) {
  // Peel version flags (ADE style) before platform parse.
  const versionArgs = [];
  const rest = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--keep' || arg === '--bump') {
      versionArgs.push(arg);
      continue;
    }
    if (arg === '--set' || arg === '--version') {
      versionArgs.push(arg, argv[i + 1] ?? '');
      i += 1;
      continue;
    }
    rest.push(arg);
  }

  const options = parseArgs(rest);
  if (options.help) {
    usage();
    process.exit(options.platforms ? 0 : 0);
  }

  applyVersionFlags(versionArgs);

  for (const platform of options.platforms) {
    for (const arch of options.arches) {
      packOne({
        platform,
        arch,
        skipBuild: options.skipBuild,
        skipSmoke: options.skipSmoke,
      });
    }
  }
}

try {
  main(process.argv.slice(2));
} catch (error) {
  err(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
