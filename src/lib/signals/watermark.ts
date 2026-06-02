import { and, desc, eq, lte } from 'drizzle-orm';
import { db } from '@/lib/db';
import { accountBalanceSnapshots } from '@/lib/db/schema';
import type { TvAlertConfig } from '@/types/tv-alerts';

/**
 * Lazy daily balance snapshot. Called on every webhook fire — checks whether
 * today's snapshot (in the configured market-close timezone) is missing AND
 * we are past the market close time. If both, write a snapshot row.
 *
 * No cron required: a single webhook on a given trading day creates that day's
 * snapshot. If a day passes with zero webhooks, no row is written — fine, as
 * watermark only matters when we're about to trade.
 */
export async function maybeSnapshotDailyBalance(
  config: TvAlertConfig,
  balance: number,
  equity: number,
): Promise<void> {
  const now = new Date();
  // Local "trading day" — the date that the market close belongs to in the
  // configured TZ. We use today's local date in that TZ, and only snapshot
  // after the close hour has passed.
  const localNow = nowInTimezone(now, config.marketCloseTimezone);
  const pastClose =
    localNow.hour > config.marketCloseHour ||
    (localNow.hour === config.marketCloseHour && localNow.minute >= config.marketCloseMinute);

  if (!pastClose) return;

  const dateStr = localNow.dateStr; // YYYY-MM-DD

  // Skip if a snapshot for this account/date already exists.
  const existing = await db.query.accountBalanceSnapshots.findFirst({
    where: and(
      eq(accountBalanceSnapshots.accountId, config.accountId),
      eq(accountBalanceSnapshots.snapshotDate, dateStr),
    ),
  });
  if (existing) return;

  await db.insert(accountBalanceSnapshots).values({
    accountId: config.accountId,
    snapshotDate: dateStr,
    balance,
    equity,
  });
}

/**
 * The "watermark" is the highest balance ever snapshotted for this account
 * up to and including yesterday's snapshot. Today's snapshot doesn't count
 * — risk is judged against prior days.
 */
export async function getWatermark(
  accountId: string,
  upToDate: Date,
  timezone: string,
): Promise<number | null> {
  // Look up snapshots strictly before today's date in the local TZ.
  const todayStr = nowInTimezone(upToDate, timezone).dateStr;

  const rows = await db
    .select({ balance: accountBalanceSnapshots.balance })
    .from(accountBalanceSnapshots)
    .where(and(
      eq(accountBalanceSnapshots.accountId, accountId),
      lte(accountBalanceSnapshots.snapshotDate, todayStr),
    ))
    .orderBy(desc(accountBalanceSnapshots.balance))
    .limit(1);

  return rows[0]?.balance ?? null;
}

/**
 * Compute the multiplier to apply to risk based on current balance vs
 * watermark. Returns 1.0 when not below the configured drawdown threshold,
 * else (1 - reductionPercent/100).
 */
export function computeRiskMultiplier(
  currentBalance: number,
  watermark: number | null,
  config: TvAlertConfig,
): { multiplier: number; reason: string } {
  if (!config.watermarkEnabled || watermark == null || watermark <= 0) {
    return { multiplier: 1.0, reason: 'Watermark disabled or no snapshots' };
  }

  const drawdownPct = ((watermark - currentBalance) / watermark) * 100;
  if (drawdownPct < config.watermarkDrawdownThreshold) {
    return {
      multiplier: 1.0,
      reason: `Drawdown ${drawdownPct.toFixed(2)}% < threshold ${config.watermarkDrawdownThreshold}%`,
    };
  }

  const multiplier = Math.max(0, 1 - config.watermarkRiskReductionPercent / 100);
  return {
    multiplier,
    reason:
      `Drawdown ${drawdownPct.toFixed(2)}% ≥ threshold ${config.watermarkDrawdownThreshold}% — ` +
      `risk reduced by ${config.watermarkRiskReductionPercent}% (multiplier ${multiplier.toFixed(2)})`,
  };
}

// ─── Time helpers ────────────────────────────────────

interface LocalTime {
  hour: number;
  minute: number;
  dateStr: string; // YYYY-MM-DD
}

/**
 * Read out year/month/day/hour/minute for `instant` in `tz` without relying on
 * a heavy date library. Uses Intl.DateTimeFormat which ships with Node.
 */
export function nowInTimezone(instant: Date, tz: string): LocalTime {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const parts = fmt.formatToParts(instant).reduce<Record<string, string>>((acc, p) => {
    acc[p.type] = p.value;
    return acc;
  }, {});
  return {
    hour: parseInt(parts.hour, 10),
    minute: parseInt(parts.minute, 10),
    dateStr: `${parts.year}-${parts.month}-${parts.day}`,
  };
}
