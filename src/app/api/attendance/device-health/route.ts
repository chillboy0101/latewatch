import { NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth/roles';
import { getDeviceSessionHealth } from '@/lib/device-session-health';

export const dynamic = 'force-dynamic';

async function requireAdmin() {
  try {
    await requireRole(['admin']);
    return null;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unauthorized';
    return { error: message, status: message === 'Forbidden' ? 403 : 401 };
  }
}

export async function GET() {
  const adminError = await requireAdmin();
  if (adminError) {
    return NextResponse.json({ error: adminError.error }, { status: adminError.status });
  }

  const result = await getDeviceSessionHealth();

  return NextResponse.json(result, {
    headers: { 'Cache-Control': 'no-store' },
  });
}
