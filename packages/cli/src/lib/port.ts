import { createServer } from 'node:net';

export type ListenTarget = {
  host: string;
  port: number;
};

/**
 * Probe whether a TCP port can be bound. Resolves true when free.
 */
export function isPortFree(host: string, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer();
    server.unref();
    server.once('error', () => resolve(false));
    server.listen({ host, port, exclusive: true }, () => {
      server.close(() => resolve(true));
    });
  });
}

/**
 * Pick host:port for the local web server.
 * Prefer the requested port; on conflict walk upward then try ephemeral (0).
 */
export async function resolveListenAddress(options: {
  host: string;
  port: number;
  maxAttempts?: number;
}): Promise<ListenTarget> {
  const maxAttempts = options.maxAttempts ?? 50;
  const requested = options.port;

  if (await isPortFree(options.host, requested)) {
    return { host: options.host, port: requested };
  }

  for (let offset = 1; offset < maxAttempts; offset += 1) {
    const candidate = requested + offset;
    if (candidate > 65_535) break;
    if (await isPortFree(options.host, candidate)) {
      return { host: options.host, port: candidate };
    }
  }

  // Last resort: OS-assigned ephemeral port.
  const ephemeral = await bindEphemeral(options.host);
  return ephemeral;
}

function bindEphemeral(host: string): Promise<ListenTarget> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen({ host, port: 0, exclusive: true }, () => {
      const address = server.address();
      if (address === null || typeof address === 'string') {
        server.close();
        reject(new Error('Failed to allocate an ephemeral port.'));
        return;
      }
      const port = address.port;
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve({ host, port });
      });
    });
  });
}
