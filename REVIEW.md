# Code Review: scalping-bot.js (V1.3.3)

## Critical Issues

### 1. API credentials use wrong environment variable names

The exchange setup uses `CLAUDE_API_KEY` and `CLAUDE_PASS`:

```js
const exchange = new ccxt.kraken({
  apiKey: process.env.CLAUDE_API_KEY,
  secret: process.env.CLAUDE_PASS,
```

But `.env.example` documents `KRAKEN_API_KEY` and `KRAKEN_API_SECRET`. Anyone following the `.env.example` will get authentication failures. Should be:

```js
apiKey: process.env.KRAKEN_API_KEY,
secret: process.env.KRAKEN_API_SECRET,
```

### 2. Missing dependencies in package.json

The code requires `dotenv` and `express` but `package.json` only lists `ccxt` as a dependency. The bot will crash on startup with `MODULE_NOT_FOUND`. Add:

```json
"dependencies": {
  "ccxt": "^4.2.25",
  "dotenv": "^16.3.1",
  "express": "^4.18.2"
}
```

### 3. No stop-loss protection

There is no downside protection. The "floor" mechanism only activates *above* the entry price (entry + 1.32%). If the price drops significantly after entry, the bot holds indefinitely. Consider adding a configurable stop-loss (e.g., -2% to -5% from entry) to cap worst-case losses.

### 4. Limit orders may never fill

Both entry and exit use `createLimitBuyOrder` / `createLimitSellOrder` with `postOnly: true` at the *current* price. In a fast-moving market:
- The buy order may be stale by the time it reaches the exchange and will be rejected (postOnly rejects if it would cross the spread).
- The sell order at the trail-stop trigger price is likely already below the current bid — it may sit unfilled or get rejected.

The bot updates state as if the order filled immediately but never checks fill status. This means `state.totalProfit` can be wrong, and the bot may think it has/doesn't have a position when the opposite is true. Either:
- Use market orders (accept taker fees), or
- Poll order status until filled/cancelled, then update state accordingly.

### 5. `exitAttempted` flag creates a stuck state

If the sell order fails, `exitAttempted` is set to `true` and the bot prints "waiting for manual intervention" forever. There's no automated recovery path. Consider:
- A Discord alert with a "clear" command
- A time-based reset (e.g., after 10 minutes, retry exit once more)
- At minimum, a way to reset the flag without restarting the process

---

## Moderate Issues

### 6. Order fill assumption — state corruption risk

`enterTrade()` sets `state.hasPosition = true` immediately after placing the limit order. A limit order isn't a fill — it's a resting order on the book. If the price moves away, the order never fills, yet the bot is now in "monitor position" mode, watching a position that doesn't exist. Same issue on exit. This is the single most likely source of real-money bugs.

### 7. `fetch()` used without import (Node < 18 compatibility)

`sendDiscordAlert` uses the global `fetch()` API, only available in Node.js 18+. No Node version is specified in `package.json` (`engines` field). If deployed on Node 16, Discord alerts silently fail. Add:

```json
"engines": { "node": ">=18.0.0" }
```

### 8. EMA condition naming is misleading

Step 3 comment says "reversal structure" but the condition `ema8 > ema3` confirms a *downtrend* (slow EMA above fast EMA). The bot enters during a downtrend with upward momentum. The naming should be clarified to avoid confusion.

### 9. Compounding on unrealized/unverified profit

`getPositionSize()` adds `state.totalProfit` to the base position. But `totalProfit` is accumulated from the *assumed* fill price of limit orders, not actual fills. Over time, this number can diverge from reality, inflating position sizes.

### 10. Race condition in entry signal

`checkEntrySignal` makes 4 API calls across ~1-2 seconds. Between the first and last call, market conditions can change substantially. The price used for the order (`price2`) could be stale by the time `enterTrade` places the order.

---

## Minor Issues

### 11. No graceful shutdown

No SIGTERM handler. On Railway container restarts, pending orders and state may be in an inconsistent state. Add a `process.on('SIGTERM', ...)` handler.

### 12. Redundant restart logic

The in-process `setTimeout` restart conflicts with Railway's `restartPolicyType: "ON_FAILURE"`. If the second `main()` also throws, it's silently swallowed. Let the process crash and let Railway handle restarts.

### 13. State file is local (ephemeral on Railway)

`bot-state.json` is written to the local filesystem. On Railway, the filesystem is ephemeral — redeployments wipe it. Consider using Railway's persistent volume or an external store.

### 14. 500ms polling interval is aggressive

~120 API calls/minute (more during entry checks). Kraken's rate limits could be hit. For a strategy targeting 1.32%+ moves, a 2-5 second interval would be adequate and safer.

### 15. `postOnly` param compatibility

The `postOnly` flag behavior depends on the ccxt version. Verify this works with ccxt ^4.2.25 — if silently ignored, you're paying taker fees without knowing it.

---

## Summary

| Priority | Issue | Impact |
|----------|-------|--------|
| Critical | Wrong env var names for API keys | Bot won't authenticate |
| Critical | Missing `dotenv` and `express` in package.json | Crash on startup |
| Critical | No order fill verification | State corruption, phantom positions |
| Critical | No stop-loss | Unbounded downside risk |
| High | Limit orders at stale prices likely rejected | Missed entries/exits |
| High | `exitAttempted` creates permanent stuck state | Bot becomes inert |
| Medium | Compounding on unverified profit | Inflated position sizes |
| Medium | No `engines` field for Node 18+ requirement | Silent failures |
| Low | Ephemeral filesystem on Railway | State lost on redeploy |
| Low | Aggressive polling interval | Rate limit risk |

The bot's core logic (RSI + momentum + EMA confirmation) is reasonable for a scalping strategy. The biggest risk is the gap between "order placed" and "order filled" — the bot treats these as the same event. Fixing order fill verification and the environment variable mismatch should be the top priorities.
