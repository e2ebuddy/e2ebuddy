import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  composeReport,
  executePlan,
  explore,
  generatePlan,
  judgeRun,
} from 'brain';
import { PageExecutor } from 'executor';
import { LocalStorageAdapter } from 'storage';

import { createCliUrlGuard, createConfiguredModelClient } from '../lib/model.js';
import { hasAiConfiguration } from '../lib/env.js';
import type { LocalRunStore } from './store.js';
import type { LocalRun } from './types.js';

export type PipelineMode = 'brain' | 'demo';

export type PipelineResult = {
  mode: PipelineMode;
  report: unknown;
};

export type EmitFn = (type: string, payload?: unknown) => Promise<void>;

export function resolvePipelineMode(): PipelineMode {
  const forced = process.env.E2EBUDDY_PIPELINE?.trim().toLowerCase();
  if (forced === 'demo') return 'demo';
  if (forced === 'brain') return 'brain';
  return hasAiConfiguration() ? 'brain' : 'demo';
}

/**
 * Run acceptance for a local web run.
 * - `brain`: same phases as `e2ebuddy test` (explore → plan → execute → judge → report)
 * - `demo`: fast placeholder when no AI key is configured (or E2EBUDDY_PIPELINE=demo)
 */
export async function runAcceptancePipeline(
  run: LocalRun,
  options: {
    store: LocalRunStore;
    emit: EmitFn;
    storageDirectory: string;
    reportsDirectory: string;
    isCancelled: () => Promise<boolean>;
  },
): Promise<PipelineResult> {
  const mode = resolvePipelineMode();
  if (mode === 'demo') {
    return runDemoPipeline(run, options.emit);
  }
  return runBrainPipeline(run, options);
}

async function runDemoPipeline(run: LocalRun, emit: EmitFn): Promise<PipelineResult> {
  await emit('phase.started', { phase: 'demo', mode: 'demo' });
  await emit('step.started', { step: 1, name: 'connect' });
  await delay(40);
  await emit('step.completed', { step: 1, name: 'connect' });
  await emit('step.started', { step: 2, name: 'perceive' });
  await delay(40);
  await emit('step.completed', { step: 2, name: 'perceive' });
  await emit('artifact.created', {
    kind: 'note',
    mode: 'demo',
    message: 'DEMO pipeline — set AI_API_KEY (or ANTHROPIC_*) for real brain/executor runs.',
  });
  return {
    mode: 'demo',
    report: {
      mode: 'demo',
      summary:
        'DEMO ONLY — no browser/AI execution. Configure AI_* env vars or set E2EBUDDY_PIPELINE=brain.',
      targetUrl: run.targetUrl,
    },
  };
}

