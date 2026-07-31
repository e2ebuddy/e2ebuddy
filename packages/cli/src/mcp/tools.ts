import { ensureUserDataDirectories, resolveUserDataLayout } from '../lib/paths.js';
import { hasAiConfiguration } from '../lib/env.js';
import { runDoctor } from '../commands/doctor.js';
import { runSetup } from '../commands/setup.js';
import { LocalRunStore } from '../runtime/store.js';
import { buildReportMarkdown } from '../runtime/report-markdown.js';
import {
  CancelledError,
  resolvePipelineMode,
  runAcceptancePipeline,
} from '../runtime/pipeline.js';
import { SettingsStore } from '../runtime/settings.js';

function textResult(payload: unknown, isError = false): {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
} {
  const text =
    typeof payload === 'string' ? payload : `${JSON.stringify(payload, null, 2)}\n`;
  return {
    content: [{ type: 'text', text }],
    ...(isError ? { isError: true } : {}),
  };
}

async function getStore(): Promise<LocalRunStore> {
  const layout = await ensureUserDataDirectories();
  const store = new LocalRunStore(layout.db);
  await store.init();
  return store;
}

async function applySettingsEnv(): Promise<void> {
  const layout = resolveUserDataLayout();
  const settings = new SettingsStore(layout);
  await settings.init();
  settings.applyLlmToProcessEnv();
}

/** e2ebuddy_doctor — environment diagnostics (no secrets). */
export async function toolDoctor(): Promise<ReturnType<typeof textResult>> {
  const result = await runDoctor({ silent: true });
  return textResult({
    ok: result.ok,
    checks: result.checks,
    pipelineMode: resolvePipelineMode(),
    hasAiConfig: hasAiConfiguration(),
  });
}

/** e2ebuddy_setup — prepare data dirs + Playwright Chromium. */
export async function toolSetup(): Promise<ReturnType<typeof textResult>> {
  const result = await runSetup({ silent: true });
  return textResult({
    ok: result.playwrightOk,
    dataDir: result.layout.root,
    playwright: result.playwrightMessage,
  }, !result.playwrightOk);
}

/**
 * e2ebuddy_run — start acceptance against a URL.
 * By default waits for completion (may take minutes). Set wait=false to return runId immediately.
 */
export async function toolRun(input: {
  targetUrl: string;
  userBrief?: string;
  wait?: boolean;
  timeoutMs?: number;
}): Promise<ReturnType<typeof textResult>> {
  const targetUrl = input.targetUrl?.trim();
  if (!targetUrl) return textResult({ error: 'targetUrl is required' }, true);
  try {
    // eslint-disable-next-line no-new
    new URL(targetUrl);
  } catch {
    return textResult({ error: 'targetUrl must be a valid URL' }, true);
  }

  await applySettingsEnv();
  const layout = await ensureUserDataDirectories();
  const store = new LocalRunStore(layout.db);
  await store.init();

  const run = await store.createRun({
    targetUrl,
    userBrief: input.userBrief,
  });

  const wait = input.wait !== false;
  const timeoutMs = input.timeoutMs ?? 600_000;

  if (!wait) {
    // Fire-and-forget while MCP client keeps the process alive.
    void executeRun(store, run.id, layout.storage, layout.reports).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(`[e2ebuddy-mcp] background run ${run.id} failed: ${message}\n`);
    });
    return textResult({
      runId: run.id,
      status: 'queued',
      pipeline: resolvePipelineMode(),
      message: 'Run started. Poll with e2ebuddy_status.',
    });
  }

  const started = Date.now();
  try {
    await executeRun(store, run.id, layout.storage, layout.reports);
  } catch (error) {
    if (!(error instanceof CancelledError)) {
      const message = error instanceof Error ? error.message : String(error);
      // executeRun already marks failed; still surface message
      const latest = await store.getRun(run.id);
      return textResult(
        {
          runId: run.id,
          status: latest?.status ?? 'failed',
          error: latest?.error ?? message,
          durationMs: Date.now() - started,
        },
        true,
      );
    }
  }

  // Timeout watchdog: if still running (shouldn't for sync executeRun), report.
  const latest = await store.getRun(run.id);
  if (latest && !['completed', 'failed', 'cancelled'].includes(latest.status)) {
    if (Date.now() - started > timeoutMs) {
      await store.updateRun(run.id, {
        status: 'failed',
        error: `Timed out after ${timeoutMs}ms`,
      });
    }
  }

  const finalRun = await store.getRun(run.id);
  if (!finalRun) return textResult({ error: 'run disappeared' }, true);

  const report = finalRun.report as Record<string, unknown> | null;
  return textResult({
    runId: finalRun.id,
    status: finalRun.status,
    error: finalRun.error,
    pipeline: report?.mode ?? resolvePipelineMode(),
    healthScore: report?.healthScore,
    verdict: report?.verdict ?? report?.summary,
    confirmedIssues: report?.confirmedIssues,
    outputDirectory: report?.outputDirectory,
    durationMs: Date.now() - started,
    hint: finalRun.status === 'completed'
      ? 'Use e2ebuddy_report for full Markdown / issues.'
      : undefined,
  }, finalRun.status === 'failed');
}

