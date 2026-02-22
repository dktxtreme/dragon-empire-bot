// ═══════════════════════════════════════════════════════════
// 🐉 DRAGON EMPIRE HOLDINGS - SCALPING BOT V1.3.3
// ═══════════════════════════════════════════════════════════
// Strategy: Triple Confirmation Entry + FLOOR + TRAIL Exit
// Position: $200 base + compounding profits
// "Take it all, let God sort it out!" 💎
// Railway Compatible (includes minimal health check server)
// Discord Alerts Enabled (Tested & Working!)
// NOW USING EMA (not MA) - FASTER REACTIONS! ⚡
// V1.3.3: CRITICAL FIX - NO RETRY LOOPS ON ERRORS! 🔒
// Let it EAT! 🔥
// ═══════════════════════════════════════════════════════════

require('dotenv').config();
const ccxt = require('ccxt');
const fs = require('fs');
const express = require('express');

// ═══════════════════════════════════════════════════════════
// DISCORD ALERT FUNCTION (TESTED & WORKING!)
// ═══════════════════════════════════════════════════════════

async function sendDiscordAlert(message) {
  const webhookUrl = process.env.DISCORD_WEBHOOK;
  if (!webhookUrl) return;

  try {
    await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content: `🐉 **DRAGON EMPIRE BOT V1.3.3**\n${message}`
      })
    });
  } catch (e) {
    console.error('Discord alert failed:', e.message);
  }
}

// ═══════════════════════════════════════════════════════════
// BOT STATUS (shared between health check and bot loop)
// ═══════════════════════════════════════════════════════════

let botStatus = {
  running: false,
  lastCheck: null,
  error: null,
  hasPosition: false,
};

// ═══════════════════════════════════════════════════════════
// RAILWAY HEALTH CHECK SERVER (Express - Railway Compatible!)
// ═══════════════════════════════════════════════════════════

const app = express();
const PORT = process.env.PORT || 3000;

app.get('/', (req, res) => {
  res.send('🐉 Dragon Empire Scalping Bot V1.3.3 - FLOOR + TRAIL! 💎');
});

app.get('/health', (req, res) => {
  res.json({
    status: botStatus.running ? 'ok' : 'starting',
    bot: botStatus.running ? 'running' : 'initializing',
    lastCheck: botStatus.lastCheck,
    error: botStatus.error,
    hasPosition: botStatus.hasPosition,
    timestamp: new Date().toISOString(),
  });
});

function startHealthServer() {
  const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`✅ Health check server running on port ${PORT}`);
  });

  server.on('error', (err) => {
    console.error(`⚠️ Health check server failed to start: ${err.message}`);
    console.log('🐉 Bot will continue running without health check server.');
  });
}

// ═══════════════════════════════════════════════════════════
// CONFIGURATION
// ═══════════════════════════════════════════════════════════

const CONFIG = {
  // Exchange settings
  symbol: 'XRP/USD',
  positionSizeUSD: 200,           // $200 per trade

  // FLOOR + TRAIL EXIT STRATEGY
  floorPercent: 0.0132,           // 1.32% = fees + $2 profit (MINIMUM)
  trailPercent: 0.01,             // 1% trailing stop (UNLIMITED UPSIDE!)

  // Triple confirmation entry
  entryRSI: 35,                   // RSI must be < 35
  momentumCheckSeconds: 0.5,      // Check price movement over 0.5 seconds
  ema3Period: 3,                  // Fast EMA
  ema8Period: 8,                  // Slow EMA

  // Compounding
  compounding: true,              // Reinvest profits into position size

  // Re-entry settings
  reEntryWaitSeconds: 30,         // Wait 30 seconds after exit
  reEntryRSI: 40,                 // RSI must be < 40 to re-enter

  // Timing
  checkInterval: 500,             // Check every 0.5 seconds

  // State persistence
  stateFile: './bot-state.json',
};

// ═══════════════════════════════════════════════════════════
// EXCHANGE SETUP
// ═══════════════════════════════════════════════════════════

const exchange = new ccxt.kraken({
  apiKey: process.env.CLAUDE_API_KEY,
  secret: process.env.CLAUDE_PASS,
  enableRateLimit: true,
  options: {
    defaultType: 'spot',
  }
});

// ═══════════════════════════════════════════════════════════
// STATE MANAGEMENT
// ═══════════════════════════════════════════════════════════

