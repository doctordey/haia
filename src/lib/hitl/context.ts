/**
 * Shared runtime context for the HITL service + manager. The worker constructs
 * a concrete implementation (it owns the MetaApi connections, account lookup,
 * and operator notification channel) and hands it to both.
 */

import type { HitlConfig } from './config';
import type { HitlBroker } from './metaapi';

export interface TargetAccount {
  accountId: string;
  isDemo: boolean;
}

export interface HitlContext {
  cfg: HitlConfig;

  /** All operator destinations (DM + group(s)); prompts/notifications fan out to all. */
  getChatIds(): Promise<string[]>;

  /** Operator-facing notification (Telegram) — broadcast to all destinations. */
  notify(text: string): Promise<void>;

  /** Broker adapter for an account whose streaming connection is live. */
  getBroker(accountId: string): HitlBroker | undefined;

  /** The opted-in HITL account (tradingAccounts.hitlEnabled). null → none armed. */
  resolveTargetAccount(): Promise<TargetAccount | null>;

  /** Realized P/L for a closed signal, if the worker can source it (else null). */
  realizedPnlForSignal?(signalId: string, since: Date, tickets: string[]): Promise<number | null>;
}
