import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { signalExecutions, signalConfigs } from '@/lib/db/schema';
import { eq, and, desc, gte, lte } from 'drizzle-orm';

/**
 * GET /api/signals/executions — filterable list of executions
 * Query params: ?page=1&limit=50&instrument=NQ|ES&status=filled&from=ISO&to=ISO
 */
export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const config = await db.query.signalConfigs.findFirst({
    where: eq(signalConfigs.userId, session.user.id),
  });
  if (!config) return NextResponse.json({ executions: [], pagination: { page: 1, totalPages: 0, total: 0 } });

  const { searchParams } = request.nextUrl;
  const page = Math.max(1, parseInt(searchParams.get('page') || '1'));
  const limit = Math.min(100, parseInt(searchParams.get('limit') || '50'));
  const instrument = searchParams.get('instrument');
  const status = searchParams.get('status');
  const from = searchParams.get('from');
  const to = searchParams.get('to');

  const conditions = [eq(signalExecutions.configId, config.id)];
  if (instrument) conditions.push(eq(signalExecutions.instrument, instrument));
  if (status) conditions.push(eq(signalExecutions.status, status));
  if (from) conditions.push(gte(signalExecutions.createdAt, new Date(from)));
  if (to) conditions.push(lte(signalExecutions.createdAt, new Date(to)));

  const allExecs = await db
    .select()
    .from(signalExecutions)
    .where(and(...conditions))
    .orderBy(desc(signalExecutions.createdAt));

  const total = allExecs.length;
  const paginated = allExecs.slice((page - 1) * limit, page * limit);

  return NextResponse.json({
    executions: paginated,
    pagination: { page, totalPages: Math.ceil(total / limit), total },
  });
}
