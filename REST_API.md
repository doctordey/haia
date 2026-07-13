# Haia REST API

Programmatic ingest/distribute API for trading-account data. Separate from the
web app's session-cookie auth — callers authenticate with a **per-user API key**.

Base path: `/api/v1` (pretty alias: `/haia/v1`).

## Authentication

Create keys in **Settings → API**. The plaintext key (`hk_…`) is shown once at
creation and stored only as a SHA-256 hash. Send it on every request via either:

```
Authorization: Bearer hk_xxxxxxxx…
X-API-Key: hk_xxxxxxxx…
```

Scopes:

- `read` — fetch accounts, trades, and transactions (every key has this).
- `write` — also ingest trades, import history, and edit labels.

`401` = missing/invalid/revoked/expired key. `403` = key lacks the needed scope.

### Per-key account restriction

A key can be limited to specific accounts — set at creation (Settings → API →
uncheck "All accounts", or pass `"accountIds": ["…"]` in the POST body). For a
restricted key:

- `GET /accounts` lists only the allowed accounts.
- Every other route returns **404** for out-of-scope account ids — identical to
  a nonexistent account, so the key holder can't probe what else exists.
- Keys without a restriction (the default) cover every account, including ones
  connected after the key was created.

## Distribute (read)

### `GET /api/v1/accounts`
List the key owner's accounts with stats. Identifying fields reflect the
operator's **label overrides** (see below) — the real broker `metaApiId` and raw
login are never exposed.

```json
{
  "accounts": [{
    "id": "…", "name": "Funded #1", "accountNumber": "TRADER-01",
    "accountType": "live", "isDemo": false, "platform": "MT5",
    "stats": { "balance": 10250.5, "totalPnl": 250.5, "winRate": 61.2, … }
  }]
}
```

Overrides are **indistinguishable**: the payload is byte-for-byte the same shape
whether a field is real or overridden — there is no flag, and no labeling or
manual-entry configuration is ever exposed.

### `GET /api/v1/accounts/:id`
One account (same shape as a list entry).

### `GET /api/v1/accounts/:id/transactions`
The account's deposits and withdrawals (captured from broker sync):

```json
{ "transactions": [ { "id": "…", "kind": "deposit", "amount": 5000,
    "time": "2024-01-15T09:00:00.000Z", "comment": "Wire transfer" } ] }
```

### `GET /api/v1/accounts/:id/trades`
Query params: `status=open|closed|all`, `source=live|manual|all`,
`symbol=EURUSD`, `page`, `limit` (max 500). The `source` filter and the per-trade
`source` field are only applied when the account has `distinguishManual` enabled.

```json
{ "trades": [ { "ticket": "101", "symbol": "EURUSD", "direction": "BUY", "profit": 50, "source": "manual" } ],
  "pagination": { "page": 1, "limit": 100, "total": 1, "totalPages": 1 } }
```

## Ingest (write)

### `PATCH /api/v1/accounts/:id` — label overrides
Override what the distribute endpoints expose for the identifying fields. A
`null` clears the override (real value is exposed again).

```json
{ "labelName": "Funded #1", "labelLogin": "TRADER-01", "labelType": "live",
  "accountType": "demo", "distinguishManual": true }
```

### `POST /api/v1/accounts/:id/trades` — manual entry
Body: a single trade, an array, or `{ "trades": [...] }`. Stored with
`source="manual"`. Aggregates (snapshots + stats) recompute automatically.

```json
{ "symbol": "EURUSD", "direction": "BUY", "lots": 0.1,
  "entryPrice": 1.1000, "closePrice": 1.1050,
  "openTime": "2024-01-01T10:00:00Z", "closeTime": "2024-01-01T12:00:00Z",
  "profit": 50 }
```

Required: `symbol`, `direction` (BUY/SELL or long/short), `lots`, `entryPrice`,
`openTime`. Omit `closeTime`/`closePrice` for an open position. `ticket` is
auto-generated if absent (idempotent upsert on `accountId+ticket`). `pips` are
derived from prices when not supplied.

### `POST /api/v1/accounts/:id/import` — MT5 history backfill
Send the MT5 *History → Report* export (HTML **or** CSV), or a JSON array of
trades. The format is auto-detected from Content-Type and the body itself:

- **HTML** (`text/html`, or body starts with `<`) — the MT5 report statement
  (MT4 statements work too). The Positions table is located by its header row;
  section titles, pending orders, and summary rows are skipped. UTF-16 encoded
  files (MT5's default save format) are handled.
- **CSV** (`text/csv` / `text/plain`) — columns matched by header name
  (case-insensitive). MT5's repeated `Time`/`Price` columns are read as open
  then close. Non-trade rows (balance/credit) are skipped.
- **JSON** (`application/json`, or body starts with `[`/`{`) —
  `[ { …trade… } ]` or `{ "trades": [...] }`.

Query params:

- `?openingBalance=10000` — anchors the rebuilt equity curve.
- `?advanceSync=false` — disables the automatic sync-cursor handoff (below).

```json
{ "success": true, "format": "html", "imported": 42, "deduplicated": 0,
  "skipped": 3, "failed": 0, "warnings": [],
  "syncCursorAdvancedTo": "2026-06-30T21:15:00.000Z",
  "totals": { "totalTrades": 42, "closedTrades": 40 } }
```

#### Backfill → live-sync handoff
Imports are designed to hand off cleanly to the live MetaApi sync:

1. **Cursor advancement** — after a successful import, the account's sync cursor
   (`lastSyncAt`) moves forward to the last imported trade's close time, so the
   next **Re-sync** continues chronologically after the backfill instead of
   re-pulling (and duplicating) the imported period. Forward-only: importing
   *older* history than what's already synced never rewinds the cursor. Opt out
   with `?advanceSync=false`.
2. **Ticket merge** — rows are keyed on `accountId + ticket`. When the export
   carries the broker's real position ids (MT5 reports do), a live sync that
   re-sees those trades updates the same rows and flips them `manual → live`.
3. **Duplicate sweep** — manual rows whose tickets *don't* match but that
   duplicate a live row on symbol + direction + lots + open time (±2 min) are
   removed automatically, on both import and sync (`deduplicated` /
   `manualReconciled` in the respective responses). Broker data wins.

## Manual vs live distinction

Each account has a `distinguishManual` flag (default on). When **on**, manually
entered / imported trades carry `source="manual"`, are returned with that field,
and can be filtered with `?source=`. When **off**, manual and live (broker-synced)
trades are pooled and **fully indistinguishable** to API consumers: no `source`
field, no config metadata on the account payload, and auto-generated tickets are
broker-style numerics (no textual marker). Toggle it via the `PATCH` above or in
**Settings → Accounts → Edit**. (The flag itself never appears in GET responses —
it only shows up in what it does to the trade payload.)

## Exclusions

Individual trades **and** individual transactions (deposits/withdrawals) can be
excluded from everything the platform derives and distributes — manage them in
**Settings → Accounts → Exclusions**. An excluded item is omitted from:

- API output (trade lists, the transactions endpoint),
- account statistics (PnL, win rate, trade counts, …),
- the balance/equity curve and daily snapshots,
- in-app listings and analytics.

Exclusion is invisible to API consumers — nothing in any payload indicates that
something was omitted. Toggling recomputes all derived numbers immediately, and
items can be restored at any time (nothing is deleted).

> Balance model: `balance = openingBalance + Σ non-excluded deposits/withdrawals
> + Σ non-excluded realized PnL`. Broker deposits are captured as transaction
> rows during **Re-sync**; `?openingBalance=` on import sets the anchor for
> backfilled accounts.
