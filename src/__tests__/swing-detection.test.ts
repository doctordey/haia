import { describe, it, expect } from 'vitest';
import { findSwingHigh, findSwingLow, findAnchorForDirection, type Candle } from '@/lib/signals/swing-detection';

function c(t: number, h: number, l: number): Candle {
  return { time: t, open: (h + l) / 2, close: (h + l) / 2, high: h, low: l };
}

describe('findSwingHigh / findSwingLow', () => {
  it('finds a clear swing high in the middle of the window', () => {
    // 7 candles, swing high at index 3 with strength 2
    const cs = [
      c(1, 100, 99),
      c(2, 101, 100),
      c(3, 102, 101),
      c(4, 110, 105),  // swing high
      c(5, 103, 102),
      c(6, 102, 101),
      c(7, 101, 100),
    ];
    const r = findSwingHigh(cs, 2);
    expect(r.found).toBe(true);
    expect(r.index).toBe(3);
    expect(r.price).toBe(110);
  });

  it('finds a clear swing low', () => {
    const cs = [
      c(1, 100, 99),
      c(2, 99, 98),
      c(3, 98, 97),
      c(4, 95, 90),    // swing low
      c(5, 96, 95),
      c(6, 97, 96),
      c(7, 98, 97),
    ];
    const r = findSwingLow(cs, 2);
    expect(r.found).toBe(true);
    expect(r.index).toBe(3);
    expect(r.price).toBe(90);
  });

  it('picks the MOST RECENT qualifying swing', () => {
    // Two swing highs, want the later one
    const cs = [
      c(1,  98,  97),
      c(2, 100,  99),
      c(3, 105, 103),  // older swing high
      c(4, 100,  99),
      c(5,  98,  97),
      c(6, 100,  99),
      c(7, 108, 105),  // more recent swing high
      c(8, 102, 101),
      c(9, 100,  99),
    ];
    const r = findSwingHigh(cs, 2);
    expect(r.found).toBe(true);
    expect(r.index).toBe(6);
    expect(r.price).toBe(108);
  });

  it('returns not-found when window is too small', () => {
    const cs = [c(1, 100, 99), c(2, 101, 100), c(3, 100, 99)];
    expect(findSwingHigh(cs, 2).found).toBe(false);
  });

  it('returns not-found when no candle qualifies', () => {
    // Strictly monotonic — no peaks
    const cs = Array.from({ length: 10 }, (_, i) => c(i, 100 + i, 99 + i));
    expect(findSwingHigh(cs, 2).found).toBe(false);
  });
});

describe('findAnchorForDirection', () => {
  it('LONG: returns the most recent swing low BELOW entry price', () => {
    const cs = [
      c(1, 100, 99),
      c(2,  99, 98),
      c(3,  98, 97),
      c(4,  95, 90),    // swing low at 90
      c(5,  96, 95),
      c(6,  97, 96),
      c(7,  99, 98),
    ];
    const r = findAnchorForDirection(cs, 'LONG', 99, 2);
    expect(r.found).toBe(true);
    expect(r.price).toBe(90);
  });

  it('LONG: skips swing lows ABOVE entry (would put SL above entry)', () => {
    // Two swing lows; the recent one is above current entry price
    const cs = [
      c(1, 100,  90),
      c(2,  99,  89),
      c(3,  98,  88),
      c(4, 100,  80),  // older swing low at 80
      c(5,  99,  89),
      c(6,  98,  90),
      c(7,  99,  95),  // recent low at 95 — but pretending entry = 92 means this is ABOVE entry
      c(8, 100,  96),
      c(9, 101,  97),
    ];
    // Entry = 92 → reject 95 (above) and look for 80 (below)
    const r = findAnchorForDirection(cs, 'LONG', 92, 2);
    expect(r.found).toBe(true);
    expect(r.price).toBe(80);
  });

  it('SHORT: returns the most recent swing high ABOVE entry', () => {
    const cs = [
      c(1, 100, 99),
      c(2, 101, 100),
      c(3, 102, 101),
      c(4, 110, 105),  // swing high
      c(5, 103, 102),
      c(6, 102, 101),
      c(7, 101, 100),
    ];
    const r = findAnchorForDirection(cs, 'SHORT', 102, 2);
    expect(r.found).toBe(true);
    expect(r.price).toBe(110);
  });

  it('returns not-found when no swing on the correct side of entry exists', () => {
    const cs = Array.from({ length: 10 }, (_, i) => c(i, 100, 99));  // flat
    const r = findAnchorForDirection(cs, 'LONG', 99, 2);
    expect(r.found).toBe(false);
  });
});
