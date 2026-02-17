// ═══════════════════════════════════════════════════════════
// 🐉 DRAGON EMPIRE HOLDINGS - SCALPING BOT V1.2
// ═══════════════════════════════════════════════════════════
// Strategy: Triple Confirmation Entry + Fixed 1.32% Target
// Position: $200 base + compounding profits
// No Stop Loss - Hold Until Target
// Railway Compatible (includes minimal health check server)
// Let it EAT! 🔥
// ═══════════════════════════════════════════════════════════

require('dotenv').config();
const ccxt = require('ccxt');
const fs = require('fs');
const express = require('express');

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
  res.send('🐉 Dragon Empire Scalping Bot is RUNNING! 🔥');
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
  
  // Target settings
  targetNetProfit: 0.01,          // 1% net profit
  makerFees: 0.0032,              // 0.32% round trip (0.16% × 2)
  grossTarget: 0.0132,            // 1.32% gross (1% + fees)
  
  // Triple confirmation entry
  entryRSI: 35,                   // RSI must be < 35
  momentumCheckSeconds: 5,        // Check price movement over 5 seconds
  ma3Period: 3,                   // Fast MA
  ma8Period: 8,                   // Slow MA (MA8 must cross above MA3)
  
  // Compounding
  compounding: true,              // Reinvest profits into position size

  // Re-entry settings
  reEntryWaitSeconds: 30,         // Wait 30 seconds after exit (was 60s - missed setups during cooldown)
  reEntryRSI: 40,                 // RSI must be < 40 to re-enter
  
  // Timing
  checkInterval: 3000,             // Check every 3 seconds (was 7.5s - too slow for scalping)
  
  // State persistence
  stateFile: './bot-state.json',
};

// ═══════════════════════════════════════════════════════════
// EXCHANGE SETUP
// ═══════════════════════════════════════════════════════════

