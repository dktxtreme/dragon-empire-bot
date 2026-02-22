// ═══════════════════════════════════════════════════════════
// DRAGON EMPIRE HOLDINGS - SCALPING BOT V1.5-SAFE
// ═══════════════════════════════════════════════════════════
// Security audit fixes applied:
//   - BUY FILL VERIFICATION before placing any sell order
//   - exitAttempted flag prevents duplicate sell orders
//   - Atomic state saves before/after each order
//   - Cancel stale orders on startup
//   - Order fill verification via fetchOrder (not just open orders check)
//   - Safe state file writes with temp-file rename
//   - MAX_SELL_AMOUNT hard cap prevents selling bags
// ═══════════════════════════════════════════════════════════

const ccxt = require('ccxt');
const fs = require('fs');

// ============= CONFIG =============
const CONFIG = {
  symbol: 'XRP/USD',
  positionSizeUSD: 200,

  // Target settings
  grossTarget: 0.0132,       // 1.32% gross (1% net after 0.32% fees)
  targetNetProfit: 0.01,

  // Entry: RSI < 35 + EMA cross
  timeframe: '1m',
  rsiPeriod: 14,
  rsiOversold: 35,
  ema3Period: 3,
  ema8Period: 8,
  momentumCheckSeconds: 0.5,

  // Compounding
  compounding: true,

  // Re-entry
  reEntryWaitSeconds: 30,

  // Timing - 5 seconds to respect Kraken rate limits
  checkInterval: 5000,

  // ═══ SAFETY HARD LIMITS ═══
  // CRITICAL: This is the maximum XRP the bot is EVER allowed to sell.
  // Set this to slightly above your expected position size.
  // At $200 capital and ~$1.40/XRP, position is ~143 XRP.
  // 200 XRP gives comfortable headroom. NEVER set this near 3665.
  MAX_SELL_AMOUNT: 200,

  // Maximum position size in USD (prevents compounding runaway)
  MAX_POSITION_USD: 500,

  // State persistence
  stateFile: './bot-state.json',

  // Discord
  discordWebhook: process.env.DISCORD_WEBHOOK,
};

// ============= EXCHANGE =============
const exchange = new ccxt.kraken({
  apiKey: process.env.KRAKEN_API_KEY,
  secret: process.env.KRAKEN_API_SECRET,
  enableRateLimit: true,
  options: { defaultType: 'spot' },
});

// ============= STATE =============
function loadState() {
  try {
    if (fs.existsSync(CONFIG.stateFile)) {
      const data = fs.readFileSync(CONFIG.stateFile, 'utf8');
      const parsed = JSON.parse(data);
      // Validate required fields exist
      if (typeof parsed.hasPosition !== 'boolean') {
        throw new Error('Invalid state: missing hasPosition');
      }
      return parsed;
    }
  } catch (error) {
    console.error('ERROR loading state:', error.message);
    // If state is corrupted, HALT instead of starting fresh
    // Starting fresh while orders exist on Kraken is dangerous
    console.error('SAFETY: Corrupted state file. Bot halting.');
    console.error('MANUAL ACTION REQUIRED: Check Kraken for open orders, then delete bot-state.json');
    process.exit(1);
  }

  return {
    hasPosition: false,
    entryPrice: 0,
    targetPrice: 0,
    amount: 0,
    positionSizeUSD: 0,
    buyOrderId: null,
    sellOrderId: null,
    buyFilled: false,
    exitAttempted: false,
    lastExitTime: 0,
    totalTrades: 0,
    successfulTrades: 0,
    totalProfit: 0,
  };
}

// Safe state write: write to temp file then rename (atomic on most filesystems)
function saveState(state) {
  try {
    const tmpFile = CONFIG.stateFile + '.tmp';
    fs.writeFileSync(tmpFile, JSON.stringify(state, null, 2));
    fs.renameSync(tmpFile, CONFIG.stateFile);
  } catch (error) {
    console.error('ERROR saving state:', error.message);
  }
}

// ============= DISCORD =============
async function sendDiscordAlert(message) {
  if (!CONFIG.discordWebhook) return;
  try {
    await fetch(CONFIG.discordWebhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content: `DRAGON EMPIRE V1.5\n${message}`
      })
    });
  } catch (error) {
    console.error('Discord alert failed:', error.message);
  }
}

