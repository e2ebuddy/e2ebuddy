import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  AnthropicModelClient,
  OpenAICompatibleModelClient,
  composeReport,
  executePlan,
  explore,
  generatePlan,
  judgeRun,
  type ModelCallMetric,
  type ModelClient,
} from 'brain';
import { Worker, type Job } from 'bullmq';
import {
  TestRunRepository,
  createPrismaClient,
  decryptCredentials,
  parseEncryptionKey,
  redactSecrets,
} from 'db';
import { PageExecutor } from 'executor';
import { Redis } from 'ioredis';
import type { TestRun } from 'shared';
import { LocalStorageAdapter, S3StorageAdapter, type StorageAdapter } from 'storage';

export const queueName = 'test-runs';

export type PipelineStage = 'explore' | 'plan' | 'execute' | 'judge' | 'report' | 'complete';

export function deriveResumeStage(run: TestRun): PipelineStage {
  if (run.understanding === undefined) return 'explore';
  if (run.plan === undefined) return 'plan';
  if (run.evidence === undefined) return 'execute';
  if (run.judgement === undefined) return 'judge';
  if (run.report === undefined) return 'report';
  return 'complete';
}

interface ModelConfiguration {
  client: ModelClient;
  agentModel: string;
  reportModel: string;
  metrics: ModelCallMetric[];
}

export async function processRun(runId: string): Promise<void> {
  const runStartedAt = Date.now();
  const prisma = createPrismaClient();
  const repository = new TestRunRepository(prisma);
  const model = createModelConfiguration();
  const storage = createStorage();
  let secrets: string[] = [];
  try {
    let run = await repository.find(runId);
    if (run === undefined) throw new Error(`Run not found: ${runId}`);
    const credentials =
      run.credentialsCiphertext === undefined
        ? undefined
        : decryptCredentials(
            run.credentialsCiphertext,
            parseEncryptionKey(requireEnvironment('CREDENTIALS_ENCRYPTION_KEY')),
          );
    secrets = credentials === undefined ? [] : [credentials.username, credentials.password];

    if (run.understanding === undefined) {
      await repository.setStatus(runId, 'exploring');
      const executor = await PageExecutor.launch({ targetUrl: run.targetUrl });
      try {
        const result = await explore(
          { targetUrl: run.targetUrl, userBrief: run.userBrief },
          { executor, client: model.client, model: model.agentModel },
        );
        run = await repository.saveStage(runId, {
          field: 'understanding',
          value: result.understanding,
          status: 'planning',
          metrics: summarizeMetrics(model.metrics, runStartedAt),
        });
      } finally {
        await executor.close().catch(() => undefined);
      }
    }

    if (run.plan === undefined) {
      const plan = await generatePlan(required(run.understanding, 'understanding'), {
        client: model.client,
        model: model.agentModel,
      });
      run = await repository.saveStage(runId, {
        field: 'plan',
        value: plan,
        status: 'executing',
        metrics: summarizeMetrics(model.metrics, runStartedAt),
      });
    }

    if (run.evidence === undefined) {
      const targetUrl = run.targetUrl;
      const execution = await executePlan(
        {
          runId,
          targetUrl: run.targetUrl,
          plan: required(run.plan, 'plan'),
          credentials,
        },
        {
          client: model.client,
          model: model.agentModel,
          storage,
          createSession: async (testCase) => {
            const videoDirectory = await mkdtemp(path.join(tmpdir(), 'e2ebuddy-worker-video-'));
            const executor = await PageExecutor.launch({
              targetUrl,
              viewport: testCase.viewport ?? 'desktop',
              recordVideoDir: videoDirectory,
            });
            return {
              executor,
              trustedLogin: (loginCredentials) => executor.trustedLogin(loginCredentials),
              finish: async () => {
                try {
                  return await executor.closeAndReadVideo();
                } finally {
                  await rm(videoDirectory, { recursive: true, force: true });
                }
              },
            };
          },
        },
      );
      run = await repository.saveStage(runId, {
        field: 'evidence',
        value: execution.evidence,
        status: 'judging',
        metrics: summarizeMetrics(model.metrics, runStartedAt),
      });
    }

    if (run.judgement === undefined) {
      const judgement = await judgeRun(
        {
          runId,
          understanding: required(run.understanding, 'understanding'),
          plan: required(run.plan, 'plan'),
          evidence: required(run.evidence, 'evidence'),
        },
        { client: model.client, model: model.agentModel, storage },
      );
      run = await repository.saveStage(runId, {
        field: 'judgement',
        value: judgement,
        status: 'reporting',
        metrics: summarizeMetrics(model.metrics, runStartedAt),
      });
    }

    if (run.report === undefined) {
      const report = await composeReport(
        {
          understanding: required(run.understanding, 'understanding'),
          plan: required(run.plan, 'plan'),
          evidence: required(run.evidence, 'evidence'),
          judgement: required(run.judgement, 'judgement'),
        },
        { client: model.client, model: model.reportModel },
      );
      await repository.saveStage(runId, {
        field: 'report',
        value: report,
        status: 'done',
        metrics: summarizeMetrics(model.metrics, runStartedAt),
      });
    }
    await repository.clearCredentials(runId);
  } catch (error) {
    const message = redactSecrets(error instanceof Error ? error.message : String(error), secrets);
    await repository.fail(runId, message).catch(() => undefined);
    throw new Error(message);
  } finally {
    await prisma.$disconnect();
  }
}

