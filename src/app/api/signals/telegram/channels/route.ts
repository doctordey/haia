import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { signalSources } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';

/**
 * GET /api/signals/telegram/channels
 * Returns channels recently seen by the Telegram listener.
 * This helps users find the correct channel ID.
 */
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // The seen channels are in the worker's memory — we can't access them from the API server.
  // Instead, return the stored channel IDs from signal sources as a reference,
  // plus a note that the auto-detect will update them.
  const sources = await db.query.signalSources.findMany({
    where: eq(signalSources.userId, session.user.id),
    columns: {
      id: true,
      name: true,
      telegramChannelId: true,
      telegramChannelName: true,
      telegramStatus: true,
    },
  });

  return NextResponse.json({
    sources,
    note: 'Channel IDs are auto-detected when messages arrive. Send a message in your signal channel and the ID will update automatically.',
  });
}
