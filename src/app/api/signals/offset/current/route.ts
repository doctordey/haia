import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { offsetHistory } from '@/lib/db/schema';
import { desc } from 'drizzle-orm';

/**
 * GET /api/signals/offset/current — returns the latest offset data
 */
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const [latest] = await db
    .select()
    .from(offsetHistory)
    .orderBy(desc(offsetHistory.receivedAt))
    .limit(1);

  if (!latest) {
    return NextResponse.json(null);
  }

  const ageMs = Date.now() - latest.receivedAt.getTime();
  const ageMinutes = Math.floor(ageMs / 60000);
  let age: string;
  if (ageMinutes < 60) {
    age = `${ageMinutes}m ago`;
  } else if (ageMinutes < 1440) {
    age = `${Math.floor(ageMinutes / 60)}h ${ageMinutes % 60}m ago`;
  } else {
    age = `${Math.floor(ageMinutes / 1440)}d ago`;
  }

  return NextResponse.json({
    nqOffset: latest.nqOffset,
    esOffset: latest.esOffset,
    nqFuturesPrice: latest.nqFuturesPrice,
    esFuturesPrice: latest.esFuturesPrice,
    nas100Price: latest.nas100Price,
    us500Price: latest.us500Price,
    nqOffsetSma: latest.nqOffsetSma,
    esOffsetSma: latest.esOffsetSma,
    receivedAt: latest.receivedAt.toISOString(),
    age,
    ageMs,
    isStale: ageMs > 86_400_000, // 24h
  });
}
