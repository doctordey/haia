# Prompt to Paste into Claude Code

Copy everything below the line into Claude Code as your first message after placing `CLAUDE.md` and `DESIGN_SPEC.md` in the project root.

---

## Prompt

I'm building FXDash — an FX trading performance analytics platform. The full design spec is in `DESIGN_SPEC.md` and project instructions are in `CLAUDE.md`. Please read both files completely before starting.

Start with **Phase 1: Foundation**. Here's exactly what I need built in this first pass:

### 1. Project Scaffolding
- Initialize a Next.js 15+ project with App Router, TypeScript, and Tailwind CSS 4
- Set up the custom dark theme from the design spec (all CSS custom properties from Section 3) in `globals.css` and `tailwind.config.ts`
- Install and configure: Prisma (PostgreSQL), NextAuth.js v5, Zustand, Recharts, date-fns
- Create the full Prisma schema from Section 6 of the design spec and run the initial migration
- Set up the project structure as defined in `CLAUDE.md`
- Create `.env.example` with all required environment variables
- Create `railway.json` for deployment

### 2. Auth System
- NextAuth.js with credentials provider (email + hashed password with bcrypt)
- Registration page at `/register` with email, password, name, username fields
- Login page at `/login`
- Protected route middleware — redirect unauthenticated users to `/login`
- Session management with JWT strategy

### 3. Core Layout & UI Primitives
- Top navigation bar (fixed, 56px height) with logo, nav links (Dashboard, Analytics, Calendar, History, Flex Cards), account selector dropdown placeholder, and user menu
- Build these base UI components in `components/ui/`: Button, Card, Input, Badge, Tabs, Select, Modal, Tooltip
- All styled according to the design spec (dark theme, flat borders, no shadows)
- Landing page at `/` with a dark hero section, headline, auth CTAs, and feature preview cards

### 4. MetaApi Account Connection
- Connection page at `/connect` with a multi-step form: choose MT4/MT5 → enter server, login, investor password → verify connection → success
- API route `POST /api/accounts` that calls MetaApi SDK to create a cloud account, waits for deployment and connection, stores the `metaApiId` in the database
- API route `GET /api/accounts` to list connected accounts
- API route `DELETE /api/accounts/:id` to disconnect
- Error handling for invalid credentials, unreachable servers, etc.

### 5. Trade History Sync
- API route `POST /api/accounts/:id/sync` that triggers an initial trade history import
- Fetch all historical deals from MetaApi, map them to our Trade model, upsert into the database
- After importing trades, aggregate into DailySnapshot records (group by close date)
- Calculate and store AccountStats (win rate, profit factor, total PNL, etc.)
- Show sync progress on the connect page (pending → syncing → synced)

### 6. Basic Dashboard
- Dashboard page at `/dashboard` showing:
  - 4 summary cards (Balance, Total PNL, Win Rate, Active Trades) — real data from AccountStats
  - Equity curve chart (Recharts area chart with time range selectors: 1D, 7D, 30D, 90D, 1Y, MAX)
  - Performance summary panel (matching Axiom's layout — Total PNL, Realized PNL, Total Trades with win/loss count, trade distribution by return range)
  - Tabbed table below: Open Positions | Trade History (paginated, 50/page) | Statistics grid
- API routes to serve all dashboard data

### 7. Health Check
- `GET /api/health` returning `{ status: "ok", timestamp: ... }` for Railway

Use the Inter font (via `next/font/google`) for body text and JetBrains Mono for numbers. Make sure the entire UI follows the dark terminal aesthetic from the design spec — `#0B0C10` background, green for profit, red for loss, purple accents, flat design with subtle borders.

Don't skip any of the color tokens or component styles from the design spec — I want the theme to be pixel-perfect from the start so we're not retrofitting later.
