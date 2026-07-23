import { NextResponse } from 'next/server';
import { enforceRole } from '@/lib/auth/roles';
import { getSecurityAlerts } from '@/lib/security-alerts';

export const dynamic = 'force-dynamic';

export async function GET() {
  const adminError = await enforceRole(['admin']);
  if (adminError) {
    return NextResponse.json({ error: adminError.error }, { status: adminError.status });
  }

  const result = await getSecurityAlerts();

  return NextResponse.json(result, {
    headers: { 'Cache-Control': 'no-store' },
  });
}
