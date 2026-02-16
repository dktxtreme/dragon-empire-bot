# 🐉 Dragon Empire Holdings - Scalping Bot V1

**Triple Confirmation Entry | Fixed 1.32% Target | No Stop Loss**

---

## 📊 STRATEGY OVERVIEW

### Entry Conditions (ALL 3 MUST BE MET):
1. **RSI < 35** - Oversold identified
2. **Price Moving Up** - 5 second momentum check confirms bounce
3. **MA8 > MA3** - Sustained momentum confirmed

### Exit Condition:
- **Fixed 1.32% Target** - Guarantees 1% net profit after 0.32% maker fees

### Position Management:
- **$200 per trade** - Fixed position size
- **No Stop Loss** - Holds until target (could take hours/days/weeks)
- **Re-entry**: 60 second cooldown after exit, then looks for new setup

---

## 🚀 DEPLOYMENT TO RAILWAY

### Step 1: Prepare Your Code

```bash
# Create project directory
mkdir dragon-empire-scalping
cd dragon-empire-scalping

# Copy all files:
# - scalping-bot.js
# - package.json
# - .env.example

# Initialize git
git init
git add .
git commit -m "Initial commit - Dragon Empire Scalping Bot V1"
```

### Step 2: Push to GitHub

```bash
# Create new repo on GitHub.com (dragon-empire-scalping)
git remote add origin https://github.com/YOUR_USERNAME/dragon-empire-scalping.git
git branch -M main
git push -u origin main
```

### Step 3: Deploy to Railway

1. Go to https://railway.app
2. Click "New Project"
3. Select "Deploy from GitHub repo"
4. Choose `dragon-empire-scalping` repo
5. Click "Deploy"

### Step 4: Add Environment Variables

In Railway dashboard:
1. Click on your project
2. Go to "Variables" tab
3. Add these variables:
   ```
   KRAKEN_API_KEY=your_actual_api_key
   KRAKEN_API_SECRET=your_actual_api_secret
   ```
4. Click "Save"

### Step 5: Verify Deployment

Railway will automatically:
- Install dependencies (`npm install`)
- Start the bot (`npm start`)
- Run 24/7

Check logs in Railway dashboard to see bot activity!

---

## 💻 LOCAL TESTING (OPTIONAL)

If you want to test locally first:

```bash
# Install dependencies
npm install

# Create .env file
cp .env.example .env
# Edit .env and add your actual API keys

# Run bot
npm start
```

**Note**: Local testing good for verification, but Railway recommended for 24/7 operation!

---

## 🔑 KRAKEN API SETUP

### Create API Key:
1. Log in to Kraken
2. Go to Settings → API
3. Click "Generate New Key"
4. Set permissions:
   - ✅ Query Funds
   - ✅ Create & Modify Orders
   - ✅ Query Open Orders & Trades
   - ✅ Query Closed Orders & Trades
   - ❌ Withdraw Funds (DO NOT ENABLE!)
5. Optional but recommended: Add IP whitelist
6. Generate key
7. Copy API Key and API Secret (you only see secret once!)

---

## 📊 BOT BEHAVIOR

### What It Does:
- Checks market every 7.5 seconds
- Looks for RSI < 35 (oversold)
- Confirms upward momentum (5 second price check)
- Confirms MA8 > MA3 (trend confirmation)
- When ALL 3 met: Places $200 buy limit + sell limit at 1.32% target
- Waits for target to hit (no stop loss)
- After exit: Waits 60 seconds, then looks for next setup

