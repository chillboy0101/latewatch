import { currentUser } from '@clerk/nextjs/server';
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { officeNetwork } from '@/db/schema';
import { getActiveOfficeNetwork, isOfficeIp, resolveClientIpInfo } from '@/lib/attendance';
import { writeAuditEvent } from '@/lib/audit';
import { publishRealtime } from '@/lib/realtime';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const network = await getActiveOfficeNetwork();
  const currentIpInfo = await resolveClientIpInfo(request);
  const currentIp = currentIpInfo.ip;

  return NextResponse.json({
    configured: Boolean(network),
    currentIp,
    currentIpSource: currentIpInfo.source,
    isOfficeNetwork: network ? isOfficeIp(currentIp, network.allowedIp) : false,
    network: network
      ? {
          id: network.id,
          allowedIp: network.allowedIp,
          name: network.name,
          updatedAt: network.updatedAt,
          updatedByEmail: network.updatedByEmail,
        }
      : null,
  }, {
    headers: { 'Cache-Control': 'no-store' },
  });
}

export async function POST(request: NextRequest) {
  try {
    const user = await currentUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    const name = typeof body?.name === 'string' && body.name.trim()
      ? body.name.trim()
      : 'Office WiFi';
    const currentIpInfo = await resolveClientIpInfo(request);
    const currentIp = currentIpInfo.ip;
    const actorEmail = user.emailAddresses[0]?.emailAddress || 'unknown';
    const before = await getActiveOfficeNetwork();

    await db.update(officeNetwork)
      .set({ isActive: false, updatedAt: new Date() });

    const [network] = await db.insert(officeNetwork).values({
      name,
      allowedIp: currentIp,
      isActive: true,
      updatedByUserId: user.id,
      updatedByEmail: actorEmail,
      updatedAt: new Date(),
    }).returning();

    await writeAuditEvent({
      entityType: 'office_network',
      entityId: network.id,
      action: before ? 'UPDATE' : 'CREATE',
      before,
      after: {
        ...network,
        detectedIpSource: currentIpInfo.source,
      },
      actor: { email: actorEmail, id: user.id },
      reason: 'attendance-network',
    });

    publishRealtime('dashboard', 'invalidate', { reason: 'attendance-network' });

    return NextResponse.json({
      success: true,
      currentIp,
      currentIpSource: currentIpInfo.source,
      network: {
        id: network.id,
        allowedIp: network.allowedIp,
        name: network.name,
        updatedAt: network.updatedAt,
        updatedByEmail: network.updatedByEmail,
      },
    });
  } catch (error) {
    console.error('Failed to update office network:', error);
    return NextResponse.json({ error: 'Failed to update office network' }, { status: 500 });
  }
}
