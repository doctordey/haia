import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { offsetHistory } from '@/lib/db/schema';
import { desc, gte } from 'drizzle-orm';

/**
 * GET /api/signals/offset/history — offset history for charting
 * Query params: ?limit=100&from=ISO
 */
export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = request.nextUrl;
  const limit = Math.min(500, parseInt(searchParams.get('limit') || '100'));
  const from = searchParams.get('from');

  const conditions = [];
  if (from) conditions.push(gte(offsetHistory.receivedAt, new Date(from)));

  const rows = await db
    .select()
    .from(offsetHistory)
    .where(conditions.length > 0 ? conditions[0] : undefined)
    .orderBy(desc(offsetHistory.receivedAt))
    .limit(limit);

  // Return in chronological order for charting
  return NextResponse.json(rows.reverse());
}
