# Signal Copier — Build Prompts for Claude Code

Use these prompts sequentially in Claude Code to build the Signal Copier & Trade Journal module into Haia. Each prompt maps to an implementation phase from `SIGNAL_PIPELINE_SPEC.md`. Run them in order — each phase depends on the one before it.

**Before you start:** Make sure the spec file is in your repo so Claude Code can reference it. Copy `SIGNAL_PIPELINE_SPEC.md` into the project root or docs folder.

---

## Phase A: Foundation (Database + Access Control)

```
Read SIGNAL_PIPELINE_SPEC.md — specifically Sections 13, 15, and 17 (Database Schema, Access Control, API Routes).

Add the Signal Copier foundation to Haia:

1. DATABASE SCHEMA — Add these 7 new tables to src/lib/db/schema.ts following existing conventions (cuid2 IDs, timestamps, Drizzle ORM):
   - userRoles — role-based access (admin, signals, journal)
   - signalSources — Telegram channel configs
   - signalConfigs — per-user pipeline settings including instrument symbols, lot sizes, offset settings (mode: webhook/fixed/none), position sizing mode (strict/percent_balance/percent_equity), execution mode (single/split_target), risk percentages, size tier multipliers, and order thresholds
   - signals — raw Telegram messages
   - signalExecutions — one row per position opened (single mode = 1 row per signal, split mode = 2 rows). Includes splitIndex, linkedExecutionId for TP1↔TP2 pairing, breakevenMovedAt timestamp, plus full audit trail (signal data, offset, adjusted levels, order type, execution result, timing/latency)
   - offsetHistory — persists every TradingView webhook payload (NQ/ES futures prices, Fusion prices, calculated offsets, SMA values, timestamps) for dashboard charts and audit trail
   - tradeJournal — per-trade annotations with setup type, reasoning, review, emotional state, rating, tags, screenshots

   All foreign keys, indexes, and constraints are defined in the spec. Follow them exactly. Export Drizzle relations for all new tables.

2. Generate and run the Drizzle migration.

3. ACCESS CONTROL — Extend NextAuth in auth.ts:
   - Query userRoles in the session callback and attach roles array to session.user
   - Add TypeScript types for the extended session

4. MIDDLEWARE — Add role-checking to src/middleware.ts:
   - /signals and /api/signals routes require "signals" role
   - /journal and /api/journal routes require "journal" role
   - /settings/admin and /api/admin routes require "admin" role
   - Return 403 for unauthorized access

5. ADMIN API — Create src/app/api/admin/users/route.ts:
   - GET: List all users with their roles
   - POST /:id/roles: Grant a role
   - DELETE /:id/roles/:role: Revoke a role
   - All endpoints require "admin" role

6. SEED SCRIPT — Create a script or Drizzle seed that grants my user (brandonsdey@gmail.com) all three roles (admin, signals, journal).

Do NOT create any UI pages yet. Just the schema, migrations, auth changes, middleware, and admin API.
```

---

## Phase B: Signal Pipeline Core Logic

