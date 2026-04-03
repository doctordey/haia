# FXDash — FX Trading Performance Analytics Platform

## Design Specification v1.0

**Date:** April 2, 2026
**Purpose:** Complete design spec for a unified FX trading analytics platform, ready for implementation in Claude Code.
**Deployment Target:** Railway (monorepo, single service)

---

## 1. Product Overview

FXDash is a unified web application that allows forex traders to connect their MetaTrader 4 or MetaTrader 5 accounts and analyze their trading performance through rich analytics, a PNL Calendar, and shareable PNL "flex" cards. It combines the deep analytical capabilities of MyFXBook with the visual design language and PNL features found in modern crypto trading terminals like Axiom and Hyperliquid.

### Core Value Proposition

- Connect MT4/MT5 accounts via MetaApi cloud SDK (no local EA required)
- Full trade history import and real-time sync
- Comprehensive performance analytics (profit factor, drawdown, Sharpe ratio, win rate, etc.)
- PNL Calendar showing daily profit/loss in a color-coded monthly grid
- PNL Flex Card generator for sharing performance on social media
- Dark, terminal-style UI inspired by Axiom's design language

---

## 2. Tech Stack

### Frontend
- **Framework:** Next.js 15+ (App Router)
- **Language:** TypeScript
- **Styling:** Tailwind CSS 4 with custom dark theme tokens
- **Charts:** Recharts (line/area charts) + custom SVG for calendar heatmap
- **State Management:** Zustand
- **Date Handling:** date-fns
- **Card Generation:** html-to-image (for PNL flex card export)

### Backend
- **Runtime:** Node.js (Next.js API routes + server actions)
- **ORM:** Prisma 6
- **Database:** PostgreSQL (Railway managed)
- **Cache:** Redis (Railway managed, for session + real-time data)
- **Auth:** NextAuth.js v5 (credentials + OAuth)
- **MT4/MT5 Integration:** `metaapi.cloud-sdk` + `metaapi.cloud-metastats-sdk`
- **Background Jobs:** BullMQ (Redis-backed, for trade sync)
- **Image Generation:** @vercel/og or html-to-image (server-side card rendering)

### Infrastructure (Railway)
- Single Railway project with 3 services:
  1. **Web** — Next.js app (frontend + API)
  2. **Worker** — BullMQ worker for trade sync jobs
  3. **Cron** — Scheduled trade data refresh (every 5 minutes for active accounts)
- PostgreSQL plugin
- Redis plugin
- Environment variables managed via Railway dashboard

---

## 3. Visual Design System

### Design Philosophy
Dark terminal aesthetic inspired by Axiom.trade — deep blacks, subtle borders, neon accent colors for profit/loss states, clean typography with high data density. The feel should be "professional trading terminal" not "consumer fintech app."

### Color Palette

```
/* Backgrounds */
--bg-primary:       #0B0C10    /* Main app background — near-black */
--bg-secondary:     #12141A    /* Cards, panels, sidebars */
--bg-tertiary:      #1A1D26    /* Elevated surfaces, modals, dropdowns */
--bg-hover:         #1E2130    /* Hover states on rows/items */

/* Borders */
--border-primary:   #1E2130    /* Subtle dividers between panels */
--border-secondary: #2A2D3A    /* More visible borders on cards */

/* Text */
--text-primary:     #E8E9ED    /* Primary body text — off-white */
--text-secondary:   #8B8D98    /* Labels, captions, muted text */
--text-tertiary:    #5A5C66    /* Disabled text, placeholders */

/* Accent — Profit (Green) */
--profit-primary:   #00DC82    /* Primary profit green — PNL amounts */
--profit-bg:        #00DC8215  /* Subtle green tint for profit cells */
--profit-border:    #00DC8230  /* Border on profit calendar cells */

/* Accent — Loss (Red/Pink) */
--loss-primary:     #FF4D6A    /* Primary loss red — PNL amounts */
--loss-bg:          #FF4D6A15  /* Subtle red tint for loss cells */
--loss-border:      #FF4D6A30  /* Border on loss calendar cells */

/* Accent — Brand / Interactive */
--accent-primary:   #6C5CE7    /* Purple — primary buttons, active tabs */
--accent-secondary: #00B4D8    /* Cyan/teal — secondary accents, links */
--accent-hover:     #7C6CF7    /* Button hover state */

/* Chart Colors */
--chart-line:       #00DC82    /* Equity curve line */
--chart-area:       #00DC8220  /* Area fill under equity curve */
--chart-grid:       #1A1D26    /* Chart gridlines */
--chart-crosshair:  #5A5C66    /* Chart crosshair */

/* Status */
--warning:          #FFB347    /* Warnings, caution states */
--info:             #00B4D8    /* Info banners, tooltips */
```

### Typography

