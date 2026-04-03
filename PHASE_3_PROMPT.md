# Phase 3 Prompt — PNL Calendar

Paste this into Claude Code after Phase 2 is complete.

---

## Prompt

Phase 2 is done. Now build **Phase 3: PNL Calendar** per `DESIGN_SPEC.md` Sections 4.2.5 and 9.

### 1. Daily Snapshot Pipeline
- Ensure the trade sync worker aggregates trades into DailySnapshot records on every sync
- Each snapshot stores: date, balance, equity, pnl (realized for that day), tradeCount, winCount, lossCount, volume, pips, commission, swap
- Backfill snapshots for all existing trades if not already present

### 2. PNL Calendar Page (`/calendar`)

Build the full calendar component matching the Axiom PNL Calendar layout I described in the spec:

**Calendar Header:**
- Month/year label with `<` and `>` navigation arrows
- Currency toggle button (USD / account currency)
- Share/export icon (opens flex card modal — stub for now, will build in Phase 4)

**Summary Bar:**
- Total monthly PNL in large text (green if positive, red if negative)
- Full-width horizontal progress bar: green segment proportional to total profit, red segment proportional to total loss
- Left side: "X / $Y" — win day count / total profit amount (green text)
- Right side: "X / $Y" — loss day count / total loss amount (red text)

**Calendar Grid:**
- 7 columns: M T W T F S S (day headers in uppercase, muted, text-xs)
- Each cell is a day of the month (~90×80px min):
  - Day number in top-left corner (text-xs, text-tertiary)
  - PNL dollar amount centered (monospaced font, JetBrains Mono)
  - Profit days: subtle green background tint (#00DC8215), green border (#00DC8230), green text
  - Loss days: subtle red background tint (#FF4D6A15), red border (#FF4D6A30), red text
  - Zero/no-trade days: neutral background, "$0" in muted gray
  - Hover state: brighter background + tooltip showing trade count breakdown (X wins, Y losses)
- Click a day → inline expandable panel below the calendar showing all trades closed that day (symbol, direction, lots, PNL, duration)

**Footer:**
- "Current Positive Streak: X days"
- "Best Positive Streak in [Month]: X days"

**Optional toggle:** Weekly summary column on the right showing weekly PNL totals.

### 3. API
- `GET /api/calendar/:accountId/:year/:month` — returns array of `{ date, pnl, tradeCount, winCount, lossCount, pips }` for each day in the month
- `GET /api/calendar/:accountId/streaks` — returns current streak + best streak data

### 4. Responsive
- On screens < 768px, collapse the grid to a vertical list view: date + PNL + trade count per row, keeping the same color coding

Make sure the calendar component is its own self-contained component at `components/calendar/PNLCalendar.tsx` so we can reuse it in the flex card renderer later.
