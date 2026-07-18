import { createServer, type Server } from 'node:http';

import { chromium, type Browser } from 'playwright';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { PageExecutor, type UrlGuard } from '../src/index.js';

class LocalTestUrlGuard implements UrlGuard {
  async assertAllowed(rawUrl: string): Promise<URL> {
    const url = new URL(rawUrl);
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Unsafe test URL.');
    return url;
  }
}

const pageHtml = `<!doctype html>
<html>
  <head><title>Executor Fixture</title></head>
  <body>
    <button id="first" onclick="result.textContent='first-clicked'">Duplicate</button>
    <button id="second" onclick="result.textContent='second-clicked'">Duplicate</button>
    <button id="noop">No visible change</button>
    <button id="payment" onclick="result.textContent='paid'">Confirm payment</button>
    <button id="script-popup" onclick="window.open('/second', '_blank')">Open helper</button>
    <a id="external" href="https://example.org/path">External link</a>
    <a id="download" href="data:text/plain,secret" download="secret.txt">Download</a>
    <a id="popup" href="/second" target="_blank">New tab</a>
    <a href="/login">Log in</a>
    <label>Query <input id="query" /></label>
    <label>Category
      <select id="category">
        <option value="a">Alpha</option>
        <option value="b">Beta</option>
      </select>
    </label>
    <div id="result" role="status">idle</div>
    <div style="height: 2000px">Tall content</div>
  </body>
</html>`;

let server: Server;
let browser: Browser;
let baseUrl: string;
const executors: PageExecutor[] = [];

beforeAll(async () => {
  server = createServer((request, response) => {
    response.setHeader('content-type', 'text/html; charset=utf-8');
    if (request.url === '/login') {
      response.end(`<!doctype html><title>Login</title><form onsubmit="event.preventDefault();location.href='/dashboard'">
        <label>Email <input type="email" autocomplete="username"></label>
        <label>Password <input type="password" autocomplete="current-password"></label>
        <button type="submit">Log in</button></form>`);
      return;
    }
    if (request.url === '/dashboard') {
      response.end('<!doctype html><title>Dashboard</title><main><h1>Welcome back</h1></main>');
      return;
    }
    if (request.url === '/second') {
      response.end('<!doctype html><title>Second</title><main>Second page</main>');
      return;
    }
    response.end(pageHtml);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('Fixture server failed.');
  baseUrl = `http://127.0.0.1:${address.port}`;
  browser = await chromium.launch({ headless: true });
});

afterEach(async () => {
  await Promise.all(executors.splice(0).map(async (executor) => executor.close()));
});

afterAll(async () => {
  await browser.close();
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error === undefined ? resolve() : reject(error)));
  });
});

async function launch(overrides: Partial<Parameters<typeof PageExecutor.launch>[0]> = {}) {
  const executor = await PageExecutor.launch({
    targetUrl: baseUrl,
    browser,
    urlGuard: new LocalTestUrlGuard(),
    stabilityTimeoutMs: 100,
    ...overrides,
  });
  executors.push(executor);
  return executor;
}

function refByName(
  perception: Awaited<ReturnType<PageExecutor['perceive']>>,
  name: string,
  occurrence = 0,
): string {
  const matches = perception.interactables.filter((item) => item.name === name);
  const match = matches[occurrence];
  if (match === undefined) throw new Error(`Missing interactable: ${name}[${occurrence}]`);
  return match.ref;
}

