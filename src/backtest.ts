/**
 * Backtester - Simulate the lag arbitrage strategy
 *
 * This module simulates the strategy using synthetic lag data
 * to estimate expected performance.
 */

import chalk from 'chalk';
import Table from 'cli-table3';

interface SimulatedTrade {
  id: number;
  direction: 'UP' | 'DOWN';
  entryPrice: number;
  exitPrice: number;
  size: number;
  lagSeconds: number;
  edgeAtEntry: number;
  pnl: number;
  pnlPct: number;
  timestamp: number;
}

interface BacktestConfig {
  initialCapital: number;
  minEdge: number;
  minLag: number;
  maxLag: number;
  positionSize: number;
  numSimulations: number;
  winRate: number;        // Estimated base win rate
  avgWin: number;         // Average win percentage
  avgLoss: number;        // Average loss percentage
}

interface BacktestResult {
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  winRate: number;
  totalPnL: number;
  totalPnLPct: number;
  maxDrawdown: number;
  sharpeRatio: number;
  profitFactor: number;
  avgTradesPerDay: number;
  finalCapital: number;
}

class Backtester {
  private config: BacktestConfig;
  private trades: SimulatedTrade[] = [];

  constructor(config: Partial<BacktestConfig> = {}) {
    this.config = {
      initialCapital: config.initialCapital ?? 50,
      minEdge: config.minEdge ?? 0.03,
      minLag: config.minLag ?? 30,
      maxLag: config.maxLag ?? 90,
      positionSize: config.positionSize ?? 500,
      numSimulations: config.numSimulations ?? 1000,
      winRate: config.winRate ?? 0.75,      // 75% win rate based on tweet
      avgWin: config.avgWin ?? 0.08,        // 8% avg win
      avgLoss: config.avgLoss ?? 0.05       // 5% avg loss
    };
  }

  run(): BacktestResult {
    console.log(chalk.cyan.bold(`
╔═══════════════════════════════════════════════════════════════════════════════╗
║                        STRATEGY BACKTEST SIMULATION                           ║
║                    Based on PurpleThunderBicycleMountain's Edge              ║
╚═══════════════════════════════════════════════════════════════════════════════╝
`));

    console.log(chalk.white('Configuration:'));
    console.log(`  Initial Capital:  $${this.config.initialCapital}`);
    console.log(`  Position Size:    $${this.config.positionSize}`);
    console.log(`  Min Edge:         ${(this.config.minEdge * 100).toFixed(1)}%`);
    console.log(`  Lag Window:       ${this.config.minLag}s - ${this.config.maxLag}s`);
    console.log(`  Simulated Trades: ${this.config.numSimulations}`);
    console.log(`  Expected Win Rate: ${(this.config.winRate * 100).toFixed(0)}%\n`);

    this.trades = [];
    let capital = this.config.initialCapital;
    let maxCapital = capital;
    let maxDrawdown = 0;
    const returns: number[] = [];

    // Simulate trades
    for (let i = 0; i < this.config.numSimulations; i++) {
      const trade = this.simulateTrade(i, capital);
      this.trades.push(trade);

      capital += trade.pnl;
      returns.push(trade.pnlPct);

      // Track drawdown
      if (capital > maxCapital) {
        maxCapital = capital;
      }
      const drawdown = (maxCapital - capital) / maxCapital;
      if (drawdown > maxDrawdown) {
        maxDrawdown = drawdown;
      }
    }

    // Calculate results
    const winningTrades = this.trades.filter(t => t.pnl > 0);
    const losingTrades = this.trades.filter(t => t.pnl <= 0);
    const totalPnL = this.trades.reduce((sum, t) => sum + t.pnl, 0);

    const grossProfit = winningTrades.reduce((sum, t) => sum + t.pnl, 0);
    const grossLoss = Math.abs(losingTrades.reduce((sum, t) => sum + t.pnl, 0));
    const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : Infinity;

    // Sharpe ratio (simplified)
    const avgReturn = returns.reduce((a, b) => a + b, 0) / returns.length;
    const variance = returns.reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) / returns.length;
    const stdDev = Math.sqrt(variance);
    const sharpeRatio = stdDev > 0 ? (avgReturn / stdDev) * Math.sqrt(252 * 24) : 0; // Annualized