export function startWorker(): Worker<{ runId: string }> {
  const connection = new Redis(requireEnvironment('REDIS_URL'), { maxRetriesPerRequest: null });
  const worker = new Worker<{ runId: string }>(
    queueName,
    async (job: Job<{ runId: string }>) => processRun(job.data.runId),
    { connection, concurrency: 1 },
  );
  worker.on('failed', (job, error) => {
    process.stderr.write(
      `${JSON.stringify({ event: 'job-failed', jobId: job?.id, error: error.message.slice(0, 2_000) })}\n`,
    );
  });
  return worker;
}

function createModelConfiguration(): ModelConfiguration {
  const metrics: ModelCallMetric[] = [];
  const onMetric = (metric: ModelCallMetric): void => {
    metrics.push(metric);
    process.stdout.write(`${JSON.stringify({ event: 'model-call', ...metric })}\n`);
  };
  const provider = process.env.AI_PROVIDER ?? 'openai-compatible';
  if (provider === 'openai-compatible') {
    const agentModel = requireEnvironment('AI_AGENT_MODEL');
    return {
      client: new OpenAICompatibleModelClient({
        apiKey: requireEnvironment('AI_API_KEY'),
        baseUrl: requireEnvironment('AI_BASE_URL'),
        visionModel: process.env.AI_VISION_MODEL,
        thinking: parseThinking(process.env.AI_THINKING),
        onMetric,
      }),
      agentModel,
      reportModel: process.env.AI_REPORT_MODEL?.trim() || agentModel,
      metrics,
    };
  }
  if (provider === 'anthropic') {
    const agentModel = requireEnvironment('ANTHROPIC_AGENT_MODEL');
    return {
      client: new AnthropicModelClient({ apiKey: requireEnvironment('ANTHROPIC_API_KEY'), onMetric }),
      agentModel,
      reportModel: process.env.ANTHROPIC_REPORT_MODEL?.trim() || agentModel,
      metrics,
    };
  }
  throw new Error(`Unsupported AI_PROVIDER: ${provider}`);
}

function createStorage(): StorageAdapter {
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

function summarizeMetrics(metrics: readonly ModelCallMetric[], runStartedAt: number): object {
  return {
    calls: metrics.length,
    inputTokens: metrics.reduce((total, metric) => total + (metric.inputTokens ?? 0), 0),
    outputTokens: metrics.reduce((total, metric) => total + (metric.outputTokens ?? 0), 0),
    durationMs: metrics.reduce((total, metric) => total + metric.durationMs, 0),
    failedCalls: metrics.filter((metric) => !metric.success).length,
    runDurationMs: Date.now() - runStartedAt,
  };
}

function required<T>(value: T | undefined, name: string): T {
  if (value === undefined) throw new Error(`Required valid stage output is missing: ${name}`);
  return value;
}

function requireEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (value === undefined || value.length === 0) throw new Error(`${name} is required.`);
  return value;
}

function parseThinking(value: string | undefined): 'enabled' | 'disabled' | undefined {
  if (value === undefined || value.trim().length === 0) return undefined;
  if (value === 'enabled' || value === 'disabled') return value;
  throw new Error('AI_THINKING must be enabled or disabled.');
}

if (process.argv[1]?.endsWith('/dist/index.js') === true) {
  startWorker();
}
