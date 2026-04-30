import type {
  ParsedMessage,
  ParsedSignal,
  ParsedTPHit,
  Instrument,
  SignalDirection,
  SignalSize,
} from '@/types/signals';

function cleanPrice(s: string): number {
  return parseFloat(s.replace(/,/g, ''));
}

// ─── REGEX PATTERNS ──────────────────────────────────

// Single instrument signal block (format A — original):
//   🟢 LONG NQ @ 24,060
//   TP1: 24,088
//   TP2: 24,160
//   SL: 24,020
//   Size: Medium
const SIGNAL_BLOCK_RE = new RegExp(
  '(?:🟢|🔴)\\s*' +
  '(LONG|SHORT)\\s+' +
  '(NQ|ES)\\s*@\\s*' +
  '([\\d,]+(?:\\.\\d+)?)\\s*\\n' +
  '\\s*TP1:\\s*([\\d,]+(?:\\.\\d+)?)\\s*\\n' +
  '\\s*TP2:\\s*([\\d,]+(?:\\.\\d+)?)\\s*\\n' +
  '\\s*SL:\\s*([\\d,]+(?:\\.\\d+)?)\\s*\\n' +
  '\\s*Size:\\s*(Small|Medium|Large)',
  'gi'
);

// Single instrument signal block (format B — new format):
//   🟢 Trade 1 — NQ LONG
//
//   📈 Entry: 27,155
//   SL: 27,050
//   TP1: 27,260 ( $2,100)
//   TP2: 27,400 ( $4,900)
//   Size: 1 contract
const SIGNAL_BLOCK_B_RE = new RegExp(
  '(?:🟢|🔴)\\s*' +
  '(?:Trade\\s+\\d+\\s*[—–-]\\s*)?' +
  '(NQ|ES)\\s+(LONG|SHORT)' +
  '[\\s\\S]*?' +
  '(?:📈\\s*)?Entry:\\s*([\\d,]+(?:\\.\\d+)?)\\s*\\n' +
  '\\s*SL:\\s*([\\d,]+(?:\\.\\d+)?)\\s*\\n' +
  '\\s*TP1:\\s*([\\d,]+(?:\\.\\d+)?)(?:\\s*\\([^)]*\\))?\\s*\\n' +
  '\\s*TP2:\\s*([\\d,]+(?:\\.\\d+)?)(?:\\s*\\([^)]*\\))?' +
  '(?:\\s*\\n\\s*Size:\\s*(.+?))?\\s*$',
  'gim'
);

const TRADE_HEADER_RE = /Trade\s+(\d+)/gi;
const CANCEL_ALL_RE = /❌\s*ALL\s+POSITIONS\s+CANCELLED/i;
const CANCEL_SPECIFIC_RE = /❌\s*Trade\s+(\d+)\s*[—–-]\s*.*?CANCELLED/i;

const TP_HIT_RE = new RegExp(
  '(?:🟢|🔴)\\s*' +
  '(LONG|SHORT)\\s+' +
  '(NQ|ES)\\s*@\\s*' +
  '([\\d,]+(?:\\.\\d+)?)\\s*' +
  '→\\s*(TP\\d)\\s+' +
  '([\\d,]+(?:\\.\\d+)?)\\s*✅',
  'gi'
);

const WARNING_RE = /⚠️\s*(.*?)(?:\n|$)/i;

// ─── MAIN PARSER ─────────────────────────────────────

/**
 * Strip Telegram markdown/HTML formatting so the regex can match clean text.
 * Handles: **bold**, *bold*, __italic__, _italic_, ~strikethrough~, `code`, ```code blocks```
 */
function stripFormatting(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, '$1')   // **bold**
    .replace(/__(.+?)__/g, '$1')         // __italic__
    .replace(/~~(.+?)~~/g, '$1')         // ~~strikethrough~~
    .replace(/```[\s\S]*?```/g, '')      // ```code blocks```
    .replace(/`(.+?)`/g, '$1')           // `inline code`
    .replace(/\*(.+?)\*/g, '$1')         // *bold* (single)
    .replace(/_(.+?)_/g, '$1');           // _italic_ (single)
}

