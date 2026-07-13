import { describe, it, expect } from 'vitest';
import { parseTimeParam } from '@/lib/api/time';

describe('parseTimeParam', () => {
  it('returns null for absent/blank', () => {
    expect(parseTimeParam(null)).toBeNull();
    expect(parseTimeParam('')).toBeNull();
    expect(parseTimeParam('   ')).toBeNull();
  });

  it('parses ISO 8601', () => {
    const d = parseTimeParam('2024-01-02T12:00:00Z') as Date;
    expect(d.toISOString()).toBe('2024-01-02T12:00:00.000Z');
    expect((parseTimeParam('2024-01-02') as Date).getTime()).not.toBeNaN();
  });

  it('parses epoch milliseconds (≥13 digits) and seconds (≤10 digits)', () => {
    const ms = new Date('2024-01-02T12:00:00Z').getTime(); // 1704196800000
    expect((parseTimeParam(String(ms)) as Date).toISOString()).toBe('2024-01-02T12:00:00.000Z');
    const secs = Math.floor(ms / 1000);                     // 1704196800
    expect((parseTimeParam(String(secs)) as Date).toISOString()).toBe('2024-01-02T12:00:00.000Z');
  });

  it('flags malformed input as invalid', () => {
    expect(parseTimeParam('not-a-date')).toBe('invalid');
    expect(parseTimeParam('2024-13-99')).toBe('invalid');
  });
});
