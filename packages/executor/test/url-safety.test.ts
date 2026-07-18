import { describe, expect, it } from 'vitest';

import { PublicUrlGuard, UnsafeUrlError, isForbiddenIpAddress } from '../src/index.js';

describe('PublicUrlGuard', () => {
  it('blocks literal private, loopback, link-local, and reserved addresses', async () => {
    const guard = new PublicUrlGuard();
    for (const url of [
      'http://127.0.0.1',
      'http://10.0.0.1',
      'http://169.254.169.254/latest/meta-data',
      'http://192.168.1.2',
      'http://[::1]',
      'http://[fc00::1]',
    ]) {
      await expect(guard.assertAllowed(url)).rejects.toBeInstanceOf(UnsafeUrlError);
    }
  });

  it('blocks hostnames resolving to any private address', async () => {
    const guard = new PublicUrlGuard(async () => [
      { address: '8.8.8.8', family: 4 },
      { address: '10.0.0.4', family: 4 },
    ]);
    await expect(guard.assertAllowed('https://example.test')).rejects.toThrow('blocked address');
  });

  it('accepts an http URL resolving only to public addresses', async () => {
    const guard = new PublicUrlGuard(async () => [{ address: '8.8.8.8', family: 4 }]);
    await expect(guard.assertAllowed('https://example.test/path')).resolves.toMatchObject({
      origin: 'https://example.test',
    });
  });

  it('classifies representative address ranges', () => {
    expect(isForbiddenIpAddress('172.16.0.1')).toBe(true);
    expect(isForbiddenIpAddress('203.0.113.10')).toBe(true);
    expect(isForbiddenIpAddress('8.8.8.8')).toBe(false);
  });
});
