import type { NextRequest } from 'next/server';

let cachedLocalPublicIp: string | null = null;

export type ClientIpSource =
  | 'cf-connecting-ip'
  | 'development-public-ip-fallback'
  | 'local'
  | 'x-client-ip'
  | 'x-forwarded-for'
  | 'x-real-ip'
  | 'x-vercel-forwarded-for';

export type ClientIpInfo = {
  ip: string;
  isPublic: boolean;
  source: ClientIpSource;
};

const IP_HEADERS: Array<{ header: string; source: ClientIpSource }> = [
  { header: 'x-vercel-forwarded-for', source: 'x-vercel-forwarded-for' },
  { header: 'x-forwarded-for', source: 'x-forwarded-for' },
  { header: 'x-real-ip', source: 'x-real-ip' },
  { header: 'cf-connecting-ip', source: 'cf-connecting-ip' },
  { header: 'x-client-ip', source: 'x-client-ip' },
];

function isValidIpv4(value: string) {
  const parts = value.split('.');
  if (parts.length !== 4) return false;

  return parts.every((part) => {
    if (!/^\d{1,3}$/.test(part)) return false;
    const number = Number(part);
    return number >= 0 && number <= 255;
  });
}

function isLikelyIpv6(value: string) {
  return value.includes(':') && /^[0-9a-f:.]+$/i.test(value);
}

function normalizeIpCandidate(value: string | null | undefined) {
  if (!value) return null;

  let candidate = value.trim().replace(/^"|"$/g, '');
  if (!candidate || candidate.toLowerCase() === 'unknown') return null;

  const bracketMatch = candidate.match(/^\[([^\]]+)\](?::\d+)?$/);
  if (bracketMatch) candidate = bracketMatch[1];

  if (candidate.startsWith('::ffff:')) candidate = candidate.slice(7);

  const ipv4WithPort = candidate.match(/^(\d{1,3}(?:\.\d{1,3}){3})(?::\d+)?$/);
  if (ipv4WithPort) candidate = ipv4WithPort[1];

  if (isValidIpv4(candidate) || isLikelyIpv6(candidate)) return candidate;
  return null;
}

function firstValidIpFromHeader(value: string | null | undefined) {
  if (!value) return null;

  for (const item of value.split(',')) {
    const ip = normalizeIpCandidate(item);
    if (ip) return ip;
  }

  return null;
}

export function getClientIpInfo(request: Pick<NextRequest, 'headers'>): ClientIpInfo {
  for (const { header, source } of IP_HEADERS) {
    const ip = firstValidIpFromHeader(request.headers.get(header));
    if (ip) {
      return {
        ip,
        isPublic: !isLoopbackIp(ip),
        source,
      };
    }
  }

  return {
    ip: 'local',
    isPublic: false,
    source: 'local',
  };
}

export function getClientIp(request: Pick<NextRequest, 'headers'>) {
  return getClientIpInfo(request).ip;
}

export function isLoopbackIp(ip: string) {
  return ip === 'local' ||
    ip === '::1' ||
    ip === '127.0.0.1' ||
    ip === '0:0:0:0:0:0:0:1';
}

async function getLocalPublicIpFallback() {
  if (cachedLocalPublicIp) return cachedLocalPublicIp;

  try {
    const response = await fetch('https://api.ipify.org?format=json', {
      cache: 'no-store',
      signal: AbortSignal.timeout(1500),
    });
    if (!response.ok) return null;

    const body = await response.json() as { ip?: unknown };
    if (typeof body.ip === 'string' && body.ip.trim()) {
      cachedLocalPublicIp = body.ip.trim();
      return cachedLocalPublicIp;
    }
  } catch {
    return null;
  }

  return null;
}

export async function resolveClientIp(request: Pick<NextRequest, 'headers'>) {
  return (await resolveClientIpInfo(request)).ip;
}

export async function resolveClientIpInfo(request: Pick<NextRequest, 'headers'>): Promise<ClientIpInfo> {
  const ipInfo = getClientIpInfo(request);

  if (process.env.NODE_ENV === 'development' && process.env.VERCEL !== '1' && isLoopbackIp(ipInfo.ip)) {
    const fallbackIp = await getLocalPublicIpFallback();
    if (fallbackIp) {
      return {
        ip: fallbackIp,
        isPublic: true,
        source: 'development-public-ip-fallback',
      };
    }
  }

  return ipInfo;
}