    const result: BacktestResult = {
      totalTrades: this.trades.length,
      winningTrades: winningTrades.length,
      losingTrades: losingTrades.length,
      winRate: winningTrades.length / this.trades.length,
      totalPnL,
      totalPnLPct: (totalPnL / this.config.initialCapital) * 100,
      maxDrawdown,
      sharpeRatio,
      profitFactor,
      avgTradesPerDay: this.trades.length / 21, // ~3 weeks
      finalCapital: capital
    };

    this.printResults(result);
    this.printEquityCurve();

    return result;
  }

  private simulateTrade(id: number, currentCapital: number): SimulatedTrade {
    // Random direction
    const direction: 'UP' | 'DOWN' = Math.random() > 0.5 ? 'UP' : 'DOWN';

    // Random lag within window
    const lagSeconds = this.config.minLag + Math.random() * (this.config.maxLag - this.config.minLag);

    // Random edge (min to 2x min)
    const edgeAtEntry = this.config.minEdge + Math.random() * this.config.minEdge;

    // Entry price (random between 0.3 and 0.7)
    const entryPrice = 0.3 + Math.random() * 0.4;

    // Determine win/loss with slight adjustment based on lag
    // Shorter lag = higher win probability
    const lagFactor = 1 - (lagSeconds - this.config.minLag) / (this.config.maxLag - this.config.minLag);
    const adjustedWinRate = this.config.winRate + lagFactor * 0.1;

    const isWin = Math.random() < adjustedWinRate;

    // Calculate exit price and PnL
    let exitPrice: number;
    let pnlPct: number;

    if (isWin) {
      // Random win between 3% and max edge
      pnlPct = 0.03 + Math.random() * (this.config.avgWin - 0.03);
      exitPrice = entryPrice + pnlPct;
    } else {
      // Random loss between 1% and avg loss
      pnlPct = -(0.01 + Math.random() * (this.config.avgLoss - 0.01));
      exitPrice = entryPrice + pnlPct;
    }

    // Position sizing (Kelly-inspired, capped)
    const kelly = edgeAtEntry / (1 - entryPrice);
    const positionSize = Math.min(
      this.config.positionSize,
      currentCapital * 0.2, // Max 20% per trade
      this.config.positionSize * kelly * 0.25 // Quarter Kelly
    );

    const pnl = positionSize * pnlPct;

    return {
      id,
      direction,
      entryPrice,
      exitPrice,
      size: positionSize,
      lagSeconds,
      edgeAtEntry,
      pnl,
      pnlPct,
      timestamp: Date.now() + id * 1000 * 60 * 30 // ~30 min between trades
    };
  }

  private printResults(result: BacktestResult): void {
    console.log(chalk.cyan.bold('\n═══════════════════════════════════════════════════════════════'));
    console.log(chalk.white.bold('                     BACKTEST RESULTS'));
    console.log(chalk.cyan.bold('═══════════════════════════════════════════════════════════════\n'));

    const table = new Table({
      style: { head: [], border: ['gray'] }
    });

    const pnlColor = result.totalPnL >= 0 ? chalk.green : chalk.red;

    table.push(
      { 'Total Trades': result.totalTrades.toString() },
      { 'Winning Trades': chalk.green(result.winningTrades.toString()) },
      { 'Losing Trades': chalk.red(result.losingTrades.toString()) },
      { 'Win Rate': chalk.yellow(`${(result.winRate * 100).toFixed(1)}%`) },
      { 'Total P&L': pnlColor(`$${result.totalPnL.toFixed(2)}`) },
      { 'Return': pnlColor(`${result.totalPnLPct.toFixed(1)}%`) },
      { 'Max Drawdown': chalk.red(`${(result.maxDrawdown * 100).toFixed(1)}%`) },
      { 'Profit Factor': chalk.yellow(result.profitFactor.toFixed(2)) },
      { 'Sharpe Ratio': chalk.yellow(result.sharpeRatio.toFixed(2)) },
      { 'Avg Trades/Day': result.avgTradesPerDay.toFixed(1) },
      { 'Initial Capital': `$${this.config.initialCapital}` },
      { 'Final Capital': pnlColor(`$${result.finalCapital.toFixed(2)}`) }
    );

    console.log(table.toString());
  }

  private printEquityCurve(): void {
    console.log(chalk.cyan.bold('\n═══════════════════════════════════════════════════════════════'));
    console.log(chalk.white.bold('                     EQUITY CURVE'));
    console.log(chalk.cyan.bold('═══════════════════════════════════════════════════════════════\n'));

    // Build equity curve
    let equity = this.config.initialCapital;
    const curve: number[] = [equity];

    for (const trade of this.trades) {
      equity += trade.pnl;
      curve.push(equity);
    }

    // ASCII chart
    const height = 15;
    const width = 60;
    const min = Math.min(...curve);
    const max = Math.max(...curve);
    const range = max - min || 1;

    // Sample points for chart
    const step = Math.ceil(curve.length / width);
    const sampledCurve = curve.filter((_, i) => i % step === 0);

    for (let row = height - 1; row >= 0; row--) {
      const threshold = min + (range * row) / (height - 1);
      let line = '';

      for (const value of sampledCurve) {
        const barHeight = Math.round(((value - min) / range) * (height - 1));
        if (barHeight >= row) {
          line += chalk.green('█');
        } else {
          line += ' ';
        }
      }

      const label = threshold.toFixed(0).padStart(8);
      console.log(`  ${chalk.gray(label)} │${line}`);
    }

    console.log(`  ${' '.repeat(8)} └${'─'.repeat(width)}`);
    console.log(`  ${' '.repeat(10)}0${' '.repeat(width - 10)}${this.trades.length} trades`);

    // Print key metrics
    console.log(chalk.gray(`\n  Starting: $${this.config.initialCapital} → Final: $${curve[curve.length - 1].toFixed(2)}`));
    console.log(chalk.gray(`  Peak: $${max.toFixed(2)} | Trough: $${min.toFixed(2)}`));
  }
}

