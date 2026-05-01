import type { NextRequest } from 'next/server';

export function getClientIp(request: Pick<NextRequest, 'headers'>) {
  const rawIp = [
    request.headers.get('x-vercel-forwarded-for')?.split(',')[0],
    request.headers.get('cf-connecting-ip'),
    request.headers.get('x-real-ip'),
    request.headers.get('x-forwarded-for')?.split(',')[0],
    request.headers.get('x-client-ip'),
  ].find((value) => value && value.trim().length > 0)?.trim();

  if (!rawIp) return 'local';
  if (rawIp.startsWith('::ffff:')) return rawIp.slice(7);
  if (rawIp.startsWith('[') && rawIp.endsWith(']')) return rawIp.slice(1, -1);
  return rawIp;
}
