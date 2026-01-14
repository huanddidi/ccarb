import { EventEmitter } from 'events';
import { BinanceFeed, PriceMovement, PriceTick } from '../feeds/binance.js';
import { PolymarketClient, BTCMarket, MarketOdds } from '../markets/polymarket.js';

export interface ArbSignal {
  id: string;
  type: 'LAG_ARB';
  marketId: string;
  market: BTCMarket;
  direction: 'UP' | 'DOWN';
  confidence: number;
  expectedEdge: number;
  binancePrice: number;
  binanceMovement: PriceMovement;
  polymarketOdds: MarketOdds;
  staleSeconds: number;
  recommendedSize: number;
  timestamp: number;
}

export interface ArbConfig {
  minEdgeThreshold: number;      // Minimum edge to take trade (e.g., 0.03 = 3%)
  minLagSeconds: number;         // Minimum lag to consider (30s)
  maxLagSeconds: number;         // Maximum lag before signal invalid (90s)
  priceMovementThreshold: number; // Min price move to trigger (e.g., 0.001 = 0.1%)
  maxPositionSize: number;       // Max position in USD
  riskPerTrade: number;          // Risk per trade as fraction (0.02 = 2%)
}

export interface EngineStats {
  signalsGenerated: number;
  tradesExecuted: number;
  winningTrades: number;
  losingTrades: number;
  totalPnL: number;
  avgEdgeCaptured: number;
  avgLagDetected: number;
  uptime: number;
}

export class ArbitrageEngine extends EventEmitter {
  private readonly binance: BinanceFeed;
  private readonly polymarket: PolymarketClient;
  private readonly config: ArbConfig;
  private isRunning = false;
  private lastSignalTime = 0;
  private priceSnapshots: Map<number, number> = new Map();
  private oddsSnapshots: Map<string, { odds: MarketOdds; timestamp: number }> = new Map();
  private signalCooldownMs = 5000; // 5 second cooldown between signals
  private stats: EngineStats = {
    signalsGenerated: 0,
    tradesExecuted: 0,
    winningTrades: 0,
    losingTrades: 0,
    totalPnL: 0,
    avgEdgeCaptured: 0,
    avgLagDetected: 0,
    uptime: 0
  };
  private startTime = 0;

  constructor(
    binance: BinanceFeed,
    polymarket: PolymarketClient,
    config: Partial<ArbConfig> = {}
  ) {
    super();
    this.binance = binance;
    this.polymarket = polymarket;

    this.config = {
      minEdgeThreshold: config.minEdgeThreshold ?? 0.03,
      minLagSeconds: config.minLagSeconds ?? 30,
      maxLagSeconds: config.maxLagSeconds ?? 90,
      priceMovementThreshold: config.priceMovementThreshold ?? 0.001,
      maxPositionSize: config.maxPositionSize ?? 1000,
      riskPerTrade: config.riskPerTrade ?? 0.02
    };
  }

  start(): void {
    if (this.isRunning) return;

    this.isRunning = true;
    this.startTime = Date.now();
    console.log('[Engine] Starting arbitrage engine...');

    // Listen to Binance price movements
    this.binance.on('tick', this.onPriceTick.bind(this));
    this.binance.on('movement', this.onPriceMovement.bind(this));

    // Listen to Polymarket odds updates
    this.polymarket.on('oddsUpdate', this.onOddsUpdate.bind(this));

    // Start Polymarket polling
    this.polymarket.startPolling(3000);

    // Start lag detection loop
    this.startLagDetectionLoop();

    this.emit('started');
    console.log('[Engine] Arbitrage engine started');
  }

  stop(): void {
    this.isRunning = false;
    this.binance.removeAllListeners('tick');
    this.binance.removeAllListeners('movement');
    this.polymarket.removeAllListeners('oddsUpdate');
    this.polymarket.stopPolling();
    this.emit('stopped');
    console.log('[Engine] Arbitrage engine stopped');
  }

  private onPriceTick(tick: PriceTick): void {
    // Store price snapshot with timestamp
    this.priceSnapshots.set(tick.timestamp, tick.price);

    // Clean old snapshots (keep last 2 minutes)
    const cutoff = Date.now() - 120000;
    for (const [ts] of this.priceSnapshots) {
      if (ts < cutoff) {
        this.priceSnapshots.delete(ts);
      }
    }
  }

  private onPriceMovement(movement: PriceMovement): void {
    // Only care about significant movements
    if (movement.magnitude < this.config.priceMovementThreshold) {
      return;
    }

    // Check for lag opportunities
    //打印movement
    console.log(`binance onPriceMovement movement: ${JSON.stringify(movement)}`);
    this.checkLagOpportunity(movement);
  }

  private onOddsUpdate(odds: MarketOdds): void {
    this.oddsSnapshots.set(odds.marketId, {
      odds,
      timestamp: Date.now()
    });
  }

  private startLagDetectionLoop(): void {
    const loop = () => {
      if (!this.isRunning) return;

      this.scanForLagOpportunities();

      // Run every 500ms
      setTimeout(loop, 500);
    };

    loop();
  }

