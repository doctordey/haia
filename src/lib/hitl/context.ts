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
  name?: string;
}

export interface HitlContext {
  cfg: HitlConfig;

  /** All operator destinations (DM + group(s)); prompts/notifications fan out to all. */
  getChatIds(): Promise<string[]>;

  /** Operator-facing notification (Telegram) — broadcast to all destinations. */
  notify(text: string): Promise<void>;

  /** Broker adapter for an account whose streaming connection is live. */
  getBroker(accountId: string): HitlBroker | undefined;

  /** Display name for a connected account (for per-account notifications). */
  accountName?(accountId: string): string | undefined;

  /** The opted-in HITL account (tradingAccounts.hitlEnabled). null → none armed. */
  resolveTargetAccount(): Promise<TargetAccount | null>;

  /** Every armed + connected HITL account — approved trades mirror to all of them. */
  resolveTargetAccounts(): Promise<TargetAccount[]>;

  /** Broker symbol names similar to `query`, for "did you mean" hints (else []). */
  suggestSymbols?(query: string): Promise<string[]>;
}
