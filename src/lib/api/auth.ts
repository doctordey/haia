import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { apiKeys } from '@/lib/db/schema';
import { and, eq, isNull, gt, or } from 'drizzle-orm';
import { hashApiKey, type ApiScope } from '@/lib/api/keys';

/**
 * Authentication for the public REST API (/api/v1/*).
 *
 * Callers present a key via either header:
 *   Authorization: Bearer hk_…
 *   X-API-Key: hk_…
 *
 * The key's SHA-256 hash is looked up; revoked/expired keys are rejected. On
 * success `lastUsedAt` is bumped (best-effort) and the resolved identity is
 * returned. Scope is enforced when `requiredScope` is provided.
 */

export interface ApiIdentity {
  userId: string;
  keyId: string;
  scopes: ApiScope[];
  /** Account restriction: null = every account the user owns; array = only these ids. */
  accountIds: string[] | null;
}

/**
 * Whether this key may touch the given account. Routes must treat a denial as
 * a 404 (same response as a nonexistent account) so a restricted key can't
 * probe which other account ids exist.
 */
export function keyAllowsAccount(identity: ApiIdentity, accountId: string): boolean {
  return identity.accountIds === null || identity.accountIds.includes(accountId);
}

function extractKey(request: Request): string | null {
  const header = request.headers.get('authorization');
  if (header) {
    const match = header.match(/^Bearer\s+(.+)$/i);
    if (match) return match[1].trim();
  }
  const x = request.headers.get('x-api-key');
  if (x) return x.trim();
  return null;
}

/**
 * Resolve the caller from their API key. Returns an `ApiIdentity` on success, or
 * a ready-to-return `NextResponse` (401/403) on failure. Callers do:
 *
 *   const auth = await authenticateApiKey(request, 'write');
 *   if (auth instanceof NextResponse) return auth;
 *   // auth.userId, auth.scopes …
 */
export async function authenticateApiKey(
  request: Request,
  requiredScope?: ApiScope,
): Promise<ApiIdentity | NextResponse> {
  const plaintext = extractKey(request);
  if (!plaintext) {
    return NextResponse.json(
      { error: 'Missing API key. Send it as "Authorization: Bearer <key>" or the "X-API-Key" header.' },
      { status: 401 },
    );
  }

  const keyHash = hashApiKey(plaintext);
  const now = new Date();

  const row = await db.query.apiKeys.findFirst({
    where: and(
      eq(apiKeys.keyHash, keyHash),
      isNull(apiKeys.revokedAt),
      or(isNull(apiKeys.expiresAt), gt(apiKeys.expiresAt, now)),
    ),
  });

  if (!row) {
    return NextResponse.json({ error: 'Invalid, revoked, or expired API key' }, { status: 401 });
  }

  const scopes = row.scopes.split(',').map((s) => s.trim()).filter(Boolean) as ApiScope[];

  if (requiredScope && !scopes.includes(requiredScope)) {
    return NextResponse.json(
      { error: `This key lacks the "${requiredScope}" scope` },
      { status: 403 },
    );
  }

  // Best-effort usage stamp — never block the request on it.
  db.update(apiKeys).set({ lastUsedAt: now }).where(eq(apiKeys.id, row.id)).catch(() => {});

  const accountIds = Array.isArray(row.accountIds) && row.accountIds.length > 0
    ? row.accountIds.map(String)
    : null;

  return { userId: row.userId, keyId: row.id, scopes, accountIds };
}
