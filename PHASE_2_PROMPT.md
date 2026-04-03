# Phase 2 Prompt — Core Analytics

Paste this into Claude Code after Phase 1 is complete and working.

---

## Prompt

Phase 1 is done. Now build **Phase 2: Core Analytics** per the design spec in `DESIGN_SPEC.md` (Section 4.2.4 and Section 4.2.6).

### 1. Trade History Page (`/history`)
- Full-width table with columns: Ticket #, Open Time, Close Time, Symbol, Direction, Lots, Entry Price, Close Price, SL, TP, Commission, Swap, PNL ($), PNL (pips), Duration
- Filter bar above: date range picker, symbol multi-select, direction (All/Buy/Sell), result (All/Win/Loss), min/max PNL range
- Sortable columns, paginated (50 per page)
- CSV export button
- Click a row → modal showing trade details
- API route `GET /api/trades/:accountId` with query params for all filters + pagination

### 2. Analytics Page (`/analytics`)
Build all sections from the design spec:

**Statistics Grid** — 3-column grid of metric cards showing: Profit Factor, Sharpe Ratio, Sortino Ratio, Max Drawdown (% and $), Avg Drawdown Duration, Expectancy, Average Win, Average Loss, Risk/Reward Ratio, Win Rate, Loss Rate, Best Trade, Worst Trade, Average Trade, Longest Win Streak, Longest Loss Streak, Avg Trade Duration, Total Commission, Long Win Rate, Short Win Rate, Total Pips, Avg Pips/Trade, Best Trade (Pips), Worst Trade (Pips)

**Performance by Symbol** — Horizontal bar chart (Recharts), PNL per currency pair, sorted by total PNL. Green bars for profit, red for loss.
- API: `GET /api/analytics/:accountId/by-symbol`

**Performance by Day of Week** — Bar chart showing avg PNL per weekday (Mon–Fri).
- API: `GET /api/analytics/:accountId/by-day`

**Performance by Hour** — Heatmap grid (24h × 5 days) showing PNL intensity. Color gradient red → neutral → green. Build as a custom SVG/div grid component.
- API: `GET /api/analytics/:accountId/by-hour`

**Monthly Returns Table** — Grid with rows = years, columns = Jan–Dec. Each cell shows % return with green/red intensity scaling. Include a YTD column.
- API: `GET /api/analytics/:accountId/monthly`

**Drawdown Chart** — Underwater equity curve showing drawdown depth over time as a red area fill chart. Label the max drawdown point.
- API: `GET /api/analytics/:accountId/drawdown`

### 3. Statistics Calculation Engine
- Create `lib/calculations.ts` with functions for all metrics listed in Section 5 of the design spec
- Include pip calculations — compute pips from entry/close price for each currency pair (handle JPY pairs with 2-decimal pricing)
- Recalculate AccountStats whenever new trades are synced
- Cache expensive calculations in Redis with a 5-minute TTL

All charts should use the design spec colors (chart line: `#00DC82`, grid: `#1A1D26`, crosshair: `#5A5C66`). Make sure numbers in tables use JetBrains Mono and are right-aligned.
