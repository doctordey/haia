import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { tradingAccounts } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { loadHitlConfig } from '@/lib/hitl/config';
import { loadRiskSettings, loadAccountRiskValues, setAccountRiskValue } from '@/lib/hitl/risk';

/** GET /api/hitl/account-risk — per-account risk overrides + the global default. */
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  // Overrides are shared across strategies; Unicorn's mode drives the inline
  // display and is recorded on save so a strategy in a different mode ignores
  // the override rather than reinterpreting the number.
  const global = await loadRiskSettings(loadHitlConfig(), 'unicorn');
  const overrides = await loadAccountRiskValues();
  return NextResponse.json({
    mode: global.mode,
    defaultValue: global.mode === 'fixed' ? global.fixedAmount : global.riskPct,
    overrides: Object.fromEntries(Object.entries(overrides).map(([id, o]) => [id, o.value])),
  });
}

/** PATCH /api/hitl/account-risk — set/clear one account's override. Body: { accountId, value|null }. */
export async function PATCH(request: Request) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json().catch(() => null);
  const accountId = typeof body?.accountId === 'string' ? body.accountId : '';
  if (!accountId) return NextResponse.json({ error: 'accountId is required' }, { status: 400 });

  // Only allow overrides on accounts the caller owns.
  const account = await db.query.tradingAccounts.findFirst({
    where: eq(tradingAccounts.id, accountId),
  });
  if (!account || account.userId !== session.user.id) {
    return NextResponse.json({ error: 'Account not found' }, { status: 404 });
  }

  const raw = body?.value;
  const value = raw == null || raw === '' ? null : Number(raw);
  if (value != null && !(Number.isFinite(value) && value > 0)) {
    return NextResponse.json({ error: 'value must be a positive number or null' }, { status: 400 });
  }

  // Record the mode the operator entered the number under (the UI labels the
  // field with Unicorn's mode).
  const { mode } = await loadRiskSettings(loadHitlConfig(), 'unicorn');
  await setAccountRiskValue(accountId, value, mode);
  return NextResponse.json({ accountId, value, mode });
}
