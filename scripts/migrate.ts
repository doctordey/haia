/**
 * Runtime migration runner — applies pending Drizzle migrations on boot using
 * only production dependencies (drizzle-orm + pg). This replaces calling the
 * `drizzle-kit` CLI at start time, which isn't reliably installed in production
 * (it's a devDependency). Compatible with migrations previously applied by
 * `drizzle-kit migrate` (same `__drizzle_migrations` journal).
 */

import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error('[migrate] DATABASE_URL is not set — skipping migrations.');
    process.exit(1);
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const db = drizzle(pool);

  console.log('[migrate] applying pending migrations…');
  await migrate(db, { migrationsFolder: './drizzle' });
  console.log('[migrate] up to date.');

  await pool.end();
}

main().catch((err) => {
  console.error('[migrate] FAILED:', err);
  process.exit(1);
});