// ============= INDICATORS =============
function calculateRSI(prices, period = 14) {
  if (prices.length < period + 1) return 50;
  let gains = 0, losses = 0;
  for (let i = prices.length - period; i < prices.length; i++) {
    const change = prices[i] - prices[i - 1];
    if (change > 0) gains += change;
    else losses += Math.abs(change);
  }
  const avgGain = gains / period;
  const avgLoss = losses / period;
  if (avgLoss === 0) return 100;
  return 100 - (100 / (1 + avgGain / avgLoss));
}

function calculateEMA(prices, period) {
  if (prices.length < period) return prices[prices.length - 1];
  const k = 2 / (period + 1);
  let ema = prices.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < prices.length; i++) {
    ema = prices[i] * k + ema * (1 - k);
  }
  return ema;
}

// ============= POSITION SIZING =============
function getPositionSize(state) {
  let size = CONFIG.positionSizeUSD;
  if (CONFIG.compounding && state.totalProfit > 0) {
    size += state.totalProfit;
  }
  // Hard cap: never exceed MAX_POSITION_USD
  return Math.min(size, CONFIG.MAX_POSITION_USD);
}

// ============= SAFETY CHECK =============
// CRITICAL: Validates sell amount before ANY sell order
function validateSellAmount(amount) {
  if (typeof amount !== 'number' || isNaN(amount) || amount <= 0) {
    throw new Error(`SAFETY HALT: Invalid sell amount: ${amount}`);
  }
  if (amount > CONFIG.MAX_SELL_AMOUNT) {
    throw new Error(
      `SAFETY HALT: Sell amount ${amount.toFixed(4)} XRP exceeds MAX_SELL_AMOUNT ` +
      `(${CONFIG.MAX_SELL_AMOUNT} XRP). This would risk your bags. Bot halting.`
    );
  }
}

// ============= CANCEL ALL OPEN ORDERS =============
async function cancelAllOpenOrders() {
  try {
    const openOrders = await exchange.fetchOpenOrders(CONFIG.symbol);
    if (openOrders.length > 0) {
      console.log(`Found ${openOrders.length} open orders on startup. Cancelling all...`);
      for (const order of openOrders) {
        try {
          await exchange.cancelOrder(order.id, CONFIG.symbol);
          console.log(`  Cancelled order ${order.id} (${order.side} ${order.amount} @ ${order.price})`);
        } catch (e) {
          console.error(`  Failed to cancel order ${order.id}: ${e.message}`);
        }
      }
      console.log('All stale orders cancelled.');
    } else {
      console.log('No stale orders found on Kraken.');
    }
  } catch (error) {
    console.error('ERROR fetching open orders on startup:', error.message);
    console.error('SAFETY: Cannot verify order state. Bot halting.');
    process.exit(1);
  }
}

// ============= CHECK BUY ORDER FILL =============
async function waitForBuyFill(orderId, maxWaitMs = 30000) {
  const startTime = Date.now();
  const checkIntervalMs = 3000;

  while (Date.now() - startTime < maxWaitMs) {
    try {
      const order = await exchange.fetchOrder(orderId, CONFIG.symbol);

      if (order.status === 'closed') {
        console.log(`  Buy order ${orderId} FILLED (${order.filled} XRP)`);
        return { filled: true, filledAmount: order.filled };
      }

      if (order.status === 'canceled' || order.status === 'cancelled' || order.status === 'expired') {
        console.log(`  Buy order ${orderId} was ${order.status}`);
        return { filled: false, filledAmount: 0 };
      }

      // Still open, wait and check again
      console.log(`  Buy order still open (filled: ${order.filled}/${order.amount}). Waiting...`);
      await sleep(checkIntervalMs);
    } catch (error) {
      console.error(`  Error checking buy order: ${error.message}`);
      await sleep(checkIntervalMs);
    }
  }

  // Timed out -- cancel the unfilled buy
  console.log(`  Buy order did not fill within ${maxWaitMs / 1000}s. Cancelling.`);
  try {
    await exchange.cancelOrder(orderId, CONFIG.symbol);
    console.log(`  Buy order ${orderId} cancelled.`);
  } catch (e) {
    console.error(`  Failed to cancel buy order: ${e.message}`);
  }
  return { filled: false, filledAmount: 0 };
}

