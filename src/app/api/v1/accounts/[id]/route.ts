import { NextResponse } from 'next/server';
import { authenticateApiKey, keyAllowsAccount, type ApiIdentity } from '@/lib/api/auth';
import { db } from '@/lib/db';
import { tradingAccounts } from '@/lib/db/schema';
import { and, eq } from 'drizzle-orm';
import { exposeAccount } from '@/lib/api/serialize';

// Ownership + key account-restriction in one step. A restricted key gets the
// same 404 as a nonexistent account, so it can't probe for other ids.
async function findAllowed(identity: ApiIdentity, id: string) {
  if (!keyAllowsAccount(identity, id)) return undefined;
  return db.query.tradingAccounts.findFirst({
    where: and(eq(tradingAccounts.id, id), eq(tradingAccounts.userId, identity.userId)),
    with: { accountStats: true },
  });
}

/** GET /api/v1/accounts/:id — distribute one account (label overrides applied). */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authenticateApiKey(request, 'read');
  if (auth instanceof NextResponse) return auth;

  const { id } = await params;
  const account = await findAllowed(auth, id);
  if (!account) return NextResponse.json({ error: 'Account not found' }, { status: 404 });

  return NextResponse.json(exposeAccount(account, account.accountStats));
}

/**
 * PATCH /api/v1/accounts/:id — set the label overrides + manual-distinction flag.
 * Body (all optional):
 *   labelName, labelLogin   — string | null  (null clears the override)
 *   labelType               — "live" | "demo" | null
 *   accountType             — declare the real type ("live" | "demo" | null)
 *   distinguishManual       — boolean
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authenticateApiKey(request, 'write');
  if (auth instanceof NextResponse) return auth;

  const { id } = await params;
  const account = await findAllowed(auth, id);
  if (!account) return NextResponse.json({ error: 'Account not found' }, { status: 404 });

  const body = await request.json().catch(() => ({}));
  const update = buildLabelUpdate(body);
  if ('error' in update) return NextResponse.json({ error: update.error }, { status: 400 });
  if (Object.keys(update.set).length === 0) {
    return NextResponse.json({ error: 'No updatable fields provided' }, { status: 400 });
  }

  const [updated] = await db
    .update(tradingAccounts)
    .set(update.set)
    .where(eq(tradingAccounts.id, id))
    .returning();

  return NextResponse.json(exposeAccount(updated, account.accountStats));
}

/**
 * Shared label-update builder used by both the v1 PATCH and the session route, so
 * the validation rules stay identical. Returns either `{ set }` or `{ error }`.
 */
export function buildLabelUpdate(body: Record<string, unknown>):
  | { set: Record<string, unknown> }
  | { error: string } {
  const set: Record<string, unknown> = {};
  const kind = (v: unknown): v is string => v === 'live' || v === 'demo';

  if ('labelName' in body) set.labelName = body.labelName == null ? null : String(body.labelName).trim() || null;
  if ('labelLogin' in body) set.labelLogin = body.labelLogin == null ? null : String(body.labelLogin).trim() || null;
  if ('labelType' in body) {
    if (body.labelType == null || body.labelType === '') set.labelType = null;
    else if (kind(body.labelType)) set.labelType = body.labelType;
    else return { error: 'labelType must be "live", "demo", or null' };
  }
  if ('accountType' in body) {
    if (body.accountType == null || body.accountType === '') set.accountType = null;
    else if (kind(body.accountType)) set.accountType = body.accountType;
    else return { error: 'accountType must be "live", "demo", or null' };
  }
  if ('labelServer' in body) set.labelServer = body.labelServer == null ? null : String(body.labelServer).trim() || null;
  if ('labelBroker' in body) set.labelBroker = body.labelBroker == null ? null : String(body.labelBroker).trim() || null;
  if ('labelLeverage' in body) {
    if (body.labelLeverage == null || body.labelLeverage === '') set.labelLeverage = null;
    else {
      const n = Number(body.labelLeverage);
      if (!Number.isFinite(n) || n < 0) return { error: 'labelLeverage must be a non-negative number or null' };
      set.labelLeverage = Math.trunc(n);
    }
  }
  if ('beginningDate' in body) {
    if (body.beginningDate == null || body.beginningDate === '') set.beginningDate = null;
    else {
      // Accept YYYY-MM-DD (or any parseable date); store as a date string.
      const d = new Date(String(body.beginningDate));
      if (Number.isNaN(d.getTime())) return { error: 'beginningDate must be a valid date (YYYY-MM-DD) or null' };
      set.beginningDate = d.toISOString().slice(0, 10);
    }
  }
  if ('distinguishManual' in body) {
    if (typeof body.distinguishManual !== 'boolean') return { error: 'distinguishManual must be a boolean' };
    set.distinguishManual = body.distinguishManual;
  }
  if ('serverTimezone' in body) {
    // Fixed UTC offset like "+03:00" or "-05:30". Empty/null resets to the
    // default (+03:00), the common MT4/MT5 broker server time.
    if (body.serverTimezone == null || body.serverTimezone === '') set.serverTimezone = '+03:00';
    else {
      const tz = String(body.serverTimezone).trim();
      if (!/^[+-]\d{2}:\d{2}$/.test(tz)) return { error: 'serverTimezone must be a UTC offset like "+03:00" or null' };
      const [h, m] = tz.slice(1).split(':').map(Number);
      if (h > 14 || m > 59) return { error: 'serverTimezone is out of range' };
      set.serverTimezone = tz;
    }
  }

  return { set };
}
