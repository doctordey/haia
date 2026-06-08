/**
 * Shared helpers for the HITL TradingView webhooks.
 *
 * Both `/tv-alert` and `/tp1-hit` authenticate with a shared secret (TradingView
 * cannot do session auth) and — per HITL_DESIGN.md §5 — return HTTP 200 on every
 * business-rule reject so TradingView does not disable the webhook or retry.
 */

import { createHash, timingSafeEqual } from 'crypto';

/** Constant-time string comparison that tolerates length mismatch. */
export function secretMatches(provided: unknown, expected: string): boolean {
  if (typeof provided !== 'string' || expected.length === 0) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** Stable id for an alert that didn't carry its own signal_id. */
export function deriveSignalId(rawBody: string): string {
  return `auto-${createHash('sha1').update(rawBody).digest('hex').slice(0, 16)}`;
}

/** Read the first present numeric field from a set of candidate keys. */
export function numField(body: Record<string, unknown>, ...keys: string[]): number | null {
  for (const k of keys) {
    if (body[k] != null && body[k] !== '') {
      const n = Number(body[k]);
      if (Number.isFinite(n)) return n;
    }
  }
  return null;
}

/** Read the first present string field from a set of candidate keys. */
export function strField(body: Record<string, unknown>, ...keys: string[]): string | null {
  for (const k of keys) {
    if (typeof body[k] === 'string' && (body[k] as string).trim() !== '') return (body[k] as string).trim();
  }
  return null;
}

/** Optional low-latency hook the worker can register to react without waiting for its poll. */
export interface HitlAlertNotifier {
  onAlert?: (sessionId: string) => void;
  onBeRequested?: (signalId: string) => void;
}

export function getHitlNotifier(): HitlAlertNotifier | undefined {
  return (globalThis as Record<string, unknown>).__haiaHitl as HitlAlertNotifier | undefined;
}
