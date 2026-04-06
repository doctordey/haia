import { describe, it, expect } from 'vitest';
import { parseSignalMessage } from '@/lib/signals/parser';

describe('parseSignalMessage', () => {
  // ─── New Signals ───────────────────────────────────

  it('parses a multi-trade LONG message with NQ and ES', () => {
    const msg = `Trade 1
🟢 LONG NQ @ 24,060
TP1: 24,088
TP2: 24,160
SL: 24,020
Size: Medium
🟢 LONG ES @ 6,606
TP1: 6,634
TP2: 6,660
SL: 6,596
Size: Medium
Trade 2
🟢 LONG NQ @ 24,000
TP1: 24,088
TP2: 24,160
SL: 23,960
Size: Medium
🟢 LONG ES @ 6,583
TP1: 6,634
TP2: 6,660
SL: 6,573
Size: Medium`;

    const result = parseSignalMessage(msg);
    expect(result.type).toBe('signals');
    if (result.type !== 'signals') return;

    expect(result.signals).toHaveLength(4);

    // Trade 1, NQ
    expect(result.signals[0]).toEqual({
      tradeNumber: 1,
      instrument: 'NQ',
      direction: 'LONG',
      entryPrice: 24060,
      tp1: 24088,
      tp2: 24160,
      stopLoss: 24020,
      size: 'Medium',
    });

    // Trade 1, ES
    expect(result.signals[1]).toEqual({
      tradeNumber: 1,
      instrument: 'ES',
      direction: 'LONG',
      entryPrice: 6606,
      tp1: 6634,
      tp2: 6660,
      stopLoss: 6596,
      size: 'Medium',
    });

    // Trade 2, NQ
    expect(result.signals[2].tradeNumber).toBe(2);
    expect(result.signals[2].instrument).toBe('NQ');
    expect(result.signals[2].entryPrice).toBe(24000);

    // Trade 2, ES
    expect(result.signals[3].tradeNumber).toBe(2);
    expect(result.signals[3].instrument).toBe('ES');
    expect(result.signals[3].entryPrice).toBe(6583);
  });

  it('parses SHORT signals with red emoji', () => {
    const msg = `Trade 1
🔴 SHORT NQ @ 23,809
TP1: 23,770
TP2: 23,700
SL: 23,850
Size: Small
🔴 SHORT ES @ 6,537
TP1: 6,510
TP2: 6,480
SL: 6,560
Size: Small`;

    const result = parseSignalMessage(msg);
    expect(result.type).toBe('signals');
    if (result.type !== 'signals') return;

    expect(result.signals).toHaveLength(2);
    expect(result.signals[0].direction).toBe('SHORT');
    expect(result.signals[0].instrument).toBe('NQ');
    expect(result.signals[0].entryPrice).toBe(23809);
    expect(result.signals[0].size).toBe('Small');

    expect(result.signals[1].direction).toBe('SHORT');
    expect(result.signals[1].instrument).toBe('ES');
    expect(result.signals[1].size).toBe('Small');
  });

  it('parses signals with Large size', () => {
    const msg = `Trade 1
🟢 LONG NQ @ 24,100
TP1: 24,200
TP2: 24,300
SL: 24,000
Size: Large`;

    const result = parseSignalMessage(msg);
    expect(result.type).toBe('signals');
    if (result.type !== 'signals') return;
    expect(result.signals[0].size).toBe('Large');
  });

  it('parses signals without Trade header (defaults to trade 1)', () => {
    const msg = `🟢 LONG NQ @ 24,060
TP1: 24,088
TP2: 24,160
SL: 24,020
Size: Medium`;

    const result = parseSignalMessage(msg);
    expect(result.type).toBe('signals');
    if (result.type !== 'signals') return;
    expect(result.signals[0].tradeNumber).toBe(1);
  });

  it('parses signals with Telegram bold markdown formatting', () => {
    const msg = `🔴 **SHORT NQ @ 23,809**
TP1: 23,763
TP2: 23,700
SL: 23,849
Size: Small`;

    const result = parseSignalMessage(msg);
    expect(result.type).toBe('signals');
    if (result.type !== 'signals') return;
    expect(result.signals[0].direction).toBe('SHORT');
    expect(result.signals[0].instrument).toBe('NQ');
    expect(result.signals[0].entryPrice).toBe(23809);
    expect(result.signals[0].stopLoss).toBe(23849);
  });

  it('parses decimal prices', () => {
    const msg = `Trade 1
🟢 LONG ES @ 6,606.50
TP1: 6,634.25
TP2: 6,660.75
SL: 6,596.00
Size: Medium`;

    const result = parseSignalMessage(msg);
    expect(result.type).toBe('signals');
    if (result.type !== 'signals') return;
    expect(result.signals[0].entryPrice).toBe(6606.5);
    expect(result.signals[0].tp1).toBe(6634.25);
  });

  // ─── Warning + Signals ────────────────────────────

  it('parses warning with signals', () => {
    const msg = `⚠️ HIGH RISK — Heavy selling pressure detected
Trade 3
🟢 LONG NQ @ 23,500
TP1: 23,588
TP2: 23,660
SL: 23,460
Size: Small
🟢 LONG ES @ 6,450
TP1: 6,488
TP2: 6,530
SL: 6,430
Size: Small`;

    const result = parseSignalMessage(msg);
    expect(result.type).toBe('signals');
    if (result.type !== 'signals') return;
    expect(result.warning).toBe('HIGH RISK — Heavy selling pressure detected');
    expect(result.signals).toHaveLength(2);
    expect(result.signals[0].tradeNumber).toBe(3);
  });

  // ─── Cancel All ───────────────────────────────────

  it('parses cancel all message', () => {
    const msg = `❌ ALL POSITIONS CANCELLED
Unusual buying pressure detected`;

    const result = parseSignalMessage(msg);
    expect(result.type).toBe('cancellation');
    if (result.type !== 'cancellation') return;
    expect(result.cancellation.type).toBe('cancel_all');
    expect(result.cancellation.reason).toBe('Unusual buying pressure detected');
  });

  it('parses cancel all without reason', () => {
    const msg = `❌ ALL POSITIONS CANCELLED`;

    const result = parseSignalMessage(msg);
    expect(result.type).toBe('cancellation');
    if (result.type !== 'cancellation') return;
    expect(result.cancellation.type).toBe('cancel_all');
  });

  // ─── Cancel Specific ──────────────────────────────

  it('parses cancel specific trade', () => {
    const msg = `❌ Trade 3 — NQ LONG @ 23,500 CANCELLED`;

    const result = parseSignalMessage(msg);
    expect(result.type).toBe('cancellation');
    if (result.type !== 'cancellation') return;
    expect(result.cancellation.type).toBe('cancel_specific');
    expect(result.cancellation.tradeNumber).toBe(3);
  });

  // ─── TP Hit ───────────────────────────────────────

  it('parses TP hit messages', () => {
    const msg = `🟢 LONG NQ @ 23,411 → TP2 23,470 ✅
🟢 LONG ES @ 6,450 → TP1 6,488 ✅`;

    const result = parseSignalMessage(msg);
    expect(result.type).toBe('tp_hit');
    if (result.type !== 'tp_hit') return;

    expect(result.hits).toHaveLength(2);
    expect(result.hits[0].instrument).toBe('NQ');
    expect(result.hits[0].direction).toBe('LONG');
    expect(result.hits[0].entryPrice).toBe(23411);
    expect(result.hits[0].tpLevel).toBe('TP2');
    expect(result.hits[0].tpPrice).toBe(23470);
    expect(result.hits[0].profitPoints).toBe(59);

    expect(result.hits[1].instrument).toBe('ES');
    expect(result.hits[1].tpLevel).toBe('TP1');
  });

  it('parses SHORT TP hit', () => {
    const msg = `🔴 SHORT NQ @ 24,000 → TP1 23,950 ✅`;

    const result = parseSignalMessage(msg);
    expect(result.type).toBe('tp_hit');
    if (result.type !== 'tp_hit') return;
    expect(result.hits[0].direction).toBe('SHORT');
    expect(result.hits[0].profitPoints).toBe(50);
  });

  // ─── Unknown ──────────────────────────────────────

  it('returns unknown for unrecognized messages', () => {
    const msg = `Market update: Nasdaq futures up 1.2%`;

    const result = parseSignalMessage(msg);
    expect(result.type).toBe('unknown');
    if (result.type !== 'unknown') return;
    expect(result.raw).toBe(msg);
  });

  it('returns unknown for empty messages', () => {
    const result = parseSignalMessage('');
    expect(result.type).toBe('unknown');
  });
});
