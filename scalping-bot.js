// Dragon Empire Scalping Bot V1.4.1 - BUG FIXES
// "RSI + EMA Scalping with Floor + Trail Exit" 🐉
// CRITICAL FIXES: Uses completed candles only, real-time ticker price, verified AND logic

const ccxt = require('ccxt');
const fs = require('fs');
// Node 24+ has native fetch - no import needed!

// ============= CONFIG =============
const CONFIG = {
  exchange: 'kraken',
  symbol: 'XRP/USD',
  apiKey: process.env.KRAKEN_API_KEY,
  apiSecret: process.env.KRAKEN_API_SECRET,
  discordWebhook: process.env.DISCORD_WEBHOOK,
  
  // Strategy
  timeframe: '1m',
  rsiPeriod: 14,
  rsiOversold: 35,
  ema3Period: 3,
  ema8Period: 8,
  
  // Exit strategy - FLOOR + TRAIL!
  floorPercent: 0.0132,  // 1.32% = fees + $2 profit
  trailPercent: 0.01,     // 1% trailing stop
  
  // Position
  basePositionUSD: 200,
  
  // Timing
  checkInterval: 500,  // 0.5 seconds
  
  // State
  stateFile: './bot-state.json'
};

const exchange = new ccxt[CONFIG.exchange]({
  apiKey: CONFIG.apiKey,
  secret: CONFIG.apiSecret,
  enableRateLimit: true
});

let state = {
  inPosition: false,
  cash: CONFIG.basePositionUSD,
  entryPrice: null,
  entryAmount: null,
  floorPrice: null,
  highestPrice: null,
  trailStopPrice: null,
  floorLocked: false
};

function loadState() {
  try {
    if (fs.existsSync(CONFIG.stateFile)) {
      state = JSON.parse(fs.readFileSync(CONFIG.stateFile, 'utf8'));
      console.log('📂 State loaded:', state);
    }
  } catch (error) {
    console.error('❌ Error loading state:', error.message);
  }
}

function saveState() {
  try {
    fs.writeFileSync(CONFIG.stateFile, JSON.stringify(state, null, 2));
  } catch (error) {
    console.error('❌ Error saving state:', error.message);
  }
}

async function sendDiscordAlert(message) {
  if (!CONFIG.discordWebhook) return;
  try {
    await fetch(CONFIG.discordWebhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content: `🐉 **SCALPING BOT V1.4.1** 🐉\n${message}`
      })
    });
  } catch (error) {
    console.error('❌ Discord alert failed:', error.message);
  }
}

