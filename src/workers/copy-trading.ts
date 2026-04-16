/**
 * Copy Trading Worker
 *
 * Runs as a separate process: npx tsx src/workers/copy-trading.ts
 * Monitors master accounts for position changes and mirrors them to slave accounts.
 */

import { db } from '../lib/db';
import {
  copyGroups,
  copySlaves,
  copySymbolMaps,
  tradingAccounts,
} from '../lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { getMetaApiInstance } from '../lib/metaapi';
import { MetaApiMasterMonitor } from '../lib/copy-trading/monitors/metaapi-monitor';
import { TradovateMasterMonitor } from '../lib/copy-trading/monitors/tradovate-monitor';
import { MetaApiCopyTradeAdapter } from '../lib/copy-trading/adapters/metaapi-adapter';
import { TradovateCopyTradeAdapter } from '../lib/copy-trading/adapters/tradovate-adapter';
import { dispatchOpen, dispatchClose, dispatchModify } from '../lib/copy-trading/dispatch';
import type {
  MasterMonitor,
  CopyTradeInterface,
  ResolvedCopyGroup,
  ResolvedCopySlave,
  ResolvedSymbolMap,
  CopyPlatform,
  CopySizingMode,
  MasterPositionEvent,
  TradovateCredentials,
} from '../types/copy-trading';

// ─── Globals ──────────────────────────────────────────

const activeMonitors = new Map<string, MasterMonitor>();
const tradeInterfaces = new Map<string, CopyTradeInterface>();
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const slaveConnections = new Map<string, any>();
let isShuttingDown = false;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── Config Loading ───────────────────────────────────

async function loadEnabledGroups(): Promise<ResolvedCopyGroup[]> {
  const groups = await db.query.copyGroups.findMany({
    where: eq(copyGroups.isEnabled, true),
    with: {
      masterAccount: true,
      slaves: {
        with: {
          account: true,
          symbolMaps: true,
        },
      },
    },
  });

  return groups.map((g) => ({
    id: g.id,
    userId: g.userId,
    name: g.name,
    masterAccountId: g.masterAccountId,
    masterAccount: {
      id: g.masterAccount.id,
      platform: g.masterAccount.platform as CopyPlatform,
      metaApiId: g.masterAccount.metaApiId,
      tradovateAccountId: g.masterAccount.tradovateAccountId,
      tradovateEnvironment: g.masterAccount.tradovateEnvironment,
    },
    slaves: g.slaves.map((s): ResolvedCopySlave => {
      const symbolMaps = new Map<string, ResolvedSymbolMap>();
      for (const sm of s.symbolMaps) {
        symbolMaps.set(sm.masterSymbol, {
          id: sm.id,
          masterSymbol: sm.masterSymbol,
          slaveSymbol: sm.slaveSymbol,
          isEnabled: sm.isEnabled,
          sizingMode: sm.sizingMode as CopySizingMode | null,
          multiplier: sm.multiplier,
          riskPercent: sm.riskPercent,
          fixedLots: sm.fixedLots,
          pipValuePerLot: sm.pipValuePerLot,
          minLotSize: sm.minLotSize,
          lotStep: sm.lotStep,
          copySl: sm.copySl,
          copyTp: sm.copyTp,
          applyOffset: sm.applyOffset,
          offsetInstrument: sm.offsetInstrument as 'NQ' | 'ES' | null,
        });
      }
      return {
        id: s.id,
        accountId: s.accountId,
        account: {
          id: s.account.id,
          platform: s.account.platform as CopyPlatform,
          metaApiId: s.account.metaApiId,
          tradovateAccountId: s.account.tradovateAccountId,
          tradovateEnvironment: s.account.tradovateEnvironment,
          accessMode: s.account.accessMode,
        },
        isEnabled: s.isEnabled,
        dryRun: s.dryRun,
        sizingMode: s.sizingMode as CopySizingMode,
        multiplier: s.multiplier,
        riskPercent: s.riskPercent,
        riskBase: s.riskBase as 'balance' | 'equity',
        maxRiskPercent: s.maxRiskPercent,
        fixedLots: s.fixedLots,
        maxLotSize: s.maxLotSize,
        maxLotsPerOrder: s.maxLotsPerOrder,
        maxSlippage: s.maxSlippage,
        marginWarningPct: s.marginWarningPct,
        marginRejectPct: s.marginRejectPct,
        directionFilter: s.directionFilter as 'LONG' | 'SHORT' | null,
        maxOpenPositions: s.maxOpenPositions,
        symbolMaps,
      };
    }),
  }));
}

// ─── Connection Management ────────────────────────────

