import { describe, it, expect } from 'vitest';
import { parseUnicornMessage } from '@/lib/signals/unicorn-parser';

describe('parseUnicornMessage — activation', () => {
  it('parses the canonical activation message', () => {
    const text = `"Activated 5m Bullish Unicorn [1H OHLC] on NAS100 @ 30348.09"

Unicorn° [Pro+] (50, Automatic, Multiple, Automatic, 15, OHLC + Swing, 60, OHLC + Swing, 240, OHLC + Swing, 2, 1.5, Small, Solid, 1, Solid, 1, All, 10, Points, 0, 0, 0, 0200-0500, 0930-1200, 1330-1600, Detailed, Small, Bottom, Right): Any alert() function call`;
    const r = parseUnicornMessage(text);
    expect(r.ok).toBe(true);
    expect(r.payload?.alert_type).toBe('activation');
    expect(r.payload?.tv_symbol).toBe('NAS100');
    expect(r.payload?.direction).toBe('LONG');
    expect(r.payload?.tv_price).toBeCloseTo(30348.09, 2);
  });

  it('handles Bearish (SHORT)', () => {
    const r = parseUnicornMessage('Activated 5m Bearish Unicorn [1H OHLC] on XBRUSD @ 75.42');
    expect(r.ok).toBe(true);
    expect(r.payload?.direction).toBe('SHORT');
    expect(r.payload?.tv_symbol).toBe('XBRUSD');
    expect(r.payload?.tv_price).toBeCloseTo(75.42, 2);
  });

  it('handles comma-formatted prices', () => {
    const r = parseUnicornMessage('Activated 15m Bullish Unicorn [4H OHLC] on US500 @ 5,432.50');
    expect(r.ok).toBe(true);
    expect(r.payload?.tv_price).toBeCloseTo(5432.5, 2);
  });

  it('handles symbols with dots and underscores', () => {
    const r = parseUnicornMessage('Activated 5m Bullish Unicorn [1H OHLC] on EUR.USD @ 1.0850');
    expect(r.ok).toBe(true);
    expect(r.payload?.tv_symbol).toBe('EUR.USD');
  });
});

describe('parseUnicornMessage — target reached', () => {
  it('parses an "1R Hit" style message', () => {
    const r = parseUnicornMessage('1R Hit on NAS100 @ 30450.00');
    expect(r.ok).toBe(true);
    expect(r.payload?.alert_type).toBe('target_reached');
    expect(r.payload?.r_level).toBe(1);
    expect(r.payload?.tv_symbol).toBe('NAS100');
  });

  it('parses "Target Reached 5R"', () => {
    const r = parseUnicornMessage('Target Reached 5R on XBRUSD @ 76.00');
    expect(r.ok).toBe(true);
    expect(r.payload?.r_level).toBe(5);
  });
});

describe('parseUnicornMessage — invalidation', () => {
  it('parses Invalidation Hit', () => {
    const r = parseUnicornMessage('Bullish Unicorn Invalidated 5m on NAS100');
    expect(r.ok).toBe(true);
    expect(r.payload?.alert_type).toBe('invalidation_hit');
    expect(r.payload?.tv_symbol).toBe('NAS100');
  });

  it('parses Invalidation Warning separately', () => {
    const r = parseUnicornMessage('Invalidation Warning 5m on XBRUSD');
    expect(r.ok).toBe(true);
    expect(r.payload?.alert_type).toBe('invalidation_warning');
  });

  it('parses Potential Breaker', () => {
    const r = parseUnicornMessage('Potential Breaker forming 5m on NAS100');
    expect(r.ok).toBe(true);
    expect(r.payload?.alert_type).toBe('potential_breaker');
  });
});

describe('parseUnicornMessage — unknown', () => {
  it('returns ok=false for unrecognised text', () => {
    const r = parseUnicornMessage('Some random message that does not match');
    expect(r.ok).toBe(false);
  });

  it('handles empty input', () => {
    const r = parseUnicornMessage('');
    expect(r.ok).toBe(false);
  });
});
