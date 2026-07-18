import { BlockList, isIP } from 'node:net';
import { lookup } from 'node:dns/promises';

import { HttpUrlSchema } from 'shared';

export interface ResolvedAddress {
  address: string;
  family: number;
}

export type HostResolver = (hostname: string) => Promise<readonly ResolvedAddress[]>;

export interface UrlGuard {
  assertAllowed(rawUrl: string): Promise<URL>;
}

export class UnsafeUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnsafeUrlError';
  }
}

const blockedAddresses = new BlockList();

for (const [network, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
] as const) {
  blockedAddresses.addSubnet(network, prefix, 'ipv4');
}

for (const [network, prefix] of [
  ['::', 128],
  ['::1', 128],
  ['fc00::', 7],
  ['fe80::', 10],
  ['ff00::', 8],
  ['2001:db8::', 32],
] as const) {
  blockedAddresses.addSubnet(network, prefix, 'ipv6');
}

const defaultResolver: HostResolver = async (hostname) =>
  lookup(hostname, { all: true, verbatim: true });

export function isForbiddenIpAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return blockedAddresses.check(address, 'ipv4');
  if (family === 6) {
    const mappedIpv4 = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(address)?.[1];
    if (mappedIpv4 !== undefined) return isForbiddenIpAddress(mappedIpv4);
    return blockedAddresses.check(address, 'ipv6');
  }
  return true;
}

export class PublicUrlGuard implements UrlGuard {
  constructor(private readonly resolveHost: HostResolver = defaultResolver) {}

  async assertAllowed(rawUrl: string): Promise<URL> {
    let url: URL;
    try {
      url = new URL(HttpUrlSchema.parse(rawUrl));
    } catch {
      throw new UnsafeUrlError('Only valid http and https URLs are allowed.');
    }

    const hostname = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
    if (
      hostname === 'localhost' ||
      hostname.endsWith('.localhost') ||
      hostname.endsWith('.local')
    ) {
      throw new UnsafeUrlError(`Local hostname is blocked: ${hostname}`);
    }

    const literalFamily = isIP(hostname);
    const addresses =
      literalFamily === 0
        ? await this.resolveHost(hostname).catch(() => {
            throw new UnsafeUrlError(`Unable to resolve target hostname: ${hostname}`);
          })
        : [{ address: hostname, family: literalFamily }];

    if (addresses.length === 0) {
      throw new UnsafeUrlError(`Target hostname resolved to no addresses: ${hostname}`);
    }
    for (const resolved of addresses) {
      if (isForbiddenIpAddress(resolved.address)) {
        throw new UnsafeUrlError(`Target resolves to a blocked address: ${resolved.address}`);
      }
    }

    return url;
  }
}

export function hasSameOrigin(candidate: URL, targetOrigin: string): boolean {
  return candidate.origin === targetOrigin;
}
