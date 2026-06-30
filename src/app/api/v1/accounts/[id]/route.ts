import { NextResponse } from 'next/server';
import { authenticateApiKey } from '@/lib/api/auth';
import { db } from '@/lib/db';
import { tradingAccounts } from '@/lib/db/schema';
import { and, eq } from 'drizzle-orm';
import { exposeAccount } from '@/lib/api/serialize';

async function findOwned(userId: string, id: string) {
  return db.query.tradingAccounts.findFirst({
    where: and(eq(tradingAccounts.id, id), eq(tradingAccounts.userId, userId)),
    with: { accountStats: true },
  });
}

/** GET /api/v1/accounts/:id — distribute one account (label overrides applied). */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authenticateApiKey(request, 'read');
  if (auth instanceof NextResponse) return auth;

  const { id } = await params;
  const account = await findOwned(auth.userId, id);
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
  const account = await findOwned(auth.userId, id);
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
  if ('distinguishManual' in body) {
    if (typeof body.distinguishManual !== 'boolean') return { error: 'distinguishManual must be a boolean' };
    set.distinguishManual = body.distinguishManual;
  }

  return { set };
}
