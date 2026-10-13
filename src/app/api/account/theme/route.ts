import { auth } from '@clerk/nextjs/server';
import { NextRequest, NextResponse } from 'next/server';
import { ablyPublish } from '@/lib/ably-channel';
import { getRedis } from '@/lib/redis';
import { parseThemeSelection, themeChannelForUser, type ThemeSelection } from '@/lib/theme';

export const dynamic = 'force-dynamic';

// One theme colour per person, kept in Redis: fast, and not subject to the sign-in provider's API
// rate limits. Each save is pushed live to the person's other open devices.

function themeKey(userId: string) {
  return `theme:${userId}`;
}

async function readTheme(userId: string): Promise<ThemeSelection | null> {
  const redis = getRedis();
  if (!redis) return null;
  return parseThemeSelection(await redis.get(themeKey(userId)));
}

export async function GET() {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    return NextResponse.json({ theme: await readTheme(userId) }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('Failed to read theme colour:', error);
    return NextResponse.json({ error: 'Failed to read theme colour' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const redis = getRedis();
  if (!redis) {
    return NextResponse.json({ error: 'Theme sync storage is not configured' }, { status: 503 });
  }

  const body = await request.json().catch(() => null);
  const selection = parseThemeSelection(body);
  if (!selection) {
    return NextResponse.json({ error: 'Invalid theme colour' }, { status: 400 });
  }

  const theme: ThemeSelection = {
    accent: selection.accent,
    customColor: selection.customColor,
    updatedAt: selection.updatedAt || Date.now(),
  };

  try {
    const current = await readTheme(userId);
    // Never let an older change (for example a slow request from another device) overwrite a newer one.
    if (current?.updatedAt && current.updatedAt > (theme.updatedAt || 0)) {
      return NextResponse.json({ theme: current, stale: true });
    }

    await redis.set(themeKey(userId), theme);

    // Awaited: a serverless function can be frozen once the response is sent, which would drop it.
    try {
      await ablyPublish(`latewatch:${themeChannelForUser(userId)}`, 'theme', {
        sourceId: typeof body?.sourceId === 'string' ? body.sourceId.slice(0, 64) : null,
        theme,
      });
    } catch (error) {
      console.error('Failed to push theme colour to other devices:', error);
    }

    return NextResponse.json({ theme });
  } catch (error) {
    console.error('Failed to save theme colour:', error);
    return NextResponse.json({ error: 'Failed to save theme colour' }, { status: 500 });
  }
}