```
/* Font Stack */
--font-primary:     'Inter', -apple-system, BlinkMacSystemFont, sans-serif
--font-mono:        'JetBrains Mono', 'Fira Code', monospace  /* For numbers/prices */

/* Scale */
--text-xs:    0.75rem / 1rem      /* 12px — smallest labels */
--text-sm:    0.875rem / 1.25rem  /* 14px — secondary text, table cells */
--text-base:  1rem / 1.5rem       /* 16px — body text */
--text-lg:    1.125rem / 1.75rem  /* 18px — section headers */
--text-xl:    1.25rem / 1.75rem   /* 20px — page section titles */
--text-2xl:   1.5rem / 2rem       /* 24px — dashboard hero numbers */
--text-3xl:   2rem / 2.5rem       /* 32px — PNL card main figure */

/* Weights */
Regular (400) for body text
Medium (500) for labels and table headers
Semibold (600) for section titles and emphasized values
Bold (700) for hero numbers (account balance, total PNL)
```

### Spacing & Layout

```
/* Base unit: 4px */
--space-1:  4px
--space-2:  8px
--space-3:  12px
--space-4:  16px
--space-5:  20px
--space-6:  24px
--space-8:  32px
--space-10: 40px
--space-12: 48px

/* Border Radius */
--radius-sm:  6px   /* Small chips, badges */
--radius-md:  8px   /* Cards, buttons */
--radius-lg:  12px  /* Modals, large cards */
--radius-xl:  16px  /* PNL flex card */

/* Panel Layout */
Sidebar width: 240px (collapsible)
Content max-width: none (full width, data-dense)
Card gap: 16px
Table row height: 48px
```

### Component Styles

**Cards/Panels:** `bg-secondary` background, 1px `border-primary` border, `radius-md`, no shadow (flat design). Subtle inner glow on hover.

**Buttons:**
- Primary: `accent-primary` bg, white text, `radius-md`, 36px height
- Secondary: transparent bg, `border-secondary` border, `text-secondary`, `radius-md`
- Ghost: transparent bg, no border, `text-secondary`, hover → `bg-hover`

**Tables:** No outer border. Header row in `text-secondary` uppercase tracking-wide `text-xs`. Rows separated by 1px `border-primary`. Hover → `bg-hover`. Monospaced numbers right-aligned.

**Inputs:** `bg-tertiary` background, 1px `border-primary` border, `radius-md`, 40px height. Focus: `accent-primary` border.

**Tabs:** Underline style. Inactive: `text-secondary`. Active: `text-primary` with 2px `accent-primary` bottom border.

---

## 4. Application Structure & Pages

### 4.1 Navigation

**Top Navigation Bar** (fixed, 56px height, `bg-primary` with bottom border):
- Left: FXDash logo + wordmark
- Center: Primary nav links — Dashboard, Analytics, Calendar, History, Flex Cards
- Right: Account selector dropdown, notification bell, settings gear, user avatar

**No sidebar** — full-width layout like Axiom for maximum data density.

### 4.2 Pages

#### 4.2.1 Landing / Auth Page (`/`)
- Dark hero with gradient accent
- Headline: "Your FX Performance, Visualized"
- CTA buttons: Sign Up / Log In
- Feature preview cards (PNL Calendar, Analytics, Flex Cards)
- Auth modal (email/password + Google OAuth)

#### 4.2.2 Onboarding — Connect Account (`/connect`)
- Step 1: Choose platform (MT4 or MT5)
- Step 2: Enter MetaApi credentials (server, login, investor password)
- Step 3: Verify connection + initial trade history import (with progress indicator)
- Step 4: Success → redirect to Dashboard
- Support for multiple accounts (multi-account selector throughout the app)

#### 4.2.3 Dashboard (`/dashboard`)
Primary overview page. Layout inspired by Axiom's Portfolio page:

**Top Row — Summary Cards (4 columns):**
| Card | Content |
|------|---------|
| Account Balance | Current balance, equity, margin. Large hero number with currency symbol. Sparkline showing 30d balance trend. |
| Total PNL | Realized + unrealized PNL. Green or red based on sign. Percentage change badge. |
| Win Rate | Circular progress indicator. Won/Lost trade count below. |
| Active Trades | Count of open positions. Unrealized PNL total. |

**Middle Row — Two Panels:**
- **Left (65%): Equity Curve Chart**
  - TradingView-style area chart showing account equity over time
  - Time range selectors: 1D, 7D, 30D, 90D, 1Y, MAX
  - Crosshair with tooltip showing date + equity value
  - Green area fill when above starting equity, transitions to red below

- **Right (35%): Performance Summary**
  - Total PNL (green/red)
  - Realized PNL
  - Total Trades count (with win/loss breakdown in green/red like Axiom: "1867 / 2132")
  - Trade distribution by return range (like Axiom):
    - >500%: count with green dot
    - 200%-500%: count with green dot
    - 0%-200%: count with lighter green dot
    - 0% to -50%: count with pink dot
    - < -50%: count with red dot
  - Progress bar showing ratio of profitable to losing trades

