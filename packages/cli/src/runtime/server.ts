import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { readFile } from 'node:fs/promises';

import type { UserDataLayout } from '../lib/paths.js';
import { LocalRunStore } from './store.js';
import { InMemoryRunQueue } from './queue.js';
import { resolvePipelineMode } from './pipeline.js';
import { buildReportMarkdown } from './report-markdown.js';
import { SettingsStore, testLlmConnection } from './settings.js';
import { toPublicRun } from './types.js';

export type LocalRuntimeOptions = {
  host: string;
  port: number;
  layout: UserDataLayout;
  /** Optional directory of built static web assets. */
  staticDirectory?: string;
};

export type LocalRuntime = {
  server: Server;
  store: LocalRunStore;
  queue: InMemoryRunQueue;
  settings: SettingsStore;
  url: string;
  close: () => Promise<void>;
};

const SSE_CLIENTS = new Map<string, Set<ServerResponse>>();

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  const payload = `${JSON.stringify(body)}\n`;
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
    'cache-control': 'no-store',
    'access-control-allow-origin': '*',
  });
  response.end(payload);
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
    if (Buffer.concat(chunks).byteLength > 1_000_000) {
      throw new Error('Request body too large.');
    }
  }
  if (chunks.length === 0) return {};
  const raw = Buffer.concat(chunks).toString('utf8');
  if (raw.trim().length === 0) return {};
  return JSON.parse(raw) as unknown;
}

/** Minimal multipart parser for a single file field named "logo" or first file. */
async function readMultipartFile(
  request: IncomingMessage,
): Promise<{ buffer: Buffer; filename: string }> {
  const contentType = request.headers['content-type'] ?? '';
  const boundaryMatch = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType);
  if (!boundaryMatch) {
    // Fallback: raw body with filename query not available — treat as binary png
    const chunks: Buffer[] = [];
    for await (const chunk of request) {
      chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
      if (Buffer.concat(chunks).byteLength > 5_000_000) throw new Error('Logo too large.');
    }
    return { buffer: Buffer.concat(chunks), filename: 'logo.png' };
  }
  const boundary = boundaryMatch[1] ?? boundaryMatch[2] ?? '';
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
    if (Buffer.concat(chunks).byteLength > 5_000_000) throw new Error('Logo too large.');
  }
  const body = Buffer.concat(chunks);
  const parts = body.toString('binary').split(`--${boundary}`);
  for (const part of parts) {
    if (!part.includes('Content-Disposition') || part.includes('filename=""')) continue;
    const nameMatch = /filename="([^"]+)"/i.exec(part);
    if (!nameMatch) continue;
    const headerEnd = part.indexOf('\r\n\r\n');
    if (headerEnd < 0) continue;
    let data = part.slice(headerEnd + 4);
    if (data.endsWith('\r\n')) data = data.slice(0, -2);
    if (data.endsWith('--')) data = data.slice(0, -2);
    if (data.endsWith('\r\n')) data = data.slice(0, -2);
    return {
      buffer: Buffer.from(data, 'binary'),
      filename: nameMatch[1] ?? 'logo.png',
    };
  }
  throw new Error('No logo file found in upload.');
}

function broadcast(runId: string, event: { id: number; type: string; payload: unknown; createdAt: string }): void {
  const clients = SSE_CLIENTS.get(runId);
  if (clients === undefined || clients.size === 0) return;
  const data = `id: ${event.id}\nevent: ${event.type}\ndata: ${JSON.stringify({
    id: event.id,
    type: event.type,
    payload: event.payload,
    createdAt: event.createdAt,
  })}\n\n`;
  for (const client of clients) {
    client.write(data);
  }
}

function contentTypeFor(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case '.html':
      return 'text/html; charset=utf-8';
    case '.js':
      return 'text/javascript; charset=utf-8';
    case '.css':
      return 'text/css; charset=utf-8';
    case '.json':
      return 'application/json; charset=utf-8';
    case '.svg':
      return 'image/svg+xml';
    case '.png':
      return 'image/png';
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.woff2':
      return 'font/woff2';
    default:
      return 'application/octet-stream';
  }
}

