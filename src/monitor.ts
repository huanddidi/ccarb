/**
 * Monitor Mode - Watch for arbitrage opportunities without executing trades
 *
 * This mode connects to Binance and Polymarket to detect lag-based
 * arbitrage opportunities in real-time. No trades are executed.
 */

import { BinanceFeed, PriceMovement } from './feeds/binance.js';
import { PolymarketClient, MarketOdds } from './markets/polymarket.js';
import chalk from 'chalk';
import Table from 'cli-table3';

interface LagOpportunity {
  timestamp: number;
  btcPrice: number;
  btcMovement: PriceMovement;
  marketId: string;
  marketQuestion: string;
  polyOdds: MarketOdds;
  lagSeconds: number;
  estimatedEdge: number;
  direction: 'UP' | 'DOWN';
}

class ArbitrageMonitor {
  private binance: BinanceFeed;
  private polymarket: PolymarketClient;
  private opportunities: LagOpportunity[] = [];
  private lastOddsUpdate: Map<string, number> = new Map();

  constructor() {
    this.binance = new BinanceFeed('btcusdt', 15000);
    this.polymarket = new PolymarketClient({
      apiKey: '',
      apiSecret: '',
      passphrase: ''
    });
  }

  async start(): Promise<void> {
    console.log(chalk.cyan.bold(`
╔═══════════════════════════════════════════════════════════════════════════════╗
║                     POLYMARKET LAG MONITOR (Read-Only)                        ║
║                   Detecting BTC Arbitrage Opportunities                       ║
╚═══════════════════════════════════════════════════════════════════════════════╝
`));

    // Connect to Binance
    console.log(chalk.gray('[Monitor] Connecting to Binance BTC/USDT stream...'));
    await this.binance.connect();
    console.log(chalk.green('[Monitor] Connected to Binance'));

    // Fetch Polymarket markets
    console.log(chalk.gray('[Monitor] Fetching Polymarket BTC markets...'));
    const markets = await this.polymarket.fetchBTCMarkets();
    console.log(chalk.green(`[Monitor] Found ${markets.length} active BTC markets\n`));

    // Set up monitoring
    this.binance.on('movement', (movement: PriceMovement) => {
      this.checkForOpportunity(movement);
    });

    // Poll Polymarket odds
    this.startOddsPolling();

    // Display loop
    this.startDisplayLoop();

    console.log(chalk.gray('Press Ctrl+C to exit\n'));
    console.log(chalk.gray('─'.repeat(80)));
  }

  private startOddsPolling(): void {
    setInterval(async () => {
      const markets = this.polymarket.getActiveMarkets();

      for (const market of markets) {
        const odds = await this.polymarket.getMarketOdds(market.id);
        if (odds) {
          this.lastOddsUpdate.set(market.id, Date.now());
        }
      }
    }, 3000);
  }

  private checkForOpportunity(movement: PriceMovement): void {
    // Only care about significant movements (>0.1%)
    if (movement.magnitude < 0.001) return;

    // Skip neutral movements
    if (movement.direction === 'NEUTRAL') return;

    const markets = this.polymarket.getActiveMarkets();
    const now = Date.now();

    for (const market of markets) {
      const lastUpdate = this.lastOddsUpdate.get(market.id);
      if (!lastUpdate) continue;

      const lagSeconds = (now - lastUpdate) / 1000;

      // Check if lag is in exploitable window (30-90s)
      if (lagSeconds < 30 || lagSeconds > 90) continue;

      // Calculate estimated edge
      const direction: 'UP' | 'DOWN' = movement.direction;
      const currentOdds = direction === 'UP' ? market.outcomePrices[0] : market.outcomePrices[1];

      // Fair probability based on movement
      const fairProbability = Math.min(0.95, 0.5 + movement.magnitude * 50);
      const estimatedEdge = fairProbability - currentOdds;

      if (estimatedEdge > 0.02) { // > 2% edge
        const opportunity: LagOpportunity = {
          timestamp: now,
          btcPrice: movement.currentPrice,
          btcMovement: movement,
          marketId: market.id,
          marketQuestion: market.question,
          polyOdds: {
            marketId: market.id,
            upPrice: market.outcomePrices[0],
            downPrice: market.outcomePrices[1],
            timestamp: lastUpdate,
            spread: Math.abs(market.outcomePrices[0] - market.outcomePrices[1])
          },
          lagSeconds,
          estimatedEdge,
          direction
        };

        this.opportunities.unshift(opportunity);

        // Keep last 50 opportunities
        if (this.opportunities.length > 50) {
          this.opportunities.pop();
        }

        this.printOpportunity(opportunity);
      }
    }
  }

