#!/usr/bin/env node

import { randomBytes } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
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
import { PageExecutor, type UrlGuard } from 'executor';
import { LocalStorageAdapter } from 'storage';

const invocationDirectory = path.resolve(process.env.INIT_CWD ?? process.cwd());

function printUsage(): void {
  process.stdout.write(`e2ebuddy

Usage:
  e2ebuddy executor-demo <url>
  e2ebuddy explore <url> [--brief "..."]
  e2ebuddy test <url> [--brief "..."]
`);
}

function createRunId(): string {
  return `r${randomBytes(16).toString('hex')}`;
}

async function runExecutorDemo(targetUrl: string): Promise<void> {
  const storageDirectory = path.resolve(invocationDirectory, process.env.STORAGE_DIR ?? './storage');
  const storage = new LocalStorageAdapter(storageDirectory);
  const executor = await PageExecutor.launch({ targetUrl, urlGuard: createCliUrlGuard(targetUrl) });
  const runId = createRunId();

  try {
    const initial = await executor.perceive();
    const clickable = initial.interactables.filter((item) => ['button', 'link'].includes(item.role));
    if (clickable.length === 0) throw new Error('The page has no safe clickable element to demo.');

    let result = await executor.execute({ type: 'click', ref: clickable[0]?.ref ?? '' });
    for (const candidate of clickable.slice(1)) {
      if (result.outcome !== 'blocked') break;
      result = await executor.execute({ type: 'click', ref: candidate.ref });
    }

    const screenshot = Buffer.from(result.perception.screenshotBase64, 'base64');
    const artifact = await storage.put(screenshot, {
      runId,
      contentType: 'image/jpeg',
      extension: 'jpg',
    });

    process.stdout.write(
      `${JSON.stringify(
        {
          runId,
          targetUrl,
          title: result.perception.title,
          urlAfter: result.perception.url,
          interactableCount: result.perception.interactables.length,
          action: result.action,
          outcome: result.outcome,
          note: result.note,
          screenshotKey: artifact.key,
          storageDirectory,
        },
        null,
        2,
      )}\n`,
    );
  } finally {
    await executor.close();
  }
}

async function runExploreCommand(targetUrl: string, userBrief?: string): Promise<void> {
  const { client, agentModel: model } = createConfiguredModelClient();
  const executor = await PageExecutor.launch({ targetUrl, urlGuard: createCliUrlGuard(targetUrl) });
  try {
    const result = await explore(
      { targetUrl, userBrief },
      { executor, client, model },
    );
    const outputPath = path.resolve(invocationDirectory, 'understanding.json');
    await writeFile(outputPath, `${JSON.stringify(result.understanding, null, 2)}\n`, 'utf8');
    process.stdout.write(
      `${JSON.stringify(
        {
          outputPath,
          productType: result.understanding.productType,
          pages: result.understanding.pages.length,
          coreFlows: result.understanding.coreFlows.length,
          termination: result.loop.termination,
          steps: result.loop.steps.length,
        },
        null,
        2,
      )}\n`,
    );
  } finally {
    await executor.close();
  }
}

async function runTestCommand(targetUrl: string, userBrief?: string): Promise<void> {
  const { client, agentModel, reportModel } = createConfiguredModelClient();
  const runId = createRunId();
  const outputDirectory = path.resolve(
    invocationDirectory,
    process.env.OUTPUT_DIR ?? './e2ebuddy-output',
    runId,
  );
  const storageDirectory = path.resolve(invocationDirectory, process.env.STORAGE_DIR ?? './storage');
  const storage = new LocalStorageAdapter(storageDirectory);
  const explorationExecutor = await PageExecutor.launch({
    targetUrl,
    urlGuard: createCliUrlGuard(targetUrl),
  });
  const videoDirectory = await mkdtemp(path.join(tmpdir(), 'e2ebuddy-video-'));
  await mkdir(outputDirectory, { recursive: true });

  try {
    const exploration = await explore(
      { targetUrl, userBrief },
      { executor: explorationExecutor, client, model: agentModel },
    );
    await explorationExecutor.close();
    const plan = await generatePlan(exploration.understanding, { client, model: agentModel });
    const username = process.env.E2EBUDDY_TEST_USERNAME;
    const password = process.env.E2EBUDDY_TEST_PASSWORD;
    const credentials =
      username === undefined || password === undefined ? undefined : { username, password };
    const execution = await executePlan(
      { runId, targetUrl, plan, credentials },
      {
        client,
        model: agentModel,
        storage,
        createSession: async (testCase) => {
          const executor = await PageExecutor.launch({
            targetUrl,
            urlGuard: createCliUrlGuard(targetUrl),
            viewport: testCase.viewport ?? 'desktop',
            recordVideoDir: videoDirectory,
          });
          return {
            executor,
            trustedLogin: (loginCredentials) => executor.trustedLogin(loginCredentials),
            finish: () => executor.closeAndReadVideo(),
          };
        },
      },
    );
    const judgement = await judgeRun(
      { runId, understanding: exploration.understanding, plan, evidence: execution.evidence },
      { client, model: agentModel, storage },
    );
    const report = await composeReport(
      {
        understanding: exploration.understanding,
        plan,
        evidence: execution.evidence,
        judgement,
      },
      { client, model: reportModel },
    );
    await Promise.all([
      writeJson(path.join(outputDirectory, 'understanding.json'), exploration.understanding),
      writeJson(path.join(outputDirectory, 'plan.json'), plan),
      writeJson(path.join(outputDirectory, 'evidence.json'), execution.evidence),
      writeJson(path.join(outputDirectory, 'judgement.json'), judgement),
      writeJson(path.join(outputDirectory, 'report.json'), report),
    ]);
    process.stdout.write(
      `${JSON.stringify(
        {
          runId,
          outputDirectory,
          storageDirectory,
          healthScore: report.healthScore,
          confirmedIssues: report.issues.length,
          needsHumanReview: report.needsHumanReview.length,
        },
        null,
        2,
      )}\n`,
    );
  } finally {
    await explorationExecutor.close().catch(() => undefined);
    await rm(videoDirectory, { recursive: true, force: true });
  }
}

