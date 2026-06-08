/**
 * HITL access — who may respond/approve, and where prompts are sent.
 *
 * Managed in-app (Settings → HITL → Access), merged with the env seeds
 * (`AUTHORIZED_TELEGRAM_USER_IDS`, `HITL_OPERATOR_CHAT_ID`). DB is live — adding
 * or removing a trader takes effect on the next message, no redeploy. Secrets
 * (bot token, webhook secret) stay in env.
 */

import { asc, eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { hitlAuthorizedUsers, hitlSettings } from '@/lib/db/schema';
import type { HitlConfig } from './config';

export type AuthorizedUserRow = typeof hitlAuthorizedUsers.$inferSelect;

const OPERATOR_CHAT_KEY = 'operatorChatId';

/** Union of env-seeded ids and DB rows. */
export async function loadAuthorizedUserIds(cfg: HitlConfig): Promise<Set<number>> {
  const set = new Set<number>(cfg.authorizedUserIds);
  const rows = await db.select().from(hitlAuthorizedUsers);
  for (const r of rows) {
    const n = Number(r.telegramUserId);
    if (Number.isInteger(n)) set.add(n);
  }
  return set;
}

export async function isUserAuthorized(cfg: HitlConfig, userId: number): Promise<boolean> {
  return (await loadAuthorizedUserIds(cfg)).has(userId);
}

/** DB operator/group chat id overrides the env seed. */
export async function loadOperatorChatId(cfg: HitlConfig): Promise<string> {
  const [row] = await db.select().from(hitlSettings).where(eq(hitlSettings.key, OPERATOR_CHAT_KEY)).limit(1);
  return row?.value || cfg.operatorChatId;
}

// ── CRUD (Settings UI / API) ──

export async function listAuthorizedUsers(): Promise<AuthorizedUserRow[]> {
  return db.select().from(hitlAuthorizedUsers).orderBy(asc(hitlAuthorizedUsers.createdAt));
}

export async function addAuthorizedUser(telegramUserId: string, label?: string): Promise<AuthorizedUserRow> {
  const id = telegramUserId.trim();
  const lbl = label?.trim() || null;
  const [row] = await db
    .insert(hitlAuthorizedUsers)
    .values({ telegramUserId: id, label: lbl })
    .onConflictDoUpdate({ target: hitlAuthorizedUsers.telegramUserId, set: { label: lbl } })
    .returning();
  return row;
}

export async function deleteAuthorizedUser(id: string): Promise<void> {
  await db.delete(hitlAuthorizedUsers).where(eq(hitlAuthorizedUsers.id, id));
}

export async function getOperatorChatSetting(): Promise<string | null> {
  const [row] = await db.select().from(hitlSettings).where(eq(hitlSettings.key, OPERATOR_CHAT_KEY)).limit(1);
  return row?.value ?? null;
}

export async function setOperatorChatSetting(value: string): Promise<void> {
  const v = value.trim();
  await db
    .insert(hitlSettings)
    .values({ key: OPERATOR_CHAT_KEY, value: v })
    .onConflictDoUpdate({ target: hitlSettings.key, set: { value: v } });
}