function calculateRSI(prices, period = 14) {
  if (prices.length < period + 1) {
    return 50; // Not enough data, return neutral
  }
  
  let gains = 0;
  let losses = 0;
  
  for (let i = prices.length - period; i < prices.length; i++) {
    const change = prices[i] - prices[i - 1];
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

function calculateEMA(prices, period) {
  if (prices.length < period) {
    return prices[prices.length - 1]; // Not enough data, return last price
  }
  
  const k = 2 / (period + 1);
  let ema = prices[0];
  for (let i = 1; i < prices.length; i++) {
    ema = prices[i] * k + ema * (1 - k);
  }
  return ema;
}

async function enterPosition(price) {
  try {
    const amount = state.cash / price;
    
    const order = await exchange.createLimitBuyOrder(
      CONFIG.symbol,
      amount,
      price,
      { postOnly: true }
    );
    
    console.log(`✅ BUY: ${amount.toFixed(4)} XRP @ $${price.toFixed(4)}`);
    
    state.inPosition = true;
    state.entryPrice = price;
    state.entryAmount = amount;
    state.floorPrice = price * (1 + CONFIG.floorPercent);
    state.highestPrice = price;
    state.trailStopPrice = state.floorPrice;
    state.floorLocked = false;
    
    saveState();
    
    await sendDiscordAlert(
      `🟢 **ENTRY**\n` +
      `Price: $${price.toFixed(4)}\n` +
      `Amount: ${amount.toFixed(4)} XRP\n` +
      `Floor: $${state.floorPrice.toFixed(4)}`
    );
    
  } catch (error) {
    console.error('❌ Entry error:', error.message);
  }
}

async function checkExit(currentPrice) {
  if (currentPrice > state.highestPrice) {
    state.highestPrice = currentPrice;
  }
  
  if (!state.floorLocked && currentPrice >= state.floorPrice) {
    state.floorLocked = true;
    console.log(`\n🔒 FLOOR LOCKED @ $${state.floorPrice.toFixed(4)}`);
    console.log(`💎 LET IT FLY! Trailing at 1%...`);
    
    await sendDiscordAlert(
      `🔒 **FLOOR LOCKED!**\n` +
      `Minimum profit secured!\n` +
      `Trailing at 1% - LET IT RUN! 🚀`
    );
  }
  
  const newTrail = state.highestPrice * (1 - CONFIG.trailPercent);
  state.trailStopPrice = Math.max(newTrail, state.floorPrice);
  
  const unrealizedPL = (state.entryAmount * currentPrice) - (state.entryAmount * state.entryPrice);
  const percentGain = ((currentPrice - state.entryPrice) / state.entryPrice) * 100;
  const distanceToTarget = ((state.trailStopPrice - currentPrice) / currentPrice) * 100;
  
  console.log(
    `📊 Entry: $${state.entryPrice.toFixed(4)} | ` +
    `Current: $${currentPrice.toFixed(4)} | ` +
    `High: $${state.highestPrice.toFixed(4)} | ` +
    `Trail: $${state.trailStopPrice.toFixed(4)} | ` +
    `P&L: $${unrealizedPL.toFixed(2)} (${percentGain.toFixed(2)}%) | ` +
    `Distance: ${distanceToTarget.toFixed(2)}% | ` +
    `${state.floorLocked ? '🔒 TRAILING' : 'Building...'}`
  );
  
  if (currentPrice <= state.trailStopPrice) {
    console.log(`\n🎯 TRAIL STOP HIT @ $${currentPrice.toFixed(4)}`);
    await exitPosition(currentPrice, percentGain);
    return true;
  }
  
  saveState();
  return false;
}

async function exitPosition(price, percentGain) {
  try {
    const order = await exchange.createLimitSellOrder(
      CONFIG.symbol,
      state.entryAmount,
      price,
      { postOnly: true }
    );
    
    const exitValue = state.entryAmount * price;
    const profit = exitValue - state.cash;
    
    console.log(`✅ SELL: ${state.entryAmount.toFixed(4)} XRP @ $${price.toFixed(4)}`);
    console.log(`💰 PROFIT: $${profit.toFixed(2)} (+${percentGain.toFixed(2)}%)`);
    console.log(`📈 NEW CAPITAL: $${exitValue.toFixed(2)}\n`);
    
    state.cash = exitValue;
    state.inPosition = false;
    state.entryPrice = null;
    state.entryAmount = null;
    state.floorPrice = null;
    state.highestPrice = null;
    state.trailStopPrice = null;
    state.floorLocked = false;
    
    saveState();
    
    await sendDiscordAlert(
      `🔴 **EXIT**\n` +
      `Price: $${price.toFixed(4)}\n` +
      `Profit: $${profit.toFixed(2)} (+${percentGain.toFixed(2)}%)\n` +
      `New Capital: $${exitValue.toFixed(2)}`
    );
    
  } catch (error) {
    console.error('❌ Exit error:', error.message);
  }
}

async function main() {
  console.log('🐉 Dragon Empire Scalping Bot V1.4.1 Starting...');
  console.log('💎 Strategy: RSI < 35 + EMA Cross + Floor + Trail Exit');
  console.log(`💰 Starting capital: $${state.cash.toFixed(2)}\n`);
  
  loadState();
  
  await sendDiscordAlert(
    `🐉 **BOT V1.4.1 STARTED**\n` +
    `Strategy: RSI < 35 + EMA Cross\n` +
    `Exit: Floor @ 1.32% + Trail @ 1%\n` +
    `Capital: $${state.cash.toFixed(2)}`
  );
  
  while (true) {
    try {
      
      if (!state.inPosition) {
        // CRITICAL FIX: Fetch enough candles + use completed candles only!
        const candles = await exchange.fetchOHLCV(CONFIG.symbol, CONFIG.timeframe, undefined, 50);
        
        // Use only COMPLETED candles for indicator calculation (exclude last incomplete)
        const completedPrices = candles.slice(0, -1).map(c => c[4]);
        
        // Get current live price from ticker
        const ticker = await exchange.fetchTicker(CONFIG.symbol);
        const currentPrice = ticker.last;
        
        // Calculate indicators on COMPLETED data only
        const rsi = calculateRSI(completedPrices, CONFIG.rsiPeriod);
        const ema3 = calculateEMA(completedPrices, CONFIG.ema3Period);
        const ema8 = calculateEMA(completedPrices, CONFIG.ema8Period);
        
        // Entry signals - BOTH must be true!
        const rsiOversold = rsi < CONFIG.rsiOversold;
        const emaSignal = ema8 > ema3;
        
        console.log(
          `🔍 RSI: ${rsi.toFixed(2)} | ` +
          `EMA3: ${ema3.toFixed(4)} | ` +
          `EMA8: ${ema8.toFixed(4)} | ` +
          `Price: $${currentPrice.toFixed(4)} | ` +
          `${rsiOversold ? '✅ RSI<35' : '❌ RSI>35'} | ` +
          `${emaSignal ? '✅ EMA8>EMA3' : '❌ EMA8<EMA3'}`
        );
        
        // ENTRY: Both conditions must be met!
        if (rsiOversold && emaSignal) {
          console.log(`\n🎯 ENTRY SIGNAL DETECTED!`);
          await enterPosition(currentPrice);
        }
        
      } else {
        // In position - monitor for exit
        const ticker = await exchange.fetchTicker(CONFIG.symbol);
        const currentPrice = ticker.last;
        await checkExit(currentPrice);
      }
      
      await new Promise(resolve => setTimeout(resolve, CONFIG.checkInterval));
      
    } catch (error) {
      console.error('❌ Error in main loop:', error.message);
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
  }
}

main().catch(console.error);

