import chalk from 'chalk';
import Table from 'cli-table3';
import { BinanceFeed } from '../feeds/binance.js';
import { PolymarketClient, BTCMarket } from '../markets/polymarket.js';
import { ArbitrageEngine, EngineStats } from '../engine/arbitrage.js';
import { TradeExecutor, Trade } from '../engine/executor.js';

export class Dashboard {
  private readonly binance: BinanceFeed;
  private readonly polymarket: PolymarketClient;
  private readonly engine: ArbitrageEngine;
  private readonly executor: TradeExecutor;
  private updateInterval: NodeJS.Timeout | null = null;

  constructor(
    binance: BinanceFeed,
    polymarket: PolymarketClient,
    engine: ArbitrageEngine,
    executor: TradeExecutor
  ) {
    this.binance = binance;
    this.polymarket = polymarket;
    this.engine = engine;
    this.executor = executor;
  }

  start(intervalMs: number = 2000): void {
    this.render();
    this.updateInterval = setInterval(() => {
      this.render();
    }, intervalMs);
  }

  stop(): void {
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
      this.updateInterval = null;
    }
  }

  private render(): void {
    console.clear();
    this.renderHeader();
    this.renderPriceInfo();
    this.renderMarkets();
    this.renderActiveTrades();
    this.renderStats();
    this.renderFooter();
  }

  private renderHeader(): void {
    console.log(chalk.cyan.bold(`
╔═══════════════════════════════════════════════════════════════════════════════╗
║                    POLYMARKET BTC ARBITRAGE BOT v1.0                          ║
║                         Exploiting the 30-90s Lag                             ║
╚═══════════════════════════════════════════════════════════════════════════════╝
`));
  }

  private renderPriceInfo(): void {
    const price = this.binance.getLastPrice();
    const movement = this.binance.getCurrentMovement();

    const priceStr = price > 0 ? `$${price.toLocaleString(undefined, { minimumFractionDigits: 2 })}` : 'Connecting...';
    const directionIcon = movement?.direction === 'UP' ? '▲' : movement?.direction === 'DOWN' ? '▼' : '─';
    const directionColor = movement?.direction === 'UP' ? chalk.green : movement?.direction === 'DOWN' ? chalk.red : chalk.gray;
    const movementPct = movement ? `${(movement.magnitude * 100).toFixed(3)}%` : '0.000%';

    console.log(chalk.white.bold('  ₿ BITCOIN PRICE'));
    console.log(`    Binance BTC/USDT: ${chalk.yellow.bold(priceStr)} ${directionColor(directionIcon + ' ' + movementPct)}`);
    console.log(`    VWAP (1min):      $${this.binance.getVWAP(60000).toLocaleString(undefined, { minimumFractionDigits: 2 })}`);

    const mode = this.executor.tradingMode === 'paper' ? chalk.yellow('PAPER') : chalk.green('LIVE');
    const status = this.engine.running ? chalk.green('● RUNNING') : chalk.red('○ STOPPED');
    console.log(`    Mode: ${mode}  Status: ${status}`);
    console.log('');
  }

  private renderMarkets(): void {
    const markets = this.polymarket.getActiveMarkets();

    console.log(chalk.white.bold('  📊 ACTIVE BTC MARKETS'));

    if (markets.length === 0) {
      console.log(chalk.gray('    No active Bitcoin markets found'));
      console.log('');
      return;
    }

    const table = new Table({
      head: [
        chalk.cyan('Market'),
        chalk.cyan('Window'),
        chalk.cyan('UP'),
        chalk.cyan('DOWN'),
        chalk.cyan('Volume'),
        chalk.cyan('Ends')
      ],
      colWidths: [40, 10, 10, 10, 12, 15],
      style: { head: [], border: ['gray'] }
    });

    for (const market of markets.slice(0, 5)) {
      const question = market.question.length > 37 ? market.question.slice(0, 37) + '...' : market.question;
      const upPrice = market.outcomePrices[0]?.toFixed(3) || '-';
      const downPrice = market.outcomePrices[1]?.toFixed(3) || '-';
      const volume = `$${(market.volume / 1000).toFixed(1)}K`;
      const endTime = this.formatEndTime(market.endDate);

      table.push([
        question,
        `${market.windowMinutes}min`,
        chalk.green(upPrice),
        chalk.red(downPrice),
        volume,
        endTime
      ]);
    }

    console.log(table.toString());
    console.log('');
  }

  private renderActiveTrades(): void {
    const trades = this.executor.getActiveTrades();

    console.log(chalk.white.bold('  💼 ACTIVE TRADES'));

    if (trades.length === 0) {
      console.log(chalk.gray('    No active trades'));
      console.log('');
      return;
    }

    const table = new Table({
      head: [
        chalk.cyan('ID'),
        chalk.cyan('Direction'),
        chalk.cyan('Entry'),
        chalk.cyan('Size'),
        chalk.cyan('P&L'),
        chalk.cyan('Age')
      ],
      colWidths: [15, 12, 10, 12, 12, 10],
      style: { head: [], border: ['gray'] }
    });

    for (const trade of trades) {
      const direction = trade.signal.direction === 'UP' ? chalk.green('▲ UP') : chalk.red('▼ DOWN');
      const entry = trade.entryOrder.avgPrice.toFixed(4);
      const size = `$${trade.entryOrder.filledSize.toFixed(2)}`;
      const pnl = trade.pnl >= 0 ? chalk.green(`+$${trade.pnl.toFixed(2)}`) : chalk.red(`-$${Math.abs(trade.pnl).toFixed(2)}`);
      const age = this.formatDuration(Date.now() - trade.entryTime);

      table.push([
        trade.id.slice(-10),
        direction,
        entry,
        size,
        pnl,
        age
      ]);
    }

    console.log(table.toString());
    console.log('');
  }

  private renderStats(): void {
    const engineStats = this.engine.getStats();
    const dailyStats = this.executor.getDailyStats();

    console.log(chalk.white.bold('  📈 PERFORMANCE'));

    const statsTable = new Table({
      style: { head: [], border: ['gray'] }
    });

    const pnlColor = dailyStats.pnl >= 0 ? chalk.green : chalk.red;
    const winRate = dailyStats.winRate.toFixed(1);

    statsTable.push(
      { 'Signals Generated': engineStats.signalsGenerated.toString() },
      { 'Trades Executed': dailyStats.trades.toString() },
      { 'Win Rate': `${winRate}% (${dailyStats.wins}W / ${dailyStats.losses}L)` },
      { 'Daily P&L': pnlColor(`$${dailyStats.pnl.toFixed(2)}`) },
      { 'Volume': `$${dailyStats.volume.toLocaleString()}` },
      { 'Paper Balance': chalk.yellow(`$${dailyStats.paperBalance.toLocaleString()}`) },
      { 'Avg Lag Detected': `${engineStats.avgLagDetected.toFixed(1)}s` },
      { 'Uptime': this.formatDuration(engineStats.uptime) }
    );

    console.log(statsTable.toString());
    console.log('');
  }

  private renderFooter(): void {
    const config = this.engine.getConfig();

    console.log(chalk.gray('─'.repeat(80)));
    console.log(chalk.gray(`  Config: Edge≥${(config.minEdgeThreshold * 100).toFixed(0)}% | Lag: ${config.minLagSeconds}-${config.maxLagSeconds}s | Max Position: $${config.maxPositionSize}`));
    console.log(chalk.gray('  Commands: Ctrl+C to exit | Press "p" to toggle paper/live mode'));
    console.log(chalk.gray(`  Last update: ${new Date().toLocaleTimeString()}`));
  }

  private formatEndTime(date: Date): string {
    const diff = date.getTime() - Date.now();
    if (diff < 0) return 'Expired';
    if (diff < 60000) return `${Math.floor(diff / 1000)}s`;
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m`;
    return `${Math.floor(diff / 3600000)}h ${Math.floor((diff % 3600000) / 60000)}m`;
  }

  private formatDuration(ms: number): string {
    if (ms < 1000) return '0s';
    if (ms < 60000) return `${Math.floor(ms / 1000)}s`;
    if (ms < 3600000) return `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`;
    return `${Math.floor(ms / 3600000)}h ${Math.floor((ms % 3600000) / 60000)}m`;
  }
}

export function printSignal(signal: any): void {
  console.log(chalk.cyan.bold('\n═══════════════════════════════════════════════════════════════'));
  console.log(chalk.yellow.bold('  ⚡ ARBITRAGE SIGNAL DETECTED'));
  console.log(chalk.cyan.bold('═══════════════════════════════════════════════════════════════'));

  const direction = signal.direction === 'UP'
    ? chalk.green.bold('▲ UP')
    : chalk.red.bold('▼ DOWN');

  console.log(`  Direction:     ${direction}`);
  console.log(`  Confidence:    ${chalk.white((signal.confidence * 100).toFixed(1))}%`);
  console.log(`  Expected Edge: ${chalk.green((signal.expectedEdge * 100).toFixed(2))}%`);
  console.log(`  Lag Detected:  ${chalk.yellow(signal.staleSeconds.toFixed(1))}s`);
  console.log(`  Binance Price: ${chalk.white('$' + signal.binancePrice.toLocaleString())}`);
  console.log(`  Rec. Size:     ${chalk.white('$' + signal.recommendedSize.toFixed(2))}`);
  console.log(chalk.cyan.bold('═══════════════════════════════════════════════════════════════\n'));
}

export function printTrade(trade: Trade, type: 'open' | 'close'): void {
  if (type === 'open') {
    console.log(chalk.green.bold('\n✓ TRADE OPENED'));
    console.log(`  ID:    ${trade.id}`);
    console.log(`  Entry: ${trade.entryOrder.avgPrice.toFixed(4)}`);
    console.log(`  Size:  $${trade.entryOrder.filledSize.toFixed(2)}`);
  } else {
    const pnlColor = trade.pnl >= 0 ? chalk.green : chalk.red;
    console.log(chalk.blue.bold('\n✓ TRADE CLOSED'));
    console.log(`  ID:    ${trade.id}`);
    console.log(`  Entry: ${trade.entryOrder.avgPrice.toFixed(4)}`);
    console.log(`  Exit:  ${trade.exitOrder?.avgPrice.toFixed(4) || 'N/A'}`);
    console.log(`  P&L:   ${pnlColor('$' + trade.pnl.toFixed(2))}`);
  }
  console.log('');
}