**Bottom Row — Tabbed Table:**
- Tabs: Open Positions | Trade History | Statistics
- **Open Positions Table:** Symbol, Direction (Buy/Sell), Lots, Entry Price, Current Price, PNL (ROE %), SL, TP, Duration
- **Trade History Table:** Date, Symbol, Direction, Lots, Entry Price, Close Price, PNL, Duration, Commission
- **Statistics Panel:** Key metrics in a 3-column grid (see Section 5 for full metrics list)

#### 4.2.4 Analytics (`/analytics`)
Deep-dive performance analysis (inspired by MyFXBook):

**Section: Trading Statistics**
Three-column grid of metric cards:
- Profit Factor, Sharpe Ratio, Sortino Ratio
- Max Drawdown (%), Max Drawdown ($), Avg Drawdown Duration
- Expectancy, Average Win, Average Loss
- Risk/Reward Ratio, Win Rate (%), Loss Rate (%)
- Best Trade ($), Worst Trade ($), Average Trade ($)
- Largest Winning Streak, Largest Losing Streak
- Average Trade Duration, Total Commission Paid
- Long Win Rate, Short Win Rate

**Section: Performance by Symbol**
Horizontal bar chart showing PNL per currency pair (EURUSD, GBPUSD, etc.), sorted by total PNL. Green bars for profit, red for loss.

**Section: Performance by Day of Week**
Bar chart showing average PNL per weekday (Mon-Fri). Helps traders identify best/worst trading days.

**Section: Performance by Hour**
Heatmap grid (24h x 5 days) showing PNL intensity by hour and day. Color gradient from red → neutral → green.

**Section: Monthly Returns Table**
Grid showing each month as a cell with % return, inspired by hedge fund tearsheets. Green/red intensity scaling with magnitude. Rows = years, columns = months.

**Section: Drawdown Chart**
Underwater equity curve showing drawdown depth over time. Red area fill. Labels for max drawdown points.

#### 4.2.5 PNL Calendar (`/calendar`)
**The centerpiece feature.** Monthly calendar grid showing daily realized PNL.

