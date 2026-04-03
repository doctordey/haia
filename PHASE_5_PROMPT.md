# Phase 5 Prompt — Polish & Launch

Paste this into Claude Code after Phase 4 is complete.

---

## Prompt

Phase 4 is done. Now build **Phase 5: Polish & Launch** per `DESIGN_SPEC.md` Section 12.

### 1. Multi-Account Support
- Account selector dropdown in the top nav — shows all connected accounts with name, platform badge (MT4/MT5), and balance
- Switching accounts updates all pages (dashboard, analytics, calendar, history, flex cards) to show data for the selected account
- "All Accounts" option that aggregates data across accounts where applicable (dashboard summary, calendar)
- Zustand store for active account state, persisted to localStorage

### 2. Background Sync Worker
- BullMQ worker in `src/workers/trade-sync.ts` that runs every 5 minutes for all active accounts
- Fetches new trades since `lastSyncAt`, upserts into database
- Updates DailySnapshot records for affected dates
- Recalculates AccountStats
- Updates `lastSyncAt` and `syncStatus` on the TradingAccount record
- Error handling: set `syncStatus` to "error" with `syncError` message, retry with exponential backoff (max 3 retries)
- Separate entry point: `npm run worker` starts the BullMQ worker process
- Add a cron schedule that enqueues sync jobs for all active accounts every 5 minutes

### 3. Mobile Responsive Design
- Top nav collapses to hamburger menu on mobile (< 768px)
- Dashboard summary cards stack to 2×2 grid on tablet, 1-column on mobile
- Equity curve and charts go full-width on mobile
- Trade tables become horizontally scrollable with pinned first column
- PNL Calendar collapses to vertical list view (date + PNL + trade count)
- Flex card generator becomes single-column (preview on top, controls below)
- Test all pages at 375px, 768px, 1024px, 1440px breakpoints

### 4. Loading & Empty States
- Skeleton loaders (animated shimmer) for all data panels — dashboard cards, charts, tables, calendar grid
- Empty states with illustration/icon + helpful message:
  - No accounts connected → "Connect your MT4/MT5 account to get started" + CTA
  - No trades yet → "No trades found for this period. Your trades will appear here after syncing."
  - Calendar month with no trades → Gray calendar with "No trading activity this month"
  - No saved flex cards → "Create your first flex card" + CTA

### 5. Error Handling
- Global error boundary with a clean error page
- API error responses: consistent `{ error: string, code: string }` format
- Toast notifications for: sync success/failure, card generation, account connection, export complete
- Form validation with inline error messages (Zod schemas)
- MetaApi connection errors: show specific messages for "invalid credentials", "server not found", "account already connected"

### 6. Performance Optimization
- Redis caching for dashboard data (5-minute TTL)
- Redis caching for analytics calculations (5-minute TTL, invalidated on new sync)
- Incremental Static Regeneration for the landing page
- Dynamic imports for heavy chart components (Recharts)
- Image optimization for flex card theme backgrounds (next/image, WebP)
- Database indexes are already defined in the Prisma schema — verify they're applied

### 7. Landing Page
- Dark hero with subtle gradient animation (purple → cyan, slow drift)
- Headline: "Your FX Performance, Visualized"
- Subhead: "Connect MetaTrader. Track every trade. Share your results."
- Two CTA buttons: "Get Started" (→ /register) and "See Demo" (→ /dashboard with demo data)
- 3 feature cards below the hero: Analytics, PNL Calendar, Flex Cards — each with an icon, title, short description
- Footer with links

### 8. Settings Page (`/settings`)
Build the full settings page from Section 4.2.8:
- Account Management: list connected accounts, add/remove, sync status, manual re-sync
- Profile: display name, avatar upload, username, email, password change
- Preferences: default currency, timezone, calendar start day, PNL calculation method
- Data: export all data (CSV), delete account with confirmation modal

### 9. Railway Production Config
- Verify `railway.json` is correct
- Add `npm run worker` as a separate Railway service (same repo, different start command)
- Health check endpoint returning DB and Redis connection status
- Ensure environment variables are documented in `.env.example`
- Set `NEXTAUTH_URL` to the Railway deployment URL
- Test the full deployment flow: push → build → migrate → start
