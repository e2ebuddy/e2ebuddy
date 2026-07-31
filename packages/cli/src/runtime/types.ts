export type RunStatus =
  | 'queued'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type LocalRun = {
  id: string;
  targetUrl: string;
  userBrief: string | null;
  status: RunStatus;
  error: string | null;
  report: unknown | null;
  /** When set, this run was created as a retest of another run. */
  parentRunId: string | null;
  /** Latest hybrid evidence snapshot for workbench panels (not full screenshots). */
  lastEvidence: unknown | null;
  createdAt: string;
  updatedAt: string;
};

export type RunEvent = {
  id: number;
  runId: string;
  type: string;
  payload: unknown;
  createdAt: string;
};

export type PublicRun = {
  id: string;
  targetUrl: string;
  userBrief: string | null;
  status: RunStatus;
  error: string | null;
  report: unknown | null;
  parentRunId: string | null;
  lastEvidence: unknown | null;
  createdAt: string;
  updatedAt: string;
};

export function toPublicRun(run: LocalRun): PublicRun {
  return {
    id: run.id,
    targetUrl: run.targetUrl,
    userBrief: run.userBrief,
    status: run.status,
    error: run.error,
    report: run.report,
    parentRunId: run.parentRunId ?? null,
    lastEvidence: run.lastEvidence ?? null,
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
  };
}