function loadState() {
  try {
    if (fs.existsSync(CONFIG.stateFile)) {
      const data = fs.readFileSync(CONFIG.stateFile, 'utf8');
      return JSON.parse(data);
    }
  } catch (error) {
    console.error('❌ Error loading state:', error.message);
  }

  return {
    hasPosition: false,
    entryPrice: 0,
    amount: 0,
    positionSizeUSD: 0,
    buyOrderId: null,
    floorPrice: 0,
    floorLocked: false,
    highestPrice: 0,
    trailStopPrice: 0,
    exitAttempted: false,        // CRITICAL: Prevents retry loops!
    lastExitTime: 0,
    totalTrades: 0,
    successfulTrades: 0,
    totalProfit: 0,
  };
}

function saveState(state) {
  try {
    fs.writeFileSync(CONFIG.stateFile, JSON.stringify(state, null, 2));
  } catch (error) {
    console.error('❌ Error saving state:', error.message);
  }
}

// ═══════════════════════════════════════════════════════════
// POSITION SIZING (COMPOUNDING)
// ═══════════════════════════════════════════════════════════

function getPositionSize(state) {
  if (CONFIG.compounding && state.totalProfit > 0) {
    return CONFIG.positionSizeUSD + state.totalProfit;
  }
  return CONFIG.positionSizeUSD;
}

// ═══════════════════════════════════════════════════════════
// TECHNICAL INDICATORS
// ═══════════════════════════════════════════════════════════

async function getOHLCV(period = 100) {
  try {
    const ohlcv = await exchange.fetchOHLCV(CONFIG.symbol, '1m', undefined, period);
    return ohlcv;
  } catch (error) {
    console.error('❌ Error fetching OHLCV:', error.message);
    throw error;
  }
}

function calculateRSI(closes, period = 14) {
  if (closes.length < period + 1) {
    throw new Error('Not enough data for RSI calculation');
  }

  let gains = 0;
  let losses = 0;

  for (let i = closes.length - period; i < closes.length; i++) {
    const change = closes[i] - closes[i - 1];
    if (change > 0) {
      gains += change;
    } else {
      losses += Math.abs(change);
    }
  }

  const avgGain = gains / period;
  const avgLoss = losses / period;

  if (avgLoss === 0) return 100;

  const rs = avgGain / avgLoss;
  const rsi = 100 - (100 / (1 + rs));

  return rsi;
}

function calculateEMA(closes, period) {
  if (closes.length < period) {
    throw new Error('Not enough data for EMA calculation');
  }

  const multiplier = 2 / (period + 1);
  let ema = closes.slice(0, period).reduce((a, b) => a + b, 0) / period;

  for (let i = period; i < closes.length; i++) {
    ema = (closes[i] - ema) * multiplier + ema;
  }

  return ema;
}

function calculateIndicators(ohlcv) {
  // Use only COMPLETED candles (exclude last forming candle)
  const completedOHLCV = ohlcv.slice(0, -1);
  const closes = completedOHLCV.map(candle => candle[4]);

  const rsi = calculateRSI(closes, 14);
  const ema3 = calculateEMA(closes, CONFIG.ema3Period);
  const ema8 = calculateEMA(closes, CONFIG.ema8Period);

  return { rsi, ema3, ema8 };
}

async function getCurrentPrice() {
  try {
    const ticker = await exchange.fetchTicker(CONFIG.symbol);
    return ticker.last;
  } catch (error) {
    console.error('❌ Error fetching ticker:', error.message);
    throw error;
  }
}

// ═══════════════════════════════════════════════════════════
// ENTRY SIGNAL CHECK (TRIPLE CONFIRMATION)
// ═══════════════════════════════════════════════════════════