async function writeJson(destination: string, value: unknown): Promise<void> {
  await writeFile(destination, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function createConfiguredModelClient(): {
  client: ModelClient;
  agentModel: string;
  reportModel: string;
} {
  const onMetric = (metric: ModelCallMetric): void => {
    process.stderr.write(`[model] ${JSON.stringify(metric)}\n`);
  };
  const provider = process.env.AI_PROVIDER ??
    (process.env.AI_API_KEY === undefined ? 'anthropic' : 'openai-compatible');
  if (provider === 'openai-compatible') {
    const apiKey = requireEnvironment('AI_API_KEY');
    const baseUrl = requireEnvironment('AI_BASE_URL');
    return {
      client: new OpenAICompatibleModelClient({
        apiKey,
        baseUrl,
        visionModel: process.env.AI_VISION_MODEL,
        thinking: parseThinking(process.env.AI_THINKING),
        onMetric,
      }),
      agentModel: requireEnvironment('AI_AGENT_MODEL'),
      reportModel: process.env.AI_REPORT_MODEL?.trim() || requireEnvironment('AI_AGENT_MODEL'),
    };
  }
  if (provider === 'anthropic') {
    return {
      client: new AnthropicModelClient({ apiKey: requireEnvironment('ANTHROPIC_API_KEY'), onMetric }),
      agentModel: requireEnvironment('ANTHROPIC_AGENT_MODEL'),
      reportModel:
        process.env.ANTHROPIC_REPORT_MODEL?.trim() || requireEnvironment('ANTHROPIC_AGENT_MODEL'),
    };
  }
  throw new Error(`Unsupported AI_PROVIDER: ${provider}`);
}

function parseThinking(value: string | undefined): 'enabled' | 'disabled' | undefined {
  if (value === undefined || value.trim().length === 0) return undefined;
  if (value === 'enabled' || value === 'disabled') return value;
  throw new Error('AI_THINKING must be enabled or disabled.');
}

function createCliUrlGuard(targetUrl: string): UrlGuard | undefined {
  if (process.env.E2EBUDDY_ALLOW_PRIVATE_TARGETS !== 'true') return undefined;
  const allowedOrigin = new URL(targetUrl).origin;
  return {
    assertAllowed: async (rawUrl: string) => {
      const url = new URL(rawUrl);
      if (!['http:', 'https:'].includes(url.protocol) || url.origin !== allowedOrigin) {
        throw new Error('Development private-target mode only allows the exact target origin.');
      }
      return url;
    },
  };
}

function requireEnvironment(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.trim().length === 0) {
    throw new Error(`${name} is required.`);
  }
  return value.trim();
}

function parseBrief(arguments_: readonly string[]): string | undefined {
  if (arguments_.length === 0) return undefined;
  if (arguments_.length !== 2 || arguments_[0] !== '--brief' || arguments_[1] === undefined) {
    throw new Error('Expected optional arguments in the form: --brief "..."');
  }
  return arguments_[1];
}

async function main(arguments_: readonly string[]): Promise<void> {
  const [command, targetUrl, ...rest] = arguments_;
  if (command === undefined || command === '--help' || command === '-h') {
    printUsage();
    return;
  }
  if (command === 'executor-demo') {
    if (targetUrl === undefined) throw new Error('executor-demo requires a target URL.');
    if (rest.length > 0) throw new Error('executor-demo accepts exactly one URL.');
    await runExecutorDemo(targetUrl);
    return;
  }
  if (command === 'explore') {
    if (targetUrl === undefined) throw new Error('explore requires a target URL.');
    await runExploreCommand(targetUrl, parseBrief(rest));
    return;
  }
  if (command === 'test') {
    if (targetUrl === undefined) throw new Error('test requires a target URL.');
    await runTestCommand(targetUrl, parseBrief(rest));
    return;
  }
  throw new Error(`Unknown command: ${command}`);
}

main(process.argv.slice(2)).catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`e2ebuddy: ${message}\n`);
  process.exitCode = 1;
});