// Run backtest
const backtester = new Backtester({
  initialCapital: 50,          // Start with $50 like in the tweet
  positionSize: 500,           // Scale up position size as capital grows
  numSimulations: 1500,        // ~50 trades over 3 weeks
  winRate: 0.85,               // High win rate due to exploiting lag
  avgWin: 0.06,                // 6% average win
  avgLoss: 0.04                // 4% average loss
});

backtester.run();

console.log(chalk.cyan(`
═══════════════════════════════════════════════════════════════════════════════
                           STRATEGY NOTES
═══════════════════════════════════════════════════════════════════════════════

The "PurpleThunderBicycleMountain" strategy exploits a simple inefficiency:

1. BINANCE LEADS: BTC spot price moves on Binance first
2. POLYMARKET LAGS: Prediction market odds take 30-90 seconds to update
3. BUY THE "DECIDED": When BTC moves up on Binance, the 15-min UP outcome
   is more likely, but Polymarket hasn't priced it in yet
4. EXIT ON SNAP: Sell when odds normalize to fair value

Key Edge Factors:
- Speed of Binance price movement detection
- Magnitude of the price move (bigger = more confident)
- Time remaining in the 15-min window
- Current mispricing in Polymarket odds

Risk Factors:
- Edge may disappear as more traders exploit it
- Polymarket liquidity on BTC markets
- Execution speed and slippage
- API reliability

This simulation assumes ~85% win rate based on the tweet's description
of "not a single red trade" over 50+ consecutive trades.

═══════════════════════════════════════════════════════════════════════════════
`));
