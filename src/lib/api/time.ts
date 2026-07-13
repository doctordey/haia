/**
 * Parse a timestamp query parameter for the public API. Accepts either:
 *   • ISO 8601 — "2024-01-02", "2024-01-02T12:00:00Z" (recommended)
 *   • epoch — all-digit strings: ≥13 digits = milliseconds, ≤10 = seconds
 *
 * Returns a Date, or null if absent/blank, or the string 'invalid' so callers
 * can return a 400 rather than silently ignoring a malformed filter.
 */
export function parseTimeParam(raw: string | null): Date | null | 'invalid' {
  if (raw == null || raw.trim() === '') return null;
  const s = raw.trim();

  if (/^\d+$/.test(s)) {
    const n = Number(s);
    const ms = s.length <= 10 ? n * 1000 : n; // seconds vs milliseconds
    const d = new Date(ms);
    return Number.isNaN(d.getTime()) ? 'invalid' : d;
  }

  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? 'invalid' : d;
}
