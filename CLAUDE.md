# Haia — Project Instructions

## What This Is

Haia is a unified FX trading performance analytics platform. Traders connect their MetaTrader 4/5 accounts and get rich analytics, a PNL Calendar, and shareable PNL flex cards. The visual design is inspired by Axiom.trade's dark terminal aesthetic.

**Read `DESIGN_SPEC.md` before writing any code.** It contains the full design spec including color palette, component styles, database schema, API routes, page layouts, and implementation phases.

## Tech Stack

- **Frontend:** Next.js 15+ (App Router), TypeScript, Tailwind CSS 4, Recharts, Zustand
- **Backend:** Next.js API routes + server actions, Drizzle ORM, PostgreSQL, Redis
- **Auth:** NextAuth.js v5 (credentials + Google OAuth)
- **MT4/MT5:** `metaapi.cloud-sdk` + `metaapi.cloud-metastats-sdk`
- **Background Jobs:** BullMQ (Redis-backed)
- **Card Generation:** `@vercel/og` (Satori) for server-side PNG rendering
- **Deployment:** Railway (single project: web + worker + cron)

## Project Structure

```
haia/
├── drizzle/                    # Generated migration SQL files
├── drizzle.config.ts
├── src/
│   ├── app/                    # Next.js App Router
│   │   ├── (auth)/             # Login, register, onboarding (route group)
│   │   │   ├── login/page.tsx
│   │   │   ├── register/page.tsx
│   │   │   └── connect/page.tsx
│   │   ├── dashboard/page.tsx
│   │   ├── analytics/page.tsx
│   │   ├── calendar/page.tsx
│   │   ├── history/page.tsx
│   │   ├── flex/page.tsx
│   │   ├── settings/page.tsx
│   │   ├── api/                # API route handlers
│   │   │   ├── auth/[...nextauth]/route.ts
│   │   │   ├── accounts/route.ts
│   │   │   ├── accounts/[id]/route.ts
│   │   │   ├── accounts/[id]/sync/route.ts
│   │   │   ├── dashboard/[accountId]/route.ts
│   │   │   ├── dashboard/[accountId]/equity-curve/route.ts
│   │   │   ├── trades/[accountId]/route.ts
│   │   │   ├── analytics/[accountId]/stats/route.ts
│   │   │   ├── analytics/[accountId]/by-symbol/route.ts
│   │   │   ├── analytics/[accountId]/by-day/route.ts
│   │   │   ├── analytics/[accountId]/by-hour/route.ts
│   │   │   ├── analytics/[accountId]/monthly/route.ts
│   │   │   ├── analytics/[accountId]/drawdown/route.ts
│   │   │   ├── calendar/[accountId]/[year]/[month]/route.ts
│   │   │   ├── flex-cards/route.ts
│   │   │   ├── flex-cards/render/route.ts
│   │   │   ├── user/profile/route.ts
│   │   │   └── health/route.ts
│   │   ├── layout.tsx
│   │   ├── page.tsx            # Landing page
│   │   └── globals.css
│   ├── components/
│   │   ├── ui/                 # Primitives: Button, Card, Input, Badge, Tabs, etc.
│   │   ├── charts/             # EquityCurve, DrawdownChart, Heatmap, Sparkline
│   │   ├── calendar/           # PNLCalendar, CalendarCell, CalendarHeader
│   │   ├── flex-card/          # CardPreview, ThemePicker, CardExport
│   │   ├── dashboard/          # SummaryCards, PerformancePanel, TradeTable
│   │   ├── analytics/          # StatCard, SymbolChart, MonthlyGrid
│   │   └── layout/             # TopNav, AccountSelector, UserMenu
│   ├── lib/
│   │   ├── metaapi.ts          # MetaApi SDK wrapper
│   │   ├── metastats.ts        # MetaStats SDK wrapper
│   │   ├── db/                 # Drizzle schema + client (schema.ts, index.ts)
│   │   ├── redis.ts            # Redis/BullMQ connection
│   │   ├── auth.ts             # NextAuth config
│   │   ├── calculations.ts     # Custom metric calculations
│   │   └── utils.ts            # Formatting, helpers
│   ├── workers/
│   │   ├── trade-sync.ts       # BullMQ trade sync worker
│   │   └── stats-calc.ts       # Stats recalculation worker
│   ├── hooks/                  # useAccount, useCalendar, useTrades, etc.
│   ├── stores/                 # Zustand: accountStore, uiStore
│   └── types/                  # Trade, Account, DailySnapshot, FlexCard types
├── public/
│   ├── themes/                 # Flex card background images (1080x1080)
│   └── fonts/
├── .env.example
├── railway.json
├── package.json
├── tailwind.config.ts
├── tsconfig.json
└── next.config.ts
```

## Design System Quick Reference

All colors, typography, spacing, and component styles are defined in Section 3 of `DESIGN_SPEC.md`. Key points:

- **Dark-first.** Background is `#0B0C10`, cards are `#12141A`, elevated surfaces are `#1A1D26`.
- **Profit = green** (`#00DC82`), **Loss = red** (`#FF4D6A`), **Accent = purple** (`#6C5CE7`).
- **Fonts:** Inter for body, JetBrains Mono for numbers/prices. Load via `next/font`.
- **No shadows.** Flat design with 1px borders. Subtle background tints for state.
- **Tables:** No outer border, header in uppercase muted text, hover rows. Monospaced numbers right-aligned.
- **Full-width layout.** No sidebar. Top nav only. Maximum data density.

## Database

The full Drizzle schema is in Section 6 of `DESIGN_SPEC.md` (written as `src/db/schema.ts`). Tables: users, sessions, tradingAccounts, trades, dailySnapshots, accountStats, flexCards.

Run migrations with:
```bash
npx drizzle-kit generate   # Generate migration SQL from schema changes
npx drizzle-kit migrate    # Apply migrations to the database
npx drizzle-kit push       # Push schema directly (dev shortcut)
npx drizzle-kit studio     # Open Drizzle Studio GUI
```

## MetaApi Integration

Uses the cloud SDK — no local Expert Advisor needed. The connection flow and sync process are detailed in Section 8 of `DESIGN_SPEC.md`. Key packages:
```bash
npm install metaapi.cloud-sdk metaapi.cloud-metastats-sdk
```

Requires a `METAAPI_TOKEN` environment variable (get from https://app.metaapi.cloud).

## Implementation Order

Follow the phased approach in Section 12 of `DESIGN_SPEC.md`:
1. Foundation (auth, DB, MetaApi connection, basic dashboard)
2. Core Analytics (trade history, statistics engine, charts)
3. PNL Calendar (daily snapshots, calendar grid, streaks)
4. Flex Cards (templates, themes, server-side rendering, export)
5. Polish (multi-account, background sync, responsive, landing page)

## Commands

```bash
npm run dev          # Start dev server
npm run build        # Production build
npm run start        # Start production server
npm run db:migrate   # Run Drizzle migrations
npm run db:push      # Push schema directly (dev shortcut)
npm run db:studio    # Open Drizzle Studio
npm run db:seed      # Seed demo data (if available)
npm run worker       # Start BullMQ trade sync worker
```

## Environment Variables

See `.env.example` for all required variables.

## Railway Deployment

Single Railway project with PostgreSQL and Redis plugins. See Section 11 of `DESIGN_SPEC.md` for `railway.json` config and deployment steps. Railway auto-detects Next.js via Nixpacks.
