import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomBytes } from 'node:crypto';

import type { LocalRun, RunEvent, RunStatus } from './types.js';

export type CreateRunInput = {
  targetUrl: string;
  userBrief?: string;
  parentRunId?: string;
};

type PersistedState = {
  version: 1;
  nextEventId: number;
  runs: LocalRun[];
  events: RunEvent[];
};

/**
 * Local persistence for the single-process web runtime.
 *
 * Honest storage: JSON file under the user data `db/` directory.
 * Not SQLite yet — field shapes are intentionally simple so a later
 * SQLite/Prisma migration can map 1:1. Do not name this file `*.sqlite*`.
 */
export class LocalRunStore {
  private readonly filePath: string;
  private readonly legacyFilePath: string;
  private state: PersistedState = { version: 1, nextEventId: 1, runs: [], events: [] };
  private writeChain: Promise<void> = Promise.resolve();
  private loaded = false;

  constructor(dbDirectory: string) {
    this.filePath = path.join(dbDirectory, 'runs.json');
    // Temporary migration path from the earlier misnamed file.
    this.legacyFilePath = path.join(dbDirectory, 'runs.sqlite.json');
  }

  /** Absolute path of the active persistence file (for doctor / diagnostics). */
  get persistencePath(): string {
    return this.filePath;
  }

  async init(): Promise<void> {
    if (this.loaded) return;
    await mkdir(path.dirname(this.filePath), { recursive: true, mode: 0o700 });
    const loaded = (await this.tryLoad(this.filePath)) || (await this.tryLoad(this.legacyFilePath));
    if (loaded && this.legacyFilePath !== this.filePath) {
      // Rewrite under the honest filename when we recovered from the legacy path.
      await this.persist();
    }
    this.loaded = true;
  }

  private async tryLoad(filePath: string): Promise<boolean> {
    try {
      const raw = await readFile(filePath, 'utf8');
      const parsed = JSON.parse(raw) as PersistedState;
      if (parsed?.version === 1 && Array.isArray(parsed.runs) && Array.isArray(parsed.events)) {
        this.state = {
          version: 1,
          nextEventId: Number(parsed.nextEventId) || 1,
          runs: parsed.runs,
          events: parsed.events,
        };
        return true;
      }
    } catch {
      // Missing or corrupt — caller may try another path.
    }
    return false;
  }

  async listRuns(): Promise<LocalRun[]> {
    await this.init();
    return [...this.state.runs].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async getRun(id: string): Promise<LocalRun | undefined> {
    await this.init();
    return this.state.runs.find((run) => run.id === id);
  }

  async createRun(input: CreateRunInput): Promise<LocalRun> {
    await this.init();
    const now = new Date().toISOString();
    const run: LocalRun = {
      id: createRunId(),
      targetUrl: input.targetUrl,
      userBrief: input.userBrief?.trim() || null,
      status: 'queued',
      error: null,
      report: null,
      parentRunId: input.parentRunId?.trim() || null,
      lastEvidence: null,
      createdAt: now,
      updatedAt: now,
    };
    this.state.runs.unshift(run);
    // appendEvent persists; no extra write here.
    await this.appendEvent(run.id, 'run.created', {
      targetUrl: run.targetUrl,
      userBrief: run.userBrief,
    });
    return run;
  }

  async updateRun(
    id: string,
    patch: Partial<Pick<LocalRun, 'status' | 'error' | 'report' | 'lastEvidence'>>,
  ): Promise<LocalRun | undefined> {
    await this.init();
    const run = this.state.runs.find((item) => item.id === id);
    if (run === undefined) return undefined;
    if (patch.status !== undefined) run.status = patch.status;
    if (patch.error !== undefined) run.error = patch.error;
    if (patch.report !== undefined) run.report = patch.report;
    if (patch.lastEvidence !== undefined) run.lastEvidence = patch.lastEvidence;
    // Backfill fields for runs created before parentRunId/lastEvidence existed.
    if (run.parentRunId === undefined) (run as LocalRun).parentRunId = null;
    if (run.lastEvidence === undefined) (run as LocalRun).lastEvidence = null;
    run.updatedAt = new Date().toISOString();
    await this.persist();
    return run;
  }

  async appendEvent(runId: string, type: string, payload: unknown = {}): Promise<RunEvent> {
    await this.init();
    const event: RunEvent = {
      id: this.state.nextEventId,
      runId,
      type,
      payload,
      createdAt: new Date().toISOString(),
    };
    this.state.nextEventId += 1;
    this.state.events.push(event);
    // Cap event history to keep the store small.
    if (this.state.events.length > 5_000) {
      this.state.events = this.state.events.slice(-4_000);
    }
    await this.persist();
    return event;
  }

  async listEvents(runId: string, afterId = 0): Promise<RunEvent[]> {
    await this.init();
    return this.state.events.filter((event) => event.runId === runId && event.id > afterId);
  }

  private persist(): Promise<void> {
    this.writeChain = this.writeChain.then(async () => {
      const temporary = `${this.filePath}.tmp-${process.pid}`;
      await writeFile(temporary, `${JSON.stringify(this.state, null, 2)}\n`, {
        mode: 0o600,
        encoding: 'utf8',
      });
      await rename(temporary, this.filePath);
    });
    return this.writeChain;
  }
}

function createRunId(): string {
  return `r${randomBytes(12).toString('hex')}`;
}

export type { RunStatus };