async function executeRun(
  store: LocalRunStore,
  runId: string,
  storageDirectory: string,
  reportsDirectory: string,
): Promise<void> {
  const current = await store.getRun(runId);
  if (!current) throw new Error(`Unknown run: ${runId}`);
  await store.updateRun(runId, { status: 'running' });

  const emit = async (type: string, payload: unknown = {}) => {
    await store.appendEvent(runId, type, payload);
  };

  try {
    const result = await runAcceptancePipeline(current, {
      store,
      emit,
      storageDirectory,
      reportsDirectory,
      isCancelled: async () => {
        const latest = await store.getRun(runId);
        return latest?.status === 'cancelled';
      },
    });
    const latest = await store.getRun(runId);
    if (latest?.status === 'cancelled') {
      await emit('run.cancelled', {});
      return;
    }
    await store.updateRun(runId, { status: 'completed', report: result.report });
    await emit('run.completed', { mode: result.mode });
  } catch (error) {
    if (error instanceof CancelledError) {
      await store.updateRun(runId, { status: 'cancelled' });
      await emit('run.cancelled', {});
      throw error;
    }
    const message = error instanceof Error ? error.message : String(error);
    await store.updateRun(runId, {
      status: 'failed',
      error: message.slice(0, 2_000),
    });
    await emit('run.failed', { error: message.slice(0, 500) });
    throw error;
  }
}

/** e2ebuddy_status — get run status and recent events. */
export async function toolStatus(input: {
  runId: string;
  includeEvents?: boolean;
}): Promise<ReturnType<typeof textResult>> {
  const runId = input.runId?.trim();
  if (!runId) return textResult({ error: 'runId is required' }, true);
  const store = await getStore();
  const run = await store.getRun(runId);
  if (!run) return textResult({ error: `Run not found: ${runId}` }, true);

  const report = run.report as Record<string, unknown> | null;
  const body: Record<string, unknown> = {
    runId: run.id,
    targetUrl: run.targetUrl,
    userBrief: run.userBrief,
    status: run.status,
    error: run.error,
    parentRunId: run.parentRunId,
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
    reportSummary: report
      ? {
          mode: report.mode,
          healthScore: report.healthScore,
          verdict: report.verdict ?? report.summary,
          confirmedIssues: report.confirmedIssues,
        }
      : null,
  };

  if (input.includeEvents !== false) {
    const events = await store.listEvents(runId, 0);
    body.events = events.slice(-40).map((e) => ({
      id: e.id,
      type: e.type,
      createdAt: e.createdAt,
      payload: e.payload,
    }));
  }

  return textResult(body);
}

/** e2ebuddy_report — Markdown report and structured issues. */
export async function toolReport(input: {
  runId: string;
  format?: 'markdown' | 'json' | 'both';
}): Promise<ReturnType<typeof textResult>> {
  const runId = input.runId?.trim();
  if (!runId) return textResult({ error: 'runId is required' }, true);
  const store = await getStore();
  const run = await store.getRun(runId);
  if (!run) return textResult({ error: `Run not found: ${runId}` }, true);

  const layout = resolveUserDataLayout();
  const settings = new SettingsStore(layout);
  await settings.init();
  const productName = settings.toPublic().branding.productName;
  const markdown = buildReportMarkdown(run, productName);
  const format = input.format ?? 'both';

  if (format === 'markdown') {
    return textResult(markdown);
  }
  if (format === 'json') {
    return textResult({
      runId: run.id,
      status: run.status,
      error: run.error,
      report: run.report,
    });
  }
  return textResult({
    runId: run.id,
    status: run.status,
    error: run.error,
    report: run.report,
    markdown,
  });
}

/** e2ebuddy_list_runs — recent runs. */
export async function toolListRuns(input: {
  limit?: number;
}): Promise<ReturnType<typeof textResult>> {
  const store = await getStore();
  const runs = await store.listRuns();
  const limit = Math.min(Math.max(input.limit ?? 20, 1), 100);
  return textResult({
    runs: runs.slice(0, limit).map((run) => ({
      runId: run.id,
      targetUrl: run.targetUrl,
      status: run.status,
      error: run.error?.slice(0, 200),
      createdAt: run.createdAt,
      updatedAt: run.updatedAt,
    })),
  });
}
