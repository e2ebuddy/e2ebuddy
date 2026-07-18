import { lookup } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';

import { Queue } from 'bullmq';
import {
  TestRunRepository,
  createPrismaClient,
  encryptCredentials,
  parseEncryptionKey,
} from 'db';
import { Redis } from 'ioredis';
import {
  CreateTestRunInputSchema,
  PublicTestRunSchema,
  type PublicTestRun,
  type TestRun,
} from 'shared';
import { LocalStorageAdapter, S3StorageAdapter, type StorageAdapter } from 'storage';

export const queueName = 'test-runs';

const blocked = new BlockList();
for (const [network, prefix] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8],
  ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24],
  ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24],
  ['224.0.0.0', 4], ['240.0.0.0', 4],
] as const) blocked.addSubnet(network, prefix, 'ipv4');
for (const [network, prefix] of [
  ['::', 128], ['::1', 128], ['fc00::', 7], ['fe80::', 10], ['ff00::', 8], ['2001:db8::', 32],
] as const) blocked.addSubnet(network, prefix, 'ipv6');

export async function assertInitialPublicUrl(value: string): Promise<void> {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Only HTTP(S) URLs are allowed.');
  const addresses = isIP(url.hostname) === 0
    ? await lookup(url.hostname, { all: true, verbatim: true })
    : [{ address: url.hostname, family: isIP(url.hostname) }];
  if (addresses.length === 0) throw new Error('Target hostname did not resolve.');
  for (const item of addresses) {
    const family = item.family === 6 ? 'ipv6' : 'ipv4';
    if (blocked.check(item.address, family)) throw new Error('Private or reserved targets are blocked.');
  }
}

export async function createRun(inputValue: unknown): Promise<PublicTestRun> {
  const input = CreateTestRunInputSchema.parse(inputValue);
  await assertInitialPublicUrl(input.targetUrl);
  const prisma = createPrismaClient();
  const repository = new TestRunRepository(prisma);
  let run: TestRun | undefined;
  try {
    const ciphertext =
      input.credentials === undefined
        ? undefined
        : encryptCredentials(
            input.credentials,
            parseEncryptionKey(requireEnvironment('CREDENTIALS_ENCRYPTION_KEY')),
          );
    run = await repository.create(input, ciphertext);
    await enqueueRun(run.id);
    return toPublicRun(run);
  } catch (error) {
    if (run !== undefined) {
      await repository.fail(run.id, error instanceof Error ? error.message : String(error)).catch(() => undefined);
    }
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

export async function getRun(id: string): Promise<PublicTestRun | undefined> {
  const prisma = createPrismaClient();
  try {
    const run = await new TestRunRepository(prisma).find(id);
    return run === undefined ? undefined : toPublicRun(run);
  } finally {
    await prisma.$disconnect();
  }
}

export function createStorage(): StorageAdapter {
  if ((process.env.STORAGE_DRIVER ?? 'local') === 's3') {
    return new S3StorageAdapter({
      bucket: requireEnvironment('S3_BUCKET'),
      endpoint: process.env.S3_ENDPOINT,
      region: requireEnvironment('S3_REGION'),
      accessKeyId: process.env.S3_ACCESS_KEY_ID,
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
      forcePathStyle: process.env.S3_FORCE_PATH_STYLE === 'true',
    });
  }
  return new LocalStorageAdapter(process.env.STORAGE_DIR ?? './storage');
}

export async function enforceRateLimit(ip: string): Promise<boolean> {
  const redis = new Redis(requireEnvironment('REDIS_URL'), { maxRetriesPerRequest: 1 });
  const window = Math.floor(Date.now() / 3_600_000);
  const key = `rate:runs:${window}:${ip}`;
  try {
    const count = await redis.incr(key);
    if (count === 1) await redis.expire(key, 3_700);
    const limit = Number(process.env.RUNS_PER_IP_PER_HOUR ?? 5);
    if (count > limit) {
      process.stdout.write(`${JSON.stringify({ event: 'rate-limit-exceeded', window, ip, count, limit })}\n`);
    }
    return count <= limit;
  } finally {
    redis.disconnect();
  }
}

export function trustedRequestIp(headers: Headers): string {
  return headers.get('x-vercel-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
}

function toPublicRun(run: TestRun): PublicTestRun {
  return PublicTestRunSchema.parse({
    id: run.id,
    targetUrl: run.targetUrl,
    status: run.status,
    createdAt: run.createdAt.toISOString(),
    report: run.report,
    error: run.error?.slice(0, 2_000),
  });
}

async function enqueueRun(runId: string): Promise<void> {
  const connection = new Redis(requireEnvironment('REDIS_URL'), { maxRetriesPerRequest: null });
  const queue = new Queue<{ runId: string }>(queueName, { connection });
  try {
    await queue.add('run', { runId }, {
      jobId: runId,
      attempts: 2,
      backoff: { type: 'exponential', delay: 5_000 },
      removeOnComplete: 100,
      removeOnFail: 100,
    });
  } finally {
    await queue.close();
    connection.disconnect();
  }
}

function requireEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (value === undefined || value.length === 0) throw new Error(`${name} is required.`);
  return value;
}
