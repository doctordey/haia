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

- `read` — fetch accounts and trades (every key has this).
- `write` — also ingest trades, import history, and edit labels.

`401` = missing/invalid/revoked/expired key. `403` = key lacks the needed scope.

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
    "distinguishManual": true, "labeled": true,
    "stats": { "balance": 10250.5, "totalPnl": 250.5, "winRate": 61.2, … }
  }]
}
```

### `GET /api/v1/accounts/:id`
One account (same shape as a list entry).

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
Send the MT5 *History → Report (CSV)* export, or a JSON array of trades.

- `Content-Type: text/csv` (or `text/plain`) — raw CSV; columns matched by header
  name (case-insensitive). MT5's repeated `Time`/`Price` columns are read as
  open then close. Non-trade rows (balance/credit) are skipped.
- `Content-Type: application/json` — `[ { …trade… } ]` or `{ "trades": [...] }`.

Optional `?openingBalance=10000` anchors the rebuilt equity curve. Imported rows
are tagged `source="manual"`.

```json
{ "success": true, "imported": 42, "skipped": 3, "failed": 0,
  "warnings": [], "totals": { "totalTrades": 42, "closedTrades": 40 } }
```

## Manual vs live distinction

Each account has a `distinguishManual` flag (default on). When **on**, manually
entered / imported trades carry `source="manual"`, are returned with that field,
and can be filtered with `?source=`. When **off**, manual and live (broker-synced)
trades are pooled and reported together. Toggle it via the `PATCH` above or in
**Settings → Accounts → Edit**.

> Balance note: imports/manual entries derive balance from realized PnL
> (`opening + cumulative PnL`). For MetaApi-connected accounts, **Re-sync**
> remains authoritative for deposit-aware balances.