async function runBrainPipeline(
  run: LocalRun,
  options: {
    store: LocalRunStore;
    emit: EmitFn;
    storageDirectory: string;
    reportsDirectory: string;
    isCancelled: () => Promise<boolean>;
  },
): Promise<PipelineResult> {
  const { emit, storageDirectory, reportsDirectory, isCancelled } = options;
  const { client, agentModel, reportModel } = createConfiguredModelClient();
  const storage = new LocalStorageAdapter(storageDirectory);
  const videoDirectory = await mkdtemp(path.join(tmpdir(), 'e2ebuddy-video-'));
  const outputDirectory = path.join(reportsDirectory, run.id);
  await mkdir(outputDirectory, { recursive: true, mode: 0o700 });

  let explorationExecutor: PageExecutor | undefined;

  try {
    await emit('phase.started', { phase: 'explore', mode: 'brain' });
    if (await isCancelled()) throw new CancelledError();

    explorationExecutor = await PageExecutor.launch({
      targetUrl: run.targetUrl,
      urlGuard: createCliUrlGuard(run.targetUrl),
    });

    const exploration = await explore(
      { targetUrl: run.targetUrl, userBrief: run.userBrief ?? undefined },
      { executor: explorationExecutor, client, model: agentModel },
    );
    // Capture hybrid evidence snapshot for workbench panels (without huge screenshot).
    try {
      const perception = await explorationExecutor.perceive();
      const evidence = {
        url: perception.url,
        title: perception.title,
        capturedAt: perception.capturedAt,
        domSummary: perception.domSummary,
        a11ySummary: perception.a11yTree.slice(0, 4_000),
        geometry: perception.geometry,
        consoleLogs: perception.consoleLogs,
        network: perception.network,
        interactableCount: perception.interactables.length,
        screenshotBase64: perception.screenshotBase64.slice(0, 200_000),
      };
      await options.store.updateRun(run.id, { lastEvidence: evidence });
      await emit('artifact.created', {
        kind: 'perception',
        title: perception.title,
        url: perception.url,
        hasScreenshot: true,
        consoleCount: perception.consoleLogs?.length ?? 0,
        networkRequests: perception.network?.requestCount ?? 0,
      });
    } catch {
      // non-fatal
    }
    await explorationExecutor.close();
    explorationExecutor = undefined;
    await emit('phase.completed', {
      phase: 'explore',
      pages: exploration.understanding.pages.length,
      coreFlows: exploration.understanding.coreFlows.length,
    });

    if (await isCancelled()) throw new CancelledError();
    await emit('phase.started', { phase: 'plan', mode: 'brain' });
    const plan = await generatePlan(exploration.understanding, { client, model: agentModel });
    await emit('phase.completed', {
      phase: 'plan',
      cases: plan.cases.length,
    });

    if (await isCancelled()) throw new CancelledError();
    await emit('phase.started', { phase: 'execute', mode: 'brain' });

    const username = process.env.E2EBUDDY_TEST_USERNAME;
    const password = process.env.E2EBUDDY_TEST_PASSWORD;
    const credentials =
      username === undefined || password === undefined ? undefined : { username, password };

    const execution = await executePlan(
      { runId: run.id, targetUrl: run.targetUrl, plan, credentials },
      {
        client,
        model: agentModel,
        storage,
        createSession: async (testCase) => {
          if (await isCancelled()) throw new CancelledError();
          const executor = await PageExecutor.launch({
            targetUrl: run.targetUrl,
            urlGuard: createCliUrlGuard(run.targetUrl),
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
    await emit('phase.completed', { phase: 'execute' });

    if (await isCancelled()) throw new CancelledError();
    await emit('phase.started', { phase: 'judge', mode: 'brain' });
    const judgement = await judgeRun(
      {
        runId: run.id,
        understanding: exploration.understanding,
        plan,
        evidence: execution.evidence,
      },
      { client, model: agentModel, storage },
    );
    await emit('phase.completed', { phase: 'judge' });

    if (await isCancelled()) throw new CancelledError();
    await emit('phase.started', { phase: 'report', mode: 'brain' });
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

    await emit('artifact.created', {
      kind: 'report',
      mode: 'brain',
      outputDirectory,
    });
    await emit('phase.completed', {
      phase: 'report',
      healthScore: report.healthScore,
      issues: report.issues.length,
    });

    return {
      mode: 'brain',
      report: {
        mode: 'brain',
        healthScore: report.healthScore,
        verdict: report.verdict,
        confirmedIssues: report.issues.length,
        needsHumanReview: report.needsHumanReview.length,
        outputDirectory,
        issues: report.issues,
        coverage: report.coverage,
        // Full structured report for detail views (no API keys in this object).
        full: report,
      },
    };
  } finally {
    await explorationExecutor?.close().catch(() => undefined);
    await rm(videoDirectory, { recursive: true, force: true });
  }
}

export class CancelledError extends Error {
  constructor() {
    super('Run cancelled.');
    this.name = 'CancelledError';
  }
}

async function writeJson(destination: string, value: unknown): Promise<void> {
  await writeFile(destination, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
