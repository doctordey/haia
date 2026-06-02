// Parser for Unicorn° Pro+ alert text. The indicator can't send JSON — only
// a free-form string — so we convert that string into the same TvAlertPayload
// shape the rest of the pipeline already speaks.
//
// Known formats (extend as new ones are captured):
//
//   Activation:
//     "Activated 5m Bullish Unicorn [1H OHLC] on NAS100 @ 30348.09"
//
//   Target Reached (TODO — sample needed):
//     "??? Reached 1R ??? on NAS100 @ 30450.00"
//
//   Invalidation Hit (TODO — sample needed):
//     "??? Invalidated ??? on NAS100"
//
// The parser ignores trailing TradingView noise — the indicator-name line
// (e.g. "Unicorn° [Pro+] (50, Automatic, ...)") and "Any alert() function call".

import type { TvAlertPayload, TvAlertType } from '@/types/tv-alerts';

export interface UnicornParseResult {
  ok: boolean;
  payload?: Partial<TvAlertPayload>;
  reason: string;
  rawMatched: string;
}

// ─── COMPOSABLE PIECES ──────────────────────────────────
// Decompose the parser so each pattern can vary independently. The Unicorn
// strings have a few moving pieces — symbol, price, R-level — and the order
// in which they appear depends on which alert fired.

const SYMBOL_TOKEN = /\bon\s+([A-Z0-9._]+)/i;
const PRICE_AT     = /@\s*([\d,]+(?:\.\d+)?)/;
const R_LEVEL      = /\b(\d+(?:\.\d+)?)\s*R\b/i;

// ─── ACTIVATION ─────────────────────────────────────────
// "Activated <tf> <Bullish|Bearish> Unicorn [<HTF context>] on <SYMBOL> @ <PRICE>"
const ACTIVATION_RE =
  /Activated\s+\S+\s+(Bullish|Bearish)\s+Unicorn[^@]*?\s+on\s+([A-Z0-9._]+)\s+@\s+([\d,]+(?:\.\d+)?)/i;

function num(s: string | undefined): number | undefined {
  if (s == null) return undefined;
  const n = parseFloat(s.replace(/,/g, ''));
  return Number.isFinite(n) ? n : undefined;
}

function pickSymbol(text: string): string | undefined {
  return text.match(SYMBOL_TOKEN)?.[1]?.toUpperCase();
}

function pickPrice(text: string): number | undefined {
  return num(text.match(PRICE_AT)?.[1]);
}

function pickRLevel(text: string): number | undefined {
  return num(text.match(R_LEVEL)?.[1]);
}

/**
 * Parse Unicorn's free-form alert text into a partial TvAlertPayload.
 * Returns {ok: false, reason} if no known pattern matches; the webhook
 * logs that into tv_alerts so unknown formats become visible.
 *
 * Pattern matching is order-sensitive: Activation is tried first because
 * its message is the most distinctive ("Activated <tf> <dir> Unicorn ...").
 */
export function parseUnicornMessage(text: string): UnicornParseResult {
  const clean = text.replace(/\r\n/g, '\n').trim();

  // Activation — most distinctive, try first.
  const a = clean.match(ACTIVATION_RE);
  if (a) {
    return {
      ok: true,
      reason: 'matched: activation',
      rawMatched: a[0],
      payload: {
        alert_type: 'activation' as TvAlertType,
        tv_symbol: a[2].toUpperCase(),
        direction: a[1].toLowerCase() === 'bullish' ? 'LONG' : 'SHORT',
        tv_price: num(a[3])!,
      },
    };
  }

  // Target Reached — anything that mentions an R-level alongside
  // "Hit" / "Reached" / "Target". Order of R-level vs keyword doesn't matter.
  const rLevel = pickRLevel(clean);
  if (rLevel != null && /\b(Hit|Reached|Target)\b/i.test(clean)) {
    return {
      ok: true,
      reason: 'matched: target_reached',
      rawMatched: clean,
      payload: {
        alert_type: 'target_reached' as TvAlertType,
        tv_symbol: pickSymbol(clean),
        r_level: rLevel,
        tv_price: pickPrice(clean),
      },
    };
  }

  // Invalidation Hit / Warning. Warning has the word "Warning" alongside;
  // Hit is anything else mentioning Invalidated / Invalidation.
  if (/\bInvalidat(?:ed|ion)\b/i.test(clean)) {
    const isWarning = /\bWarning\b/i.test(clean);
    return {
      ok: true,
      reason: `matched: ${isWarning ? 'invalidation_warning' : 'invalidation_hit'}`,
      rawMatched: clean,
      payload: {
        alert_type: (isWarning ? 'invalidation_warning' : 'invalidation_hit') as TvAlertType,
        tv_symbol: pickSymbol(clean),
        tv_price: pickPrice(clean),
      },
    };
  }

  if (/\bPotential\s+Breaker\b/i.test(clean)) {
    return {
      ok: true,
      reason: 'matched: potential_breaker',
      rawMatched: clean,
      payload: {
        alert_type: 'potential_breaker' as TvAlertType,
        tv_symbol: pickSymbol(clean),
        tv_price: pickPrice(clean),
      },
    };
  }

  return {
    ok: false,
    reason: 'No Unicorn pattern matched',
    rawMatched: '',
  };
}