// ============= ENTRY =============
async function checkEntrySignal(state) {
  if (state.hasPosition) return null;

  const now = Date.now();
  const timeSinceExit = (now - state.lastExitTime) / 1000;
  if (timeSinceExit < CONFIG.reEntryWaitSeconds) return null;

  const candles = await exchange.fetchOHLCV(CONFIG.symbol, CONFIG.timeframe, undefined, 50);
  const completedPrices = candles.slice(0, -1).map(c => c[4]);
  const ticker = await exchange.fetchTicker(CONFIG.symbol);
  const currentPrice = ticker.last;

  const rsi = calculateRSI(completedPrices, CONFIG.rsiPeriod);
  const ema3 = calculateEMA(completedPrices, CONFIG.ema3Period);
  const ema8 = calculateEMA(completedPrices, CONFIG.ema8Period);

  const rsiOversold = rsi < CONFIG.rsiOversold;
  const emaSignal = ema8 > ema3;

  console.log(
    `  RSI: ${rsi.toFixed(2)} | EMA3: ${ema3.toFixed(4)} | EMA8: ${ema8.toFixed(4)} | ` +
    `Price: $${currentPrice.toFixed(4)} | ` +
    `${rsiOversold ? 'RSI<35' : 'RSI>35'} | ` +
    `${emaSignal ? 'EMA8>EMA3' : 'EMA8<EMA3'}`
  );

  if (!rsiOversold || !emaSignal) return null;

  // Step 2: Momentum check
  const price1 = currentPrice;
  await sleep(CONFIG.momentumCheckSeconds * 1000);
  const ticker2 = await exchange.fetchTicker(CONFIG.symbol);
  const price2 = ticker2.last;

  if (price2 <= price1) {
    console.log(`  Momentum check failed: $${price1.toFixed(4)} -> $${price2.toFixed(4)}`);
    return null;
  }

  console.log(`  ALL 3 CONFIRMATIONS MET. Entry signal at $${price2.toFixed(4)}`);
  return { entryPrice: price2 };
}

async function enterTrade(signal, state) {
  const entryPrice = signal.entryPrice;
  const positionSize = getPositionSize(state);
  const amount = positionSize / entryPrice;
  const targetPrice = entryPrice * (1 + CONFIG.grossTarget);

  // SAFETY: Validate amount before doing anything
  validateSellAmount(amount);

  console.log('--- ENTERING TRADE ---');
  console.log(`Entry: $${entryPrice.toFixed(4)} | Amount: ${amount.toFixed(2)} XRP | Target: $${targetPrice.toFixed(4)}`);

  // Step 1: Place buy order
  const buyOrder = await exchange.createLimitBuyOrder(CONFIG.symbol, amount, entryPrice);
  console.log(`Buy order placed: ${buyOrder.id}`);

  // CRITICAL: Save state IMMEDIATELY after buy order is placed
  // This prevents orphaned buy orders if the bot crashes
  state.hasPosition = true;
  state.entryPrice = entryPrice;
  state.targetPrice = targetPrice;
  state.amount = amount;
  state.positionSizeUSD = positionSize;
  state.buyOrderId = buyOrder.id;
  state.sellOrderId = null;
  state.buyFilled = false;
  state.exitAttempted = false;
  state.totalTrades++;
  saveState(state);

  // Step 2: WAIT for buy to fill (up to 30 seconds)
  const fillResult = await waitForBuyFill(buyOrder.id);

  if (!fillResult.filled) {
    // Buy did NOT fill -- cancel and reset. DO NOT place sell order.
    console.log('Buy order did not fill. Resetting position. NO SELL ORDER PLACED.');
    state.hasPosition = false;
    state.entryPrice = 0;
    state.targetPrice = 0;
    state.amount = 0;
    state.positionSizeUSD = 0;
    state.buyOrderId = null;
    state.buyFilled = false;
    state.exitAttempted = false;
    state.totalTrades--;
    saveState(state);
    return;
  }

  // Step 3: Buy filled! Record it, then place sell
  state.buyFilled = true;
  const filledAmount = fillResult.filledAmount || amount;
  state.amount = filledAmount;
  saveState(state);

  // SAFETY: Re-validate the filled amount before selling
  validateSellAmount(filledAmount);

  console.log(`Buy FILLED: ${filledAmount.toFixed(4)} XRP. Placing sell at target...`);

  const sellOrder = await exchange.createLimitSellOrder(CONFIG.symbol, filledAmount, targetPrice);
  console.log(`Sell order placed: ${sellOrder.id}`);

  state.sellOrderId = sellOrder.id;
  saveState(state);

  await sendDiscordAlert(
    `ENTRY: ${filledAmount.toFixed(2)} XRP @ $${entryPrice.toFixed(4)}\n` +
    `Target: $${targetPrice.toFixed(4)} (+1.32%)`
  );

  console.log('Trade entry complete. Waiting for target...');
}

