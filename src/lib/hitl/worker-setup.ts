/**
 * HITL worker bootstrap — wires the bot, service, and manager loop into the
 * signal-listener worker, alongside (never replacing) the existing pipeline.
 *
 * Owns its own MetaApi streaming connections for HITL-enabled accounts, so the
 * signal-copier's connections are untouched. Everything here is guarded: if
 * HITL isn't enabled or a connection fails, the existing worker keeps running.
 *
 * Demo guard: an account is treated as demo only when its server name positively
 * matches /demo/i (conservative — unknown ⇒ live). Combined with HITL_ALLOW_LIVE
 * defaulting false, live dispatch is blocked until acceptance both ways.
 */

import { and, eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { tradingAccounts } from '@/lib/db/schema';
import { getMetaApi, fetchBrokerSymbols } from '@/lib/metaapi';
import { getValidatedHitlConfig } from './config';
import { loadChatIds } from './access';
import { buildHitlBroker } from './metaapi';
import { suggestSymbolMatches } from './symbol-suggest';
import type { HitlContext, TargetAccount } from './context';
import { HitlService } from './service';
import { HitlBot } from './bot';
import { HitlManager } from './manager';
import type { HitlAlertNotifier } from './webhook';

interface HitlConnection {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  connection: any;
  isDemo: boolean;
  metaApiId: string;
  name: string;
}

function isDemoServer(server: string): boolean {
  return /demo/i.test(server);
}

// The broker symbol list is large and rarely changes — cache it per account so
// "did you mean" hints don't spin up an RPC connection on every miss.
const SYMBOLS_TTL_MS = 10 * 60_000;
const symbolCache = new Map<string, { symbols: string[]; at: number }>();

async function getCachedSymbols(metaApiId: string): Promise<string[]> {
  const hit = symbolCache.get(metaApiId);
  if (hit && Date.now() - hit.at < SYMBOLS_TTL_MS) return hit.symbols;
  const symbols = await fetchBrokerSymbols(metaApiId);
  symbolCache.set(metaApiId, { symbols, at: Date.now() });
  return symbols;
}

export interface HitlHandle {
  teardown: () => Promise<void>;
}

/**
 * Boot HITL. Returns null when HITL is disabled (no-op for existing deploys).
 */
export async function setupHitl(): Promise<HitlHandle | null> {
  const cfg = getValidatedHitlConfig();
  if (!cfg.enabled) {
    console.log('[hitl] HITL_ENABLED is not "true" — HITL not started.');
    return null;
  }

  console.log('[hitl] starting (demo-only: HITL_ALLOW_LIVE=' + cfg.allowLive + ')');

  const connections = new Map<string, HitlConnection>();
  // Exponential backoff for accounts that fail to connect, so a persistently
  // unreachable/rate-limited account isn't retried every 30s (piling more load
  // onto MetaApi and spamming the logs).
  const connectBackoff = new Map<string, { attempts: number; nextRetry: number }>();

  // Shared per-process SDK client (same instance as the signal listener's
  // price streaming) — one websocket pool instead of one per subsystem.
  const api = await getMetaApi();

  async function connectAccount(row: typeof tradingAccounts.$inferSelect): Promise<void> {
    if (connections.has(row.id)) return;
    const bo = connectBackoff.get(row.id);
    if (bo && Date.now() < bo.nextRetry) return; // still backing off from a prior failure
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let connection: any = null;
    try {
      const account = await api.metatraderAccountApi.getAccount(row.metaApiId);
      if (account.state !== 'DEPLOYED') await account.waitDeployed();
      if (account.connectionStatus !== 'CONNECTED') await account.waitConnected();
      connection = account.getStreamingConnection();
      await connection.connect();
      await connection.waitSynchronized({ timeoutInSeconds: 120 });
      connections.set(row.id, { connection, isDemo: isDemoServer(row.server), metaApiId: row.metaApiId, name: row.name });
      connectBackoff.delete(row.id);
      console.log(`[hitl] connected account ${row.name} (${row.id}) demo=${isDemoServer(row.server)}`);
    } catch (err) {
      // Back off: 30s, 60s, 120s … capped at 10min.
      const attempts = (bo?.attempts ?? 0) + 1;
      const delayMs = Math.min(30_000 * 2 ** (attempts - 1), 10 * 60_000);
      connectBackoff.set(row.id, { attempts, nextRetry: Date.now() + delayMs });
      console.error(`[hitl] failed to connect account ${row.name} (${row.id}) — retrying in ${Math.round(delayMs / 1000)}s:`, err instanceof Error ? err.message : err);
      // Close the half-open connection so its websocket stops retry-looping in the
      // background — otherwise failed attempts pile up and hammer MetaApi (429).
      if (connection) { try { await connection.close(); } catch { /* ignore */ } }
    }
  }

  async function scanAndConnect(): Promise<void> {
    const enabled = await db
      .select()
      .from(tradingAccounts)
      .where(and(eq(tradingAccounts.hitlEnabled, true), eq(tradingAccounts.isActive, true)));
    for (const row of enabled) await connectAccount(row);
  }

  await scanAndConnect();

  const ctx: HitlContext = {
    cfg,

    getChatIds() {
      return loadChatIds(cfg);
    },

    async notify(text) {
      await bot.broadcast(text);
    },

    getBroker(accountId) {
      const c = connections.get(accountId);
      return c ? buildHitlBroker(c.connection, c.isDemo) : undefined;
    },

    accountName(accountId) {
      return connections.get(accountId)?.name;
    },

    async resolveTargetAccounts(): Promise<TargetAccount[]> {
      const enabled = await db
        .select()
        .from(tradingAccounts)
        .where(and(eq(tradingAccounts.hitlEnabled, true), eq(tradingAccounts.isActive, true)));
      // Only accounts with a live connection can receive orders. Stable order
      // (by id) so the same account consistently backs the primary session.
      return enabled
        .filter((r) => connections.has(r.id))
        .sort((a, b) => a.id.localeCompare(b.id))
        .map((r) => ({ accountId: r.id, isDemo: connections.get(r.id)!.isDemo, name: r.name }));
    },

    async resolveTargetAccount(): Promise<TargetAccount | null> {
      const all = await this.resolveTargetAccounts();
      return all[0] ?? null;
    },

    async suggestSymbols(query): Promise<string[]> {
      const c = [...connections.values()][0];
      if (!c) return [];
      try {
        const symbols = await getCachedSymbols(c.metaApiId);
        return suggestSymbolMatches(query, symbols, 5);
      } catch (err) {
        console.warn('[hitl] symbol suggestion lookup failed:', err);
        return [];
      }
    },
  };

  const service = new HitlService(ctx);
  const bot = new HitlBot(cfg.telegramBotToken, service);
  const manager = new HitlManager(ctx, bot, service);

  // Low-latency nudges from the webhooks (otherwise the loop catches it anyway).
  const notifier: HitlAlertNotifier = {
    onAlert: () => void manager.tick().catch(() => {}),
    onBeRequested: () => void manager.tick().catch(() => {}),
  };
  (globalThis as Record<string, unknown>).__haiaHitl = notifier;

  bot.start();
  await manager.resumeOnRestart();
  manager.start();

  // Surface the resolved destinations once at boot — the single most useful line
  // when prompts aren't arriving.
  try {
    const dests = await loadChatIds(cfg);
    if (dests.length === 0) {
      console.warn('[hitl] NO destinations configured — add a DM/group in Settings → Unicorn → Access (or set HITL_OPERATOR_CHAT_ID). Prompts have nowhere to go.');
    } else {
      console.log(`[hitl] ${dests.length} destination(s): ${dests.join(', ')}`);
    }
  } catch (err) {
    console.error('[hitl] could not resolve destinations at boot:', err);
  }

  // Pick up accounts toggled on after boot.
  const rescan = setInterval(() => void scanAndConnect().catch(() => {}), 30_000);

  console.log('[hitl] running.');

  return {
    async teardown() {
      clearInterval(rescan);
      manager.stop();
      await bot.stop().catch(() => {});
      for (const c of connections.values()) {
        try { await c.connection.close(); } catch {}
      }
      connections.clear();
      delete (globalThis as Record<string, unknown>).__haiaHitl;
      console.log('[hitl] stopped.');
    },
  };
}