```
Read SIGNAL_PIPELINE_SPEC.md — specifically Sections 6, 7, 8, 9, 11, 12, and 14 (Parsed Data Structures, Signal Parser, Order Type Decision, Pipeline Flow, Offset Calculation, Position Sizing, Cancellation Handling).

Build the signal pipeline core logic under src/lib/signals/. These are pure functions with no UI — just the engine.

1. TYPES — Create src/types/signals.ts with all the interfaces from Section 6:
   - ParsedSignal (direction, instrument, entry, tp1, tp2, sl, size, tradeNumber)
   - ParsedMessage (type: signals/cancellation/tp_hit/unknown, signals array, cancellation info, warning text, raw message)
   - OrderDecision (orderType, reason)
   - ExecutionResult, OffsetResult, etc.

2. PARSER — Create src/lib/signals/parser.ts implementing the calibrated regex parser from Section 7:
   - parseSignalMessage(text: string): ParsedMessage
   - Must handle all 6 message types: new signals, cancel all, cancel specific, TP hit, warning, unknown
   - The regex must handle comma-formatted prices ("24,060"), both NQ and ES instruments, 🟢/🔴 emoji prefixes, Size: Small/Medium/Large
   - Multi-trade messages (Trade 1, Trade 2, etc.) must be parsed correctly
   - Write unit tests covering every message type from the spec examples

3. ORDER TYPE — Create src/lib/signals/order-type.ts from Section 8:
   - determineOrderType(direction, adjustedEntryPrice, currentMarketPrice, threshold = 5.0): OrderDecision
   - Within threshold → MARKET
   - LONG: below entry → BUY_STOP, above → BUY_LIMIT
   - SHORT: below entry → SELL_LIMIT, above → SELL_STOP
   - Write unit tests for all 6 order type scenarios

4. OFFSET — Create src/lib/signals/offset.ts from Section 11:
   - Instrument map: NQ → NAS100, ES → US500
   - getOffset(instrument, priceCache, config): OffsetResult — returns the offset to apply
   - adjustSignalLevels(signal, offset): adjusts entry, SL, TP1, TP2 (always subtract — futures trade higher than CFDs)
   - Validate offset is within configured min/max bounds (throw if exceeded — possible contract roll or data error)
   - Support three modes:
     * "webhook" (default): reads the latest offset from TradingView webhook data in PriceCache. Falls back to fixed if webhook data is stale (>24h) or missing.
     * "fixed": uses user-configured values (NQ default 198, ES default 40)
     * "none": no offset applied (zero adjustment)
   - IMPORTANT: CME futures prices come from TradingView webhooks, NOT from MetaApi. Fusion Markets is a CFD broker and does not offer CME futures contracts. MetaApi only provides NAS100/US500 prices.

5. SIZING — Create src/lib/signals/sizing.ts from Section 12:
   - calculateLotSize(config, signal, account, contractSpec): SizingResult
   - SizingResult includes: lotSize, riskAmount, effectiveRiskPercent, reason, isSplit, tp1LotSize?, tp2LotSize?, splitFallbackReason?, chunks[], tp1Chunks?[], tp2Chunks?[]
   - Three sizing modes: "strict" (fixed lots per size tier), "percent_balance" (% of account balance), "percent_equity" (% of equity)
   - Two execution modes: "single" (1 position per signal) and "split_target" (2 positions — TP1 + TP2)
   - Split target logic: calculate total lots normally, then split. TP1 gets the LARGER half (ceil), TP2 gets the remainder. If total lots = min lot size and can't be split, fall back to single mode and log the reason.
   - ORDER CHUNKING: If total lots > maxLotsPerOrder (default 50, hard cap 100), split into multiple orders. chunkLots(totalLots, maxPerOrder, lotStep) → number[]. Applies AFTER split-target calculation — each half (TP1/TP2) is chunked independently.
   - CONTRACT SPECS: Fetch from MetaApi getSymbolSpecification() on startup and cache. NAS100 and US500 on Fusion: pipValuePerLot = $0.10/point, minLot = 0.01, lotStep = 0.01, maxOrderSize = 100. Note: 100 lots = $10/point (not $10/pip — 1 point = 10 pips on these instruments).
   - Size tier multipliers (Small=0.5x, Medium=1.0x, Large=1.5x by default)
   - Safeguards: minLotSize, maxLotSize cap, maxLotsPerOrder (chunking), maxRiskPercent ceiling, minStopDistance guard
   - Round down to nearest lot step
   - Write unit tests for all three sizing modes × both execution modes × chunking scenarios, including edge cases (can't split, tight stops, exceeding max risk, lots requiring 5+ chunks)

5b. MARGIN VALIDATION — Create src/lib/signals/margin.ts from Section 12:
   - checkMargin(account, symbol, totalLots, direction): MarginCheck
   - Uses MetaApi calculateMargin() to get required margin for the TOTAL position (all chunks combined)
   - Returns: requiredMargin, freeMargin, sufficient (boolean), marginUtilization (%)
   - Pipeline behavior: if utilization < marginWarningThreshold (default 80%) → proceed normally. If 80-95% → proceed + log warning. If > marginRejectThreshold (default 95%) → REJECT the trade, log error, alert dashboard.
   - Margin is checked ONCE for the total position before any orders are sent — not per chunk.

6. CANCELLATION — Create src/lib/signals/cancel.ts from Section 14:
   - handleCancellation(parsedMessage, configId): cancels pending orders
   - "ALL CANCELLED" → cancel all pending (status='sent') executions for the config
   - "Trade N CANCELLED" → cancel only that trade number
   - If already filled, log as no-op (do NOT close position)

7. PIPELINE ORCHESTRATOR — Create src/lib/signals/execute.ts from Section 9:
   - executePipeline(rawMessage, config, priceCache, account): ExecutionResult[]
   - Full flow: parse → validate → get cached prices → calculate offset → adjust all levels → determine order type → calculate lot size → CHECK MARGIN → chunk orders → send all chunks via MetaApi → log execution(s) with timing
   - MARGIN CHECK: Before sending ANY orders, call checkMargin() for the total lot size. If insufficient, reject the entire trade (don't send partial). Log margin utilization in each execution row.
   - ORDER CHUNKING: If sizing returns chunks > 1, send each chunk as a separate MetaApi order. All chunks share the same entry, SL, TP. Fire all in parallel via Promise.all. Each chunk gets its own signalExecution row with chunkIndex and totalChunks fields.
   - SPLIT TARGET + CHUNKING: If split mode, tp1Chunks and tp2Chunks are sent independently. Example: 250 lots split → TP1: [50,50,30], TP2: [50,50,20] = 6 orders parallel.
   - SPLIT TARGET MODE (no chunking needed): When lots are small enough, just two orders — splitIndex=1 (TP1) and splitIndex=2 (TP2), linked via linkedExecutionId.
   - SINGLE MODE: One order (or multiple chunks), splitIndex=null.
   - Support dry run mode (skip MetaApi call, log as dry_run)
   - Track latency at each step
   - Execute multiple signals from same message in parallel (Promise.all)
   - Handle both NQ and ES signals in the same message independently

8. BREAKEVEN MONITOR — Create src/lib/signals/breakeven.ts:
   - onPositionClosed(closedPositionId): checks if this was a TP1 split execution
   - If yes: look up linked TP2 execution via linkedExecutionId
   - Call MetaApi modifyPosition to set TP2's SL to the original entry price
   - Update the TP2 execution row with breakevenMovedAt timestamp
   - If TP1 was stopped out (not TP hit), leave TP2 unchanged
   - This function is called from the MetaApi synchronization listener (same WebSocket the trade-sync worker uses)

All functions should be well-typed, export cleanly, and have comprehensive unit tests.
```

