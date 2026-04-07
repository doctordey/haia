/**
 * Seed script: Grants admin, signals, and journal roles to brandonsdey@gmail.com
 *
 * Usage: npx tsx scripts/seed-roles.ts
 */
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { eq } from 'drizzle-orm';
import { users, userRoles } from '../src/lib/db/schema';

async function seed() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const db = drizzle(pool);

  const TARGET_EMAIL = 'brandonsdey@gmail.com';
  const ROLES = ['admin', 'signals', 'journal'] as const;

  console.log(`Looking up user: ${TARGET_EMAIL}`);
  const [user] = await db.select().from(users).where(eq(users.email, TARGET_EMAIL));

  if (!user) {
    console.error(`User ${TARGET_EMAIL} not found. Register first, then run this script.`);
    await pool.end();
    process.exit(1);
  }

  console.log(`Found user: ${user.name ?? user.email} (${user.id})`);

  for (const role of ROLES) {
    try {
      await db.insert(userRoles).values({ userId: user.id, role }).onConflictDoNothing();
      console.log(`  ✓ Granted role: ${role}`);
    } catch (err) {
      console.error(`  ✗ Failed to grant role ${role}:`, err);
    }
  }

  console.log('Done.');
  await pool.end();
}

seed().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