function serveStatic(
  response: ServerResponse,
  staticDirectory: string | undefined,
  urlPath: string,
): boolean {
  if (staticDirectory === undefined || !existsSync(staticDirectory)) return false;
  const decoded = decodeURIComponent(urlPath.split('?')[0] ?? '/');
  const relative = decoded === '/' ? 'index.html' : decoded.replace(/^\//, '');
  const candidate = path.resolve(staticDirectory, relative);
  const root = path.resolve(staticDirectory);
  if (!candidate.startsWith(root) || !existsSync(candidate) || !statSync(candidate).isFile()) {
    // SPA fallback
    const index = path.join(staticDirectory, 'index.html');
    if (existsSync(index) && !relative.includes('.')) {
      response.writeHead(200, {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-store',
      });
      createReadStream(index).pipe(response);
      return true;
    }
    return false;
  }
  response.writeHead(200, {
    'content-type': contentTypeFor(candidate),
    'cache-control': relative.startsWith('assets/') ? 'public, max-age=31536000, immutable' : 'no-store',
  });
  createReadStream(candidate).pipe(response);
  return true;
}

const PLACEHOLDER_HTML = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>e2ebuddy</title>
  <style>
    :root { color-scheme: dark light; font-family: ui-sans-serif, system-ui, sans-serif; }
    body { margin: 0; min-height: 100vh; display: grid; place-items: center;
      background: #0b1020; color: #e8eefc; }
    main { max-width: 40rem; padding: 2rem; text-align: center; }
    h1 { font-size: 1.75rem; margin: 0 0 0.75rem; }
    p { color: #a9b6d3; line-height: 1.55; }
    code { background: #1a2340; padding: 0.15rem 0.4rem; border-radius: 0.35rem; }
  </style>
</head>
<body>
  <main>
    <h1>e2ebuddy</h1>
    <p>Local Web runtime is up (no Redis). Full workbench UI arrives with the Web build task.</p>
    <p>API: <code>GET /api/health</code> · <code>GET /api/runs</code> · <code>POST /api/runs</code></p>
  </main>
</body>
</html>
`;

function resolveDefaultStaticDirectory(): string | undefined {
  // Prefer local-web production build, then legacy web outputs.
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.resolve(here, 'web'),
    path.resolve(here, '../web'),
    path.resolve(here, '../../../apps/local-web/dist'),
    path.resolve(here, '../../local-web/dist'),
    path.resolve(process.cwd(), 'apps/local-web/dist'),
    path.resolve(process.cwd(), 'packages/cli/../../apps/local-web/dist'),
    path.resolve(here, '../../../apps/web/out'),
    path.resolve(here, '../../../apps/web/dist'),
    path.resolve(process.cwd(), 'apps/web/out'),
    path.resolve(process.cwd(), 'apps/web/dist'),
  ];
  for (const candidate of candidates) {
    if (existsSync(path.join(candidate, 'index.html'))) return candidate;
  }
  return undefined;
}

export async function startLocalRuntime(options: LocalRuntimeOptions): Promise<LocalRuntime> {
  const store = new LocalRunStore(options.layout.db);
  await store.init();

  const settings = new SettingsStore(options.layout);
  await settings.init();
  settings.applyLlmToProcessEnv();

  // Patch appendEvent to fan out SSE after each persist (before queue recover).
  const originalAppend = store.appendEvent.bind(store);
  store.appendEvent = async (runId, type, payload = {}) => {
    const event = await originalAppend(runId, type, payload);
    broadcast(runId, event);
    return event;
  };

  const queue = new InMemoryRunQueue(store, {
    storageDirectory: options.layout.storage,
    reportsDirectory: options.layout.reports,
  });
  await queue.recover();

  const staticDirectory = options.staticDirectory ?? resolveDefaultStaticDirectory();

  const server = createServer((request, response) => {
    void handleRequest(request, response, {
      store,
      queue,
      settings,
      staticDirectory,
      layout: options.layout,
    }).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      if (!response.headersSent) {
        sendJson(response, 500, { error: 'internal_error', message: message.slice(0, 500) });
      } else {
        response.end();
      }
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port, options.host, () => resolve());
  });

  const url = `http://${options.host}:${options.port}/`;

  return {
    server,
    store,
    queue,
    settings,
    url,
    close: () =>
      new Promise((resolve, reject) => {
        queue.stop();
        for (const clients of SSE_CLIENTS.values()) {
          for (const client of clients) client.end();
        }
        SSE_CLIENTS.clear();
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}

type RequestContext = {
  store: LocalRunStore;
  queue: InMemoryRunQueue;
  settings: SettingsStore;
  staticDirectory: string | undefined;
  layout: UserDataLayout;
};

async function handleRequest(
  request: IncomingMessage,
  response: ServerResponse,
  ctx: RequestContext,
): Promise<void> {
  const method = request.method ?? 'GET';
  const url = new URL(request.url ?? '/', 'http://127.0.0.1');

  if (method === 'OPTIONS') {
    response.writeHead(204, {
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET,POST,PUT,OPTIONS',
      'access-control-allow-headers': 'content-type',
    });
    response.end();
    return;
  }

  if (url.pathname === '/api/health') {
    const publicSettings = ctx.settings.toPublic();
    sendJson(response, 200, {
      ok: true,
      service: 'e2ebuddy-web',
      mode: 'local',
      pipeline: resolvePipelineMode(),
      redis: false,
      bullmq: false,
      persistence: 'json-file',
      dataDir: ctx.layout.root,
      version: '0.1.1',
      productName: publicSettings.branding.productName,
      platform: process.platform,
      arch: process.arch,
      node: process.versions.node,
    });
    return;
  }

  if (url.pathname === '/api/settings' && method === 'GET') {
    sendJson(response, 200, ctx.settings.toPublic());
    return;
  }

  if (url.pathname === '/api/settings/branding' && method === 'PUT') {
    try {
      const body = (await readJsonBody(request)) as Record<string, unknown>;
      const updated = await ctx.settings.updateBranding({
        productName: typeof body.productName === 'string' ? body.productName : undefined,
        clearLogo: body.clearLogo === true,
      });
      sendJson(response, 200, updated);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      sendJson(response, 400, { error: message.slice(0, 500) });
    }
    return;
  }

  if (url.pathname === '/api/settings/branding/logo' && method === 'POST') {
    try {
      const { buffer, filename } = await readMultipartFile(request);
      const updated = await ctx.settings.saveLogoBuffer(buffer, filename);
      sendJson(response, 200, updated);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      sendJson(response, 400, { error: message.slice(0, 500) });
    }
    return;
  }

  if (url.pathname === '/api/settings/llm' && method === 'PUT') {
    try {
      const body = (await readJsonBody(request)) as Record<string, unknown>;
      const updated = await ctx.settings.updateLlm({
        provider:
          body.provider === 'anthropic' || body.provider === 'openai-compatible'
            ? body.provider
            : undefined,
        baseUrl: typeof body.baseUrl === 'string' ? body.baseUrl : undefined,
        apiKey: typeof body.apiKey === 'string' ? body.apiKey : undefined,
        agentModel: typeof body.agentModel === 'string' ? body.agentModel : undefined,
        visionModel: typeof body.visionModel === 'string' ? body.visionModel : undefined,
        reportModel: typeof body.reportModel === 'string' ? body.reportModel : undefined,
      });
      sendJson(response, 200, updated);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      sendJson(response, 400, { error: message.slice(0, 500) });
    }
    return;
  }

  if (url.pathname === '/api/settings/llm/test' && method === 'POST') {
    const raw = ctx.settings.getRaw().llm;
    const result = await testLlmConnection(raw);
    sendJson(response, result.ok ? 200 : 400, result);
    return;
  }

  if (url.pathname === '/api/branding/logo' && method === 'GET') {
    const logoPath = ctx.settings.logoAbsolutePath();
    if (!logoPath || !existsSync(logoPath)) {
      sendJson(response, 404, { error: 'logo_not_found' });
      return;
    }
    const data = await readFile(logoPath);
    response.writeHead(200, {
      'content-type': contentTypeFor(logoPath),
      'content-length': data.byteLength,
      'cache-control': 'no-store',
    });
    response.end(data);
    return;
  }

  if (url.pathname === '/api/runs' && method === 'GET') {
    const runs = await ctx.store.listRuns();
    sendJson(response, 200, { runs: runs.map(toPublicRun) });
    return;
  }

  if (url.pathname === '/api/runs' && method === 'POST') {
    let body: unknown;
    try {
      body = await readJsonBody(request);
    } catch {
      sendJson(response, 400, { error: 'invalid_json' });
      return;
    }
    const record = body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
    const targetUrl = typeof record.targetUrl === 'string' ? record.targetUrl.trim() : '';
    const userBrief = typeof record.userBrief === 'string' ? record.userBrief : undefined;
    const parentRunId =
      typeof record.parentRunId === 'string' ? record.parentRunId.trim() : undefined;
    if (!targetUrl) {
      sendJson(response, 400, { error: 'targetUrl is required' });
      return;
    }
    try {
      const parsed = new URL(targetUrl);
      if (!['http:', 'https:'].includes(parsed.protocol)) {
        sendJson(response, 400, { error: 'Only HTTP(S) URLs are allowed.' });
        return;
      }
    } catch {
      sendJson(response, 400, { error: 'Invalid targetUrl' });
      return;
    }
    // Ensure latest LLM settings apply before queue picks up the job.
    ctx.settings.applyLlmToProcessEnv();
    const run = await ctx.store.createRun({ targetUrl, userBrief, parentRunId });
    ctx.queue.enqueue(run.id);
    sendJson(response, 201, toPublicRun(run));
    return;
  }

  const runMatch = /^\/api\/runs\/([^/]+)$/.exec(url.pathname);
  if (runMatch && method === 'GET') {
    const run = await ctx.store.getRun(decodeURIComponent(runMatch[1] ?? ''));
    if (run === undefined) {
      sendJson(response, 404, { error: 'not_found' });
      return;
    }
    sendJson(response, 200, toPublicRun(run));
    return;
  }

  const cancelMatch = /^\/api\/runs\/([^/]+)\/cancel$/.exec(url.pathname);
  if (cancelMatch && method === 'POST') {
    const id = decodeURIComponent(cancelMatch[1] ?? '');
    const run = await ctx.store.getRun(id);
    if (run === undefined) {
      sendJson(response, 404, { error: 'not_found' });
      return;
    }
    if (run.status === 'completed' || run.status === 'failed' || run.status === 'cancelled') {
      sendJson(response, 200, toPublicRun(run));
      return;
    }
    const updated = await ctx.store.updateRun(id, { status: 'cancelled' });
    await ctx.store.appendEvent(id, 'run.cancelled', {});
    sendJson(response, 200, toPublicRun(updated!));
    return;
  }

  const retestMatch = /^\/api\/runs\/([^/]+)\/retest$/.exec(url.pathname);
  if (retestMatch && method === 'POST') {
    const id = decodeURIComponent(retestMatch[1] ?? '');
    const source = await ctx.store.getRun(id);
    if (source === undefined) {
      sendJson(response, 404, { error: 'not_found' });
      return;
    }
    let issueHint: string | undefined;
    try {
      const body = (await readJsonBody(request)) as Record<string, unknown>;
      if (typeof body.issueId === 'string') issueHint = body.issueId;
      if (typeof body.issueTitle === 'string') {
        issueHint = issueHint ? `${issueHint}: ${body.issueTitle}` : body.issueTitle;
      }
    } catch {
      // empty body ok
    }
    const briefParts = [
      source.userBrief ?? '',
      issueHint ? `Retest focus: ${issueHint}` : 'Retest previous acceptance run.',
    ].filter((part) => part.trim().length > 0);
    ctx.settings.applyLlmToProcessEnv();
    const run = await ctx.store.createRun({
      targetUrl: source.targetUrl,
      userBrief: briefParts.join('\n'),
      parentRunId: source.id,
    });
    ctx.queue.enqueue(run.id);
    sendJson(response, 201, toPublicRun(run));
    return;
  }

  const reportMatch = /^\/api\/runs\/([^/]+)\/report\.md$/.exec(url.pathname);
  if (reportMatch && method === 'GET') {
    const id = decodeURIComponent(reportMatch[1] ?? '');
    const run = await ctx.store.getRun(id);
    if (run === undefined) {
      sendJson(response, 404, { error: 'not_found' });
      return;
    }
    const productName = ctx.settings.toPublic().branding.productName;
    const markdown = buildReportMarkdown(run, productName);
    response.writeHead(200, {
      'content-type': 'text/markdown; charset=utf-8',
      'content-length': Buffer.byteLength(markdown),
      'cache-control': 'no-store',
    });
    response.end(markdown);
    return;
  }

  const eventsMatch = /^\/api\/runs\/([^/]+)\/events$/.exec(url.pathname);
  if (eventsMatch && method === 'GET') {
    const id = decodeURIComponent(eventsMatch[1] ?? '');
    const run = await ctx.store.getRun(id);
    if (run === undefined) {
      sendJson(response, 404, { error: 'not_found' });
      return;
    }

    const lastEventIdHeader = request.headers['last-event-id'];
    const afterId = Number(
      url.searchParams.get('after') ??
        (typeof lastEventIdHeader === 'string' ? lastEventIdHeader : 0),
    );

    response.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'access-control-allow-origin': '*',
    });
    response.write(': connected\n\n');

    const history = await ctx.store.listEvents(id, Number.isFinite(afterId) ? afterId : 0);
    for (const event of history) {
      response.write(
        `id: ${event.id}\nevent: ${event.type}\ndata: ${JSON.stringify({
          id: event.id,
          type: event.type,
          payload: event.payload,
          createdAt: event.createdAt,
        })}\n\n`,
      );
    }

    let clients = SSE_CLIENTS.get(id);
    if (clients === undefined) {
      clients = new Set();
      SSE_CLIENTS.set(id, clients);
    }
    clients.add(response);

    const heartbeat = setInterval(() => {
      response.write(': ping\n\n');
    }, 15_000);

    request.on('close', () => {
      clearInterval(heartbeat);
      clients?.delete(response);
      if (clients && clients.size === 0) SSE_CLIENTS.delete(id);
    });
    return;
  }

  if (method === 'GET') {
    if (serveStatic(response, ctx.staticDirectory, url.pathname)) return;
    if (url.pathname === '/' || url.pathname === '/index.html') {
      response.writeHead(200, {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-store',
      });
      response.end(PLACEHOLDER_HTML);
      return;
    }
  }

  sendJson(response, 404, { error: 'not_found', path: url.pathname });
}
