import { createHash, randomBytes } from 'crypto';

/**
 * API key helpers for the public REST API (/api/v1/*).
 *
 * A key looks like `hk_<48 hex chars>`. We never persist the plaintext — only
 * its SHA-256 hash and a short, non-secret `prefix` (the first chars) so the UI
 * can show which key is which without revealing it.
 */

export const API_KEY_PREFIX = 'hk_';
export const API_SCOPES = ['read', 'write'] as const;
export type ApiScope = (typeof API_SCOPES)[number];

export interface GeneratedApiKey {
  /** Full plaintext key — shown to the user exactly once, never stored. */
  plaintext: string;
  /** Short non-secret identifier, e.g. "hk_a1b2c3". Safe to display/store. */
  prefix: string;
  /** SHA-256 hex of the plaintext; this is what we store and look up by. */
  keyHash: string;
}

export function hashApiKey(plaintext: string): string {
  return createHash('sha256').update(plaintext.trim()).digest('hex');
}

export function generateApiKey(): GeneratedApiKey {
  const plaintext = API_KEY_PREFIX + randomBytes(24).toString('hex'); // 48 hex chars
  return {
    plaintext,
    prefix: plaintext.slice(0, API_KEY_PREFIX.length + 6), // "hk_" + 6 chars
    keyHash: hashApiKey(plaintext),
  };
}

/** Parse/clean a comma-separated scope string; keeps only known scopes. */
export function normalizeScopes(input: unknown): ApiScope[] {
  const raw = Array.isArray(input)
    ? input
    : typeof input === 'string'
      ? input.split(',')
      : [];
  const cleaned = raw
    .map((s) => String(s).trim().toLowerCase())
    .filter((s): s is ApiScope => (API_SCOPES as readonly string[]).includes(s));
  const unique = Array.from(new Set(cleaned));
  // Every key can at least read.
  return unique.length ? (unique.includes('read') ? unique : ['read', ...unique]) : ['read'];
}

export function scopesToString(scopes: ApiScope[]): string {
  return scopes.join(',');
}