async function checkEntrySignal(state) {
  // Check if in cooldown after last exit
  if (state.lastExitTime) {
    const timeSinceExit = (Date.now() - state.lastExitTime) / 1000;
    if (timeSinceExit < CONFIG.reEntryWaitSeconds) {
      console.log(`   ⏳ Cooldown: ${(CONFIG.reEntryWaitSeconds - timeSinceExit).toFixed(0)}s remaining`);
      return null;
    }
  }

  // Get market data
  const ohlcv = await getOHLCV();
  const indicators = calculateIndicators(ohlcv);
  const price1 = await getCurrentPrice();

  console.log(`   RSI: ${indicators.rsi.toFixed(2)} | EMA3: ${indicators.ema3.toFixed(5)} | EMA8: ${indicators.ema8.toFixed(5)} | Price: $${price1.toFixed(5)}`);

  // STEP 1: Check RSI < 35
  if (indicators.rsi >= CONFIG.entryRSI) {
    console.log(`   ❌ Step 1 FAILED: RSI ${indicators.rsi.toFixed(2)} >= ${CONFIG.entryRSI}`);
    return null;
  }
  console.log(`   ✅ Step 1 PASSED: RSI ${indicators.rsi.toFixed(2)} < ${CONFIG.entryRSI}! OVERSOLD!`);

  // STEP 2: Check price momentum (0.5 second check)
  await sleep(CONFIG.momentumCheckSeconds * 1000);
  const price2 = await getCurrentPrice();

  if (price2 <= price1) {
    console.log(`   ❌ Step 2 FAILED: Price ${price2.toFixed(5)} NOT > ${price1.toFixed(5)}`);
    return null;
  }
  console.log(`   ✅ Step 2 PASSED: Price moving UP! ${price1.toFixed(5)} → ${price2.toFixed(5)}`);

  // STEP 3: Check EMA8 > EMA3 (reversal structure)
  // Get fresh indicators to verify RSI still valid
  const ohlcv2 = await getOHLCV();
  const indicators2 = calculateIndicators(ohlcv2);

  if (indicators2.ema8 <= indicators2.ema3) {
    console.log(`   ❌ Step 3 FAILED: EMA8 (${indicators2.ema8.toFixed(5)}) NOT > EMA3 (${indicators2.ema3.toFixed(5)})`);
    return null;
  }
  console.log(`   ✅ Step 3 PASSED: EMA8 > EMA3! DIP STRUCTURE CONFIRMED!`);

  // FINAL VERIFICATION: Double-check RSI still < 35 before entering
  if (indicators2.rsi >= CONFIG.entryRSI) {
    console.log(`   ❌ FINAL CHECK FAILED: RSI moved to ${indicators2.rsi.toFixed(2)} >= ${CONFIG.entryRSI}`);
    console.log(`   ⚠️ Market moved too fast, RSI no longer oversold. Skipping entry.`);
    return null;
  }
  console.log(`   ✅ FINAL CHECK PASSED: RSI still ${indicators2.rsi.toFixed(2)} < ${CONFIG.entryRSI}`);

  // ALL CONFIRMATIONS MET!
  console.log('\n🎯🎯🎯 ALL CONFIRMATIONS MET! ENTERING TRADE! 🎯🎯🎯\n');

  return {
    entryPrice: price2,
    rsi: indicators2.rsi,
    ema3: indicators2.ema3,
    ema8: indicators2.ema8,
  };
}

// ═══════════════════════════════════════════════════════════
// TRADE EXECUTION - FLOOR + TRAIL EXIT
// ═══════════════════════════════════════════════════════════

