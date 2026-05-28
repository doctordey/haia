import { NextRequest, NextResponse } from 'next/server';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { tvAlerts, tvAlertConfigs } from '@/lib/db/schema';

/**
 * GET /api/signals/tradingview/alerts?limit=20[&configId=xyz]
 * Returns the most recent tvAlerts that belong to one of this user's configs.
 */
export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const limit = Math.min(parseInt(request.nextUrl.searchParams.get('limit') ?? '20', 10) || 20, 100);
  const configIdFilter = request.nextUrl.searchParams.get('configId');

  // Scope to alerts whose config belongs to the caller.
  const userConfigs = await db
    .select({ id: tvAlertConfigs.id })
    .from(tvAlertConfigs)
    .where(eq(tvAlertConfigs.userId, session.user.id));

  const configIds = userConfigs.map((c) => c.id);
  if (configIds.length === 0) return NextResponse.json([]);

  const where = configIdFilter
    ? and(inArray(tvAlerts.configId, configIds), eq(tvAlerts.configId, configIdFilter))
    : inArray(tvAlerts.configId, configIds);

  const rows = await db
    .select()
    .from(tvAlerts)
    .where(where)
    .orderBy(desc(tvAlerts.receivedAt))
    .limit(limit);

  return NextResponse.json(rows);
}
