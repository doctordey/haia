import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { loadHitlConfig } from '@/lib/hitl/config';
import { loadTpMultiples, setTpMultiples } from '@/lib/hitl/targets';

/** GET /api/hitl/targets — effective TP R-multiples (env + DB overrides). */
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  return NextResponse.json(await loadTpMultiples(loadHitlConfig()));
}

/** PATCH /api/hitl/targets — set TP R-multiples. Body: { tp1, tp2, tp3 }. */
export async function PATCH(request: Request) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json().catch(() => null);
  const tp1 = Number(body?.tp1);
  const tp2 = Number(body?.tp2);
  const tp3 = Number(body?.tp3);

  if (![tp1, tp2, tp3].every((n) => Number.isFinite(n) && n > 0)) {
    return NextResponse.json({ error: 'tp1, tp2 and tp3 must all be positive numbers' }, { status: 400 });
  }
  if (!(tp1 < tp2 && tp2 < tp3)) {
    return NextResponse.json({ error: 'Multiples must be strictly increasing: TP1 < TP2 < TP3' }, { status: 400 });
  }

  await setTpMultiples({ tp1, tp2, tp3 });
  return NextResponse.json({ tp1, tp2, tp3 });
}