### What You'll See in Logs:
```
🔍 Checking entry conditions...
   RSI: 32.45
   ❌ Step 1 FAILED: RSI not oversold
   
[Later when RSI drops]
   
🔍 Checking entry conditions...
   RSI: 33.21
   ✅ Step 1 PASSED: RSI oversold!
   ⏳ Waiting 5 seconds to check momentum...
   Price1: $1.47000
   Price2: $1.47250
   ✅ Step 2 PASSED: Price moving UP!
   ✅ Step 3 PASSED: MA8 > MA3!
   
🎯🎯🎯 ALL 3 CONFIRMATIONS MET! ENTERING TRADE! 🎯🎯🎯

🚀 ENTERING TRADE
Entry Price: $1.47250
Amount: 135.84 XRP
Target Price: $1.49194 (+1.32%)
Expected Profit: $2.00 (net)

✅ TRADE ENTRY COMPLETE!
💎 Position open, waiting for target...

[Later when target hits]

💰💰💰 TARGET HIT! TRADE COMPLETE! 💰💰💰
Entry: $1.47250
Exit: $1.49194
Profit: $2.00 (+1.00% net)
```

---

## 🛡️ SAFETY FEATURES

### What's Included:
- ✅ Triple confirmation (high quality entries)
- ✅ All limit orders (maker fees only, 0.16% each side)
- ✅ State persistence (survives Railway restarts)
- ✅ Error handling (retries on failures)
- ✅ Auto-restart (Railway handles crashes)

### What's NOT Included (by design):
- ❌ No stop loss (holds until target)
- ❌ No daily loss limits
- ❌ No time restrictions
- ❌ No trade count limits

**"LET IT EAT!"** - Bot runs unlimited, takes every valid signal

---

## 📁 STATE FILE

Bot creates `bot-state.json` to track:
- Current position (if any)
- Entry/target prices
- Order IDs
- Total trades / successful trades
- Total profit
- Last exit time (for re-entry cooldown)

**This file survives Railway restarts!**

If bot crashes/restarts mid-trade:
1. Loads state file
2. Sees existing position
3. Continues monitoring for target
4. No manual intervention needed ✅

---

## 🎯 EXPECTED PERFORMANCE

### With Perfect Conditions:
- 20 wins per month @ $2.00 each = **$40/month**
- On $200 capital = **20% monthly return**
- Win rate target: 70%+

### Reality Check:
- Triple confirmation = fewer but higher quality entries
- Might only get 10-15 setups per month (selective)
- Some trades might take days to hit target
- No stop loss = can be stuck in drawdown

**First goal: Prove the strategy works with 1-2 winning trades!** ✅

---

## ⚠️ IMPORTANT WARNINGS

1. **Only $257 available** - This bot uses $200 per trade
2. **No stop loss** - If enters and drops, holds until recovers (could be days/weeks)
3. **Can't manually intervene** - Bot manages everything automatically
4. **First real money test** - Monitor closely, learn from results
5. **Crypto is volatile** - Understand the risks

**This is a TEST with real money. Start small, learn, iterate!**

---

## 🐉 DRAGON EMPIRE PHILOSOPHY

**"Let it eat!"** - No artificial limits, no fear-based restrictions

- ✅ Trust the triple confirmation
- ✅ Trust the mathematics (1.32% = 1% net)
- ✅ Trust the automation
- ✅ Learn from results
- ✅ Iterate and improve

**This is V1. There will be V2, V3, V4...**

**Each version gets better based on real data!** 💎

---

## 📞 MONITORING & SUPPORT

### Check Bot Status:
- Railway dashboard shows logs in real-time
- Check for "🎯 ALL 3 CONFIRMATIONS MET!" messages
- Check for "💰 TARGET HIT!" messages

### If Something's Wrong:
- Check Railway logs for errors
- Verify API keys are correct
- Ensure Kraken API has correct permissions
- Check Kraken account has $200+ available USD

### Questions?
Review this README, check the code comments, and trust the process!

---

## 🚀 GOOD LUCK!

**Dragon Empire Holdings LLC**

**Up Only, Forever!** 🐉💚

**Let it EAT!** 🔥

---

*Version 1.0 - February 2026*
*Triple Confirmation Scalping Strategy*
*No Stop Loss - Fixed Target - Let It Run*
