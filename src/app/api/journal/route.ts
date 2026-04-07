import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { tradeJournal } from '@/lib/db/schema';
import { eq, and, desc, gte, lte, like, isNull } from 'drizzle-orm';

/**
 * GET /api/journal — paginated list, filterable
 * Query: ?page=1&limit=20&setupType=breakout&instrument=NAS100&emotionalState=confident&from=ISO&to=ISO&tags=tag1,tag2&signalOnly=true
 */
export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = request.nextUrl;
  const page = Math.max(1, parseInt(searchParams.get('page') || '1'));
  const limit = Math.min(100, parseInt(searchParams.get('limit') || '20'));
  const setupType = searchParams.get('setupType');
  const instrument = searchParams.get('instrument');
  const emotionalState = searchParams.get('emotionalState');
  const from = searchParams.get('from');
  const to = searchParams.get('to');
  const tagsFilter = searchParams.get('tags');
  const signalOnly = searchParams.get('signalOnly');

  const conditions = [eq(tradeJournal.userId, session.user.id)];
  if (setupType) conditions.push(eq(tradeJournal.setupType, setupType));
  if (instrument) conditions.push(eq(tradeJournal.symbol, instrument));
  if (emotionalState) conditions.push(eq(tradeJournal.emotionalState, emotionalState));
  if (from) conditions.push(gte(tradeJournal.createdAt, new Date(from)));
  if (to) conditions.push(lte(tradeJournal.createdAt, new Date(to)));
  if (signalOnly === 'true') conditions.push(eq(tradeJournal.setupType, 'signal_copy'));
  if (tagsFilter) {
    for (const tag of tagsFilter.split(',')) {
      conditions.push(like(tradeJournal.tags, `%${tag.trim()}%`));
    }
  }

  const allEntries = await db
    .select()
    .from(tradeJournal)
    .where(and(...conditions))
    .orderBy(desc(tradeJournal.createdAt));

  const total = allEntries.length;
  const entries = allEntries.slice((page - 1) * limit, page * limit);

  return NextResponse.json({
    entries,
    pagination: { page, totalPages: Math.ceil(total / limit), total },
  });
}

/**
 * POST /api/journal — create entry
 */
export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json();

  const [entry] = await db
    .insert(tradeJournal)
    .values({
      userId: session.user.id,
      tradeId: body.tradeId || null,
      signalExecutionId: body.signalExecutionId || null,
      setupType: body.setupType || null,
      reasoning: body.reasoning || null,
      review: body.review || null,
      emotionalState: body.emotionalState || null,
      rating: body.rating != null ? Number(body.rating) : null,
      tags: body.tags ? JSON.stringify(body.tags) : null,
      screenshotUrls: body.screenshotUrls ? JSON.stringify(body.screenshotUrls) : null,
      symbol: body.symbol || null,
      direction: body.direction || null,
      pnl: body.pnl != null ? Number(body.pnl) : null,
      pnlPips: body.pnlPips != null ? Number(body.pnlPips) : null,
      entryTime: body.entryTime ? new Date(body.entryTime) : null,
      exitTime: body.exitTime ? new Date(body.exitTime) : null,
    })
    .returning();

  return NextResponse.json(entry, { status: 201 });
}