---

## Phase C: Telegram + Price Streaming + TradingView Webhook

```
Read SIGNAL_PIPELINE_SPEC.md — specifically Sections 10, 11, 17, 18, and 20 (Price Streaming & Caching, Offset Calculation, API Routes, Telegram Integration, Environment Variables).

Wire up the external connections — Telegram listener, MetaApi CFD price streaming, and TradingView offset webhook.

1. INSTALL GRAMJS — Run: npm install telegram

2. TELEGRAM CLIENT — Create src/lib/signals/telegram.ts:
   - TelegramSignalClient class wrapping GramJS (MTProto user client, NOT bot API)
   - Constructor takes apiId, apiHash, and session string from env vars
   - connect() — initialize and authenticate
   - listenToChannel(channelId, callback) — subscribe to new messages from a specific channel
   - disconnect() — clean shutdown
   - Store session string in the database (signalSources table) so reconnection works without re-auth

3. TELEGRAM AUTH API — Create the auth flow endpoints:
   - POST /api/signals/telegram/auth — accepts phone number, initiates GramJS auth, sends code via Telegram
   - POST /api/signals/telegram/verify — accepts verification code (and optional 2FA password), completes auth, saves session string
   - GET /api/signals/telegram/status — returns connection status and connected channel info

4. PRICE CACHE — Create src/lib/signals/price-cache.ts from Section 10:
   - PriceCache class with TWO data sources:
     a) CFD prices (MetaApi WebSocket): NAS100 and US500 only. Stale after 10s. Used for order type decisions.
     b) Offset data (TradingView Webhook): NQ/ES futures prices, NAS100/US500 prices at webhook time, calculated offsets, SMA values. Stale after 24h. Used for signal level adjustments.
   - setPrice(key, bid, ask) — called by MetaApi streaming
   - getPrice(key): CachedPrice | null — returns null if stale
   - setOffset(data) — called by webhook endpoint
   - getOffset(): CachedOffset | null — returns null if stale
   - getOffsetAge(): number | null — for dashboard display
   - IMPORTANT: MetaApi only streams Fusion CFD prices (NAS100, US500). It does NOT have CME futures (NQM2026, ESM2026) because Fusion Markets is a CFD broker. Futures prices come exclusively from TradingView webhooks.

4b. OFFSET WEBHOOK ENDPOINT — Create POST /api/signals/offset/webhook:
   - Receives JSON from TradingView: { secret, nq_price, es_price, nas100_price, us500_price, nq_offset, es_offset, nq_sma, es_sma, timestamp }
   - Validate secret matches TRADINGVIEW_WEBHOOK_SECRET env var (reject with 401 if wrong)
   - Update PriceCache with setOffset()
   - Persist to offsetHistory table for charting
   - Return 200 OK
   - This endpoint must NOT require NextAuth session (TradingView can't authenticate as a user) — use the secret token for auth instead

5. SIGNAL LISTENER WORKER — Create src/workers/signal-listener.ts:
   - Runs alongside the existing trade-sync worker
   - On startup: connect Telegram client, start MetaApi price streaming for NAS100 + US500 (CFD prices only — offset comes from TradingView webhook)
   - On new Telegram message: call executePipeline() from Phase B
   - Write results to database (signals + signalExecutions tables)
   - Handle reconnection gracefully (Telegram drops, MetaApi disconnects)
   - Respect the isEnabled and dryRun flags from signalConfigs
   - BREAKEVEN MONITOR: Hook into the existing MetaApi synchronization listener (the one trade-sync already uses). When any position closes, call onPositionClosed() from breakeven.ts. This detects TP1 fills and automatically moves the paired TP2's SL to entry. No additional WebSocket connection needed — piggyback on the existing one.

6. ENV VARS — Add to .env.example:
   - TELEGRAM_API_ID, TELEGRAM_API_HASH (from my.telegram.org)
   - TRADINGVIEW_WEBHOOK_SECRET (random string — must match the secret in the Pine Script indicator)
   - No other new env vars needed — MetaApi creds already exist

Make sure the worker can be started and stopped independently. It should log clearly what it's doing (connecting, listening, executing, errors).
```

