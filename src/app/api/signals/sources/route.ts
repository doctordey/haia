import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { signalSources } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';

/**
 * GET /api/signals/sources — list the user's signal sources
 */
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const sources = await db.query.signalSources.findMany({
    where: eq(signalSources.userId, session.user.id),
  });

  return NextResponse.json(sources);
}

/**
 * POST /api/signals/sources — create a new signal source
 * Body: { name: string, telegramChannelId?: string, telegramChannelName?: string, priceFeed: string }
 */
export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json();
  const { name, telegramChannelId, telegramChannelName, priceFeed } = body;

  if (!name || !priceFeed) {
    return NextResponse.json({ error: 'name and priceFeed are required' }, { status: 400 });
  }

  const [source] = await db
    .insert(signalSources)
    .values({
      userId: session.user.id,
      name,
      telegramChannelId: telegramChannelId || null,
      telegramChannelName: telegramChannelName || null,
      priceFeed,
    })
    .returning();

  return NextResponse.json(source, { status: 201 });
}
