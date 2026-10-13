import { auth, clerkClient } from '@clerk/nextjs/server';
import { NextRequest, NextResponse } from 'next/server';
import { ablyPublish } from '@/lib/ably-channel';
import { parseThemeSelection, themeChannelForUser } from '@/lib/theme';

export const dynamic = 'force-dynamic';

/**
 * Saves the signed-in person's theme colour on their account and pushes it to their other open
 * devices immediately. Only the `theme` key of their metadata is touched.
 */
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

  const theme = {
    accent: selection.accent,
    customColor: selection.customColor,
    updatedAt: selection.updatedAt || Date.now(),
  };

  try {
    const client = await clerkClient();
    const user = await client.users.getUser(userId);
    const current = parseThemeSelection((user.unsafeMetadata as Record<string, unknown> | undefined)?.theme);
    // Never let an older change (for example a slow request from another device) overwrite a newer one.
    if (current?.updatedAt && current.updatedAt > theme.updatedAt) {
      return NextResponse.json({ theme: current, stale: true });
    }

    await client.users.updateUserMetadata(userId, { unsafeMetadata: { theme } });
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
