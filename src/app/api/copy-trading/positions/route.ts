import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { copyPositions, copyGroups } from '@/lib/db/schema';
import { eq, and, desc, gte, lte } from 'drizzle-orm';

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = request.nextUrl;
  const groupId = searchParams.get('groupId');
  const status = searchParams.get('status');
  const limit = Math.min(100, parseInt(searchParams.get('limit') || '50'));
  const page = Math.max(1, parseInt(searchParams.get('page') || '1'));

  // Verify group belongs to user
  if (groupId) {
    const group = await db.query.copyGroups.findFirst({
      where: and(eq(copyGroups.id, groupId), eq(copyGroups.userId, session.user.id)),
    });
    if (!group) return NextResponse.json({ error: 'Group not found' }, { status: 404 });
  }

  // Get all user's group IDs for filtering
  const userGroups = await db.query.copyGroups.findMany({
    where: eq(copyGroups.userId, session.user.id),
    columns: { id: true },
  });
  const groupIds = userGroups.map((g) => g.id);
  if (groupIds.length === 0) return NextResponse.json({ positions: [], pagination: { page, total: 0, totalPages: 0 } });

  const conditions = groupId
    ? [eq(copyPositions.groupId, groupId)]
    : groupIds.map((gid) => eq(copyPositions.groupId, gid));

  // For simplicity, fetch all matching and paginate in-memory
  // (a production system would use SQL pagination)
  let allPositions = await db.query.copyPositions.findMany({
    where: groupId ? eq(copyPositions.groupId, groupId) : undefined,
    orderBy: (p, { desc }) => [desc(p.createdAt)],
  });

  // Filter to user's groups only
  allPositions = allPositions.filter((p) => groupIds.includes(p.groupId));

  if (status) {
    allPositions = allPositions.filter((p) => p.status === status);
  }

  const total = allPositions.length;
  const paginated = allPositions.slice((page - 1) * limit, page * limit);

  return NextResponse.json({
    positions: paginated,
    pagination: { page, total, totalPages: Math.ceil(total / limit) },
  });
}
