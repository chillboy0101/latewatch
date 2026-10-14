import { NextResponse } from 'next/server';
import { enforceRole } from '@/lib/auth/roles';
import { getDeviceSessionHealth } from '@/lib/device-session-health';

export const dynamic = 'force-dynamic';

export async function GET() {
  const adminError = await enforceRole(['admin']);
  if (adminError) {
    return NextResponse.json({ error: adminError.error }, { status: adminError.status });
  }

  try {
    const result = await getDeviceSessionHealth();
    return NextResponse.json(result, {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    console.error('Failed to load device health:', error);
    return NextResponse.json({ error: 'Could not load device health. Try again.' }, { status: 500 });
  }
}