  private printOpportunity(opp: LagOpportunity): void {
    const dirColor = opp.direction === 'UP' ? chalk.green : chalk.red;
    const dirIcon = opp.direction === 'UP' ? '▲' : '▼';

    console.log(chalk.yellow.bold('\n⚡ ARBITRAGE OPPORTUNITY DETECTED'));
    console.log(chalk.gray('─'.repeat(60)));
    console.log(`Time:       ${new Date(opp.timestamp).toLocaleTimeString()}`);
    console.log(`BTC Price:  $${opp.btcPrice.toLocaleString()} ${dirColor(dirIcon + ' ' + (opp.btcMovement.magnitude * 100).toFixed(3) + '%')}`);
    console.log(`Direction:  ${dirColor(opp.direction)}`);
    console.log(`Lag:        ${chalk.yellow(opp.lagSeconds.toFixed(1) + 's')}`);
    console.log(`Est. Edge:  ${chalk.green((opp.estimatedEdge * 100).toFixed(2) + '%')}`);
    console.log(`Market:     ${opp.marketQuestion.slice(0, 50)}...`);
    console.log(`Odds:       UP=${opp.polyOdds.upPrice.toFixed(3)} DOWN=${opp.polyOdds.downPrice.toFixed(3)}`);
    console.log(chalk.gray('─'.repeat(60)));
  }

  private startDisplayLoop(): void {
    setInterval(() => {
      this.displayStatus();
    }, 5000);
  }

  private displayStatus(): void {
    const price = this.binance.getLastPrice();
    const movement = this.binance.getCurrentMovement();
    const markets = this.polymarket.getActiveMarkets();

    console.log(chalk.gray(`\n[${new Date().toLocaleTimeString()}] BTC: $${price.toLocaleString()} | Markets: ${markets.length} | Opportunities: ${this.opportunities.length}`));
  }

  async stop(): Promise<void> {
    this.binance.disconnect();
    this.polymarket.stopPolling();

    console.log(chalk.cyan('\n=== Session Summary ==='));
    console.log(`Total Opportunities Detected: ${this.opportunities.length}`);

    if (this.opportunities.length > 0) {
      const avgEdge = this.opportunities.reduce((sum, o) => sum + o.estimatedEdge, 0) / this.opportunities.length;
      const avgLag = this.opportunities.reduce((sum, o) => sum + o.lagSeconds, 0) / this.opportunities.length;

      console.log(`Average Edge:     ${(avgEdge * 100).toFixed(2)}%`);
      console.log(`Average Lag:      ${avgLag.toFixed(1)}s`);
      console.log(`UP Opportunities: ${this.opportunities.filter(o => o.direction === 'UP').length}`);
      console.log(`DOWN Opportunities: ${this.opportunities.filter(o => o.direction === 'DOWN').length}`);
    }

    console.log(chalk.cyan('=======================\n'));
  }
}

// Main
const monitor = new ArbitrageMonitor();

process.on('SIGINT', async () => {
  console.log(chalk.yellow('\n[Monitor] Shutting down...'));
  await monitor.stop();
  process.exit(0);
});

monitor.start().catch(console.error);