**Layout (matching Axiom's PNL Calendar):**

**Header:**
- Month/Year with left/right navigation arrows (< Apr 2026 >)
- Currency toggle (USD / account currency)
- Export/share icon (opens flex card modal)

**Summary Bar (below header):**
- Total monthly PNL (large text, green or red)
- Full-width progress bar: green segment (total profit days) → red segment (total loss days)
- Left label: "X / $Y" (win days count / total profit)
- Right label: "X / $Y" (loss days count / total loss)

**Calendar Grid:**
- 7 columns: Mon, Tue, Wed, Thu, Fri, Sat, Sun
- Day headers in uppercase `text-secondary` `text-xs`
- Each day cell (minimum 90px × 80px):
  - Day number in top-left corner (`text-xs`, `text-tertiary`)
  - PNL amount centered in cell (monospaced font)
  - Profit days: `profit-bg` background tint, `profit-border` border, green text
  - Loss days: `loss-bg` background tint, `loss-border` border, red text
  - Zero/no-trade days: neutral background, "$0" in `text-tertiary`
  - Hover: slightly brighter background, shows tooltip with trade count and breakdown

**Footer:**
- "Current Positive Streak: X days"
- "Best Positive Streak in [Month]: X days"
- Branding watermark (bottom-right)

**Weekly Summary Column (optional, togglable):**
Additional column on the right showing weekly PNL totals.

#### 4.2.6 Trade History (`/history`)
Full searchable/filterable trade history:

**Filters Bar:**
- Date range picker
- Symbol multi-select
- Direction (All / Buy / Sell)
- Result (All / Win / Loss)
- Min/Max PNL range

**Table Columns:**
Ticket #, Open Time, Close Time, Symbol, Direction, Lots, Entry Price, Close Price, SL, TP, Commission, Swap, PNL ($), PNL (pips), Duration

**Features:**
- Sort by any column
- Paginated (50 per page)
- CSV export button
- Click row → trade detail modal with entry/exit annotations on a mini price chart

#### 4.2.7 PNL Flex Cards (`/flex`)
Shareable PNL performance cards for social media.

**Card Generator Interface:**

**Left Panel — Card Preview (live updating):**
- Large card preview (1080x1080px or 1200x630px aspect ratio options)
- Real-time preview updates as options change

**Right Panel — Customization Options:**

**Data Selection:**
- Time period: 1D, 7D, 30D, 90D, 1Y, MAX, Custom date range
- Metric focus (determines the hero number and card layout):
  1. **Total PNL** — Hero: dollar PNL amount. Supporting: % gain, trade count.
  2. **Win Rate** — Hero: win percentage. Supporting: wins/losses, profit factor.
  3. **Profit Factor** — Hero: ratio (e.g. "2.4x"). Supporting: gross profit, gross loss.
  4. **Monthly Return** — Hero: % return for the month. Supporting: start/end balance, PNL.
  5. **Sharpe Ratio** — Hero: Sharpe number (e.g. "1.82"). Supporting: mean return, std dev, trade count.
  6. **% Gain** — Hero: percentage gain/loss for the period (e.g. "+24.5%"). Supporting: start balance, end balance, dollar difference.
  7. **Pips** — Hero: total pips gained/lost (e.g. "+1,342 pips"). Supporting: avg pips/trade, best pip trade, trade count.
  8. **Calendar View** — Hero: mini PNL calendar grid rendered directly on the card. Shows the selected month with color-coded day cells (green/red), monthly total, and win/loss day counts. No equity curve — the calendar IS the visual.
- Account selector (if multiple accounts)

**Visual Customization:**
- Background theme picker (thumbnail strip of 6+ themes):
  1. Dark Geometric (dark triangular mesh patterns)
  2. Gold Crystalline (amber/gold faceted geometry)
  3. Neon Abstract (purple/blue energy waves)
  4. Matrix Code (green code rain on black)
  5. Clean Minimal (solid dark gradient)
  6. Custom Upload (user uploads image, max 0.5MB)
- Color accent override (optional)
- Show/hide elements: username, PNL chart, win/loss ratio, branding

**Card Layouts by Metric Focus:**

*Standard Layout (Total PNL, Win Rate, Profit Factor, Monthly Return, Sharpe Ratio, % Gain, Pips):*
```
┌──────────────────────────────────────┐
│ [Logo]                    FXDash     │
│                                      │
│        [Period] Realized PNL         │  ← label changes per metric
│          +$12,450.00                 │  ← hero number
│                                      │
│  PNL %     +24.5%                    │  ← supporting stat 1
│  Win Rate   68%                      │  ← supporting stat 2
│  Trades    342                       │  ← supporting stat 3
│                                      │
│  [Mini equity curve chart]           │
│                                      │
│  [Avatar] @username                  │
│  fxdash.app  •  Save 10% on fees    │
└──────────────────────────────────────┘
```

*Calendar View Layout:*
```
┌──────────────────────────────────────┐
│ [Logo]                    FXDash     │
│                                      │
│  Apr 2026              +$3,450.00    │  ← month + total PNL
│  ┌──┬──┬──┬──┬──┬──┬──┐             │
│  │M │T │W │T │F │S │S │             │  ← mini calendar grid
│  ├──┼──┼──┼──┼──┼──┼──┤             │     (5-6 rows × 7 cols)
│  │  │  │+2│-1│+4│  │  │             │     green cells = profit
│  │+1│+3│-2│+5│+1│  │  │             │     red cells = loss
│  │+2│-1│+3│+2│-1│  │  │             │     numbers in abbreviated $
│  │+4│+1│  │  │  │  │  │             │
│  └──┴──┴──┴──┴──┴──┴──┘             │
│  Win Days: 14  Loss Days: 6         │
│                                      │
│  [Avatar] @username                  │
│  fxdash.app  •  Save 10% on fees    │
└──────────────────────────────────────┘
```

*Pips Layout variation:*
```
┌──────────────────────────────────────┐
│ [Logo]                    FXDash     │
│                                      │
│        [Period] Total Pips           │
│          +1,342 pips                 │  ← hero number in pips
│                                      │
│  Avg/Trade   +3.9 pips              │  ← pips per trade
│  Best Trade  +87 pips               │  ← best single trade in pips
│  Trades      342                     │
│                                      │
│  [Mini equity curve chart]           │
│                                      │
│  [Avatar] @username                  │
│  fxdash.app  •  Save 10% on fees    │
└──────────────────────────────────────┘
```

**Export Options:**
- Download as PNG (high-res)
- Download as Video (animated card with counter animation, MP4)
- Copy to clipboard
- Share directly to Twitter/X (pre-filled post with image)

#### 4.2.8 Settings (`/settings`)

**Account Management:**
- Connected MT4/MT5 accounts list
- Add new account
- Remove account
- Sync status per account (last sync time, next sync time)
- Manual re-sync button

**Profile:**
- Display name, avatar upload
- Username (used on flex cards)
- Email, password change

**Preferences:**
- Default currency display
- Timezone
- Calendar start day (Mon/Sun)
- PNL calculation method (FIFO, by position)

**Data:**
- Export all data (CSV/JSON)
- Delete account

---

## 5. Metrics & Calculations

All metrics computed server-side using MetaApi MetaStats SDK where possible, with custom calculations for FX-specific metrics.

### Core Metrics

| Metric | Formula / Description |
|--------|----------------------|
| Balance | Current account balance from MT4/MT5 |
| Equity | Balance + unrealized PNL |
| Margin Level | (Equity / Used Margin) × 100 |
| Total PNL | Sum of all closed trade profits/losses |
| Realized PNL | PNL from closed positions only |
| Unrealized PNL | PNL from open positions |
| Profit Factor | Gross Profit / Gross Loss |
| Win Rate | Winning Trades / Total Trades × 100 |
| Loss Rate | Losing Trades / Total Trades × 100 |
| Expectancy | (Win Rate × Avg Win) - (Loss Rate × Avg Loss) |
| Average Win | Total Profit / Winning Trades |
| Average Loss | Total Loss / Losing Trades |
| Risk/Reward | Average Win / Average Loss |
| Max Drawdown (%) | Largest peak-to-trough decline as % of peak equity |
| Max Drawdown ($) | Largest peak-to-trough decline in absolute $ |
| Sharpe Ratio | (Mean Return - Risk Free Rate) / Std Dev of Returns |
| Sortino Ratio | (Mean Return - Risk Free Rate) / Downside Deviation |
| Average Trade Duration | Mean time from open to close |
| Best Trade | Largest single trade profit |
| Worst Trade | Largest single trade loss |
| Longest Win Streak | Consecutive winning trades |
| Longest Loss Streak | Consecutive losing trades |
| Daily PNL | Sum of all trade PNL closed on a given calendar day |
| Monthly Return (%) | (End Balance - Start Balance) / Start Balance × 100 |
| Lots Traded | Total lots/volume across all trades |
| Commission Total | Sum of all commissions paid |
| Swap Total | Sum of all swap charges/credits |
| Total Pips | Sum of all trade PNL measured in pips |
| Avg Pips/Trade | Total Pips / Total Trades |
| Best Trade (Pips) | Largest single trade gain in pips |
| Worst Trade (Pips) | Largest single trade loss in pips |
| % Gain | (End Balance - Start Balance) / Start Balance × 100 for any period |

### PNL Calendar Specific

| Metric | Description |
|--------|-------------|
| Day PNL | Sum of realized PNL for trades closed on that date |
| Win Days | Count of days with positive PNL |
| Loss Days | Count of days with negative PNL |
| Break-even Days | Count of days with $0 PNL |
| Current Win Streak | Consecutive profitable days ending today |
| Best Win Streak | Longest consecutive profitable days in the displayed month |
| Daily Avg PNL | Monthly PNL / trading days |

---

## 6. Database Schema

```prisma
// schema.prisma

generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model User {
  id            String    @id @default(cuid())
  email         String    @unique
  password      String?   // hashed, null for OAuth users
  name          String?
  username      String?   @unique
  avatarUrl     String?
  timezone      String    @default("UTC")
  calendarStart String    @default("monday") // "monday" or "sunday"
  currency      String    @default("USD")
  createdAt     DateTime  @default(now())
  updatedAt     DateTime  @updatedAt

  accounts      TradingAccount[]
  sessions      Session[]
  flexCards     FlexCard[]
}

model Session {
  id           String   @id @default(cuid())
  userId       String
  token        String   @unique
  expiresAt    DateTime
  user         User     @relation(fields: [userId], references: [id], onDelete: Cascade)
}

model TradingAccount {
  id              String   @id @default(cuid())
  userId          String
  name            String   // User-given label, e.g. "Main Account"
  platform        String   // "MT4" or "MT5"
  metaApiId       String   @unique // MetaApi account ID
  server          String   // Broker server name
  login           String   // MT4/MT5 login number
  broker          String?  // Broker name
  leverage        Int?
  currency        String   @default("USD")
  isActive        Boolean  @default(true)
  lastSyncAt      DateTime?
  syncStatus      String   @default("pending") // "pending", "syncing", "synced", "error"
  syncError       String?
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  user            User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  trades          Trade[]
  dailySnapshots  DailySnapshot[]
  accountStats    AccountStats?

  @@index([userId])
}

model Trade {
  id              String   @id @default(cuid())
  accountId       String
  ticket          String   // MT4/MT5 ticket number
  symbol          String   // e.g. "EURUSD"
  direction       String   // "BUY" or "SELL"
  lots            Float
  entryPrice      Float
  closePrice      Float?
  stopLoss        Float?
  takeProfit      Float?
  openTime        DateTime
  closeTime       DateTime?
  profit          Float    // PNL in account currency
  pips            Float?   // PNL in pips
  commission      Float    @default(0)
  swap            Float    @default(0)
  isOpen          Boolean  @default(false)
  magicNumber     Int?     // EA identifier
  comment         String?

  account         TradingAccount @relation(fields: [accountId], references: [id], onDelete: Cascade)

  @@unique([accountId, ticket])
  @@index([accountId, closeTime])
  @@index([accountId, symbol])
  @@index([accountId, isOpen])
}

model DailySnapshot {
  id              String   @id @default(cuid())
  accountId       String
  date            DateTime @db.Date
  balance         Float
  equity          Float
  pnl             Float    // Realized PNL for this day
  tradeCount      Int      // Number of trades closed on this day
  winCount        Int
  lossCount       Int
  volume          Float    // Total lots traded
  pips            Float    @default(0) // Total pips for the day
  commission      Float    @default(0)
  swap            Float    @default(0)

  account         TradingAccount @relation(fields: [accountId], references: [id], onDelete: Cascade)

  @@unique([accountId, date])
  @@index([accountId, date])
}

model AccountStats {
  id                  String   @id @default(cuid())
  accountId           String   @unique
  balance             Float    @default(0)
  equity              Float    @default(0)
  totalPnl            Float    @default(0)
  realizedPnl         Float    @default(0)
  unrealizedPnl       Float    @default(0)
  totalTrades         Int      @default(0)
  winningTrades       Int      @default(0)
  losingTrades        Int      @default(0)
  winRate             Float    @default(0)
  profitFactor        Float    @default(0)
  expectancy          Float    @default(0)
  averageWin          Float    @default(0)
  averageLoss         Float    @default(0)
  riskRewardRatio     Float    @default(0)
  maxDrawdownPct      Float    @default(0)
  maxDrawdownAbs      Float    @default(0)
  sharpeRatio         Float    @default(0)
  sortinoRatio        Float    @default(0)
  avgTradeDuration    Int      @default(0) // in minutes
  bestTrade           Float    @default(0)
  worstTrade          Float    @default(0)
  longestWinStreak    Int      @default(0)
  longestLossStreak   Int      @default(0)
  totalLots           Float    @default(0)
  totalPips           Float    @default(0)
  avgPipsPerTrade     Float    @default(0)
  bestTradePips       Float    @default(0)
  worstTradePips      Float    @default(0)
  totalCommission     Float    @default(0)
  totalSwap           Float    @default(0)
  lastCalculatedAt    DateTime @default(now())

  account             TradingAccount @relation(fields: [accountId], references: [id], onDelete: Cascade)
}

model FlexCard {
  id              String   @id @default(cuid())
  userId          String
  accountId       String?
  title           String?
  period          String   // "1D", "7D", "30D", "90D", "1Y", "MAX", or ISO date range
  metric          String   // "pnl", "winrate", "profitfactor", "monthlyreturn", "sharpe", "pctgain", "pips", "calendar"
  backgroundTheme String   @default("dark-geometric")
  customBgUrl     String?
  showUsername    Boolean  @default(true)
  showChart       Boolean  @default(true)
  showWinLoss     Boolean  @default(true)
  showBranding    Boolean  @default(true)
  imageUrl        String?  // Generated card image URL
  createdAt       DateTime @default(now())

  user            User     @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId])
}
```

---

## 7. API Routes

### Auth
```
POST   /api/auth/register        — Create account (email, password, name)
POST   /api/auth/login            — Login (email, password) → JWT
POST   /api/auth/logout           — Invalidate session
GET    /api/auth/session          — Get current session/user
POST   /api/auth/[...nextauth]   — NextAuth handlers (Google OAuth)
```

### Trading Accounts
```
GET    /api/accounts              — List user's connected accounts
POST   /api/accounts              — Connect new MT4/MT5 account
GET    /api/accounts/:id          — Get account details + stats
DELETE /api/accounts/:id          — Disconnect account
POST   /api/accounts/:id/sync     — Trigger manual sync
GET    /api/accounts/:id/status   — Get sync status
```

### Dashboard
```
GET    /api/dashboard/:accountId              — Summary cards data
GET    /api/dashboard/:accountId/equity-curve  — Equity data points (date, equity)
GET    /api/dashboard/:accountId/performance   — Performance summary panel data
```

### Trades
```
GET    /api/trades/:accountId                  — Paginated trade list (with filters)
GET    /api/trades/:accountId/open             — Open positions
GET    /api/trades/:accountId/:tradeId         — Single trade detail
GET    /api/trades/:accountId/export           — CSV export
```

### Analytics
```
GET    /api/analytics/:accountId/stats         — All computed statistics
GET    /api/analytics/:accountId/by-symbol     — PNL grouped by currency pair
GET    /api/analytics/:accountId/by-day        — PNL grouped by day of week
GET    /api/analytics/:accountId/by-hour       — PNL heatmap (hour x day)
GET    /api/analytics/:accountId/monthly       — Monthly returns grid
GET    /api/analytics/:accountId/drawdown      — Drawdown series data
```

### PNL Calendar
```
GET    /api/calendar/:accountId/:year/:month   — Daily PNL data for a month
GET    /api/calendar/:accountId/streaks         — Win/loss streak data
```

### Flex Cards
```
GET    /api/flex-cards                          — User's saved cards
POST   /api/flex-cards/generate                 — Generate new card (returns image URL)
POST   /api/flex-cards/render                   — Server-side render card to PNG
GET    /api/flex-cards/:id                      — Get saved card
DELETE /api/flex-cards/:id                      — Delete saved card
```

### User
```
GET    /api/user/profile                       — Get profile
PATCH  /api/user/profile                       — Update profile
PATCH  /api/user/preferences                   — Update preferences
POST   /api/user/avatar                        — Upload avatar
DELETE /api/user                               — Delete account + all data
```

---

## 8. MetaApi Integration

### Connection Flow

1. User enters: Platform (MT4/MT5), broker server name, account login number, investor (read-only) password
2. Backend calls MetaApi SDK to create a cloud account:
   ```typescript
   const account = await api.metatraderAccountApi.createAccount({
     type: 'cloud',
     login: userLogin,
     password: investorPassword,
     name: 'FXDash - User Account',
     server: brokerServer,
     platform: 'mt5', // or 'mt4'
   });
   await account.waitDeployed();
   await account.waitConnected();
   ```
3. Store `account.id` as `metaApiId` in our database
4. Trigger initial trade history sync (background job)

### Trade Sync Process (BullMQ Worker)

1. Connect to MetaApi account
2. Retrieve trading history: `account.getHistoryOrdersByTimeRange(startDate, endDate)`
3. Retrieve deals: `account.getDealsByTimeRange(startDate, endDate)`
4. Map deals to our Trade model, upsert into database (idempotent on ticket number)
5. Update DailySnapshot records (aggregate trades by close date)
6. Recalculate AccountStats
7. For active accounts, re-run every 5 minutes via cron

### MetaStats Integration

For pre-computed performance metrics:
```typescript
import MetaStats from 'metaapi.cloud-metastats-sdk';

const metaStats = new MetaStats(metaApiToken);
const metrics = await metaStats.getMetrics(metaApiAccountId);
// Returns: profitFactor, sharpeRatio, maxDrawdown, etc.
```

---

## 9. PNL Calendar — Detailed Behavior

### Data Flow
1. API receives request for `GET /api/calendar/:accountId/2026/04`
2. Query `DailySnapshot` for all records where `accountId` matches and `date` is in April 2026
3. Return array of `{ date, pnl, tradeCount, winCount, lossCount }`
4. Frontend renders into calendar grid

### Cell Rendering Logic
```typescript
function getCellStyle(pnl: number) {
  if (pnl > 0) return { bg: 'profit-bg', border: 'profit-border', text: 'profit-primary' };
  if (pnl < 0) return { bg: 'loss-bg', border: 'loss-border', text: 'loss-primary' };
  return { bg: 'transparent', border: 'none', text: 'text-tertiary' };
}
```

### Interaction
- Click on a day cell → expands to show list of trades closed that day (inline panel below calendar or slide-over)
- Month navigation via arrows or direct month/year picker
- Responsive: on mobile, collapse to a list view (date + PNL + trade count)

---

## 10. Flex Card Generation — Detailed Behavior

### Server-Side Rendering

Use `@vercel/og` (Satori) or `html-to-image` with Puppeteer for server-side card rendering:

1. Client sends card config (period, metric, theme, toggles) to `POST /api/flex-cards/render`
2. Server queries relevant data (PNL, win rate, etc. for the selected period)
3. Server renders HTML template to PNG:
   - Load background image/theme
   - Overlay data text with specified fonts
   - Render mini equity curve as inline SVG
   - Composite user avatar + username
   - Add branding watermark
4. Store generated image (Railway volume or S3-compatible storage)
5. Return image URL

### Card Dimensions
- Square: 1080 × 1080px (Instagram/Twitter)
- Landscape: 1200 × 630px (Twitter card / Open Graph)
- Story: 1080 × 1920px (Instagram/TikTok stories)

### Background Themes
Each theme is a high-res image (1080×1080) stored as static assets:

| Theme ID | Name | Description |
|----------|------|-------------|
| `dark-geometric` | Dark Geometric | Dark triangular mesh / low-poly background |
| `gold-crystalline` | Gold Crystalline | Amber/gold faceted crystal geometry |
| `neon-abstract` | Neon Abstract | Purple/blue electric energy waves |
| `matrix-code` | Matrix Code | Green code rain on deep black |
| `clean-minimal` | Clean Minimal | Solid dark gradient (#0B0C10 → #1A1D26) |
| `custom` | Custom Upload | User-provided image |

---

## 11. Railway Deployment Configuration

### Project Structure
```
fxdash/
├── prisma/
│   └── schema.prisma
├── src/
│   ├── app/              # Next.js App Router pages
│   │   ├── (auth)/       # Login, register, onboarding
│   │   ├── dashboard/
│   │   ├── analytics/
│   │   ├── calendar/
│   │   ├── history/
│   │   ├── flex/
│   │   ├── settings/
│   │   ├── api/          # API route handlers
│   │   ├── layout.tsx
│   │   └── page.tsx
│   ├── components/
│   │   ├── ui/           # Base UI primitives (Button, Card, Input, etc.)
│   │   ├── charts/       # Equity curve, drawdown chart, heatmap
│   │   ├── calendar/     # PNL calendar grid component
│   │   ├── flex-card/    # Card preview, theme picker, export
│   │   ├── dashboard/    # Dashboard-specific composed components
│   │   ├── analytics/    # Analytics page components
│   │   └── layout/       # Nav, sidebar, footer
│   ├── lib/
│   │   ├── metaapi.ts    # MetaApi SDK wrapper
│   │   ├── metastats.ts  # MetaStats SDK wrapper
│   │   ├── prisma.ts     # Prisma client singleton
│   │   ├── redis.ts      # Redis connection
│   │   ├── auth.ts       # NextAuth config
│   │   └── utils.ts      # Shared utilities
│   ├── workers/
│   │   ├── trade-sync.ts # BullMQ trade sync worker
│   │   └── stats-calc.ts # Statistics recalculation worker
│   ├── hooks/            # Custom React hooks
│   ├── stores/           # Zustand stores
│   └── types/            # TypeScript type definitions
├── public/
│   ├── themes/           # Flex card background images
│   └── fonts/            # Inter + JetBrains Mono
├── railway.json
├── Dockerfile
├── package.json
├── tailwind.config.ts
├── tsconfig.json
└── next.config.ts
```

### railway.json
```json
{
  "$schema": "https://railway.app/railway.schema.json",
  "build": {
    "builder": "NIXPACKS"
  },
  "deploy": {
    "numReplicas": 1,
    "healthcheckPath": "/api/health",
    "restartPolicyType": "ON_FAILURE",
    "restartPolicyMaxRetries": 5
  }
}
```

### Environment Variables (Railway)
```
DATABASE_URL=              # Railway PostgreSQL connection string (auto-provisioned)
REDIS_URL=                 # Railway Redis connection string (auto-provisioned)
NEXTAUTH_SECRET=           # Random 32-char secret
NEXTAUTH_URL=              # https://fxdash.up.railway.app
METAAPI_TOKEN=             # MetaApi API token
GOOGLE_CLIENT_ID=          # Google OAuth (optional)
GOOGLE_CLIENT_SECRET=      # Google OAuth (optional)
```

### Deployment Steps
1. Create Railway project
2. Add PostgreSQL plugin → auto-provisions `DATABASE_URL`
3. Add Redis plugin → auto-provisions `REDIS_URL`
4. Connect GitHub repo → auto-deploy on push
5. Set environment variables in Railway dashboard
6. Railway auto-detects Next.js via Nixpacks, builds with standalone output
7. Custom domain: `fxdash.yourdomain.com` via Railway settings

---

## 12. Implementation Priority (Phased)

### Phase 1: Foundation (Week 1-2)
- [ ] Project setup: Next.js + Tailwind + Prisma + Railway
- [ ] Auth system (NextAuth with credentials)
- [ ] Database schema migration
- [ ] MetaApi account connection flow
- [ ] Trade history sync (initial import)
- [ ] Basic dashboard with balance + equity curve

### Phase 2: Core Analytics (Week 3-4)
- [ ] Full trade history page with filtering
- [ ] Performance statistics calculation engine
- [ ] Analytics page (all metric cards, charts)
- [ ] Performance by symbol, day, hour views
- [ ] Monthly returns grid
- [ ] Drawdown chart

### Phase 3: PNL Calendar (Week 5)
- [ ] Daily snapshot aggregation pipeline
- [ ] PNL Calendar component
- [ ] Month navigation + streak calculations
- [ ] Day-click drill-down to trades
- [ ] Calendar share/export

### Phase 4: Flex Cards (Week 6)
- [ ] Card template system + background themes
- [ ] Live preview component
- [ ] Server-side card rendering (PNG generation)
- [ ] Download / copy / share functionality
- [ ] Video card animation (stretch goal)

### Phase 5: Polish & Launch (Week 7-8)
- [ ] Multi-account support
- [ ] Background sync worker (BullMQ cron)
- [ ] Mobile responsive design
- [ ] Performance optimization (caching, ISR)
- [ ] Error handling, loading states, empty states
- [ ] Landing page
- [ ] Custom domain + Railway production config

---

## 13. Key Design References

| Source | What to Reference |
|--------|-------------------|
| Axiom.trade Portfolio | Dark theme, panel layout, PNL chart, performance summary, trade table |
| Axiom PNL Calendar | Calendar grid layout, color coding, progress bar, streak stats |
| Axiom Flex Card Modal | Card preview + background theme picker + time period selectors + download/copy |
| Hyperliquid Portfolio | Clean metric layout (PNL, Volume, Max Drawdown, Equity breakdown) |
| Hyperliquid Leaderboard | Table design (Rank, Trader, PNL, ROI, Volume columns) |
| Hyperdash Explore | Cohort cards with sparklines, long/short volume bars |
| MyFXBook Analytics | Comprehensive trade statistics, performance by symbol/time, monthly returns grid |
| MyFXBook Dashboard | Multi-metric overview, equity curve, trade history with filters |

---

*This spec is designed to be self-contained and implementable in Claude Code. Each section provides enough detail for a developer to build the feature without additional design mockups.*