async function connectSlaveMetaApi(accountId: string, metaApiId: string, platform: 'mt4' | 'mt5'): Promise<void> {
  if (slaveConnections.has(accountId)) return;

  const api = getMetaApiInstance('signals');
  const account = await api.metatraderAccountApi.getAccount(metaApiId);
  if (account.state !== 'DEPLOYED') await account.waitDeployed();
  if (account.connectionStatus !== 'CONNECTED') await account.waitConnected();

  const connection = account.getStreamingConnection();
  await connection.connect();
  await connection.waitSynchronized({ timeoutInSeconds: 120 });

  slaveConnections.set(accountId, connection);
  tradeInterfaces.set(accountId, new MetaApiCopyTradeAdapter(connection, platform));
  console.log(`[copy] Slave connected: ${accountId} (${platform})`);
}

async function connectSlaveTradovate(
  accountId: string,
  credentials: TradovateCredentials,
  tradovateAccountId: number,
): Promise<void> {
  if (tradeInterfaces.has(accountId)) return;

  const { TradovateClient } = await import('../lib/copy-trading/adapters/tradovate-client');
  const client = new TradovateClient(credentials);
  await client.authenticate();

  tradeInterfaces.set(accountId, new TradovateCopyTradeAdapter(client, tradovateAccountId));
  console.log(`[copy] Slave connected: ${accountId} (tradovate)`);
}

// ─── Master Monitoring ────────────────────────────────

function createMasterMonitor(group: ResolvedCopyGroup): MasterMonitor | null {
  const { masterAccount } = group;

  if ((masterAccount.platform === 'mt4' || masterAccount.platform === 'mt5') && masterAccount.metaApiId) {
    return new MetaApiMasterMonitor(masterAccount.id, masterAccount.metaApiId, masterAccount.platform);
  }

  if (masterAccount.platform === 'tradovate' && masterAccount.tradovateAccountId) {
    // Load credentials from the account record
    // Note: in production, credentials should be fetched from DB at this point
    return null; // Tradovate monitor requires credentials — loaded separately
  }

  console.warn(`[copy] Cannot create monitor for ${masterAccount.id} (${masterAccount.platform})`);
  return null;
}

async function createTradovateMasterMonitor(group: ResolvedCopyGroup): Promise<MasterMonitor | null> {
  const acct = await db.query.tradingAccounts.findFirst({
    where: eq(tradingAccounts.id, group.masterAccountId),
  });
  if (!acct || !acct.tradovateUsername || !acct.tradovatePassword || !acct.tradovateAccountId) {
    console.warn(`[copy] Tradovate master ${group.masterAccountId} missing credentials`);
    return null;
  }

  const credentials: TradovateCredentials = {
    username: acct.tradovateUsername,
    password: acct.tradovatePassword,
    appId: 'Haia',
    appVersion: '1.0.0',
    cid: acct.tradovateCid || 8,
    sec: acct.tradovateApiSecret || '',
    environment: (acct.tradovateEnvironment as 'demo' | 'live') || 'demo',
  };

  return new TradovateMasterMonitor(acct.id, credentials, parseInt(acct.tradovateAccountId, 10));
}

function wireMonitorEvents(monitor: MasterMonitor, group: ResolvedCopyGroup): void {
  monitor.onPositionOpen = (event: MasterPositionEvent) => {
    console.log(`[copy] Master OPEN: ${event.symbol} ${event.direction} ${event.lots} lots @ ${event.entryPrice}`);
    dispatchOpen(event, group, tradeInterfaces).catch((err) =>
      console.error(`[copy] dispatchOpen error:`, err),
    );
  };

  monitor.onPositionClose = (event: MasterPositionEvent) => {
    console.log(`[copy] Master CLOSE: ${event.symbol} ${event.direction} ${event.lots} lots @ ${event.closePrice}`);
    dispatchClose(event, group, tradeInterfaces).catch((err) =>
      console.error(`[copy] dispatchClose error:`, err),
    );
  };

  monitor.onPositionModify = (event: MasterPositionEvent) => {
    console.log(`[copy] Master MODIFY: ${event.symbol} SL=${event.stopLoss} TP=${event.takeProfit}`);
    dispatchModify(event, group, tradeInterfaces).catch((err) =>
      console.error(`[copy] dispatchModify error:`, err),
    );
  };
}

// ─── Startup ──────────────────────────────────────────