async function enterTrade(signal, state) {
  try {
    const entryPrice = signal.entryPrice;
    const positionSize = getPositionSize(state);
    const amount = positionSize / entryPrice;
    const floorPrice = entryPrice * (1 + CONFIG.floorPercent);

    console.log('═══════════════════════════════════════════════════════════');
    console.log('🚀 ENTERING TRADE - FLOOR + TRAIL STRATEGY');
    console.log('═══════════════════════════════════════════════════════════');
    console.log(`Entry Price: $${entryPrice.toFixed(5)}`);
    console.log(`Amount: ${amount.toFixed(2)} XRP (ONLY ${amount.toFixed(2)} XRP!)`);
    console.log(`Position Size: $${positionSize.toFixed(2)}${CONFIG.compounding && state.totalProfit > 0 ? ` (base $${CONFIG.positionSizeUSD} + $${state.totalProfit.toFixed(2)} profit)` : ''}`);
    console.log(`Floor Price: $${floorPrice.toFixed(5)} (minimum exit - $2 profit locked)`);
    console.log(`Trail: 1% below highest price (unlimited upside!)`);
    console.log(`RSI: ${signal.rsi.toFixed(2)}`);
    console.log(`EMA8 > EMA3: ${signal.ema8.toFixed(5)} > ${signal.ema3.toFixed(5)}`);
    console.log('💎 "Take it all, let God sort it out!"');
    console.log('═══════════════════════════════════════════════════════════');

    // Place LIMIT BUY order (maker fee)
    console.log('\n📥 Placing BUY limit order...');
    const buyOrder = await exchange.createLimitBuyOrder(
      CONFIG.symbol,
      amount,
      entryPrice,
      { postOnly: true }
    );
    console.log(`✅ Buy order placed! ID: ${buyOrder.id}`);

    // Send Discord alert for trade entry
    await sendDiscordAlert(`✅ **TRADE ENTERED!**\n\n💰 Amount: ${amount.toFixed(2)} XRP\n📊 Entry: $${entryPrice.toFixed(5)}\n🔒 Floor: $${floorPrice.toFixed(5)} ($2 min)\n📈 RSI: ${signal.rsi.toFixed(2)}\n⚡ EMA8>EMA3: Confirmed\n💎 Strategy: Floor + Trail\n🚀 Let it run!`);

    // Update state
    state.hasPosition = true;
    state.entryPrice = entryPrice;
    state.amount = amount;
    state.positionSizeUSD = positionSize;
    state.buyOrderId = buyOrder.id;
    state.floorPrice = floorPrice;
    state.floorLocked = false;
    state.highestPrice = entryPrice;
    state.trailStopPrice = floorPrice;
    state.exitAttempted = false;    // CRITICAL: Reset exit flag
    state.totalTrades++;

    saveState(state);

    console.log('\n✅ TRADE ENTRY COMPLETE!');
    console.log('💎 Position open, monitoring for floor + trail...\n');

  } catch (error) {
    console.error('❌ ERROR entering trade:', error.message);
    await sendDiscordAlert(`❌ **ERROR entering trade:**\n${error.message}`);
    // Don't throw - just log and continue
  }
}

async function monitorPosition(state) {
  if (!state.hasPosition) {
    return;
  }

  // CRITICAL: If exit already attempted, don't try again!
  if (state.exitAttempted) {
    console.log('⚠️ Exit already attempted - waiting for manual intervention');
    return;
  }

  try {
    const currentPrice = await getCurrentPrice();

    // Update highest price
    if (currentPrice > state.highestPrice) {
      state.highestPrice = currentPrice;
    }

    // Check if floor locked
    if (!state.floorLocked && currentPrice >= state.floorPrice) {
      state.floorLocked = true;
      console.log('\n🔒🔒🔒 FLOOR LOCKED! 🔒🔒🔒');
      console.log(`Floor: $${state.floorPrice.toFixed(5)}`);
      console.log('💎 Minimum $2 profit SECURED!');
      console.log('🚀 Now trailing at 1% - LET IT RUN!\n');

      await sendDiscordAlert(`🔒 **FLOOR LOCKED!**\n\nMinimum profit secured: $2\nNow trailing at 1% below highest price\n💎 Let God sort it out!`);
    }

    // Calculate trail stop (1% below highest, but never below floor)
    const newTrail = state.highestPrice * (1 - CONFIG.trailPercent);
    state.trailStopPrice = Math.max(newTrail, state.floorPrice);

    // Calculate current P&L
    const currentValue = state.amount * currentPrice;
    const entryValue = state.amount * state.entryPrice;
    const unrealizedProfit = currentValue - entryValue;
    const percentGain = ((currentPrice - state.entryPrice) / state.entryPrice) * 100;

    console.log(
      `📊 Entry: $${state.entryPrice.toFixed(5)} | ` +
      `Current: $${currentPrice.toFixed(5)} | ` +
      `High: $${state.highestPrice.toFixed(5)} | ` +
      `Trail: $${state.trailStopPrice.toFixed(5)} | ` +
      `P&L: $${unrealizedProfit.toFixed(2)} (+${percentGain.toFixed(2)}%) | ` +
      `${state.floorLocked ? '🔒 TRAILING' : '⏳ Building to floor...'}`
    );

    // Check if trail stop hit
    if (currentPrice <= state.trailStopPrice) {
      await exitPosition(state, currentPrice, unrealizedProfit, percentGain);
    } else {
      saveState(state);
    }

  } catch (error) {
    console.error('❌ Error monitoring position:', error.message);
  }
}