---

## Phase D: Signal Settings + Config UI

```
Read SIGNAL_PIPELINE_SPEC.md — specifically Sections 16.2, 17 (Signal Settings UI, API Routes for Config).

Build the Signal Settings page at /signals/settings. This is the control panel where I configure the pipeline before turning it on. Follow Haia's existing dark theme, Tailwind CSS conventions, and component patterns.

1. CONFIG API — Create the config endpoints:
   - GET /api/signals/config — returns the user's current signalConfig (or null if not set up)
   - POST /api/signals/config — create or update config (upsert)
   - PATCH /api/signals/config/toggle — toggle isEnabled or dryRun
   - GET /api/signals/sources — list signal sources
   - POST /api/signals/sources — create a new signal source

2. SETTINGS PAGE — Create src/app/(app)/signals/settings/page.tsx with these sections:

   a) TELEGRAM CONNECTION
      - Show connection status (connected/disconnected/connecting)
      - Phone number input + "Send Code" button → triggers auth flow
      - Verification code input + "Verify" button
      - Once connected, show channel name and a disconnect option
      - Channel selector (list channels the user is a member of)

   b) OFFSET SETTINGS
      - Offset mode selector: Webhook (TradingView) / Fixed / None
      - When "Webhook" is selected: show current webhook status (last received timestamp, offset age, NQ and ES offset values). If no webhook has been received yet, show setup instructions with the webhook URL and a reminder to configure the Pine Script indicator.
      - Per-instrument fixed offset inputs (NQ default 198, ES default 40) — used as fallback when webhook is stale or in "Fixed" mode
      - Per-instrument min/max offset bounds (safety check — pipeline rejects offsets outside these bounds)
      - Webhook secret display/regenerate button

   c) POSITION SIZING
      - Mode selector: Strict Lot Sizing / % of Account Balance / % of Account Equity
      - When "Strict" is selected: show lot size inputs per tier (Small/Medium/Large) for both NQ and ES
      - When "% Balance" or "% Equity" is selected: show base risk % input, size tier multiplier inputs (Small/Medium/Large), maxLotSize, maxRiskPercent, minStopDistance
      - Show a live preview/example calculation based on current settings

   d) EXECUTION MODE
      - Toggle: Single Position / Split Target (TP1 + TP2)
      - When Split Target is selected, show explanation text: "Opens two positions per signal. TP1 gets the larger lot. When TP1 hits, TP2's stop loss automatically moves to entry (breakeven)."
      - Show a visual example of the lot split based on current sizing settings (e.g., "0.05 total → TP1: 0.03, TP2: 0.02")

   e) INSTRUMENT SETTINGS
      - NQ execution symbol (default NAS100)
      - ES execution symbol (default US500)

   f) ORDER SETTINGS
      - Market order threshold (default 5 points)
      - Max slippage (default 5 points)
      - Max lots per order (default 50, hard cap 100). Show note: "Orders larger than this will be automatically split into multiple smaller orders."
      - Margin warning threshold (default 80%). "Warns when margin utilization exceeds this level."
      - Margin reject threshold (default 95%). "Rejects trades when margin utilization exceeds this level."
      - Show current account free margin and a sample margin calculation

   g) MASTER CONTROLS
      - Big toggle: Pipeline Enabled / Disabled
      - Dry Run toggle with clear indicator
      - Status indicator: show if worker is running, Telegram connected, price cache ready, webhook offset age

   Use Zustand for form state. Save on explicit "Save Settings" button click. Show toast on success/error.
```