  private scanForLagOpportunities(): void {
    const currentMovement = this.binance.getCurrentMovement();
    if (!currentMovement || currentMovement.direction === 'NEUTRAL') {
      return;
    }

    // Check if movement is significant
    if (currentMovement.magnitude < this.config.priceMovementThreshold) {
      return;
    }

    // Check all active markets for lag
    const markets = this.polymarket.getActiveMarkets();

    for (const market of markets) {
      const oddsData = this.oddsSnapshots.get(market.id);
      if (!oddsData) continue;

      const lagSeconds = (Date.now() - oddsData.timestamp) / 1000;

      // Skip if lag is outside our window
      if (lagSeconds < this.config.minLagSeconds || lagSeconds > this.config.maxLagSeconds) {
        continue;
      }

      // Analyze for arbitrage opportunity
      const signal = this.analyzeOpportunity(market, oddsData.odds, currentMovement, lagSeconds);

      //打印signal.expectedEdge
      if (signal) {
        console.log(`signal.expectedEdge: ${signal.expectedEdge}`);
      }


      if (signal && signal.expectedEdge >= this.config.minEdgeThreshold) {
        this.emitSignal(signal);
      }
    }
  }

  private checkLagOpportunity(movement: PriceMovement): void {
    // Similar to scan but triggered by movement events
    const markets = this.polymarket.getActiveMarkets();

    for (const market of markets) {
      const oddsData = this.oddsSnapshots.get(market.id);
      if (!oddsData) continue;

      const lagSeconds = (Date.now() - oddsData.timestamp) / 1000;

      if (lagSeconds >= this.config.minLagSeconds && lagSeconds <= this.config.maxLagSeconds) {
        const signal = this.analyzeOpportunity(market, oddsData.odds, movement, lagSeconds);

        if (signal && signal.expectedEdge >= this.config.minEdgeThreshold) {
          this.emitSignal(signal);
        }
      }
    }
  }

  private analyzeOpportunity(
    market: BTCMarket,
    odds: MarketOdds,
    movement: PriceMovement,
    lagSeconds: number
  ): ArbSignal | null {
    // Determine what outcome the Binance movement suggests
    const suggestedOutcome = movement.direction;

    // Skip neutral movements
    if (suggestedOutcome === 'NEUTRAL') {
      return null;
    }

    // Get current Polymarket odds for that outcome
    const currentOddsForOutcome = suggestedOutcome === 'UP' ? odds.upPrice : odds.downPrice;

    // Calculate expected fair odds based on Binance movement
    // If BTC moved up significantly, UP should be priced higher
    // The "fair" probability increases with movement magnitude
    const movementConfidence = Math.min(0.95, 0.5 + movement.magnitude * 50);

    // Edge = fair probability - current price we'd pay
    const expectedEdge = movementConfidence - currentOddsForOutcome;

    if (expectedEdge <= 0) {
      return null; // No edge
    }

    // Calculate recommended position size (Kelly-inspired)
    const kellyFraction = expectedEdge / (1 - currentOddsForOutcome);
    const recommendedSize = Math.min(
      this.config.maxPositionSize,
      this.config.maxPositionSize * kellyFraction * 0.25 // Quarter Kelly
    );

    return {
      id: `arb_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      type: 'LAG_ARB',
      marketId: market.id,
      market,
      direction: suggestedOutcome,
      confidence: movementConfidence,
      expectedEdge,
      binancePrice: movement.currentPrice,
      binanceMovement: movement,
      polymarketOdds: odds,
      staleSeconds: lagSeconds,
      recommendedSize,
      timestamp: Date.now()
    };
  }

  private emitSignal(signal: ArbSignal): void {
    // Apply cooldown
    if (Date.now() - this.lastSignalTime < this.signalCooldownMs) {
      return;
    }

    this.lastSignalTime = Date.now();
    this.stats.signalsGenerated++;
    this.stats.avgLagDetected =
      (this.stats.avgLagDetected * (this.stats.signalsGenerated - 1) + signal.staleSeconds) /
      this.stats.signalsGenerated;

    console.log(`\n[Signal] ${signal.direction} opportunity detected!`);
    console.log(`  Market: ${signal.market.question.slice(0, 60)}...`);
    console.log(`  Binance: $${signal.binancePrice.toFixed(2)} (${signal.binanceMovement.direction} ${(signal.binanceMovement.magnitude * 100).toFixed(3)}%)`);
    console.log(`  Polymarket odds: UP=${signal.polymarketOdds.upPrice.toFixed(3)} DOWN=${signal.polymarketOdds.downPrice.toFixed(3)}`);
    console.log(`  Lag: ${signal.staleSeconds.toFixed(1)}s`);
    console.log(`  Expected edge: ${(signal.expectedEdge * 100).toFixed(2)}%`);
    console.log(`  Recommended size: $${signal.recommendedSize.toFixed(2)}`);

    this.emit('signal', signal);
  }

  recordTradeResult(pnl: number, edgeCaptured: number): void {
    this.stats.tradesExecuted++;
    this.stats.totalPnL += pnl;

    if (pnl > 0) {
      this.stats.winningTrades++;
    } else {
      this.stats.losingTrades++;
    }

    this.stats.avgEdgeCaptured =
      (this.stats.avgEdgeCaptured * (this.stats.tradesExecuted - 1) + edgeCaptured) /
      this.stats.tradesExecuted;
  }

  getStats(): EngineStats {
    return {
      ...this.stats,
      uptime: this.isRunning ? Date.now() - this.startTime : 0
    };
  }

  getConfig(): ArbConfig {
    return { ...this.config };
  }

  updateConfig(updates: Partial<ArbConfig>): void {
    Object.assign(this.config, updates);
    this.emit('configUpdated', this.config);
  }

  get running(): boolean {
    return this.isRunning;
  }
}
