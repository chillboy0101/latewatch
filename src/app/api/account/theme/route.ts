import { auth } from '@clerk/nextjs/server';
import { eq, sql } from 'drizzle-orm';
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { userThemePreference } from '@/db/schema';
import { ablyPublish } from '@/lib/ably-channel';
import { parseThemeSelection, themeChannelForUser, type ThemeSelection } from '@/lib/theme';

export const dynamic = 'force-dynamic';

// One theme colour per person, stored in the app database and pushed live to the person's other
// open devices on every save. The newest choice always wins.

async function readTheme(userId: string): Promise<ThemeSelection | null> {
  const [row] = await db.select()
    .from(userThemePreference)
    .where(eq(userThemePreference.userId, userId))
    .limit(1);
  return row
    ? parseThemeSelection({ accent: row.accent, customColor: row.customColor, mode: row.mode, updatedAt: Number(row.updatedAt) })
    : null;
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

  const body = await request.json().catch(() => null);
  const selection = parseThemeSelection(body);
  if (!selection) {
    return NextResponse.json({ error: 'Invalid theme colour' }, { status: 400 });
  }

  const theme: ThemeSelection = {
    accent: selection.accent,
    customColor: selection.customColor,
    mode: selection.mode,
    updatedAt: selection.updatedAt || Date.now(),
  };

  try {
    // Newest wins in one statement: an older save (e.g. a slow request from another device) is ignored.
    const saved = await db.insert(userThemePreference)
      .values({ accent: theme.accent, customColor: theme.customColor, mode: theme.mode ?? null, updatedAt: theme.updatedAt!, userId })
      .onConflictDoUpdate({
        set: {
          accent: sql`excluded.accent`,
          customColor: sql`excluded.custom_color`,
          // Keep the stored mode when an older client sends none.
          mode: sql`coalesce(excluded.mode, ${userThemePreference.mode})`,
          updatedAt: sql`excluded.updated_at`,
        },
        target: userThemePreference.userId,
        setWhere: sql`${userThemePreference.updatedAt} <= excluded.updated_at`,
      })
      .returning({ userId: userThemePreference.userId });

    if (saved.length === 0) {
      return NextResponse.json({ stale: true, theme: await readTheme(userId) });
    }

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