---

## Phase E: Signal Dashboard

```
Read SIGNAL_PIPELINE_SPEC.md — specifically Sections 16.1 and 17 (Signal Dashboard UI, API Routes).

Build the Signal Dashboard at /signals — the real-time monitoring page. Follow Haia's existing dark theme, Tailwind, Recharts patterns.

1. STATS API — Create GET /api/signals/stats:
   - Returns: total signals today, filled count, error count, average latency, win rate, P&L per instrument
   - Filterable by date range and instrument

2. OFFSET API — Create:
   - GET /api/signals/offset/current — returns current NQ and ES offsets from the price cache + age (time since last TradingView webhook) + source (webhook/fixed)
   - GET /api/signals/offset/history — returns offset history from the offsetHistory table for charting (one row per TradingView webhook received)

3. SIGNALS + EXECUTIONS API — Create:
   - GET /api/signals — paginated list of signals with their executions
   - GET /api/signals/:id — single signal with all executions
   - GET /api/signals/executions — filterable list of executions (by instrument, status, date)

4. DASHBOARD PAGE — Create src/app/(app)/signals/page.tsx:

   a) SUMMARY CARDS (top row):
      - Pipeline status (Active/Paused/Error + Dry Run indicator)
      - Today's signals count + fill rate
      - Average execution latency
      - Current NQ offset (points) + age since last webhook update
      - Current ES offset (points) + age since last webhook update

   b) SIGNAL TABLE:
      - Columns: Time, Symbol (NAS100/US500), Direction, Signal Price, Adjusted Price, Order Type, Fill Price, Latency (ms), Status
      - Filter tabs: [All] [NQ] [ES]
      - Color-code by status (filled=green, pending=yellow, error=red, dry_run=blue)
      - Click row to expand execution details (offset applied, slippage, lot size, sizing reason, split info)
      - Split-target executions: group TP1 and TP2 rows together visually (e.g., indent TP2 under TP1, or show as a sub-row). Show breakeven status badge on TP2 rows ("BE Moved" with timestamp, or "Pending").
      - Chunked orders: group all chunks under one parent row. Show total lots and chunk count (e.g., "150 lots (3 × 50)"). Expand to see individual chunk fill prices.
      - Margin-rejected trades: show in red with rejection reason and margin utilization at time of attempt.

   c) OFFSET CHARTS:
      - Dual Recharts line charts: NQ-NAS100 spread and ES-US500 spread over time
      - Show current offset value prominently

   d) PERFORMANCE PANEL:
      - P&L by instrument (NAS100, US500, combined)
      - Win rate by instrument
      - Average slippage

5. REAL-TIME UPDATES — Use SSE (Server-Sent Events) or polling (30s interval) to refresh the dashboard:
   - New signal executions appear at the top of the table without page reload
   - Summary cards update automatically
   - Offset values update in real-time

6. Add "Signals" to the main navigation/sidebar alongside existing links (Dashboard, Analytics, Calendar, History, Flex).
```

---

## Phase F: Trade Journal