export function parseSignalMessage(rawText: string): ParsedMessage {
  const text = stripFormatting(rawText);
  // 1. Check for cancellations (highest priority)
  if (CANCEL_ALL_RE.test(text)) {
    const reasonMatch = text.match(/CANCELLED\s*\n?(.*)/i);
    return {
      type: 'cancellation',
      cancellation: {
        type: 'cancel_all',
        reason: reasonMatch?.[1]?.trim() || undefined,
      },
    };
  }

  // Reset regex state before testing
  const sigTestRe = new RegExp(SIGNAL_BLOCK_RE.source, SIGNAL_BLOCK_RE.flags);
  const cancelSpecific = text.match(CANCEL_SPECIFIC_RE);
  if (cancelSpecific && !sigTestRe.test(text)) {
    return {
      type: 'cancellation',
      cancellation: {
        type: 'cancel_specific',
        tradeNumber: parseInt(cancelSpecific[1]),
      },
    };
  }

  // 2. Check for TP hit messages
  const tpHits: ParsedTPHit[] = [];
  let tpMatch;
  const tpRe = new RegExp(TP_HIT_RE.source, TP_HIT_RE.flags);
  while ((tpMatch = tpRe.exec(text)) !== null) {
    tpHits.push({
      instrument: tpMatch[2].toUpperCase() as Instrument,
      direction: tpMatch[1].toUpperCase() as SignalDirection,
      entryPrice: cleanPrice(tpMatch[3]),
      tpLevel: tpMatch[4],
      tpPrice: cleanPrice(tpMatch[5]),
      profitPoints: Math.abs(cleanPrice(tpMatch[5]) - cleanPrice(tpMatch[3])),
    });
  }
  if (tpHits.length > 0) {
    return { type: 'tp_hit', hits: tpHits };
  }

  // 3. Parse signal blocks — try format A (original), then format B (new)
  const signals: ParsedSignal[] = [];
  let signalMatch;

  // Build trade number index from "Trade N" headers
  const tradeHeaders: { tradeNum: number; startIndex: number }[] = [];
  let headerMatch;
  const headerRe = new RegExp(TRADE_HEADER_RE.source, TRADE_HEADER_RE.flags);
  while ((headerMatch = headerRe.exec(text)) !== null) {
    tradeHeaders.push({
      tradeNum: parseInt(headerMatch[1]),
      startIndex: headerMatch.index,
    });
  }

  function findTradeNumber(matchIndex: number): number {
    let tradeNumber = 1;
    for (const header of tradeHeaders) {
      if (matchIndex >= header.startIndex) {
        tradeNumber = header.tradeNum;
      }
    }
    return tradeNumber;
  }

  // Format A: 🟢 LONG NQ @ 24,060 / TP1 / TP2 / SL / Size
  const sigRe = new RegExp(SIGNAL_BLOCK_RE.source, SIGNAL_BLOCK_RE.flags);
  while ((signalMatch = sigRe.exec(text)) !== null) {
    signals.push({
      tradeNumber: findTradeNumber(signalMatch.index),
      instrument: signalMatch[2].toUpperCase() as Instrument,
      direction: signalMatch[1].toUpperCase() as SignalDirection,
      entryPrice: cleanPrice(signalMatch[3]),
      tp1: cleanPrice(signalMatch[4]),
      tp2: cleanPrice(signalMatch[5]),
      stopLoss: cleanPrice(signalMatch[6]),
      size: signalMatch[7] as SignalSize,
    });
  }

  // Format B: 🟢 Trade 1 — NQ LONG / Entry: / SL: / TP1: / TP2: / Size:
  if (signals.length === 0) {
    const sigReB = new RegExp(SIGNAL_BLOCK_B_RE.source, SIGNAL_BLOCK_B_RE.flags);
    while ((signalMatch = sigReB.exec(text)) !== null) {
      // Parse size — can be Small/Medium/Large or "N contract(s)"
      const rawSize = (signalMatch[7] || '').trim();
      let size: SignalSize = 'Medium';
      if (/^small$/i.test(rawSize)) size = 'Small';
      else if (/^large$/i.test(rawSize)) size = 'Large';
      else if (/^medium$/i.test(rawSize)) size = 'Medium';
      else if (/(\d+)\s*contract/i.test(rawSize)) {
        const contracts = parseInt(rawSize.match(/(\d+)/)?.[1] || '1');
        size = contracts <= 1 ? 'Small' : contracts <= 3 ? 'Medium' : 'Large';
      }

      signals.push({
        tradeNumber: findTradeNumber(signalMatch.index),
        instrument: signalMatch[1].toUpperCase() as Instrument,
        direction: signalMatch[2].toUpperCase() as SignalDirection,
        entryPrice: cleanPrice(signalMatch[3]),
        stopLoss: cleanPrice(signalMatch[4]),
        tp1: cleanPrice(signalMatch[5]),
        tp2: cleanPrice(signalMatch[6]),
        size,
      });
    }
  }

  if (signals.length > 0) {
    const warningMatch = text.match(WARNING_RE);
    return {
      type: 'signals',
      signals,
      warning: warningMatch ? warningMatch[1].trim() : undefined,
    };
  }

  return { type: 'unknown', raw: text };
}
