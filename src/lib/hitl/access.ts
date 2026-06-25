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
import { hitlAuthorizedUsers, hitlChats, hitlSettings } from '@/lib/db/schema';
import type { HitlConfig } from './config';

export type AuthorizedUserRow = typeof hitlAuthorizedUsers.$inferSelect;
export type ChatRow = typeof hitlChats.$inferSelect;

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

/**
 * All operator destinations: the env seed (HITL_OPERATOR_CHAT_ID), the legacy
 * single setting (if any), and every hitl_chats row — deduped. Prompts and
 * notifications fan out to all of these.
 */
export async function loadChatIds(cfg: HitlConfig): Promise<string[]> {
  const ids = new Set<string>();
  if (cfg.operatorChatId) ids.add(cfg.operatorChatId.trim());

  // Each DB source is isolated: a failure (e.g. an un-applied migration) must
  // not silence the whole bot — fall back to whatever destinations we can get.
  try {
    const [legacy] = await db.select().from(hitlSettings).where(eq(hitlSettings.key, OPERATOR_CHAT_KEY)).limit(1);
    if (legacy?.value) ids.add(legacy.value.trim());
  } catch (err) {
    console.error('[hitl/access] legacy operator-chat lookup failed:', err);
  }

  try {
    const rows = await db.select().from(hitlChats);
    for (const r of rows) ids.add(r.chatId.trim());
  } catch (err) {
    console.error('[hitl/access] hitl_chats lookup failed — is migration 0010 applied?', err);
  }

  return [...ids].filter(Boolean);
}

// ── chat destinations CRUD ──

export async function listChats(): Promise<ChatRow[]> {
  return db.select().from(hitlChats).orderBy(asc(hitlChats.createdAt));
}

export async function addChat(chatId: string, label?: string): Promise<ChatRow> {
  const id = chatId.trim();
  const lbl = label?.trim() || null;
  const [row] = await db
    .insert(hitlChats)
    .values({ chatId: id, label: lbl })
    .onConflictDoUpdate({ target: hitlChats.chatId, set: { label: lbl } })
    .returning();
  return row;
}

export async function deleteChat(id: string): Promise<void> {
  await db.delete(hitlChats).where(eq(hitlChats.id, id));
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
