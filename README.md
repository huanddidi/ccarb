# Polymarket BTC Arbitrage Bot

A trading bot that exploits the 30-90 second lag between Binance BTC spot price movements and Polymarket Bitcoin prediction market odds.

## The Strategy

Based on the "PurpleThunderBicycleMountain" wallet strategy that turned $50 into $280K in three weeks:

1. **Monitor Binance**: Watch BTC/USDT price in real-time via WebSocket
2. **Detect Movement**: Identify significant price movements (>0.1%)
3. **Check Polymarket**: Compare current prediction market odds to what they "should" be
4. **Exploit the Lag**: Polymarket odds lag behind Binance by 30-90 seconds
5. **Buy the Winner**: Purchase the outcome that's already "decided" based on Binance data
6. **Exit on Snap**: Sell when probabilities normalize to fair value

## Features

- **Real-time Binance WebSocket Feed**: Sub-second BTC price updates
- **Polymarket Integration**: Fetch BTC prediction markets and execute trades
- **Lag Detection Engine**: Identifies exploitable timing discrepancies
- **Paper Trading Mode**: Test the strategy without risking real money
- **Live Trading Mode**: Execute real trades on Polymarket (requires API keys)
- **CLI Dashboard**: Real-time monitoring of opportunities and positions
- **Backtesting**: Simulate strategy performance

## Installation

```bash
# Clone the repository
git clone <repo-url>
cd polymarket-btc-arb

# Install dependencies
npm install

# Copy environment template
cp .env.example .env

# Configure your settings (see Configuration section)
```

## Configuration

Edit `.env` with your settings:

```env
# Polymarket API (required for live trading)
POLYMARKET_API_KEY=your_api_key
POLYMARKET_SECRET=your_secret
POLYMARKET_PASSPHRASE=your_passphrase
PRIVATE_KEY=your_ethereum_private_key

# Trading Settings
TRADING_MODE=paper          # paper or live
MAX_POSITION_SIZE=1000      # Maximum position in USD
MIN_EDGE_THRESHOLD=0.03     # Minimum edge to trade (3%)
MAX_DAILY_TRADES=100        # Daily trade limit

# Lag Detection
MIN_LAG_SECONDS=30          # Minimum lag to consider
MAX_LAG_SECONDS=90          # Maximum lag before invalid
PRICE_MOVE_THRESHOLD=0.001  # Min price move (0.1%)
```

## Usage

### Paper Trading (No API Keys Required)

```bash
# Run in paper trading mode
npm run dev

# Run with dashboard
npm run dev -- --dashboard

# Monitor mode (no trades, just detect opportunities)
npm run monitor
```

### Live Trading

1. Set `TRADING_MODE=live` in `.env`
2. Add your Polymarket API credentials
3. Run: `npm run dev`

### Backtesting

```bash
npm run backtest
```

## Architecture

```
src/
├── feeds/
│   └── binance.ts       # Real-time BTC price feed via WebSocket
├── markets/
│   └── polymarket.ts    # Polymarket API client for markets & trading
├── engine/
│   ├── arbitrage.ts     # Core lag detection and signal generation
│   └── executor.ts      # Trade execution and position management
├── utils/
│   ├── config.ts        # Configuration management
│   └── dashboard.ts     # CLI dashboard and display utilities
├── index.ts             # Main entry point
├── monitor.ts           # Read-only monitoring mode
└── backtest.ts          # Strategy backtester
```

## How It Works

### Signal Generation

1. Binance WebSocket provides real-time BTC/USDT trades
2. Engine tracks price movements over 15-second windows
3. When BTC moves significantly (>0.1%), engine checks Polymarket odds
4. If odds haven't updated in 30-90 seconds, an arbitrage signal is generated
5. Expected edge is calculated: `fair_probability - current_polymarket_price`

### Trade Execution

1. Signal triggers trade with Kelly-inspired position sizing
2. Buy the outcome (UP or DOWN) that Binance suggests
3. Position monitored for:
   - Profit target (exit when odds normalize)
   - Stop loss (-10% default)
   - Time-based exit (30 seconds default)
4. Close position and record P&L

### Risk Management

- **Position Limits**: Max 20% of capital per trade
- **Concurrent Trades**: Max 5 open positions
- **Stop Loss**: Automatic exit at -10%
- **Quarter Kelly**: Conservative position sizing
- **Cooldown**: 5 seconds between signals

## Performance Expectations

Based on the original strategy:

| Metric | Expected |
|--------|----------|
| Win Rate | 75-85% |
| Avg Win | 5-8% |
| Avg Loss | 3-5% |
| Trades/Day | ~50 |
| Max Drawdown | <15% |

**Note**: Past performance does not guarantee future results. The edge may diminish as more traders exploit it.

## Disclaimer

This software is for educational purposes only. Trading involves significant risk of loss. The strategy described may not work in all market conditions. Always start with paper trading and only risk capital you can afford to lose.

## License

MIT
