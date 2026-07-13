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
  /** Has a Forever-specific variant stored at `msg.<key>.forever`; it falls back to the base template when unset. */
  perStrategy?: boolean;
}

export const MESSAGE_DEFS: MessageDef[] = [
  {
    key: 'prompt',
    label: 'Alert prompt',
    description: 'Sent when a new signal fires; asks for the range. {strategy} is Unicorn or Forever.',
    variables: ['strategy', 'direction', 'symbol', 'price'],
    perStrategy: true,
    default:
      '🔔 New {strategy} signal: {direction} {symbol} @ {price}\n' +
      'Reply to THIS message with the range (high low) as two numbers.',
  },
  {
    key: 'notification',
    label: 'Info alert',
    description: 'Notification-only alerts forwarded from TradingView (e.g. Forever ERL Hit). {text} is the alert text.',
    variables: ['text'],
    default: '📣 {text}',
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
    description: 'When the stop is moved to entry at TP1. {account} is the account name.',
    variables: ['account', 'symbol', 'legs'],
    default: '🟦 {account} · {symbol}: TP1 reached — stop moved to breakeven ({legs} leg(s)).',
  },
  {
    key: 'beNotReady',
    label: 'Breakeven not ready',
    description: 'When breakeven is triggered but the trade is not yet in profit. {account} is the account name.',
    variables: ['account', 'symbol'],
    default:
      '⚠️ {account} · {symbol}: breakeven was triggered, but the trade isn\'t in profit yet — ' +
      'the stop can\'t move to entry until price reaches TP1. I\'ll apply it automatically when it does.',
  },
  {
    key: 'beRejected',
    label: 'Breakeven rejected',
    description: 'When the broker rejects the breakeven move. {account} is the account name.',
    variables: ['account', 'symbol', 'reason'],
    default: '⚠️ {account} · {symbol}: breakeven move was rejected — {reason}. Will retry.',
  },
  {
    key: 'closed',
    label: 'Trade closed',
    description: 'When all positions for a signal are gone. {account} is the account name; {pnl} is pre-formatted (may be empty).',
    variables: ['account', 'symbol', 'pnl'],
    default: '✅ {account} · {symbol} closed.{pnl}',
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

// What {direction} renders as — operator-editable (hitl_settings dir.BUY/dir.SELL).
export const DIRECTION_DEFAULTS = { BUY: '🟢 BUY', SELL: '🔴 SELL' } as const;

export async function loadDirectionLabels(): Promise<{ BUY: string; SELL: string }> {
  const labels = { ...DIRECTION_DEFAULTS } as { BUY: string; SELL: string };
  try {
    const rows = await db.select().from(hitlSettings);
    for (const r of rows) {
      if (r.key === 'dir.BUY') labels.BUY = r.value;
      else if (r.key === 'dir.SELL') labels.SELL = r.value;
    }
  } catch (err) {
    console.error('[hitl/messages] direction label lookup failed, using defaults:', err);
  }
  return labels;
}

/** Resolve a raw direction ('BUY'/'SELL') to its configured display label. */
export async function directionLabel(dir: string | null | undefined): Promise<string> {
  if (dir !== 'BUY' && dir !== 'SELL') return '';
  return (await loadDirectionLabels())[dir];
}

export async function setDirectionLabels(buy: string, sell: string): Promise<void> {
  for (const [key, value] of [['dir.BUY', buy], ['dir.SELL', sell]] as [string, string][]) {
    await db.insert(hitlSettings).values({ key, value }).onConflictDoUpdate({ target: hitlSettings.key, set: { value } });
  }
}

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

const FOREVER_SUFFIX = '.forever';

/** Valid template key: a base message key, or `<key>.forever` for per-strategy defs. */
export function isMessageKey(key: string): boolean {
  if (MESSAGE_DEFS.some((d) => d.key === key)) return true;
  if (!key.endsWith(FOREVER_SUFFIX)) return false;
  const base = key.slice(0, -FOREVER_SUFFIX.length);
  return MESSAGE_DEFS.some((d) => d.perStrategy && d.key === base);
}

/**
 * Render one message by key. When `strategy` is "forever" and the message has a
 * Forever-specific template (`msg.<key>.forever`), that wins; otherwise the base
 * template (with any operator override), then the built-in default.
 */
export async function renderMessage(
  key: string,
  vars: MessageVars,
  strategy?: 'unicorn' | 'forever' | null,
): Promise<string> {
  const templates = await loadTemplates();
  const tpl =
    (strategy === 'forever' ? templates[`${key}${FOREVER_SUFFIX}`] : undefined) ??
    templates[key] ??
    DEFAULTS[key] ??
    '';
  return renderTemplate(tpl, vars);
}

export async function setTemplate(key: string, template: string): Promise<void> {
  if (!isMessageKey(key)) throw new Error(`unknown message key: ${key}`);
  await db
    .insert(hitlSettings)
    .values({ key: `msg.${key}`, value: template })
    .onConflictDoUpdate({ target: hitlSettings.key, set: { value: template } });
}

export async function resetTemplate(key: string): Promise<void> {
  await db.delete(hitlSettings).where(eq(hitlSettings.key, `msg.${key}`));
}
