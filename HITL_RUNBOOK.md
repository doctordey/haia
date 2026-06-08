# HITL Setup & Acceptance Runbook

Step-by-step to bring the human-in-the-loop (HITL) executor online on a **demo**
account, validate it, and only then consider live. Nothing runs until
`HITL_ENABLED=true`, and it refuses non-demo accounts until `HITL_ALLOW_LIVE=true`.

---

## 1. Create the Telegram bot

1. Message **@BotFather** → `/newbot` → follow prompts.
2. Copy the token → `HITL_TELEGRAM_BOT_TOKEN`.
3. **Send your new bot any message once** (so it's allowed to DM you).

## 2. Get your Telegram ids

1. Message **@userinfobot** (or @RawDataBot) → it replies with your numeric id.
2. That number is both:
   - `AUTHORIZED_TELEGRAM_USER_IDS` (only these ids can approve), and
   - `HITL_OPERATOR_CHAT_ID` (where prompts are sent — for a 1:1 DM with the bot
     it's the same number).

## 3. Generate the webhook secret

```
openssl rand -hex 16
```
→ `HITL_WEBHOOK_SECRET`.

## 4. Connect a demo account

- In Haia → **Connect Account**, add a broker **demo** MT4/MT5 account.
- It must be a **trading** login (not investor/read-only) or HITL can't be armed.
- A demo account = practice account on the broker's *demo server* (fake money).

## 5. Set environment variables (Railway) and redeploy

Required:
```
HITL_ENABLED=true
HITL_ALLOW_LIVE=false                 # keep false until acceptance passes
HITL_TELEGRAM_BOT_TOKEN=...
AUTHORIZED_TELEGRAM_USER_IDS=123456789
HITL_OPERATOR_CHAT_ID=123456789
HITL_WEBHOOK_SECRET=...
```
Optional symbol map (only symbols that differ from the broker):
```
HITL_SYMBOL_MAP=UK10YBGBP:UKGILT
```
Everything else (`SL_FROM=range_size`, `POSITION_MODEL=two_position`,
`BE_TRIGGER=both`, risk %, timeouts…) has locked defaults — leave unless you
mean to change a decision. `METAAPI_TOKEN` is already set.

The worker validates these on boot and refuses to start HITL if any required
one is missing or invalid.

## 6. Arm the account

Settings → your demo account → **Enable HITL** (a HITL badge appears). This is
the deliberate opt-in; connecting an account never auto-arms it.

## 7. Point TradingView at the webhook

- On the Unicorn alert, set the webhook URL to:
  ```
  https://<your-domain>/haia/hitl/tv-alert?secret=<HITL_WEBHOOK_SECRET>
  ```
- Leave the alert **message** as the indicator's default text (the
  `Activated …` / `Target Reached …` strings). One alert covers both — no JSON
  needed.

## 8. Dry-run the dialog (demo)

1. Trigger (or wait for) an **Activated** alert.
2. The bot DMs you: `🔔 HITL alert: <SYMBOL> @ <price>` and asks for the range.
3. Reply with two numbers — the **high and low** of the range (e.g. `50820 50760`).
4. The bot replies with a **confirm card**: direction, entry, SL, R, TP1/2/3,
   total lots, and the two legs (Leg A → TP2, Leg B → TP3).
5. Tap **✅ Approve** → it opens the two legs on the demo account.
   (Tap **❌ Reject** to discard.)
6. When the **Target Reached** alert for that symbol/direction fires (or price
   reaches TP1), both stops move to **breakeven** — you'll get a confirmation.
7. As price hits TP2 then TP3 the legs close; you get a **closed + P/L** message.

---

## §7 acceptance checklist (run on demo before going live)

- [ ] Activation → prompt → range reply → confirm card shows **real lots**.
- [ ] Approve → two legs open on the demo account with correct SL and TP2/TP3.
- [ ] Breakeven fires **once** when Target-Reached arrives **and** when it's
      suppressed but price reaches TP1 (the internal backstop).
- [ ] Legs close at TP2/TP3 → session goes CLOSED with P/L reported.
- [ ] Send the same Activation 5× → only one trade (dedupe + cooldown +
      pre-fill block); send Target-Reached 5× → BE applied once.
- [ ] A non-authorized Telegram user is ignored (and logged).
- [ ] Reject and timeout paths behave (REJECTED / EXPIRED, no orders).
- [ ] Symbol mapping resolves correctly (e.g. UK10YBGBP → UKGILT) — order lands
      on the right broker symbol.

When all boxes are checked on demo, set `HITL_ALLOW_LIVE=true` and enable HITL on
a live trading account to go live.

---

## Notes / things to verify on the demo

- **SDK field names** (isolated in `src/lib/hitl/metaapi.ts`): the symbol-spec
  fields (`tickValue` fallback) and the order `clientId` option — confirm these
  on the first real order; everything depending on them is unit-tested.
- **Demo detection** is by server name matching `/demo/i`. If your demo server
  isn't named that way, HITL will (safely) refuse it — tell me and I'll switch
  to an explicit per-account flag.
- **One account at a time**: if several accounts are HITL-enabled, the first
  armed one is targeted (with a warning logged). Multi-account fan-out is a
  follow-up if you want it.

## Troubleshooting

- *Bot never DMs you* → you didn't message the bot first (step 1.3), or the
  user id / chat id is wrong, or `HITL_ENABLED` isn't exactly `true`.
- *Alerts rejected silently* → the webhook always returns HTTP 200; check the
  worker logs for the reason (`unauthorized`, `cooldown`, `prefill_active`,
  `unparseable`).
- *"No HITL-enabled account is armed"* on the confirm step → enable HITL on the
  account in Settings, and make sure the worker has connected it (give it ~30s).
- *"live account blocked"* → expected until `HITL_ALLOW_LIVE=true`.
