import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { signalSources } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';

/**
 * GET /api/signals/telegram/status
 * Returns Telegram connection status for the user's signal sources.
 */
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const sources = await db.query.signalSources.findMany({
    where: eq(signalSources.userId, session.user.id),
    columns: {
      id: true,
      name: true,
      telegramChannelId: true,
      telegramChannelName: true,
      telegramPhone: true,
      telegramStatus: true,
      isActive: true,
    },
  });

  return NextResponse.json(sources);
}
