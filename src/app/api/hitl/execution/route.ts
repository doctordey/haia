import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { loadHitlConfig } from '@/lib/hitl/config';
import { loadExecutionSettings, setExecutionSettings } from '@/lib/hitl/execution';

/** GET /api/hitl/execution — position model + TP3 toggle (env + DB overrides). */
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  return NextResponse.json(await loadExecutionSettings(loadHitlConfig()));
}

/** PATCH /api/hitl/execution — Body: { positionModel, tp3Enabled }. */
export async function PATCH(request: Request) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json().catch(() => null);
  const positionModel = body?.positionModel === 'single' ? 'single' : body?.positionModel === 'two_position' ? 'two_position' : null;
  const tp3Enabled = body?.tp3Enabled === true || body?.tp3Enabled === 'true';

  if (!positionModel) {
    return NextResponse.json({ error: 'positionModel must be "single" or "two_position"' }, { status: 400 });
  }
  if (positionModel === 'two_position' && !tp3Enabled) {
    return NextResponse.json({ error: 'Two-position mode needs TP3 enabled — Leg B targets TP3. Use single position to take full profit at TP2.' }, { status: 400 });
  }

  const settings = { positionModel, tp3Enabled } as const;
  await setExecutionSettings(settings);
  return NextResponse.json(settings);
}
