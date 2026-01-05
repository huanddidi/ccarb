import { BinanceFeed } from './feeds/binance.js';
import { PolymarketClient } from './markets/polymarket.js';
import { ArbitrageEngine } from './engine/arbitrage.js';
import { TradeExecutor } from './engine/executor.js';
import { Dashboard, printSignal, printTrade } from './utils/dashboard.js';
import { loadConfig, validateConfig, printConfig } from './utils/config.js';
import chalk from 'chalk';

async function main() {
  console.log(chalk.cyan.bold(`
  ╔═══════════════════════════════════════════════════════════════╗
  ║     POLYMARKET BTC ARBITRAGE BOT                              ║
  ║     Exploiting the 30-90 Second Binance → Polymarket Lag     ║
  ╚═══════════════════════════════════════════════════════════════╝
  `));

  // Load and validate configuration
  const config = loadConfig();
  const validation = validateConfig(config);

  if (!validation.valid) {
    console.error(chalk.red('Configuration errors:'));
    validation.errors.forEach(e => console.error(chalk.red(`  - ${e}`)));

    if (config.trading.mode === 'live') {
      console.error(chalk.yellow('\nSwitching to paper trading mode...'));
      config.trading.mode = 'paper';
    }
  }

  printConfig(config);

  // Initialize components
  console.log(chalk.gray('[Init] Starting Binance feed...'));
  const binance = new BinanceFeed('btcusdt', 15000); // 15 second price window

  console.log(chalk.gray('[Init] Initializing Polymarket client...'));
  const polymarket = new PolymarketClient({
    apiKey: config.polymarket.apiKey,
    apiSecret: config.polymarket.apiSecret,
    passphrase: config.polymarket.passphrase,
    privateKey: config.polymarket.privateKey
  });

  console.log(chalk.gray('[Init] Creating arbitrage engine...'));
  const engine = new ArbitrageEngine(binance, polymarket, {
    minEdgeThreshold: config.trading.minEdgeThreshold,
    minLagSeconds: config.lag.minLagSeconds,
    maxLagSeconds: config.lag.maxLagSeconds,
    priceMovementThreshold: config.lag.priceMovementThreshold,
    maxPositionSize: config.trading.maxPositionSize,
    riskPerTrade: config.trading.riskPerTrade
  });

  console.log(chalk.gray('[Init] Creating trade executor...'));
  const executor = new TradeExecutor(polymarket, engine, {
    mode: config.trading.mode,
    maxConcurrentTrades: config.executor.maxConcurrentTrades,
    exitDelayMs: config.executor.exitDelayMs,
    maxSlippage: config.executor.maxSlippage,
    minProfitToExit: config.executor.minProfitToExit,
    stopLoss: config.executor.stopLoss
  });

  // Set up event handlers for logging
  engine.on('signal', (signal) => {
    printSignal(signal);
  });

  executor.on('tradeOpened', (trade) => {
    printTrade(trade, 'open');
  });

  executor.on('tradeClosed', (trade) => {
    printTrade(trade, 'close');
  });

  // Handle shutdown gracefully
  process.on('SIGINT', async () => {
    console.log(chalk.yellow('\n[Shutdown] Received SIGINT, closing positions...'));

    await executor.closeAllPositions();
    engine.stop();
    binance.disconnect();

    const stats = engine.getStats();
    const dailyStats = executor.getDailyStats();

    console.log(chalk.cyan('\n=== Final Session Stats ==='));
    console.log(`Signals Generated: ${stats.signalsGenerated}`);
    console.log(`Trades Executed:   ${dailyStats.trades}`);
    console.log(`Win Rate:          ${dailyStats.winRate.toFixed(1)}%`);
    console.log(`Total P&L:         $${dailyStats.pnl.toFixed(2)}`);
    console.log(`Final Balance:     $${dailyStats.paperBalance.toFixed(2)}`);
    console.log(chalk.cyan('===========================\n'));

    process.exit(0);
  });

  // Start the system
  try {
    console.log(chalk.gray('[Init] Connecting to Binance...'));
    await binance.connect();

    console.log(chalk.gray('[Init] Fetching Polymarket BTC markets...'));
    const markets = await polymarket.fetchBTCMarkets();
    console.log(chalk.green(`[Init] Found ${markets.length} active BTC markets`));

    if (markets.length > 0) {
      console.log(chalk.gray('\nActive markets:'));
      markets.slice(0, 5).forEach(m => {
        console.log(chalk.gray(`  - ${m.question.slice(0, 60)}...`));
      });
    }

    console.log(chalk.green('\n[Init] Starting arbitrage engine...'));
    engine.start();

    // Check for dashboard mode
    const useDashboard = process.argv.includes('--dashboard') || process.argv.includes('-d');

    if (useDashboard) {
      const dashboard = new Dashboard(binance, polymarket, engine, executor);
      dashboard.start(2000);
    } else {
      console.log(chalk.green('\n[Running] Bot is now monitoring for arbitrage opportunities...'));
      console.log(chalk.gray('Press Ctrl+C to stop\n'));
      console.log(chalk.gray('─'.repeat(70)));
    }
  } catch (error: any) {
    console.error(chalk.red('[Error] Failed to start:'), error.message);
    process.exit(1);
  }
}

main().catch(console.error);