const exchange = new ccxt.kraken({
  apiKey: process.env.KRAKEN_API_KEY,
  apiSecret: process.env.KRAKEN_API_SECRET,
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
    targetPrice: 0,
    amount: 0,
    positionSizeUSD: 0,
    buyOrderId: null,
    sellOrderId: null,
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
  
  // First average
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

function calculateMA(closes, period) {
  if (closes.length < period) {
    throw new Error('Not enough data for MA calculation');
  }
  
  const slice = closes.slice(-period);
  const sum = slice.reduce((a, b) => a + b, 0);
  return sum / period;
}

async function getIndicators() {
  const ohlcv = await getOHLCV(100);
  const closes = ohlcv.map(candle => candle[4]); // Close prices
  
  const rsi = calculateRSI(closes, 14);
  const ma3 = calculateMA(closes, CONFIG.ma3Period);
  const ma8 = calculateMA(closes, CONFIG.ma8Period);
  const currentPrice = closes[closes.length - 1];
  
  return {
    rsi,
    ma3,
    ma8,
    currentPrice,
    ma8CrossAboveMA3: ma8 > ma3,
  };
}

// ═══════════════════════════════════════════════════════════
// ENTRY LOGIC - TRIPLE CONFIRMATION
// ═══════════════════════════════════════════════════════════

async function checkEntrySignal(state) {
  // Don't enter if we have a position
  if (state.hasPosition) {
    return null;
  }
  
  // Check if we're in re-entry cooldown
  const now = Date.now();
  const timeSinceExit = (now - state.lastExitTime) / 1000;
  if (timeSinceExit < CONFIG.reEntryWaitSeconds) {
    return null;
  }
  
  console.log('\n🔍 Checking entry conditions...');
  
  // STEP 1: Check RSI < 35
  const indicators = await getIndicators();
  console.log(`   RSI: ${indicators.rsi.toFixed(2)}`);
  console.log(`   MA3: ${indicators.ma3.toFixed(5)}`);
  console.log(`   MA8: ${indicators.ma8.toFixed(5)}`);
  console.log(`   Price: $${indicators.currentPrice.toFixed(5)}`);
  
  if (indicators.rsi >= CONFIG.entryRSI) {
    console.log(`   ❌ Step 1 FAILED: RSI ${indicators.rsi.toFixed(2)} >= ${CONFIG.entryRSI}`);
    return null;
  }
  console.log(`   ✅ Step 1 PASSED: RSI ${indicators.rsi.toFixed(2)} < ${CONFIG.entryRSI} (OVERSOLD!)`);
  
  // STEP 2: Check price momentum (5 seconds)
  const price1 = indicators.currentPrice;
  console.log(`   ⏳ Waiting ${CONFIG.momentumCheckSeconds} seconds to check momentum...`);
  await sleep(CONFIG.momentumCheckSeconds * 1000);
  
  const indicators2 = await getIndicators();
  const price2 = indicators2.currentPrice;
  const priceChange = ((price2 - price1) / price1) * 100;
  
  console.log(`   Price1: $${price1.toFixed(5)}`);
  console.log(`   Price2: $${price2.toFixed(5)}`);
  console.log(`   Change: ${priceChange.toFixed(3)}%`);
  
  if (price2 <= price1) {
    console.log(`   ❌ Step 2 FAILED: Price not moving up`);
    return null;
  }
  console.log(`   ✅ Step 2 PASSED: Price moving UP! (+${priceChange.toFixed(3)}%)`);
  
  // STEP 3: Check MA8 > MA3 using INITIAL indicators (pre-bounce snapshot)
  // We use the first reading (indicators) not the second (indicators2) because:
  // During a sharp V-bounce, MA3 (fast, 3-period) recovers faster than MA8 (slow, 8-period).
  // By the time we do the 5-second momentum check, MA3 may have already crossed above MA8,
  // flipping this condition to FALSE and causing us to miss the trade.
  // The MA check should confirm we're in a dip (MA8 > MA3 = slow above fast = downtrend),
  // while Step 2 confirms the bounce has started.
  if (!indicators.ma8CrossAboveMA3) {
    console.log(`   ❌ Step 3 FAILED: MA8 (${indicators.ma8.toFixed(5)}) NOT > MA3 (${indicators.ma3.toFixed(5)})`);
    return null;
  }
  console.log(`   ✅ Step 3 PASSED: MA8 > MA3! DIP STRUCTURE CONFIRMED!`);
  
  // ALL 3 CONDITIONS MET!
  console.log('\n🎯🎯🎯 ALL 3 CONFIRMATIONS MET! ENTERING TRADE! 🎯🎯🎯\n');
  
  return {
    entryPrice: price2,
    rsi: indicators2.rsi,
    ma3: indicators2.ma3,
    ma8: indicators2.ma8,
  };
}

// ═══════════════════════════════════════════════════════════
// TRADE EXECUTION
// ═══════════════════════════════════════════════════════════

async function enterTrade(signal, state) {
  try {
    const entryPrice = signal.entryPrice;
    const positionSize = getPositionSize(state);
    const amount = positionSize / entryPrice;
    const targetPrice = entryPrice * (1 + CONFIG.grossTarget);

    console.log('═══════════════════════════════════════════════════════════');
    console.log('🚀 ENTERING TRADE');
    console.log('═══════════════════════════════════════════════════════════');
    console.log(`Entry Price: $${entryPrice.toFixed(5)}`);
    console.log(`Amount: ${amount.toFixed(2)} XRP`);
    console.log(`Position Size: $${positionSize.toFixed(2)}${CONFIG.compounding && state.totalProfit > 0 ? ` (base $${CONFIG.positionSizeUSD} + $${state.totalProfit.toFixed(2)} profit)` : ''}`);
    console.log(`Target Price: $${targetPrice.toFixed(5)} (+${(CONFIG.grossTarget * 100).toFixed(2)}%)`);
    console.log(`Expected Profit: $${(positionSize * CONFIG.targetNetProfit).toFixed(2)} (net)`);
    console.log(`RSI: ${signal.rsi.toFixed(2)}`);
    console.log(`MA8 > MA3: ${signal.ma8.toFixed(5)} > ${signal.ma3.toFixed(5)}`);
    console.log('═══════════════════════════════════════════════════════════');
    
    // Place LIMIT BUY order (maker fee)
    console.log('\n📥 Placing BUY limit order...');
    const buyOrder = await exchange.createLimitBuyOrder(
      CONFIG.symbol,
      amount,
      entryPrice
    );
    console.log(`✅ Buy order placed! ID: ${buyOrder.id}`);
    
    // Wait a moment for buy to potentially fill
    await sleep(2000);
    
    // Place LIMIT SELL order at target (maker fee)
    console.log('\n📤 Placing SELL limit order at target...');
    const sellOrder = await exchange.createLimitSellOrder(
      CONFIG.symbol,
      amount,
      targetPrice
    );
    console.log(`✅ Sell order placed! ID: ${sellOrder.id}`);
    
    // Update state
    state.hasPosition = true;
    state.entryPrice = entryPrice;
    state.targetPrice = targetPrice;
    state.amount = amount;
    state.positionSizeUSD = positionSize;
    state.buyOrderId = buyOrder.id;
    state.sellOrderId = sellOrder.id;
    state.totalTrades++;
    
    saveState(state);
    
    console.log('\n✅ TRADE ENTRY COMPLETE!');
    console.log('💎 Position open, waiting for target...\n');
    
  } catch (error) {
    console.error('❌ ERROR entering trade:', error.message);
    throw error;
  }
}

async function checkExit(state) {
  if (!state.hasPosition) {
    return;
  }
  
  try {
    // Check if sell order filled
    const openOrders = await exchange.fetchOpenOrders(CONFIG.symbol);
    const sellOrderStillOpen = openOrders.find(o => o.id === state.sellOrderId);
    
    if (!sellOrderStillOpen) {
      // Sell order filled! Target hit!
      const tradePosSize = state.positionSizeUSD || CONFIG.positionSizeUSD;
      const profit = tradePosSize * CONFIG.targetNetProfit;
      
      console.log('\n═══════════════════════════════════════════════════════════');
      console.log('💰💰💰 TARGET HIT! TRADE COMPLETE! 💰💰💰');
      console.log('═══════════════════════════════════════════════════════════');
      console.log(`Entry: $${state.entryPrice.toFixed(5)}`);
      console.log(`Exit: $${state.targetPrice.toFixed(5)}`);
      console.log(`Position Size: $${tradePosSize.toFixed(2)}`);
      console.log(`Profit: $${profit.toFixed(2)} (+${(CONFIG.targetNetProfit * 100).toFixed(2)}% net)`);
      console.log(`Total Profit: $${(state.totalProfit + profit).toFixed(2)}`);
      console.log(`Next Position: $${CONFIG.compounding ? (CONFIG.positionSizeUSD + state.totalProfit + profit).toFixed(2) : CONFIG.positionSizeUSD.toFixed(2)}`);
      console.log(`Total Trades: ${state.totalTrades}`);
      console.log(`Successful: ${state.successfulTrades + 1}`);
      console.log('═══════════════════════════════════════════════════════════\n');
      
      // Update state
      state.hasPosition = false;
      state.successfulTrades++;
      state.totalProfit += profit;
      state.lastExitTime = Date.now();
      state.entryPrice = 0;
      state.targetPrice = 0;
      state.amount = 0;
      state.positionSizeUSD = 0;
      state.buyOrderId = null;
      state.sellOrderId = null;
      
      saveState(state);
      
      console.log('🔄 Waiting 30 seconds before looking for re-entry...\n');
    }
    
  } catch (error) {
    console.error('❌ Error checking exit:', error.message);
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
  console.log('🐉 DRAGON EMPIRE HOLDINGS - SCALPING BOT V1.2 🐉');
  console.log('═══════════════════════════════════════════════════════════');
  console.log('Strategy: Triple Confirmation + Fixed Target');
  console.log(`Position: $${CONFIG.positionSizeUSD} base${CONFIG.compounding ? ' + compounding profits' : ''}`);
  console.log('Target: 1.32% gross (1% net after fees)');
  console.log('Entry: RSI < 35 + Price Up + MA8 > MA3');
  console.log('Exit: Fixed target (no stop loss)');
  console.log(`Compounding: ${CONFIG.compounding ? 'ON - profits reinvested' : 'OFF - fixed position size'}`);
  console.log('═══════════════════════════════════════════════════════════');
  console.log('🔥 LET IT EAT! 🔥');
  console.log('═══════════════════════════════════════════════════════════\n');
  
  // Load state
  let state = loadState();
  
  if (state.hasPosition) {
    console.log('📊 Resuming with existing position:');
    console.log(`   Entry: $${state.entryPrice.toFixed(5)}`);
    console.log(`   Target: $${state.targetPrice.toFixed(5)}`);
    console.log(`   Amount: ${state.amount.toFixed(2)} XRP\n`);
  } else {
    console.log('📊 No existing position. Ready to trade!\n');
  }
  
  // Main loop
  while (true) {
    try {
      const timestamp = new Date().toISOString();
      console.log(`[${timestamp}] 🔍 Checking...`);

      if (state.hasPosition) {
        // Check if target hit
        await checkExit(state);
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
      botStatus.error = error.message;
      console.log('⏳ Waiting 60 seconds before retry...\n');
      await sleep(60000);
    }
  }
}

// ═══════════════════════════════════════════════════════════
// START BOT
// ═══════════════════════════════════════════════════════════

// Start health check server first (non-blocking, won't crash bot if it fails)
startHealthServer();

// Start bot loop (retries internally, never calls process.exit)
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
