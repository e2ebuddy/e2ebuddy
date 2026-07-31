import type { LocalRunStore } from './store.js';
import { CancelledError, runAcceptancePipeline, type EmitFn } from './pipeline.js';

type JobContext = {
  storageDirectory: string;
  reportsDirectory: string;
};

/**
 * Single-process in-memory FIFO queue. No Redis/BullMQ.
 * Jobs left "running" across restarts are marked failed on boot.
 */
export class InMemoryRunQueue {
  private readonly store: LocalRunStore;
  private readonly context: JobContext;
  private readonly pending: string[] = [];
  private active = false;
  private stopped = false;

  constructor(store: LocalRunStore, context: JobContext) {
    this.store = store;
    this.context = context;
  }

  async recover(): Promise<void> {
    const runs = await this.store.listRuns();
    for (const run of runs) {
      if (run.status === 'running') {
        await this.store.updateRun(run.id, {
          status: 'failed',
          error: 'Interrupted by process restart.',
        });
        await this.store.appendEvent(run.id, 'run.failed', {
          error: 'Interrupted by process restart.',
        });
      } else if (run.status === 'queued') {
        this.pending.push(run.id);
      }
    }
    void this.pump();
  }

  enqueue(runId: string): void {
    if (this.stopped) return;
    this.pending.push(runId);
    void this.pump();
  }

  stop(): void {
    this.stopped = true;
  }

  private async pump(): Promise<void> {
    if (this.active || this.stopped) return;
    this.active = true;
    try {
      while (!this.stopped && this.pending.length > 0) {
        const runId = this.pending.shift();
        if (runId === undefined) break;
        const run = await this.store.getRun(runId);
        if (run === undefined || run.status === 'cancelled') continue;
        if (run.status !== 'queued') continue;

        await this.store.updateRun(runId, { status: 'running' });
        const current = await this.store.getRun(runId);
        if (current === undefined) continue;

        const emit: EmitFn = async (type, payload = {}) => {
          await this.store.appendEvent(runId, type, payload);
        };

        try {
          const result = await runAcceptancePipeline(current, {
            store: this.store,
            emit,
            storageDirectory: this.context.storageDirectory,
            reportsDirectory: this.context.reportsDirectory,
            isCancelled: async () => {
              const latest = await this.store.getRun(runId);
              return latest?.status === 'cancelled';
            },
          });

          const latest = await this.store.getRun(runId);
          if (latest?.status === 'cancelled') {
            await emit('run.cancelled', {});
            continue;
          }

          await this.store.updateRun(runId, {
            status: 'completed',
            report: result.report,
          });
          await emit('run.completed', { mode: result.mode });
        } catch (error) {
          if (error instanceof CancelledError) {
            const latest = await this.store.getRun(runId);
            if (latest?.status !== 'cancelled') {
              await this.store.updateRun(runId, { status: 'cancelled' });
            }
            await emit('run.cancelled', {});
            continue;
          }
          const message = error instanceof Error ? error.message : String(error);
          // Never put secrets into errors if models leak them — still slice.
          await this.store.updateRun(runId, {
            status: 'failed',
            error: sanitizeError(message).slice(0, 2_000),
          });
          await emit('run.failed', { error: sanitizeError(message).slice(0, 500) });
        }
      }
    } finally {
      this.active = false;
      if (!this.stopped && this.pending.length > 0) void this.pump();
    }
  }
}

function sanitizeError(message: string): string {
  // Redact common secret patterns from error strings.
  return message
    .replace(/(api[_-]?key|authorization|bearer)\s*[:=]\s*\S+/gi, '$1=[redacted]')
    .replace(/sk-[A-Za-z0-9_-]{10,}/g, '[redacted-key]');
}
