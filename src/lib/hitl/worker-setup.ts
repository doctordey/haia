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
import { fetchHistoricalDeals } from '@/lib/metaapi';
import { getValidatedHitlConfig } from './config';
import { loadChatIds } from './access';
import { buildHitlBroker, signalIdPrefix } from './metaapi';
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
}

function isDemoServer(server: string): boolean {
  return /demo/i.test(server);
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

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const MetaApi = require('metaapi.cloud-sdk').default;
  const api = new MetaApi(process.env.METAAPI_TOKEN);

  async function connectAccount(row: typeof tradingAccounts.$inferSelect): Promise<void> {
    if (connections.has(row.id)) return;
    try {
      const account = await api.metatraderAccountApi.getAccount(row.metaApiId);
      if (account.state !== 'DEPLOYED') await account.waitDeployed();
      if (account.connectionStatus !== 'CONNECTED') await account.waitConnected();
      const connection = account.getStreamingConnection();
      await connection.connect();
      await connection.waitSynchronized({ timeoutInSeconds: 120 });
      connections.set(row.id, { connection, isDemo: isDemoServer(row.server), metaApiId: row.metaApiId });
      console.log(`[hitl] connected account ${row.name} (${row.id}) demo=${isDemoServer(row.server)}`);
    } catch (err) {
      console.error(`[hitl] failed to connect account ${row.name} (${row.id}):`, err);
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

    async resolveTargetAccount(): Promise<TargetAccount | null> {
      const enabled = await db
        .select()
        .from(tradingAccounts)
        .where(and(eq(tradingAccounts.hitlEnabled, true), eq(tradingAccounts.isActive, true)));
      const armed = enabled.filter((r) => connections.has(r.id));
      if (armed.length === 0) return null;
      if (armed.length > 1) {
        console.warn(`[hitl] ${armed.length} HITL accounts armed — targeting first (${armed[0].name}).`);
      }
      const c = connections.get(armed[0].id)!;
      return { accountId: armed[0].id, isDemo: c.isDemo };
    },

    async realizedPnlForSignal(signalId, since): Promise<number | null> {
      const c = [...connections.values()][0];
      if (!c) return null;
      try {
        const deals = await fetchHistoricalDeals(c.metaApiId, since, new Date());
        const prefix = signalIdPrefix(signalId);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const matched = (deals as any[]).filter((d) => typeof d.clientId === 'string' && d.clientId.startsWith(prefix));
        if (matched.length === 0) return null;
        return matched.reduce((sum, d) => sum + Number(d.profit ?? 0) + Number(d.commission ?? 0) + Number(d.swap ?? 0), 0);
      } catch (err) {
        console.warn(`[hitl] realizedPnl lookup failed for ${signalId}:`, err);
        return null;
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
