# Haia HITL — TypeScript / MetaApi Design (for sign-off)

**Status:** DRAFT — awaiting operator sign-off. Nothing in this document is built yet.
**Author:** Claude Code
**Scope:** Map the Haia HITL Execution Spec's *behaviour* onto the existing
TypeScript + MetaApi Cloud codebase, instead of the Python + direct-MetaTrader5
scaffold the brief assumed.

---

## 0. Premise correction (read first)

The HITL brief (`design.md`) assumes a Python scaffold (`main.py`,
`hitl/{config,session,mt5_client}.py`, `requirements.txt`) and a companion
`Haia_HITL_Execution_Spec.md` already exist and compile. **Neither exists in
this repo.** This repo is the Next.js/TypeScript Haia app whose signal copier
runs on the **MetaApi Cloud SDK** — the explicit opposite of the brief's
"direct MT5, no bridge" transport.

This document therefore re-targets the HITL *behaviour and safety model* (which
is transport-agnostic) onto the existing stack. Where the brief cites the
missing `Haia_HITL_Execution_Spec.md` §N as authoritative, this doc reconstructs
the requirement from `design.md` and **flags it for reconciliation** once the
real spec is supplied. **If the authoritative spec later contradicts anything
here, the spec wins** (per the brief's own rule).

---

## 1. Open decisions — NEEDS CONFIRMATION before build

These change behaviour/numbers. Per the brief, defaults are stated and put
behind a config switch; **do not treat any as settled until signed off.**

### Carried from brief §5
| # | Decision | Default (switch) | Notes |
|---|---|---|---|
| D1 | Range → SL mapping | `SL_FROM=protective_edge` (alt: `range_size`) | Highest impact. `protective_edge`: SL at far edge of range, R = \|entry − SL\|. `range_size`: range width *is* R, SL = entry ∓ R. |
| D2 | TP1 webhook source & `signal_id` correlation | keep `BE_TRIGGER=both` | What fires `/tp1-hit` and can it carry `signal_id`? Until confirmed, the internal price-watch BE backstop is the safety net. |
| D3 | Scanner fill semantics (single mode) | `SCANNER_FILL=close_through` (alt: `touch`) | 5m close beyond TP2 vs. intrabar touch. |
| D4 | Partial-leg failure policy | `PARTIAL_LEG_FAILURE=alert_hold` (alt: `auto_close`) | One leg fills, the other errors. |

### New decisions forced by the TS/MetaApi mapping
| # | Decision | Recommendation | Why it's yours to make |
|---|---|---|---|
| D5 | **Process model.** The brief's "single asyncio process" invariant cannot hold — Next.js is web + workers. | Run the Telegram bot **and** the manager loop inside the existing `signal-listener` worker (it already owns the MetaApi connection). Web `/tv-alert` + `/tp1-hit` routes are thin and coordinate via Postgres. | This is the biggest structural divergence from the spec; see §4. |
| D6 | **Does the HITL path coexist with, or replace, the existing auto-execute Telegram-channel pipeline?** | Coexist — HITL is a separate, approval-gated path keyed off TradingView. Leave the channel pipeline untouched. | Affects whether `signal-listener` keeps its current behaviour. |
| D7 | **Signal/symbol model.** Existing pipeline is NQ/ES→NAS100/US500 with a futures-basis *offset*. HITL `compute_levels` is range-based and instrument-generic (US500/NAS100/XAUUSD/BTCUSD/FX). | HITL alerts carry the **broker symbol and prices directly** — no offset applied on the HITL path. | Confirm TradingView posts Fusion symbols/prices, not futures needing offset. |
| D8 | **Order↔session correlation.** Brief wants MT5 `magic` + `comment=signal_id`. MetaApi sets `magic` at account level (currently `0`); positions expose `comment`/`clientId`. | Correlate via `clientId = signal_id` (+ `comment`), filter `terminalState.positions` by it. | MetaApi doesn't give a per-order magic the same way; confirm `clientId` is acceptable as the key. |
| D9 | **HITL config home.** Spec is env-driven (`Config` dataclass). Repo uses per-account DB rows (`signalConfigs`) + a few env vars. | Operator-level safety knobs (risk, timeouts, switches) via **env** (`src/lib/hitl/config.ts` + `validate()`), mirroring the spec. Which broker account HITL trades is the one open question — env `HITL_ACCOUNT_ID` or a dedicated config row. | Confirm the env-only approach and how the target account is selected. |

---

## 2. What maps cleanly (already in the repo)

| HITL spec piece | Existing TS/MetaApi asset | Location |
|---|---|---|
| Webhook intake, shared-secret auth, HTTP 200 on reject | TradingView offset webhook pattern | `src/app/api/signals/offset/webhook/route.ts` |
| `compute_lots` = risk/(R × value_per_point), clamp + step | `calculateLotSize()` | `src/lib/signals/sizing.ts:21` |
| `split_legs` / chunking | `chunkLots()`, `split_target` mode | `src/lib/signals/sizing.ts:6,78` |
| Order writes (market/limit/stop, SL/TP, comment) | `buildMetaApiInterface().createOrder` | `src/workers/signal-listener.ts:554` |
| `modify_sl` (BE move) | `modifyPosition(positionId, sl, tp)` | `src/workers/signal-listener.ts:601` |
| Close detection + realized P/L | `getDealsByTimeRange` / `fetchHistoricalDeals` | `src/lib/metaapi.ts:54` |
| Durable, never-deleted sessions | Drizzle + Postgres (`signalExecutions` precedent) | `src/lib/db/schema.ts:346` |
| Long-lived single process + MetaApi conn | `signal-listener` worker | `src/workers/signal-listener.ts:654` |
| Live equity/balance for sizing | `terminalState.accountInformation` | `src/workers/signal-listener.ts:626` |

## 3. What is genuinely new (to build)

1. `compute_levels` — range→direction/SL/R/TP1/TP2/TP3 geometry (gated by D1). Pure module.
2. A **Telegram Bot** (grammy, approved) for the operator dialog — prompt → range reply → confirm card → approve/reject. The existing `telegram.ts` is a GramJS **user-client channel listener**, not a bot; it cannot render inline-button approvals.
3. The two HTTP webhooks: `/tv-alert` (creates a session) and `/tp1-hit` (BE trigger).
4. A `hitl_sessions` table + state machine (durable, resumable).
5. A **manager loop**: timeout sweep, BE price-watch backstop, single-mode TP2 scanner, close detection, resume-on-restart.
6. `partialClose` on the MetaApi interface (the only missing write primitive).
7. Generic symbol-spec sourcing: pull `tickValue`/`tickSize`/`volumeMin/Max/Step` from MetaApi `getSymbolSpecification` so sizing works for XAUUSD/BTCUSD/FX (today `ContractSpec` is hardcoded for NAS100/US500 in `src/types/signals.ts:103`).

---

## 4. Architecture — process model (decision D5)

```
TradingView ──HTTPS──▶  Next.js web process
                        ├─ POST /api/hitl/tv-alert   (intake guards → insert RECEIVED)
                        └─ POST /api/hitl/tp1-hit     (auth secret → flag BE request)
                                   │
                                   ▼  (Postgres hitl_sessions)
                        signal-listener worker  ── single long-lived process ──
                        ├─ grammy Bot (long-poll getUpdates): prompt, range reply,
                        │   confirm card, approve/reject callbacks  [auth on both]
                        ├─ MetaApi streaming connection (already present)
                        └─ manager loop (interval + price events):
                             • prompt newly RECEIVED sessions
                             • timeout sweep (pre-fill → EXPIRED)
                             • dispatch on approval (open legs)
                             • BE backstop (price ≥/≤ TP1 → SL=entry, once)
                             • single-mode TP2 scanner
                             • close detection → CLOSED + realized P/L
                             • resume-on-restart reconciliation
```

**Why the worker, not the web process:** only one process may long-poll a bot's
`getUpdates`, and only the worker holds the live MetaApi connection. Keeping the
bot + loop + MetaApi access together in the worker is the closest honest analogue
to the spec's "single process owns Telegram + loop + MT5" invariant.

**Cross-process handoff:** the web `/tv-alert` route only validates + inserts a
`RECEIVED` row. The worker reacts via Postgres `LISTEN/NOTIFY` (low latency) with
a short poll as fallback. Approval/order writes happen entirely in the worker, so
the money path never spans processes. `/tp1-hit` likewise only sets a flag the
worker acts on.

**Invariant preservation:**
- *All MetaApi access through one wrapper* → the HITL path uses the same
  `buildMetaApiInterface()` (extended with `partialClose`); nothing else opens trades.
- *Fail-closed* → every leg write is wrapped; any error notifies + moves the
  session to `FAILED` (or `alert_hold` per D4). No silent partials.
- *Durable, never hard-deleted* → `hitl_sessions` rows are only ever transitioned,
  never deleted (audit).
- *Secrets from env only* → `Config.validate()` on worker boot; webhook secret checked per request.

---

## 5. State machine (reconstructed — reconcile with real spec §1)

```
RECEIVED ──prompt sent──▶ AWAITING_RANGE
AWAITING_RANGE ──range reply (entry inside range)──▶ AWAITING_DIRECTION
AWAITING_RANGE / AWAITING_DIRECTION ──levels+lots computed──▶ AWAITING_APPROVAL
AWAITING_APPROVAL ──approve──▶ DISPATCHING ──all legs ok──▶ OPEN
DISPATCHING ──full failure──▶ FAILED
DISPATCHING ──partial failure──▶ OPEN(+alert) | FAILED   (per D4)
OPEN ──positions gone──▶ CLOSED            (record realized P/L)
{RECEIVED, AWAITING_RANGE, AWAITING_DIRECTION, AWAITING_APPROVAL} ──timeout──▶ EXPIRED
AWAITING_APPROVAL ──reject──▶ REJECTED
```

- **Pre-fill states** (swept by `SIGNAL_TIMEOUT_SECONDS`): `RECEIVED`,
  `AWAITING_RANGE`, `AWAITING_DIRECTION`, `AWAITING_APPROVAL`.
- **BE does not change state**: while `OPEN`, it sets `be_applied=true` (idempotent).
- **Terminal**: `CLOSED`, `FAILED`, `EXPIRED`, `REJECTED` — all reachable; no orphans.
- Sessions are never deleted.

### Intake guards in `/tv-alert` (ordered; every reject returns HTTP 200)
1. `secret` match (env `HITL_WEBHOOK_SECRET`).
2. Exact dedupe (`signal_id`, else payload hash) — duplicate ⇒ 200, no-op.
3. Per-symbol cooldown (`SIGNAL_COOLDOWN_SECONDS`).
4. Live-pre-fill block — refuse a second active pre-fill for the same symbol.
5. Create `RECEIVED`.

---

## 6. Data model — `hitl_sessions` (new Drizzle table)

```
id                cuid (pk)
signalId          text unique      -- correlation key; also order clientId/comment
symbol            text
action            text             -- BUY|SELL (or null until AWAITING_DIRECTION resolved)
state             text             -- state machine (§5)
-- inputs
entryRef          real
rangeHigh         real  (nullable)
rangeLow          real  (nullable)
rawAlert          jsonb
-- computed (gated by D1)
direction         text
sl                real
r                 real
tp1, tp2, tp3     real
lots              real
legs              jsonb            -- [{leg:'A', tp, volume, ticket, status}, ...]
-- config snapshot (audit)
slFrom, positionModel, entryMode, riskPct, ...
-- telegram
operatorChatId    text
promptMessageId   text
confirmMessageId  text
-- lifecycle
beApplied         boolean default false
beAppliedAt       timestamp
dispatchedAt      timestamp
realizedPnl       real
failureReason     text
receivedAt, rangeReceivedAt, approvedAt, closedAt, createdAt, updatedAt
```

Indexes on `state`, `symbol`, `signalId`. Mirrors the durability of
`signalExecutions` (`schema.ts:346`); reuse `createId()` and the migration flow
(`npx drizzle-kit generate`).

---

## 7. Module plan (files to add / change)

| File | New? | Responsibility |
|---|---|---|
| `src/lib/hitl/config.ts` | new | Env `Config` + `validate()` (all §10 keys). |
| `src/lib/hitl/levels.ts` | new | `computeLevels(entry, rangeHigh, rangeLow, action)` — pure, D1 switch. |
| `src/lib/hitl/sizing.ts` | new (thin) | `computeLots`/`splitLegs` wrappers that **reuse** `calculateLotSize`/`chunkLots`; source specs from MetaApi. |
| `src/lib/hitl/session.ts` | new | `hitl_sessions` CRUD + guarded state transitions. |
| `src/lib/hitl/bot.ts` | new | grammy bot: prompt, range parse, confirm card, approve/reject, `_authorized` on reply **and** callback. |
| `src/lib/hitl/dispatch.ts` | new | Pre-dispatch risk gates + open legs (two_position / single). |
| `src/lib/hitl/manager.ts` | new | Manager loop: timeout, BE backstop, scanner, close detection, resume. |
| `src/lib/db/schema.ts` | edit | Add `hitlSessions` table (+ migration). |
| `src/workers/signal-listener.ts` | edit | Boot the bot + manager loop alongside existing streaming; add `partialClose` to `buildMetaApiInterface`. |
| `src/app/api/hitl/tv-alert/route.ts` | new | Intake guards → insert `RECEIVED`. |
| `src/app/api/hitl/tp1-hit/route.ts` | new | Secret check → set BE request flag. |
| `src/__tests__/hitl-levels.test.ts` | new | §8 geometry/sizing suite (mock MetaApi; runs off-Windows). |

**Path note:** spec cites `/haia/hitl/tv-alert` & `/haia/hitl/tp1-hit`. In Next.js
these are `/api/hitl/tv-alert` & `/api/hitl/tp1-hit`; the reverse proxy / Railway
route maps the `/haia/hitl/*` public path onto them.

### MetaApi writes (extend the existing wrapper, don't fork it)
- `open_order` → reuse `createMarketBuy/SellOrder` or `createLimit/StopOrder`; set `clientId/comment = signal_id`, SL/TP, honour `MAX_DEVIATION_POINTS` via `slippage`. Treat anything but a `DONE` result as failure.
- `modify_sl` → `modifyPosition(ticket, entry, preservedTP)` (BE move).
- `partial_close` → **add** `closePositionPartially(ticket, volume)`.
- `positionsBySignal` → filter `terminalState.positions` by `clientId/comment === signal_id`.
- realized P/L → `getDealsByTimeRange` (reuse `fetchHistoricalDeals`).

---

## 8. Sizing & levels — acceptance (brief §4.1 / §7)

- `compute_levels`: preserve geometry; **D1 switch** decides SL/R derivation.
  Reject non-positive R. Entry-inside-range ⇒ `AWAITING_DIRECTION` prompt path.
- `computeLots`: **reuse** `calculateLotSize` math — `risk/(R × valuePerPoint)`,
  `valuePerPoint = tickValue/tickSize`, clamp to `volumeMin/Max`, round to
  `volumeStep`. **Do not invent a second method** (brief's explicit instruction).
- `splitLegs`: re-clamp each leg; any leg `< volumeMin` ⇒ collapse to single,
  front-loaded, and signal the caller (mirrors `sizing.ts` `split_target` fallback).
- Unit tests: US500, NAS100, XAUUSD, BTCUSD, one FX pair, long & short, incl.
  entry-inside-range and non-positive-R rejection. MetaApi mocked (no live calls),
  so CI runs off-Windows — there is no `MetaTrader5` import to gate on.

---

## 9. Manager loop & safety (brief §4.3–4.5)

- **Pre-dispatch gates:** R>0 & SL on correct side; TP legs beyond entry; computed
  risk ≤ `MAX_RISK_PER_TRADE`; symbol tradable; no double-dispatch (`DISPATCHING` guard).
- **Two-position default:** Leg A→TP2, Leg B→TP3. **Single:** one position→TP3 + scanner.
- **BE (D2):** `/tp1-hit` webhook **and** internal price-watch backstop both move all
  legs' SL→entry exactly once (`be_applied` flag); `BE_TRIGGER=both` default. This is
  separate from the existing `breakeven.ts` (which triggers on a *leg close*, not a price level).
- **Close detection:** `positionsBySignal` empty ⇒ `CLOSED`, record realized P/L, notify.
- **Resume-on-restart:** on boot, reconcile every non-terminal session against live
  positions; gone ⇒ `CLOSED`; pre-fill past timeout ⇒ `EXPIRED`; rest resume.
- **Auth:** `_authorized` re-checked on the range-reply handler **and** the approval
  callback (not just at prompt time).

---

## 10. Config / env (new keys — `Config.validate()` on boot)

```
HITL_TELEGRAM_BOT_TOKEN      # BotFather bot (separate from the GramJS listener)
AUTHORIZED_TELEGRAM_USER_IDS # comma-separated numeric ids (reply + callback auth)
HITL_OPERATOR_CHAT_ID        # where prompts are sent
HITL_WEBHOOK_SECRET          # /tv-alert + /tp1-hit shared secret
HITL_ACCOUNT_ID              # target trading account (D9)
SIGNAL_TIMEOUT_SECONDS       # pre-fill sweep
SIGNAL_COOLDOWN_SECONDS      # per-symbol intake cooldown
RISK_PCT                     # default risk per trade
MAX_RISK_PER_TRADE           # hard cap (pre-dispatch gate)
SL_FROM=protective_edge      # D1
POSITION_MODEL=two_position  # two_position|single
ENTRY_MODE=market            # market|pending
BE_TRIGGER=both              # both|internal|webhook  (D2)
TP2_CLOSE_PCT                # single-mode scale-out
LEG_SPLIT                    # two-position leg ratio
MAX_DEVIATION_POINTS         # market slippage cap
SCANNER_FILL=close_through   # D3
PARTIAL_LEG_FAILURE=alert_hold  # D4
```
(Existing `METAAPI_TOKEN`, `DATABASE_URL`, `TELEGRAM_API_ID/HASH` are reused.)

---

## 11. Deployment — replaces brief §6 entirely

The brief's §6 (Windows VPS + MT5 terminal + NSSM) **does not apply** — MetaApi
hosts the terminal. Instead:

- Railway (already configured): web + workers, auto-TLS on the public domain.
- TradingView posts to `https://<domain>/haia/hitl/tv-alert` and `…/tp1-hit`
  (proxy → `/api/hitl/*`). IP-allowlist TradingView ranges at the proxy.
- Worker runs grammy **long-polling** (no inbound port) + manager loop; auto-restart is Railway-native.
- New env vars (§10) added to the Railway service; `Config.validate()` fails boot if missing.
- **Demo-only until brief §7 passes** — `HITL_ACCOUNT_ID` points at a demo account first.

---

## 12. Acceptance mapping (brief §7) — how each is met on demo

| Brief §7 item | Mechanism here |
|---|---|
| Unit sizing green (all instruments/dirs/edges) | `hitl-levels.test.ts` + reused `sizing.ts`, MetaApi mocked |
| E2E alert→prompt→range→confirm(real lots)→approve→order | `/tv-alert` → bot → `dispatch.ts` on demo account |
| BE once (webhook + suppressed-webhook backstop) | `/tp1-hit` + manager price-watch, `be_applied` idempotency |
| Scale-out TP2/TP3 → CLOSED + P/L | broker TPs (two-position) or scanner (single) + close detection |
| Idempotency ×5 alerts / ×5 tp1-hit | dedupe guard + `be_applied` flag |
| Guards (cooldown / pre-fill block / expiry) | intake guards + timeout sweep |
| Auth (non-allowlisted ignored + logged) | `_authorized` on reply + callback |
| Fail-closed mid-dispatch | wrapped leg writes → `FAILED`/`alert_hold`, notify |

---

## 13. Build order (once signed off)

1. `hitl_sessions` table + migration; `config.ts` + `validate()`.
2. `levels.ts` + `hitl/sizing.ts` + unit suite (no I/O — fastest to green).
3. `/tv-alert` + `/tp1-hit` routes with intake guards.
4. grammy bot dialog (prompt → range → confirm → approve) + auth.
5. `dispatch.ts` (+ `partialClose` on the wrapper) + pre-dispatch gates.
6. manager loop: timeout, BE backstop, close detection, scanner, resume.
7. `.env.example` additions + README runbook; demo §7 acceptance pass.

---

## 14. Sign-off checklist

- [ ] D1 `SL_FROM` default confirmed
- [ ] D2 `/tp1-hit` source + `signal_id` correlation confirmed (or keep backstop)
- [ ] D3 scanner fill semantics confirmed
- [ ] D4 partial-leg failure policy confirmed
- [ ] D5 process model (bot + loop in `signal-listener` worker) approved
- [ ] D6 coexist vs replace existing channel pipeline
- [ ] D7 HITL alerts carry broker symbol/prices directly (no offset)
- [ ] D8 `clientId/comment = signal_id` correlation acceptable
- [ ] D9 env-driven HITL config + target-account selection confirmed
- [ ] Authoritative `Haia_HITL_Execution_Spec.md` provided for §1/§5/§7 reconciliation
