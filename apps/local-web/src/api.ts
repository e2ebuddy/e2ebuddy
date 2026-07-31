export type PublicRun = {
  id: string;
  targetUrl: string;
  userBrief: string | null;
  status: string;
  error: string | null;
  report: Record<string, unknown> | null;
  parentRunId: string | null;
  lastEvidence: EvidenceSnapshot | null;
  createdAt: string;
  updatedAt: string;
};

export type EvidenceSnapshot = {
  url?: string;
  title?: string;
  capturedAt?: string;
  domSummary?: string;
  a11ySummary?: string;
  geometry?: Record<string, number>;
  consoleLogs?: Array<{ type: string; text: string; timestamp?: string }>;
  network?: { requestCount: number; failedCount: number; sampleUrls: string[] };
  interactableCount?: number;
  screenshotBase64?: string;
};

export type Health = {
  ok: boolean;
  service: string;
  mode: string;
  pipeline?: string;
  /** @deprecated never shown in UI; local runtime does not use Redis */
  redis?: boolean;
  persistence?: string;
  dataDir?: string;
  version?: string;
  productName?: string;
  platform?: string;
  arch?: string;
  node?: string;
};

export type PublicSettings = {
  branding: {
    productName: string;
    logoFileName: string | null;
    logoUrl: string | null;
  };
  llm: {
    provider: 'openai-compatible' | 'anthropic';
    baseUrl: string;
    apiKeyMasked: string;
    hasApiKey: boolean;
    agentModel: string;
    visionModel: string;
    reportModel: string;
  };
};

export type RunEvent = {
  id: number;
  type: string;
  payload: unknown;
  createdAt: string;
};

async function parseJson<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text.slice(0, 300) || `HTTP ${response.status}`);
  }
  return (await response.json()) as T;
}

export async function fetchHealth(): Promise<Health> {
  return parseJson(await fetch('/api/health'));
}

export async function fetchRuns(): Promise<PublicRun[]> {
  const body = await parseJson<{ runs: PublicRun[] }>(await fetch('/api/runs'));
  return body.runs;
}

export async function fetchRun(id: string): Promise<PublicRun> {
  return parseJson(await fetch(`/api/runs/${encodeURIComponent(id)}`));
}

export async function createRun(input: {
  targetUrl: string;
  userBrief?: string;
  parentRunId?: string;
}): Promise<PublicRun> {
  return parseJson(
    await fetch('/api/runs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    }),
  );
}

export async function cancelRun(id: string): Promise<PublicRun> {
  return parseJson(
    await fetch(`/api/runs/${encodeURIComponent(id)}/cancel`, { method: 'POST' }),
  );
}

export async function retestRun(
  id: string,
  opts?: { issueId?: string; issueTitle?: string },
): Promise<PublicRun> {
  return parseJson(
    await fetch(`/api/runs/${encodeURIComponent(id)}/retest`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(opts ?? {}),
    }),
  );
}

export async function fetchReportMarkdown(id: string): Promise<string> {
  const response = await fetch(`/api/runs/${encodeURIComponent(id)}/report.md`);
  if (!response.ok) throw new Error(`report.md HTTP ${response.status}`);
  return response.text();
}

export async function fetchSettings(): Promise<PublicSettings> {
  return parseJson(await fetch('/api/settings'));
}

export async function saveBranding(input: {
  productName?: string;
  clearLogo?: boolean;
}): Promise<PublicSettings> {
  return parseJson(
    await fetch('/api/settings/branding', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    }),
  );
}

export async function uploadLogo(file: File): Promise<PublicSettings> {
  const form = new FormData();
  form.append('logo', file, file.name);
  return parseJson(await fetch('/api/settings/branding/logo', { method: 'POST', body: form }));
}

export async function saveLlm(input: {
  provider?: string;
  baseUrl?: string;
  apiKey?: string;
  agentModel?: string;
  visionModel?: string;
  reportModel?: string;
}): Promise<PublicSettings> {
  return parseJson(
    await fetch('/api/settings/llm', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    }),
  );
}

export async function testLlm(): Promise<{ ok: boolean; message: string }> {
  return parseJson(await fetch('/api/settings/llm/test', { method: 'POST' }));
}

export function openRunEventSource(
  runId: string,
  afterId: number,
  onEvent: (event: RunEvent) => void,
): EventSource {
  const source = new EventSource(
    `/api/runs/${encodeURIComponent(runId)}/events?after=${afterId}`,
  );
  const handler = (raw: MessageEvent) => {
    try {
      const data = JSON.parse(String(raw.data)) as RunEvent;
      onEvent(data);
    } catch {
      // ignore parse errors
    }
  };
  // Listen for named events we emit
  for (const type of [
    'run.created',
    'phase.started',
    'phase.completed',
    'step.started',
    'step.completed',
    'artifact.created',
    'run.completed',
    'run.failed',
    'run.cancelled',
  ]) {
    source.addEventListener(type, handler as EventListener);
  }
  source.onmessage = handler;
  return source;
}
