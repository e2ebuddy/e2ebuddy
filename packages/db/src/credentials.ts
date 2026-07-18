import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

import { LoginCredentialsSchema, type LoginCredentials } from 'shared';

const algorithm = 'aes-256-gcm';

export function parseEncryptionKey(encoded: string): Buffer {
  const key = Buffer.from(encoded, 'base64');
  if (key.byteLength !== 32) {
    throw new Error('CREDENTIALS_ENCRYPTION_KEY must be base64 for exactly 32 bytes.');
  }
  return key;
}

export function encryptCredentials(credentials: LoginCredentials, key: Uint8Array): string {
  if (key.byteLength !== 32) throw new Error('Credential encryption requires a 32-byte key.');
  const validated = LoginCredentialsSchema.parse(credentials);
  const iv = randomBytes(12);
  const cipher = createCipheriv(algorithm, key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(validated), 'utf8'),
    cipher.final(),
  ]);
  return ['v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), ciphertext.toString('base64url')].join('.');
}

export function decryptCredentials(value: string, key: Uint8Array): LoginCredentials {
  if (key.byteLength !== 32) throw new Error('Credential decryption requires a 32-byte key.');
  const [version, ivValue, tagValue, ciphertextValue] = value.split('.');
  if (version !== 'v1' || ivValue === undefined || tagValue === undefined || ciphertextValue === undefined) {
    throw new Error('Unsupported credential ciphertext format.');
  }
  try {
    const decipher = createDecipheriv(algorithm, key, Buffer.from(ivValue, 'base64url'));
    decipher.setAuthTag(Buffer.from(tagValue, 'base64url'));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(ciphertextValue, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
    return LoginCredentialsSchema.parse(JSON.parse(plaintext));
  } catch {
    throw new Error('Credential ciphertext could not be authenticated.');
  }
}

export function redactSecrets(message: string, secrets: readonly string[]): string {
  return secrets
    .filter((secret) => secret.length > 0)
    .reduce((result, secret) => result.split(secret).join('[REDACTED]'), message)
    .slice(0, 10_000);
}
