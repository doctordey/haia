import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { users, userRoles } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';

const VALID_ROLES = ['admin', 'signals', 'journal'] as const;

// GET /api/admin/users — List all users with their roles
export async function GET() {
  const session = await auth();
  if (!session?.user?.roles?.includes('admin')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const allUsers = await db.query.users.findMany({
    columns: { id: true, email: true, name: true, username: true, avatarUrl: true, createdAt: true },
    with: { roles: { columns: { id: true, role: true, grantedAt: true } } },
  });

  return NextResponse.json(allUsers);
}

// POST /api/admin/users — Grant a role to a user
// Body: { userId: string, role: string }
export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.roles?.includes('admin')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const body = await request.json();
  const { userId, role } = body;

  if (!userId || !role) {
    return NextResponse.json({ error: 'userId and role are required' }, { status: 400 });
  }

  if (!VALID_ROLES.includes(role)) {
    return NextResponse.json({ error: `Invalid role. Must be one of: ${VALID_ROLES.join(', ')}` }, { status: 400 });
  }

  // Check user exists
  const user = await db.query.users.findFirst({ where: eq(users.id, userId) });
  if (!user) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 });
  }

  // Insert role (unique constraint will prevent duplicates)
  try {
    const [inserted] = await db.insert(userRoles).values({
      userId,
      role,
      grantedBy: session.user.id,
    }).returning();

    return NextResponse.json(inserted, { status: 201 });
  } catch (error: unknown) {
    const pgError = error as { code?: string };
    if (pgError.code === '23505') {
      return NextResponse.json({ error: 'User already has this role' }, { status: 409 });
    }
    throw error;
  }
}

// DELETE /api/admin/users — Revoke a role from a user
// Body: { userId: string, role: string }
export async function DELETE(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.roles?.includes('admin')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const body = await request.json();
  const { userId, role } = body;

  if (!userId || !role) {
    return NextResponse.json({ error: 'userId and role are required' }, { status: 400 });
  }

  const deleted = await db
    .delete(userRoles)
    .where(and(eq(userRoles.userId, userId), eq(userRoles.role, role)))
    .returning();

  if (deleted.length === 0) {
    return NextResponse.json({ error: 'Role not found for this user' }, { status: 404 });
  }

  return NextResponse.json({ success: true });
}
