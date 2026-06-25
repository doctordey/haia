/**
 * HITL session store — CRUD over `hitl_sessions` plus guarded state
 * transitions. Sessions are durable and never hard-deleted; they only ever
 * move through the state machine (HITL_DESIGN.md §5).
 */

import { and, desc, eq, gt, inArray } from 'drizzle-orm';
import { db } from '@/lib/db';
import { hitlSessions, type HitlLeg } from '@/lib/db/schema';

export const STATES = {
  RECEIVED: 'RECEIVED',
  AWAITING_RANGE: 'AWAITING_RANGE',
  AWAITING_DIRECTION: 'AWAITING_DIRECTION',
  AWAITING_APPROVAL: 'AWAITING_APPROVAL',
  DISPATCHING: 'DISPATCHING',
  OPEN: 'OPEN',
  CLOSED: 'CLOSED',
  FAILED: 'FAILED',
  EXPIRED: 'EXPIRED',
  REJECTED: 'REJECTED',
} as const;

export type HitlState = (typeof STATES)[keyof typeof STATES];

/** States before any order is live — swept by the timeout sweep. */
export const PRE_FILL_STATES: HitlState[] = [
  STATES.RECEIVED,
  STATES.AWAITING_RANGE,
  STATES.AWAITING_DIRECTION,
  STATES.AWAITING_APPROVAL,
];

/** Non-terminal states — reconciled on worker restart. */
export const ACTIVE_STATES: HitlState[] = [...PRE_FILL_STATES, STATES.DISPATCHING, STATES.OPEN];

export const TERMINAL_STATES: HitlState[] = [
  STATES.CLOSED,
  STATES.FAILED,
  STATES.EXPIRED,
  STATES.REJECTED,
];

export type HitlSession = typeof hitlSessions.$inferSelect;
export type { HitlLeg };

export interface CreateSessionInput {
  signalId: string;
  symbol: string;
  entryRef?: number | null;
  rangeHigh?: number | null;
  rangeLow?: number | null;
  action?: 'BUY' | 'SELL' | null;
  rawAlert: Record<string, unknown>;
  operatorChatId?: string | null;
}

export async function createSession(input: CreateSessionInput): Promise<HitlSession> {
  const [row] = await db
    .insert(hitlSessions)
    .values({
      signalId: input.signalId,
      symbol: input.symbol,
      entryRef: input.entryRef ?? null,
      rangeHigh: input.rangeHigh ?? null,
      rangeLow: input.rangeLow ?? null,
      action: input.action ?? null,
      rawAlert: input.rawAlert,
      operatorChatId: input.operatorChatId ?? null,
      state: STATES.RECEIVED,
    })
    .returning();
  return row;
}

export async function getById(id: string): Promise<HitlSession | undefined> {
  const [row] = await db.select().from(hitlSessions).where(eq(hitlSessions.id, id)).limit(1);
  return row;
}

export async function findBySignalId(signalId: string): Promise<HitlSession | undefined> {
  const [row] = await db.select().from(hitlSessions).where(eq(hitlSessions.signalId, signalId)).limit(1);
  return row;
}

/** True if a non-terminal pre-fill session already exists for this symbol (live-pre-fill block). */
export async function hasActivePrefill(symbol: string): Promise<boolean> {
  const [row] = await db
    .select({ id: hitlSessions.id })
    .from(hitlSessions)
    .where(and(eq(hitlSessions.symbol, symbol), inArray(hitlSessions.state, PRE_FILL_STATES)))
    .limit(1);
  return Boolean(row);
}

/** True if any session for this symbol was received within the cooldown window. */
export async function inCooldown(symbol: string, cooldownSeconds: number): Promise<boolean> {
  const since = new Date(Date.now() - cooldownSeconds * 1000);
  const [row] = await db
    .select({ id: hitlSessions.id })
    .from(hitlSessions)
    .where(and(eq(hitlSessions.symbol, symbol), gt(hitlSessions.receivedAt, since)))
    .limit(1);
  return Boolean(row);
}

/**
 * Route a text reply: find the awaiting session whose prompt (in any chat) has
 * this message id. Prompts are broadcast to all destinations, so each session
 * carries the message ids it was sent as across chats.
 */
