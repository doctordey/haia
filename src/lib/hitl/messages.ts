/**
 * HITL message templates — operator-editable wording for every bot message.
 *
 * Each message has a key, a default template, and a set of `{placeholder}`
 * variables. Operators edit them in-app (Settings → HITL → Messages); overrides
 * live in hitl_settings under `msg.<key>` (no migration). Rendering substitutes
 * `{var}` with the provided value (missing → empty string).
 */

import { db } from '@/lib/db';
import { eq } from 'drizzle-orm';
import { hitlSettings } from '@/lib/db/schema';

export interface MessageDef {
  key: string;
  label: string;
  description: string;
  variables: string[];
  default: string;
}

export const MESSAGE_DEFS: MessageDef[] = [
  {
    key: 'prompt',
    label: 'Alert prompt',
    description: 'Sent when a new signal fires; asks for the range.',
    variables: ['direction', 'symbol', 'price'],
    default:
      '🔔 New signal: {direction} {symbol} @ {price}\n' +
      'Reply to THIS message with the range (high low) as two numbers.',
  },
  {
    key: 'needDirection',
    label: 'Direction prompt',
    description: 'Asked only when the entry sits inside the range and direction is ambiguous.',
    variables: ['entry', 'low', 'high'],
    default: 'Entry {entry} is inside the range {low}–{high}. Reply BUY or SELL.',
  },
  {
    key: 'confirm',
    label: 'Confirm card',
    description: 'The approval card with levels and lots. {legs} is the per-leg breakdown.',
    variables: ['direction', 'symbol', 'account', 'entry', 'sl', 'r', 'tp1', 'tp2', 'tp3', 'lots', 'risk', 'riskAmount', 'legs'],
    default:
      '📋 Confirm {direction} {symbol} ({account})\n' +
      'Entry {entry} · SL {sl} · R {r}\n' +
      'TP1 {tp1} · TP2 {tp2} · TP3 {tp3}\n' +
      'Size {lots} lots — risk {risk}% (≈ ${riskAmount})\n' +
      '{legs}',
  },
  {
    key: 'approved',
    label: 'Approved',
    description: 'Broadcast when a trade is approved.',
    variables: ['who', 'symbol', 'result'],
    default: '✅ Approved by {who}\n{result}',
  },
  {
    key: 'rejected',
    label: 'Rejected',
    description: 'Broadcast when a trade is rejected.',
    variables: ['who', 'symbol', 'result'],
    default: '❌ Rejected by {who}\n{result}',
  },
  {
    key: 'breakeven',
    label: 'Breakeven moved',
    description: 'When the stop is moved to entry at TP1.',
    variables: ['symbol', 'legs'],
    default: '🟦 {symbol}: TP1 reached — stop moved to breakeven ({legs} leg(s)).',
  },
  {
    key: 'beNotReady',
    label: 'Breakeven not ready',
    description: 'When breakeven is triggered but the trade is not yet in profit.',
    variables: ['symbol'],
    default:
      '⚠️ {symbol}: breakeven was triggered, but the trade isn\'t in profit yet — ' +
      'the stop can\'t move to entry until price reaches TP1. I\'ll apply it automatically when it does.',
  },
  {
    key: 'beRejected',
    label: 'Breakeven rejected',
    description: 'When the broker rejects the breakeven move.',
    variables: ['symbol', 'reason'],
    default: '⚠️ {symbol}: breakeven move was rejected — {reason}. Will retry.',
  },
  {
    key: 'closed',
    label: 'Trade closed',
    description: 'When all positions for a signal are gone. {pnl} is pre-formatted (may be empty).',
    variables: ['symbol', 'pnl'],
    default: '✅ {symbol} closed.{pnl}',
  },
  {
    key: 'expired',
    label: 'Expired',
    description: 'When a pre-fill signal times out without approval.',
    variables: ['symbol', 'timeout'],
    default: '⏱️ {symbol} expired (no approval within {timeout}s).',
  },
  {
    key: 'dispatchFailed',
    label: 'Dispatch failed',
    description: 'When opening the legs fails before any fill.',
    variables: ['symbol', 'reason'],
    default: '❌ Dispatch FAILED for {symbol}: {reason}',
  },
  {
    key: 'partialFill',
    label: 'Partial fill held',
    description: 'When one leg fills and another fails (alert_hold policy).',
    variables: ['symbol', 'detail'],
    default: '⚠️ {symbol}: partial dispatch — {detail} Held open; review manually.',
  },
];

const DEFAULTS: Record<string, string> = Object.fromEntries(MESSAGE_DEFS.map((d) => [d.key, d.default]));

export type MessageVars = Record<string, string | number | null | undefined>;

/** Substitute {var} placeholders; unknown/empty vars render as ''. */
export function renderTemplate(template: string, vars: MessageVars): string {
  return template.replace(/\{(\w+)\}/g, (_, k: string) => {
    const v = vars[k];
    return v == null ? '' : String(v);
  });
}

/** All templates: defaults merged with in-app overrides (hitl_settings `msg.*`). */
export async function loadTemplates(): Promise<Record<string, string>> {
  const map: Record<string, string> = { ...DEFAULTS };
  try {
    const rows = await db.select().from(hitlSettings);
    for (const r of rows) {
      if (r.key.startsWith('msg.')) map[r.key.slice(4)] = r.value;
    }
  } catch (err) {
    console.error('[hitl/messages] template lookup failed, using defaults:', err);
  }
  return map;
}

/** Render one message by key (loads overrides, falls back to default). */
export async function renderMessage(key: string, vars: MessageVars): Promise<string> {
  const templates = await loadTemplates();
  const tpl = templates[key] ?? DEFAULTS[key] ?? '';
  return renderTemplate(tpl, vars);
}

export async function setTemplate(key: string, template: string): Promise<void> {
  if (!(key in DEFAULTS)) throw new Error(`unknown message key: ${key}`);
  await db
    .insert(hitlSettings)
    .values({ key: `msg.${key}`, value: template })
    .onConflictDoUpdate({ target: hitlSettings.key, set: { value: template } });
}

export async function resetTemplate(key: string): Promise<void> {
  await db.delete(hitlSettings).where(eq(hitlSettings.key, `msg.${key}`));
}
