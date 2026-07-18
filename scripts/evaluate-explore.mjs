import { spawn } from 'node:child_process';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(await readFile(path.join(root, 'evals/explore-sites.json'), 'utf8'));
const resultRoot = path.join(root, 'evals/results', manifest.reviewDate);
const selectedIds = new Set(process.argv.slice(2).filter((value) => value !== '--'));
await mkdir(resultRoot, { recursive: true });

for (const site of manifest.sites.filter((candidate) => selectedIds.size === 0 || selectedIds.has(candidate.id))) {
  const destination = path.join(resultRoot, site.id);
  await mkdir(destination, { recursive: true });
  await run('pnpm', ['-F', 'e2ebuddy', 'cli', 'explore', site.url], root);
  await rename(path.join(root, 'understanding.json'), path.join(destination, 'understanding.json'));
  await writeFile(
    path.join(destination, 'review.json'),
    `${JSON.stringify({
      siteId: site.id,
      productTypeCorrect: null,
      recognizedCoreFlows: [],
      expectedCoreFlows: site.expectedCoreFlows,
      coreFlowAccuracy: null,
      reviewerNotes: '',
    }, null, 2)}\n`,
  );
}

function run(command, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env: process.env, stdio: 'inherit' });
    child.once('error', reject);
    child.once('exit', (code) => code === 0 ? resolve() : reject(new Error(`${command} exited with ${code}`)));
  });
}
