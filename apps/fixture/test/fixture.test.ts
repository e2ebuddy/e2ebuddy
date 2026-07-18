import type { AddressInfo } from 'node:net';

import { afterEach, describe, expect, it } from 'vitest';

import { createFixtureServer } from '../src/index.js';

const servers = new Set<ReturnType<typeof createFixtureServer>>();

afterEach(async () => {
  await Promise.all([...servers].map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
  servers.clear();
});

describe('defect fixture', () => {
  it('serves a stable page containing all deterministic defect signals', async () => {
    const server = createFixtureServer().listen(0, '127.0.0.1');
    servers.add(server);
    await new Promise<void>((resolve) => server.once('listening', resolve));
    const port = (server.address() as AddressInfo).port;
    const html = await fetch(`http://127.0.0.1:${port}/`).then((response) => response.text());
    expect(html).toContain('id="dead-start"');
    expect(html).toContain('Lorem ipsum');
    expect(html).toContain('width: 720px');
    expect(html).toContain('Quantity: 2 · Unit price: $25');
    expect(html).toContain('Total: $40');
    expect(html).not.toContain('export campaign results as CSV');
  });

  it('serves a functional login demo with documented fake credentials', async () => {
    const server = createFixtureServer().listen(0, '127.0.0.1');
    servers.add(server);
    await new Promise<void>((resolve) => server.once('listening', resolve));
    const port = (server.address() as AddressInfo).port;
    const response = await fetch(`http://127.0.0.1:${port}/demo/login`);
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(html).toContain('BuddyBoard Login Demo');
    expect(html).toContain('autocomplete="username"');
    expect(html).toContain('autocomplete="current-password"');
    expect(html).toContain('demo@e2ebuddy.dev');
    expect(html).toContain('Create test run');
    expect(html).toContain('Log out');
  });
});