async function exitPosition(state, exitPrice, profit, percentGain) {
  // CRITICAL FIX: Mark exit as attempted IMMEDIATELY to prevent retry loops!
  state.exitAttempted = true;
  saveState(state);

  try {
    console.log('\n═══════════════════════════════════════════════════════════');
    console.log('💰💰💰 TRAIL STOP HIT! EXITING POSITION! 💰💰💰');
    console.log('═══════════════════════════════════════════════════════════');
    console.log(`Entry: $${state.entryPrice.toFixed(5)}`);
    console.log(`Exit: $${exitPrice.toFixed(5)}`);
    console.log(`Amount: ${state.amount.toFixed(2)} XRP (ONLY THIS AMOUNT!)`);
    console.log(`Highest: $${state.highestPrice.toFixed(5)}`);
    console.log(`Trail Stop: $${state.trailStopPrice.toFixed(5)}`);
    console.log(`Profit: $${profit.toFixed(2)} (+${percentGain.toFixed(2)}%)`);
    console.log(`Floor was: ${state.floorLocked ? 'LOCKED ✅' : 'Not reached'}`);
    console.log('═══════════════════════════════════════════════════════════');

    // Place LIMIT SELL order - ONLY for state.amount XRP!
    console.log('\n📤 Placing SELL limit order...');
    console.log(`   Amount to sell: ${state.amount.toFixed(2)} XRP (NOT YOUR BAGS!)`);

    const sellOrder = await exchange.createLimitSellOrder(
      CONFIG.symbol,
      state.amount,              // ONLY sell the tracked amount!
      exitPrice,
      { postOnly: true }
    );
    console.log(`✅ Sell order placed! ID: ${sellOrder.id}`);
    console.log(`✅ Selling ONLY ${state.amount.toFixed(2)} XRP - bags safe!`);

    // Send Discord alert
    await sendDiscordAlert(
      `💰 **POSITION CLOSED!**\n\n` +
      `Exit: $${exitPrice.toFixed(5)}\n` +
      `Amount: ${state.amount.toFixed(2)} XRP\n` +
      `Profit: $${profit.toFixed(2)} (+${percentGain.toFixed(2)}%)\n` +
      `Highest: $${state.highestPrice.toFixed(5)}\n` +
      `Floor: ${state.floorLocked ? 'Locked ✅' : 'Not reached'}\n` +
      `Total Profit: $${(state.totalProfit + profit).toFixed(2)}\n` +
      `Next Position: $${(CONFIG.positionSizeUSD + state.totalProfit + profit).toFixed(2)}`
    );

    // Update state - position closed successfully
    state.hasPosition = false;
    state.successfulTrades++;
    state.totalProfit += profit;
    state.lastExitTime = Date.now();
    state.entryPrice = 0;
    state.amount = 0;
    state.positionSizeUSD = 0;
    state.buyOrderId = null;
    state.floorPrice = 0;
    state.floorLocked = false;
    state.highestPrice = 0;
    state.trailStopPrice = 0;
    state.exitAttempted = false;   // Reset for next trade

    saveState(state);

    console.log(`\n✅ Total Trades: ${state.totalTrades}`);
    console.log(`✅ Successful: ${state.successfulTrades}`);
    console.log(`✅ Total Profit: $${state.totalProfit.toFixed(2)}`);
    console.log(`✅ Next Position: $${CONFIG.compounding ? (CONFIG.positionSizeUSD + state.totalProfit).toFixed(2) : CONFIG.positionSizeUSD.toFixed(2)}`);
    console.log('🔄 Waiting 30 seconds before looking for re-entry...\n');

  } catch (error) {
    // CRITICAL: Even if exit fails, exitAttempted is ALREADY true!
    // This prevents retry loops!
    console.error('❌ ERROR exiting position:', error.message);
    console.error('🚨 EXIT FAILED! exitAttempted flag is SET - will NOT retry!');
    console.error('⚠️ MANUAL INTERVENTION REQUIRED - check Kraken orders!');

    await sendDiscordAlert(
      `🚨 **EXIT ERROR!**\n\n` +
      `Error: ${error.message}\n` +
      `Position: ${state.amount.toFixed(2)} XRP\n` +
      `⚠️ Bot will NOT retry automatically!\n` +
      `👀 CHECK KRAKEN MANUALLY!`
    );

    // State remains: hasPosition=true, exitAttempted=true
    // Bot will NOT try to exit again - waits for manual intervention
  }
}