export async function findByPromptMessageId(messageId: number): Promise<HitlSession | undefined> {
  const rows = await db
    .select()
    .from(hitlSessions)
    .where(inArray(hitlSessions.state, [STATES.AWAITING_RANGE, STATES.AWAITING_DIRECTION]));
  return rows.find((r) => Array.isArray(r.promptMessageIds) && r.promptMessageIds.includes(messageId));
}

/** Fallback routing: the single newest session awaiting operator input (any chat). */
export async function newestAwaiting(): Promise<HitlSession | undefined> {
  const [row] = await db
    .select()
    .from(hitlSessions)
    .where(inArray(hitlSessions.state, [STATES.AWAITING_RANGE, STATES.AWAITING_DIRECTION]))
    .orderBy(desc(hitlSessions.receivedAt))
    .limit(1);
  return row;
}

/** Append prompt message ids (from a broadcast) for reply routing. */
export async function recordPromptMessageIds(id: string, messageIds: number[]): Promise<void> {
  const current = await getById(id);
  const existing = (current?.promptMessageIds as number[] | null) ?? [];
  const merged = [...new Set([...existing, ...messageIds])];
  await patch(id, { promptMessageIds: merged });
}

export async function listByState(states: HitlState[]): Promise<HitlSession[]> {
  if (states.length === 0) return [];
  return db.select().from(hitlSessions).where(inArray(hitlSessions.state, states)).orderBy(desc(hitlSessions.receivedAt));
}

type SessionPatch = Partial<typeof hitlSessions.$inferInsert>;

/**
 * Guarded transition: only moves the row if it is currently in one of `from`.
 * Returns the updated row, or null if the guard failed (already transitioned /
 * lost a race). The state guard is enforced atomically in the WHERE clause.
 */
export async function transition(
  id: string,
  from: HitlState[],
  to: HitlState,
  patch: SessionPatch = {},
): Promise<HitlSession | null> {
  const [row] = await db
    .update(hitlSessions)
    .set({ ...patch, state: to })
    .where(and(eq(hitlSessions.id, id), inArray(hitlSessions.state, from)))
    .returning();
  return row ?? null;
}

/** Patch fields without changing state (e.g. recording prompt message ids). */
export async function patch(id: string, fields: SessionPatch): Promise<HitlSession | null> {
  const [row] = await db.update(hitlSessions).set(fields).where(eq(hitlSessions.id, id)).returning();
  return row ?? null;
}

/**
 * Atomically claim the breakeven move for an OPEN session (idempotent). Returns
 * the row only to the caller that won the claim (beApplied flips false→true),
 * so the SL move runs exactly once even if webhook + price-watch both fire.
 */
export async function claimBreakeven(id: string): Promise<HitlSession | null> {
  const [row] = await db
    .update(hitlSessions)
    .set({ beApplied: true, beAppliedAt: new Date() })
    .where(and(eq(hitlSessions.id, id), eq(hitlSessions.state, STATES.OPEN), eq(hitlSessions.beApplied, false)))
    .returning();
  return row ?? null;
}

/**
 * Mark a BE request by symbol + direction (the "Target Reached" alert carries
 * no id). Flags every OPEN, not-yet-BE'd session matching the trade, idempotently.
 * Returns the affected sessions (usually one — the live-prefill block keeps
 * concurrent same-symbol trades rare).
 */
export async function markBeRequestedBySymbolDirection(
  symbol: string,
  direction: 'BUY' | 'SELL',
): Promise<HitlSession[]> {
  return db
    .update(hitlSessions)
    .set({ beRequested: true, beRequestedAt: new Date() })
    .where(
      and(
        eq(hitlSessions.symbol, symbol),
        eq(hitlSessions.direction, direction),
        eq(hitlSessions.state, STATES.OPEN),
        eq(hitlSessions.beApplied, false),
      ),
    )
    .returning();
}

/**
 * Mark a BE request from the /tp1-hit webhook (idempotent). Only flags a
 * session that is OPEN and hasn't already had BE applied. The worker reacts.
 */
export async function markBeRequested(signalId: string): Promise<HitlSession | null> {
  const [row] = await db
    .update(hitlSessions)
    .set({ beRequested: true, beRequestedAt: new Date() })
    .where(
      and(
        eq(hitlSessions.signalId, signalId),
        eq(hitlSessions.state, STATES.OPEN),
        eq(hitlSessions.beApplied, false),
      ),
    )
    .returning();
  return row ?? null;
}