```
Read SIGNAL_PIPELINE_SPEC.md — specifically Sections 16.3 and 17 (Trade Journal UI, Journal API Routes).

Build the Trade Journal at /journal. This is a standalone feature that works for both signal-copied trades AND manual trades.

1. JOURNAL API — Create the full CRUD:
   - GET /api/journal — paginated list, filterable by: setupType, instrument, emotionalState, dateRange, tags
   - POST /api/journal — create entry (can optionally link to a tradeId or signalExecutionId)
   - GET /api/journal/:id — single entry with linked trade/execution data
   - PATCH /api/journal/:id — update entry
   - DELETE /api/journal/:id — soft delete
   - GET /api/journal/stats — performance breakdown by setup type and emotional state
   - GET /api/journal/tags — list all unique tags used

2. AUTO-CREATE — When a signal execution completes (in the pipeline orchestrator from Phase B), automatically create a journal entry with:
   - setupType: "signal_copy"
   - symbol, direction, entry/exit from the execution
   - Leave reasoning/review/emotionalState/rating empty for the user to fill in later

3. JOURNAL PAGE — Create src/app/(app)/journal/page.tsx:

   a) TIMELINE VIEW (default):
      - Chronological list of journal entries, grouped by day
      - Each card shows: symbol, direction, P&L, setup type, emotional state badge, rating stars, tags
      - Signal-copied entries have a distinct indicator/badge
      - Click to expand inline editor

   b) ENTRY EDITOR (modal or inline):
      - Setup type dropdown: Breakout, Pullback, Reversal, Signal Copy, custom text
      - Reasoning textarea (pre-trade thesis)
      - Review textarea (post-trade review)
      - Emotional state selector: Confident, Hesitant, FOMO, Revenge, Calm
      - Rating: 1-5 star selector
      - Tags: multi-select with autocomplete from existing tags + ability to create new ones
      - Screenshot upload (store as URLs — use existing file upload infrastructure or base64 in DB)

   c) STATS PANEL (sidebar or separate tab):
      - P&L by setup type (bar chart)
      - Win rate by emotional state (shows how emotions correlate with results)
      - Most profitable setup types
      - Rating distribution
      - Tag cloud or frequency chart

   d) FILTERS:
      - Date range picker
      - Setup type multi-select
      - Instrument (NAS100, US500, all)
      - Emotional state
      - Tags
      - Signal-copied only toggle

4. Add "Journal" to the main navigation alongside Signals.
```

---

## Phase G: Polish + Contract Rolls

```
Read SIGNAL_PIPELINE_SPEC.md — specifically Sections 19 and 22 (Contract Roll Handling, Implementation Phases — Phase F).

Final polish pass:

1. CONTRACT ROLL DETECTION — In the signal listener worker:
   - Track current contract month (NQM2026 = June, NQU2026 = September, etc.)
   - Starting 5 days before expiry (June 15 for NQM2026/ESM2026), check if the offset has jumped abnormally (>2x the normal range)
   - If detected: auto-pause the pipeline, log a warning, show an alert on the dashboard
   - Add a manual "Update Contract" button in Signal Settings that lets you update the futures contract ticker

2. TOAST NOTIFICATIONS — When a signal is executed:
   - Show a toast notification on any open Haia page: "🟢 LONG NAS100 @ 24,182 — MARKET — Filled @ 24,183 (620ms)"
   - Use the existing toast/notification system if Haia has one, or add sonner/react-hot-toast

3. CSV EXPORT — Add an "Export CSV" button to the Signal Dashboard:
   - Exports all executions (filterable by date range and instrument)
   - Columns: timestamp, instrument, direction, signal price, adjusted price, order type, fill price, lot size, slippage, latency, status

4. MOBILE RESPONSIVE — Review all new pages (/signals, /signals/settings, /journal) on mobile viewport:
   - Summary cards should stack vertically
   - Signal table should be horizontally scrollable
   - Journal timeline should be single-column

5. ERROR HANDLING REVIEW — Go through all API routes and the pipeline orchestrator:
   - Ensure every MetaApi call has try/catch with meaningful error messages logged to signalExecutions
   - Ensure Telegram disconnection triggers a visible status change on the dashboard
   - Ensure price cache staleness (>30s) prevents execution and logs the reason

6. Run the full test suite and fix any failures. Build the project and verify no TypeScript errors.
```

---

## Tips

- Run one phase per session if context gets long.
- After each phase, verify the build passes (`npm run build`) before moving on.
- Phase B is the most important — the pure logic functions are the foundation everything else depends on. Make sure the unit tests are solid.
- You can run Phases D and E in parallel if you want — they don't depend on each other (though both depend on B and C).
- Phase F (Journal) is fully independent of the signal pipeline and can be built anytime after Phase A.