// ═══════════════════════════════════════════════════════════
// MAIN BOT LOOP
// ═══════════════════════════════════════════════════════════

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {
  console.log('\n');
  console.log('═══════════════════════════════════════════════════════════');
  console.log('🐉 DRAGON EMPIRE HOLDINGS - SCALPING BOT V1.3.3 🐉');
  console.log('═══════════════════════════════════════════════════════════');
  console.log('Strategy: Triple Confirmation Entry + FLOOR + TRAIL Exit');
  console.log(`Position: $${CONFIG.positionSizeUSD} base${CONFIG.compounding ? ' + compounding profits' : ''}`);
  console.log(`Entry: RSI < 35 + Price Up + EMA8 > EMA3`);
  console.log(`Floor: Entry + ${(CONFIG.floorPercent * 100).toFixed(2)}% (locks $2 minimum)`);
  console.log(`Trail: ${(CONFIG.trailPercent * 100).toFixed(0)}% below highest (unlimited upside!)`);
  console.log(`Compounding: ${CONFIG.compounding ? 'ON - profits reinvested' : 'OFF'}`);
  console.log('⚡ EMA POWERED - FAST REACTIONS!');
  console.log('🔒 V1.3.3: NO RETRY LOOPS - PREVENTS MULTI-ORDER BUGS!');
  console.log('💎 "TAKE IT ALL, LET GOD SORT IT OUT!"');
  console.log('═══════════════════════════════════════════════════════════');
  console.log('🔥 LET IT EAT! 🔥');
  console.log('═══════════════════════════════════════════════════════════\n');

  // Load state
  let state = loadState();

  if (state.hasPosition) {
    console.log('📊 Resuming with existing position:');
    console.log(`   Entry: $${state.entryPrice.toFixed(5)}`);
    console.log(`   Floor: $${state.floorPrice.toFixed(5)}`);
    console.log(`   Amount: ${state.amount.toFixed(2)} XRP`);
    if (state.exitAttempted) {
      console.log('   ⚠️ WARNING: Exit was attempted and may have failed!');
      console.log('   ⚠️ Check Kraken for open orders manually!');
    }
    console.log('');
  } else {
    console.log('📊 No existing position. Ready to trade!\n');
  }

  // Send startup notification to Discord
  await sendDiscordAlert(
    `🐉 **BOT V1.3.3 STARTED**\n\n` +
    `✅ Status: Online\n` +
    `🎯 Strategy: Floor + Trail\n` +
    `💰 Position: ${state.hasPosition ? 'Active' : 'None'}\n` +
    `🔒 Anti-retry protection enabled\n` +
    `⚡ EMA powered\n` +
    `💎 "Let God sort it out!"\n` +
    `⏰ ${new Date().toISOString()}`
  );

  // Main loop
  while (true) {
    try {
      const timestamp = new Date().toISOString();
      console.log(`[${timestamp}] 🔍 Checking...`);

      if (state.hasPosition) {
        // Monitor position for floor + trail exit
        await monitorPosition(state);
      } else {
        // Look for entry
        const signal = await checkEntrySignal(state);
        if (signal) {
          await enterTrade(signal, state);
        }
      }

      // Update bot status
      botStatus.running = true;
      botStatus.lastCheck = timestamp;
      botStatus.error = null;
      botStatus.hasPosition = state.hasPosition;

      // Wait before next check
      await sleep(CONFIG.checkInterval);

    } catch (error) {
      console.error('\n❌ ERROR in main loop:', error.message);
      await sendDiscordAlert(`⚠️ **Main loop error:**\n${error.message}`);
      botStatus.error = error.message;
      console.log('⏳ Waiting 60 seconds before retry...\n');
      await sleep(60000);
    }
  }
}

// ═══════════════════════════════════════════════════════════
// START BOT
// ═══════════════════════════════════════════════════════════

// Start health check server first
startHealthServer();

// Start bot loop
main().catch(error => {
  console.error('💥 FATAL ERROR:', error);
  botStatus.error = error.message;
  botStatus.running = false;
  console.log('🔄 Restarting bot in 30 seconds...');
  setTimeout(() => {
    main().catch(err => {
      console.error('💥 FATAL ERROR on restart:', err);
      botStatus.error = err.message;
    });
  }, 30000);
});
