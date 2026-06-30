import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { apiKeys } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { generateApiKey, normalizeScopes, scopesToString } from '@/lib/api/keys';

// List the current user's API keys (never returns the secret — only metadata).
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const keys = await db.query.apiKeys.findMany({
    where: eq(apiKeys.userId, session.user.id),
    orderBy: (k, { desc }) => [desc(k.createdAt)],
    columns: { keyHash: false },
  });

  return NextResponse.json(keys);
}

// Create a new API key. The plaintext is returned exactly once, here.
export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const name = typeof body.name === 'string' && body.name.trim() ? body.name.trim() : 'API key';
  const scopes = normalizeScopes(body.scopes);

  let expiresAt: Date | null = null;
  if (body.expiresAt) {
    const d = new Date(body.expiresAt);
    if (Number.isNaN(d.getTime())) {
      return NextResponse.json({ error: 'Invalid expiresAt' }, { status: 400 });
    }
    expiresAt = d;
  }

  const generated = generateApiKey();

  const [row] = await db
    .insert(apiKeys)
    .values({
      userId: session.user.id,
      name,
      prefix: generated.prefix,
      keyHash: generated.keyHash,
      scopes: scopesToString(scopes),
      expiresAt,
    })
    .returning({
      id: apiKeys.id,
      name: apiKeys.name,
      prefix: apiKeys.prefix,
      scopes: apiKeys.scopes,
      expiresAt: apiKeys.expiresAt,
      createdAt: apiKeys.createdAt,
    });

  // `key` is the only time the plaintext is ever exposed.
  return NextResponse.json({ ...row, key: generated.plaintext }, { status: 201 });
}