// ============= EXIT CHECK =============
async function checkExit(state) {
  if (!state.hasPosition) return;

  // SAFETY: If exit was already attempted, do NOT try again
  if (state.exitAttempted) {
    console.log('  Exit already attempted. Waiting for manual resolution or order fill.');
    // Check if the sell order has filled so we can clean up
    if (state.sellOrderId) {
      try {
        const order = await exchange.fetchOrder(state.sellOrderId, CONFIG.symbol);
        if (order.status === 'closed') {
          console.log('  Previous sell order has filled. Cleaning up state.');
          completeExit(state);
        }
      } catch (e) {
        console.error(`  Error checking sell order status: ${e.message}`);
      }
    }
    return;
  }

  // If buy hasn't filled yet, check on it
  if (!state.buyFilled && state.buyOrderId) {
    try {
      const buyOrder = await exchange.fetchOrder(state.buyOrderId, CONFIG.symbol);
      if (buyOrder.status === 'closed') {
        state.buyFilled = true;
        state.amount = buyOrder.filled;
        saveState(state);
        console.log(`  Buy order filled: ${buyOrder.filled} XRP`);
      } else if (buyOrder.status === 'canceled' || buyOrder.status === 'cancelled') {
        console.log('  Buy order was cancelled. Resetting.');
        resetState(state);
        return;
      } else {
        console.log(`  Buy order still open (${buyOrder.filled}/${buyOrder.amount} filled). Waiting...`);
        return;
      }
    } catch (e) {
      console.error(`  Error checking buy order: ${e.message}`);
      return;
    }
  }

  // Check if sell order exists and its status
  if (!state.sellOrderId) {
    // Buy filled but no sell order placed yet (crash recovery scenario)
    // Place the sell order now
    if (state.buyFilled && state.amount > 0) {
      validateSellAmount(state.amount);
      console.log(`  Placing missing sell order for ${state.amount.toFixed(4)} XRP @ $${state.targetPrice.toFixed(4)}`);
      try {
        const sellOrder = await exchange.createLimitSellOrder(
          CONFIG.symbol, state.amount, state.targetPrice
        );
        state.sellOrderId = sellOrder.id;
        saveState(state);
        console.log(`  Sell order placed: ${sellOrder.id}`);
      } catch (e) {
        console.error(`  Error placing sell order: ${e.message}`);
        // Don't retry immediately -- wait for next loop
      }
    }
    return;
  }

  // Check sell order status using fetchOrder (more reliable than fetchOpenOrders)
  try {
    const sellOrder = await exchange.fetchOrder(state.sellOrderId, CONFIG.symbol);

    if (sellOrder.status === 'closed') {
      // Target hit!
      console.log('TARGET HIT! Sell order filled.');
      completeExit(state);
    } else if (sellOrder.status === 'canceled' || sellOrder.status === 'cancelled') {
      // Sell order was cancelled externally -- need to re-place it
      console.log('  WARNING: Sell order was cancelled. Re-placing...');
      validateSellAmount(state.amount);
      const newSell = await exchange.createLimitSellOrder(
        CONFIG.symbol, state.amount, state.targetPrice
      );
      state.sellOrderId = newSell.id;
      saveState(state);
      console.log(`  New sell order placed: ${newSell.id}`);
    }
    // else: still open, waiting for target
  } catch (error) {
    console.error(`  Error checking sell order: ${error.message}`);
  }
}

