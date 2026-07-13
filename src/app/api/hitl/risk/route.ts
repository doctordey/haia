import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { loadHitlConfig } from '@/lib/hitl/config';
import { loadRiskSettings, setRiskSettings, type RiskMode } from '@/lib/hitl/risk';

/** GET /api/hitl/risk — effective risk-per-trade settings per strategy (env + DB overrides). */
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const cfg = loadHitlConfig();
  const [unicorn, forever] = await Promise.all([
    loadRiskSettings(cfg, 'unicorn'),
    loadRiskSettings(cfg, 'forever'),
  ]);
  return NextResponse.json({ unicorn, forever });
}

/** PATCH /api/hitl/risk — set one strategy's risk. Body: { strategy, mode, riskPct, fixedAmount, maxRiskPct }. */
export async function PATCH(request: Request) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json().catch(() => null);
  const strategy = body?.strategy === 'forever' ? 'forever' : 'unicorn';
  const mode: RiskMode = body?.mode === 'fixed' ? 'fixed' : 'percent';
  const riskPct = Number(body?.riskPct);
  const fixedAmount = Number(body?.fixedAmount);
  const maxRiskPct = Number(body?.maxRiskPct);

  if (!(Number.isFinite(maxRiskPct) && maxRiskPct > 0)) {
    return NextResponse.json({ error: 'maxRiskPct must be a positive number' }, { status: 400 });
  }
  if (mode === 'percent') {
    if (!(Number.isFinite(riskPct) && riskPct > 0)) {
      return NextResponse.json({ error: 'riskPct must be a positive number' }, { status: 400 });
    }
    if (riskPct > maxRiskPct) {
      return NextResponse.json({ error: 'riskPct must not exceed the max-risk cap' }, { status: 400 });
    }
  } else {
    if (!(Number.isFinite(fixedAmount) && fixedAmount > 0)) {
      return NextResponse.json({ error: 'fixedAmount must be a positive number' }, { status: 400 });
    }
  }

  const settings = {
    mode,
    riskPct: Number.isFinite(riskPct) && riskPct > 0 ? riskPct : 1,
    fixedAmount: Number.isFinite(fixedAmount) && fixedAmount > 0 ? fixedAmount : 0,
    maxRiskPct,
  };
  await setRiskSettings(settings, strategy);
  return NextResponse.json({ strategy, ...settings });
}
