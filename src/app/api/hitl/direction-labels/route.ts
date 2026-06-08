import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { loadDirectionLabels, setDirectionLabels } from '@/lib/hitl/messages';

/** GET /api/hitl/direction-labels — what {direction} renders as for BUY / SELL. */
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  return NextResponse.json(await loadDirectionLabels());
}

/** PATCH /api/hitl/direction-labels — set them. Body: { BUY, SELL }. */
export async function PATCH(request: Request) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json().catch(() => null);
  const buy = typeof body?.BUY === 'string' ? body.BUY.trim() : '';
  const sell = typeof body?.SELL === 'string' ? body.SELL.trim() : '';
  if (!buy || !sell) {
    return NextResponse.json({ error: 'Both BUY and SELL labels are required' }, { status: 400 });
  }
  await setDirectionLabels(buy, sell);
  return NextResponse.json({ BUY: buy, SELL: sell });
}
