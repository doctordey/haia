/**
 * Fuzzy "did you mean" symbol matcher — when a requested symbol has no broker
 * specification, rank the broker's actual symbol names by similarity so the
 * operator can map it (e.g. US30 → US30.cash) instead of guessing.
 */

function normalize(s: string): string {
  return s.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function sharedPrefix(a: string, b: string): number {
  const n = Math.min(a.length, b.length);
  let i = 0;
  while (i < n && a[i] === b[i]) i++;
  return i;
}

/** Best matches for `query` among `symbols`, most-similar first (max `limit`). */
export function suggestSymbolMatches(query: string, symbols: string[], limit = 5): string[] {
  const q = normalize(query);
  if (!q) return [];

  const scored: { sym: string; score: number }[] = [];
  for (const sym of symbols) {
    // Don't suggest the exact thing that just failed.
    if (sym.toUpperCase() === query.toUpperCase()) continue;
    const n = normalize(sym);
    if (!n) continue;

    let score = 0;
    if (n === q) score = 100;
    else if (n.startsWith(q)) score = 85;
    else if (q.startsWith(n)) score = 75;
    else if (n.includes(q)) score = 65;
    else if (q.includes(n)) score = 55;
    else {
      const lcp = sharedPrefix(n, q);
      if (lcp >= Math.min(3, q.length)) score = 30 + lcp;
    }

    if (score > 0) scored.push({ sym, score });
  }

  scored.sort((a, b) => b.score - a.score || a.sym.length - b.sym.length || a.sym.localeCompare(b.sym));
  return scored.slice(0, limit).map((s) => s.sym);
}