describe('PageExecutor', () => {
  it('uses unique refs even when accessible role and name are identical', async () => {
    const executor = await launch();
    const perception = await executor.perceive();
    const duplicateButtons = perception.interactables.filter((item) => item.name === 'Duplicate');

    expect(duplicateButtons).toHaveLength(2);
    expect(duplicateButtons[0]?.ref).not.toBe(duplicateButtons[1]?.ref);

    const result = await executor.execute({
      type: 'click',
      ref: duplicateButtons[1]?.ref ?? '',
    });
    expect(result.outcome).toBe('ok');
    expect(result.perception.a11yTree).toContain('second-clicked');
  });

  it('includes deterministic scroll and hash-target layout diagnostics', async () => {
    const executor = await launch();
    const perception = await executor.perceive();

    expect(perception.a11yTree).toContain('[layout] viewport=');
    expect(perception.a11yTree).toContain('scroll=0,0');
    expect(perception.a11yTree).toContain('maxScrollY=');
    expect(perception.a11yTree).toContain('hashTarget=""');
    expect(perception.a11yTree).toContain('hashTargetTop=none');
  });

  it('executes every allowed action and reports no visible change', async () => {
    const executor = await launch();
    let perception = await executor.perceive();

    let result = await executor.execute({
      type: 'type',
      ref: refByName(perception, 'Query'),
      text: 'playwright',
    });
    expect(result.outcome).toBe('ok');
    perception = result.perception;

    result = await executor.execute({
      type: 'select',
      ref: refByName(perception, 'Category'),
      value: 'b',
    });
    expect(result.outcome).toBe('ok');
    expect(await executor.page.locator('#category').inputValue()).toBe('b');

    await expect(executor.execute({ type: 'scroll', direction: 'down' })).resolves.toMatchObject({
      outcome: 'ok',
    });
    await expect(executor.execute({ type: 'wait', ms: 1 })).resolves.toMatchObject({ outcome: 'ok' });
    await expect(
      executor.execute({ type: 'setViewport', preset: 'mobile' }),
    ).resolves.toMatchObject({ outcome: 'ok' });
    expect(executor.page.viewportSize()).toEqual({ width: 375, height: 812 });

    await expect(
      executor.execute({ type: 'navigate', url: `${baseUrl}/second` }),
    ).resolves.toMatchObject({ outcome: 'ok' });
    await expect(executor.execute({ type: 'done', reason: 'complete' })).resolves.toMatchObject({
      outcome: 'ok',
    });

    const secondExecutor = await launch();
    perception = await secondExecutor.perceive();
    const unchanged = await secondExecutor.execute({
      type: 'click',
      ref: refByName(perception, 'No visible change'),
    });
    expect(unchanged.outcome).toBe('no-visible-change');
  });

  it('blocks payments, downloads, popups, and cross-origin navigation', async () => {
    const cases = [
      ['Confirm payment', 'irreversible'],
      ['Download', 'download'],
      ['New tab', 'browsing context'],
      ['External link', 'Cross-origin'],
    ] as const;

    for (const [name, note] of cases) {
      const executor = await launch();
      const perception = await executor.perceive();
      const result = await executor.execute({ type: 'click', ref: refByName(perception, name) });
      expect(result.outcome).toBe('blocked');
      expect(result.note?.toLowerCase()).toContain(note.toLowerCase());
      await executor.close();
      executors.splice(executors.indexOf(executor), 1);
    }

    const scriptPopupExecutor = await launch();
    const perception = await scriptPopupExecutor.perceive();
    const popupResult = await scriptPopupExecutor.execute({
      type: 'click',
      ref: refByName(perception, 'Open helper'),
    });
    expect(popupResult.outcome).toBe('blocked');
    expect(popupResult.note).toContain('popup');

    await expect(
      scriptPopupExecutor.execute({ type: 'navigate', url: 'https://example.org' }),
    ).resolves.toMatchObject({ outcome: 'blocked' });
  });

  it('converts Playwright failures and configured limits into outcomes', async () => {
    const executor = await launch({ caseStepLimit: 1 });
    const failure = await executor.execute({ type: 'click', ref: 'e9999' });
    expect(failure.outcome).toBe('error');
    expect(failure.note).toContain('stale element ref');

    await expect(executor.execute({ type: 'wait', ms: 0 })).resolves.toMatchObject({
      outcome: 'blocked',
      note: 'Case step limit reached.',
    });

    const timedOut = await launch({ runTimeoutMs: 0 });
    await expect(timedOut.execute({ type: 'wait', ms: 0 })).resolves.toMatchObject({
      outcome: 'blocked',
      note: 'Run time limit reached.',
    });
  });

  it('performs trusted login without returning plaintext credentials in perception', async () => {
    const executor = await launch();
    const result = await executor.trustedLogin({
      username: 'private-user@example.com',
      password: 'private-password',
    });
    expect(result).toEqual({ success: true, note: 'Login completed.' });
    const perception = await executor.perceive();
    expect(perception.url).toBe(`${baseUrl}/dashboard`);
    expect(perception.a11yTree).toContain('Welcome back');
    expect(JSON.stringify(perception)).not.toContain('private-user@example.com');
    expect(JSON.stringify(perception)).not.toContain('private-password');
  });
});
