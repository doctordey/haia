# Phase 4 Prompt — Flex Cards

Paste this into Claude Code after Phase 3 is complete.

---

## Prompt

Phase 3 is done. Now build **Phase 4: PNL Flex Cards** per `DESIGN_SPEC.md` Sections 4.2.7 and 10.

### 1. Flex Card Page (`/flex`)

Two-panel layout:
- **Left:** Live card preview (updates in real time as options change)
- **Right:** Customization controls

### 2. Data Selection Controls
- **Time period selector:** 1D, 7D, 30D, 90D, 1Y, MAX, Custom (date range picker)
- **Metric focus selector** (8 options — each changes the card layout):
  1. **Total PNL** — Hero: dollar amount. Supporting: % gain, trade count
  2. **Win Rate** — Hero: win %. Supporting: wins/losses, profit factor
  3. **Profit Factor** — Hero: ratio (e.g. "2.4x"). Supporting: gross profit, gross loss
  4. **Monthly Return** — Hero: % return. Supporting: start/end balance, PNL
  5. **Sharpe Ratio** — Hero: Sharpe number. Supporting: mean return, std dev, trade count
  6. **% Gain** — Hero: percentage gain/loss for period. Supporting: start balance, end balance, dollar difference
  7. **Pips** — Hero: total pips (e.g. "+1,342 pips"). Supporting: avg pips/trade, best pip trade, trade count
  8. **Calendar View** — Renders a mini PNL calendar grid on the card instead of an equity curve. Shows the selected month with color-coded cells, monthly total, win/loss day counts
- **Account selector** (if multiple accounts connected)

### 3. Visual Customization Controls
- **Background theme picker:** horizontal thumbnail strip showing 6 themes:
  1. `dark-geometric` — dark triangular mesh / low-poly
  2. `gold-crystalline` — amber/gold faceted crystal geometry
  3. `neon-abstract` — purple/blue electric energy waves
  4. `matrix-code` — green code rain on deep black
  5. `clean-minimal` — solid dark gradient (#0B0C10 → #1A1D26)
  6. `custom` — user uploads their own image (max 0.5MB, accept .jpg/.png/.webp)
- Create placeholder background images for each theme (can be simple gradients/patterns generated with CSS or SVG for now — they'll be replaced with final art later)
- **Element toggles:** show/hide username, show/hide mini chart, show/hide win/loss ratio, show/hide branding
- **Aspect ratio selector:** Square (1080×1080), Landscape (1200×630), Story (1080×1920)

### 4. Card Rendering

For metrics 1–7 (standard layout):
```
[Logo]                         FXDash
         [Period] [Metric Label]
           [HERO NUMBER]
  [Stat 1 label]    [Stat 1 value]
  [Stat 2 label]    [Stat 2 value]
  [Stat 3 label]    [Stat 3 value]
  [Mini equity curve — if toggled on]
  [Avatar] @username
  fxdash.app
```

For metric 8 (Calendar View):
```
[Logo]                         FXDash
  [Month Year]           [Total PNL]
  [7-col mini calendar grid]
  [Green/red cells with abbreviated $ amounts]
  Win Days: X    Loss Days: Y
  [Avatar] @username
  fxdash.app
```

Reuse the `PNLCalendar` component from Phase 3 in a compact/mini mode for the calendar view card.

### 5. Export System
- **Download as PNG:** Use `@vercel/og` (Satori) to render the card server-side at the selected aspect ratio. API route: `POST /api/flex-cards/render` — accepts card config JSON, returns PNG image buffer
- **Copy to clipboard:** Use `html-to-image` on the client to capture the preview div, then copy to clipboard via `navigator.clipboard.write()`
- **Share to Twitter/X:** Generate the PNG, then open `https://twitter.com/intent/tweet?text=...` with the image (user can paste from clipboard, or we link to a hosted version)
- **Download** and **Copy** buttons at the bottom of the customization panel

### 6. Saved Cards
- `POST /api/flex-cards` — save card config to database (FlexCard model)
- `GET /api/flex-cards` — list user's saved cards
- `DELETE /api/flex-cards/:id` — delete a saved card
- Show saved cards in a grid below the generator (click to re-edit)

### 7. Background Theme Assets
For now, generate 5 theme background images programmatically:
- `dark-geometric`: CSS/SVG with dark triangles on #0B0C10
- `gold-crystalline`: CSS gradient with amber/gold tones
- `neon-abstract`: CSS gradient with purple → blue → cyan
- `matrix-code`: Dark bg with faint green vertical lines pattern
- `clean-minimal`: Simple linear gradient #0B0C10 → #1A1D26

Store in `public/themes/` as 1080×1080 PNGs or use inline SVG in the renderer.
