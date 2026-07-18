import { describe, expect, it } from 'vitest';

import { decryptCredentials, encryptCredentials, parseEncryptionKey, redactSecrets } from '../src/index.js';

describe('credential protection', () => {
  it('round-trips authenticated AES-256-GCM without embedding plaintext', () => {
    const key = new Uint8Array(32).fill(7);
    const credentials = { username: 'qa@example.com', password: 'very-secret' };
    const encrypted = encryptCredentials(credentials, key);
    expect(encrypted).not.toContain(credentials.username);
    expect(encrypted).not.toContain(credentials.password);
    expect(decryptCredentials(encrypted, key)).toEqual(credentials);
    const parts = encrypted.split('.');
    const ciphertext = parts[3] ?? '';
    parts[3] = `${ciphertext.startsWith('A') ? 'B' : 'A'}${ciphertext.slice(1)}`;
    expect(() => decryptCredentials(parts.join('.'), key)).toThrow('could not be authenticated');
  });

  it('validates key size and redacts known secret values', () => {
    expect(parseEncryptionKey(Buffer.alloc(32, 1).toString('base64'))).toHaveLength(32);
    expect(() => parseEncryptionKey('short')).toThrow('exactly 32 bytes');
    expect(redactSecrets('password=abc token=abc', ['abc'])).toBe('password=[REDACTED] token=[REDACTED]');
  });
});