async function startGroup(group: ResolvedCopyGroup): Promise<void> {
  console.log(`[copy] Starting group "${group.name}" (master: ${group.masterAccount.platform})`);

  // Create and start master monitor
  let monitor: MasterMonitor | null;
  if (group.masterAccount.platform === 'tradovate') {
    monitor = await createTradovateMasterMonitor(group);
  } else {
    monitor = createMasterMonitor(group);
  }

  if (!monitor) {
    console.error(`[copy] Failed to create monitor for group "${group.name}"`);
    return;
  }

  wireMonitorEvents(monitor, group);

  // Connect slave accounts
  const enabledSlaves = group.slaves.filter((s) => s.isEnabled);
  for (const slave of enabledSlaves) {
    if (slave.dryRun) {
      console.log(`[copy] Slave ${slave.accountId} in DRY RUN mode — no connection needed`);
      continue;
    }

    try {
      if ((slave.account.platform === 'mt4' || slave.account.platform === 'mt5') && slave.account.metaApiId) {
        await connectSlaveMetaApi(slave.accountId, slave.account.metaApiId, slave.account.platform);
      } else if (slave.account.platform === 'tradovate' && slave.account.tradovateAccountId) {
        const acct = await db.query.tradingAccounts.findFirst({
          where: eq(tradingAccounts.id, slave.accountId),
        });
        if (acct?.tradovateUsername && acct.tradovatePassword) {
          await connectSlaveTradovate(slave.accountId, {
            username: acct.tradovateUsername,
            password: acct.tradovatePassword,
            appId: 'Haia',
            appVersion: '1.0.0',
            cid: acct.tradovateCid || 8,
            sec: acct.tradovateApiSecret || '',
            environment: (acct.tradovateEnvironment as 'demo' | 'live') || 'demo',
          }, parseInt(acct.tradovateAccountId!, 10));
        }
      }
    } catch (err) {
      console.error(`[copy] Failed to connect slave ${slave.accountId}:`, err);
    }

    // Small delay between slave connections to avoid rate limits
    await sleep(1000);
  }

  // Start the monitor
  try {
    await monitor.start();
    activeMonitors.set(group.id, monitor);
    console.log(`[copy] Group "${group.name}" active — monitoring master, ${enabledSlaves.length} slave(s)`);
  } catch (err) {
    console.error(`[copy] Failed to start monitor for group "${group.name}":`, err);
  }
}

// ─── Main Loop ────────────────────────────────────────

async function main(): Promise<void> {
  console.log('[copy-worker] Copy trading worker starting...');

  // Initial load
  let groups = await loadEnabledGroups();

  if (groups.length === 0) {
    console.log('[copy-worker] No enabled copy groups found. Waiting...');
  }

  // Wait for groups to be configured
  while (groups.length === 0 && !isShuttingDown) {
    await sleep(30_000);
    groups = await loadEnabledGroups();
  }

  if (isShuttingDown) return;

  // Start all groups
  for (const group of groups) {
    if (isShuttingDown) break;
    try {
      await startGroup(group);
    } catch (err) {
      console.error(`[copy-worker] Failed to start group "${group.name}":`, err);
    }
    await sleep(2000);
  }

  console.log(`[copy-worker] ${activeMonitors.size} group(s) active`);

  // Periodic config reload — pick up new groups, enable/disable changes
  const RELOAD_INTERVAL = 60_000;
  while (!isShuttingDown) {
    await sleep(RELOAD_INTERVAL);
    if (isShuttingDown) break;

    try {
      const freshGroups = await loadEnabledGroups();
      const freshIds = new Set(freshGroups.map((g) => g.id));
      const activeIds = new Set(activeMonitors.keys());

      // Stop removed/disabled groups
      for (const id of activeIds) {
        if (!freshIds.has(id)) {
          const monitor = activeMonitors.get(id);
          if (monitor) {
            console.log(`[copy-worker] Stopping group ${id}`);
            await monitor.stop();
            activeMonitors.delete(id);
          }
        }
      }

      // Start new groups
      for (const group of freshGroups) {
        if (!activeIds.has(group.id)) {
          console.log(`[copy-worker] Starting new group "${group.name}"`);
          await startGroup(group);
          await sleep(2000);
        }
      }
    } catch (err) {
      console.error('[copy-worker] Config reload error:', err);
    }
  }
}

// ─── Shutdown ─────────────────────────────────────────

async function shutdown(): Promise<void> {
  console.log('[copy-worker] Shutting down...');
  isShuttingDown = true;

  for (const [id, monitor] of activeMonitors) {
    try {
      await monitor.stop();
    } catch {}
    activeMonitors.delete(id);
  }

  for (const [id, conn] of slaveConnections) {
    try {
      if (conn.close) await conn.close();
    } catch {}
    slaveConnections.delete(id);
  }

  console.log('[copy-worker] Shutdown complete');
}

process.on('SIGINT', () => shutdown().then(() => process.exit(0)));
process.on('SIGTERM', () => shutdown().then(() => process.exit(0)));

main().catch((err) => {
  console.error('[copy-worker] Fatal error:', err);
  process.exit(1);
});