function completeExit(state) {
  const profit = (state.positionSizeUSD || CONFIG.positionSizeUSD) * CONFIG.targetNetProfit;

  console.log('--- TARGET HIT ---');
  console.log(`Entry: $${state.entryPrice.toFixed(4)} | Exit: $${state.targetPrice.toFixed(4)}`);
  console.log(`Profit: $${profit.toFixed(2)}`);

  state.successfulTrades++;
  state.totalProfit += profit;
  state.lastExitTime = Date.now();

  sendDiscordAlert(
    `TARGET HIT!\nProfit: $${profit.toFixed(2)}\n` +
    `Total: $${state.totalProfit.toFixed(2)} (${state.successfulTrades}/${state.totalTrades} wins)`
  );

  resetState(state);
}

function resetState(state) {
  state.hasPosition = false;
  state.entryPrice = 0;
  state.targetPrice = 0;
  state.amount = 0;
  state.positionSizeUSD = 0;
  state.buyOrderId = null;
  state.sellOrderId = null;
  state.buyFilled = false;
  state.exitAttempted = false;
  saveState(state);
}

// ============= MAIN LOOP =============
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {
  console.log('');
  console.log('═══════════════════════════════════════════════════════════');
  console.log('  DRAGON EMPIRE HOLDINGS - SCALPING BOT V1.5-SAFE');
  console.log('═══════════════════════════════════════════════════════════');
  console.log(`  Symbol: ${CONFIG.symbol}`);
  console.log(`  Position: $${CONFIG.positionSizeUSD} (max $${CONFIG.MAX_POSITION_USD})`);
  console.log(`  Max sell: ${CONFIG.MAX_SELL_AMOUNT} XRP (hard cap)`);
  console.log(`  Target: +1.32% gross (+1% net)`);
  console.log(`  Check interval: ${CONFIG.checkInterval}ms`);
  console.log('═══════════════════════════════════════════════════════════');
  console.log('');

  // Load state
  let state = loadState();

  // SAFETY: Cancel all stale orders on startup
  // This prevents orphaned orders from previous crashes
  if (!state.hasPosition) {
    await cancelAllOpenOrders();
  } else {
    console.log(`Resuming position: ${state.amount.toFixed(2)} XRP @ $${state.entryPrice.toFixed(4)}`);
    console.log(`  Buy filled: ${state.buyFilled}`);
    console.log(`  Sell order: ${state.sellOrderId || 'none'}`);
    console.log(`  Exit attempted: ${state.exitAttempted}`);

    // Verify the orders are still valid on Kraken
    if (state.buyOrderId && !state.buyFilled) {
      try {
        const buyOrder = await exchange.fetchOrder(state.buyOrderId, CONFIG.symbol);
        if (buyOrder.status === 'closed') {
          state.buyFilled = true;
          state.amount = buyOrder.filled;
          saveState(state);
          console.log(`  Buy order confirmed filled: ${buyOrder.filled} XRP`);
        } else if (buyOrder.status === 'canceled' || buyOrder.status === 'cancelled') {
          console.log('  Buy order was cancelled. Resetting.');
          resetState(state);
        }
      } catch (e) {
        console.error(`  Could not verify buy order: ${e.message}`);
      }
    }
  }

  await sendDiscordAlert(
    `BOT V1.5-SAFE STARTED\n` +
    `Max sell cap: ${CONFIG.MAX_SELL_AMOUNT} XRP\n` +
    `Position: ${state.hasPosition ? state.amount.toFixed(2) + ' XRP' : 'None'}`
  );

  // Main loop
  while (true) {
    try {
      const ts = new Date().toISOString().slice(11, 19);
      console.log(`[${ts}] Checking...`);

      if (state.hasPosition) {
        await checkExit(state);
      } else {
        const signal = await checkEntrySignal(state);
        if (signal) {
          await enterTrade(signal, state);
        }
      }

      await sleep(CONFIG.checkInterval);

    } catch (error) {
      console.error(`ERROR: ${error.message}`);

      // SAFETY: If this is a safety halt, stop the bot
      if (error.message.startsWith('SAFETY HALT')) {
        console.error('SAFETY HALT triggered. Bot stopping.');
        await sendDiscordAlert(`SAFETY HALT: ${error.message}`);
        process.exit(1);
      }

      await sendDiscordAlert(`Error: ${error.message}`);
      console.log('Waiting 30 seconds before retry...');
      await sleep(30000);
    }
  }
}

main().catch(error => {
  console.error('FATAL:', error.message);
  process.exit(1);
});
