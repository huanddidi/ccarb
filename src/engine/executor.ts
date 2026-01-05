import { EventEmitter } from 'events';
import { PolymarketClient, OrderResult, Position } from '../markets/polymarket.js';
import { ArbitrageEngine, ArbSignal } from './arbitrage.js';

export interface ExecutorConfig {
  mode: 'paper' | 'live';
  maxConcurrentTrades: number;
  exitDelayMs: number;         // Time to wait before exiting (let odds normalize)
  maxSlippage: number;         // Max acceptable slippage (e.g., 0.02 = 2%)
  minProfitToExit: number;     // Min profit % to trigger exit
  stopLoss: number;            // Stop loss threshold (e.g., -0.1 = -10%)
  trailingStop: boolean;       // Enable trailing stop
}

export interface Trade {
  id: string;
  signal: ArbSignal;
  entryOrder: OrderResult;
  exitOrder?: OrderResult;
  entryTime: number;
  exitTime?: number;
  status: 'OPEN' | 'CLOSED' | 'EXPIRED';
  pnl: number;
  edgeCaptured: number;
}

export class TradeExecutor extends EventEmitter {
  private readonly polymarket: PolymarketClient;
  private readonly engine: ArbitrageEngine;
  private readonly config: ExecutorConfig;
  private activeTrades: Map<string, Trade> = new Map();
  private tradeHistory: Trade[] = [];
  private dailyStats = {
    trades: 0,
    wins: 0,
    losses: 0,
    pnl: 0,
    volume: 0
  };
  private isEnabled = true;
  private paperBalance = 10000; // Starting paper balance

  constructor(
    polymarket: PolymarketClient,
    engine: ArbitrageEngine,
    config: Partial<ExecutorConfig> = {}
  ) {
    super();
    this.polymarket = polymarket;
    this.engine = engine;

    this.config = {
      mode: config.mode ?? 'paper',
      maxConcurrentTrades: config.maxConcurrentTrades ?? 5,
      exitDelayMs: config.exitDelayMs ?? 30000, // 30 seconds
      maxSlippage: config.maxSlippage ?? 0.02,
      minProfitToExit: config.minProfitToExit ?? 0.01,
      stopLoss: config.stopLoss ?? -0.1,
      trailingStop: config.trailingStop ?? true
    };

    // Listen for signals
    this.engine.on('signal', this.handleSignal.bind(this));
  }

  private async handleSignal(signal: ArbSignal): Promise<void> {
    if (!this.isEnabled) {
      console.log('[Executor] Trading disabled, ignoring signal');
      return;
    }

    // Check concurrent trade limit
    if (this.activeTrades.size >= this.config.maxConcurrentTrades) {
      console.log('[Executor] Max concurrent trades reached, skipping signal');
      return;
    }

    // Check if we already have a trade in this market
    for (const trade of this.activeTrades.values()) {
      if (trade.signal.marketId === signal.marketId) {
        console.log('[Executor] Already have position in this market');
        return;
      }
    }

    console.log(`\n[Executor] Processing signal ${signal.id}...`);
    await this.executeTrade(signal);
  }

  private async executeTrade(signal: ArbSignal): Promise<void> {
    const size = Math.min(signal.recommendedSize, this.getAvailableCapital() * 0.2);

    if (size < 10) {
      console.log('[Executor] Position size too small, skipping');
      return;
    }

    console.log(`[Executor] Executing ${signal.direction} trade, size: $${size.toFixed(2)}`);

    try {
      // Entry order
      const entryOrder = await this.polymarket.placeOrder({
        marketId: signal.marketId,
        side: 'BUY',
        outcome: signal.direction,
        size,
        price: signal.direction === 'UP' ? signal.polymarketOdds.upPrice : signal.polymarketOdds.downPrice
      });

      const trade: Trade = {
        id: `trade_${Date.now()}`,
        signal,
        entryOrder,
        entryTime: Date.now(),
        status: 'OPEN',
        pnl: 0,
        edgeCaptured: 0
      };

      this.activeTrades.set(trade.id, trade);
      this.dailyStats.trades++;
      this.dailyStats.volume += size;

      if (this.config.mode === 'paper') {
        this.paperBalance -= size;
      }

      console.log(`[Executor] Trade opened: ${trade.id}`);
      console.log(`  Entry price: ${entryOrder.avgPrice.toFixed(4)}`);
      console.log(`  Size: ${entryOrder.filledSize.toFixed(2)}`);

      this.emit('tradeOpened', trade);

      // Schedule exit
      this.scheduleExit(trade);
    } catch (error: any) {
      console.error('[Executor] Trade execution error:', error.message);
      this.emit('tradeError', { signal, error });
    }
  }

  private scheduleExit(trade: Trade): void {
    // Wait for odds to normalize, then exit
    setTimeout(async () => {
      await this.exitTrade(trade.id);
    }, this.config.exitDelayMs);

    // Also monitor for early exit conditions
    this.monitorPosition(trade);
  }

  private monitorPosition(trade: Trade): void {
    const checkInterval = setInterval(async () => {
      const activeTrade = this.activeTrades.get(trade.id);
      if (!activeTrade || activeTrade.status === 'CLOSED') {
        clearInterval(checkInterval);
        return;
      }

      // Get current odds
      const currentOdds = await this.polymarket.getMarketOdds(trade.signal.marketId);
      if (!currentOdds) return;

      const currentPrice = trade.signal.direction === 'UP' ? currentOdds.upPrice : currentOdds.downPrice;
      const entryPrice = trade.entryOrder.avgPrice;
      const pnlPct = (currentPrice - entryPrice) / entryPrice;

      // Update trade PnL
      activeTrade.pnl = pnlPct * trade.entryOrder.filledSize;

      // Check stop loss
      if (pnlPct <= this.config.stopLoss) {
        console.log(`[Executor] Stop loss triggered for ${trade.id}`);
        clearInterval(checkInterval);
        await this.exitTrade(trade.id, 'STOP_LOSS');
        return;
      }

      // Check profit target
      if (pnlPct >= this.config.minProfitToExit * 2) {
        console.log(`[Executor] Profit target reached for ${trade.id}`);
        clearInterval(checkInterval);
        await this.exitTrade(trade.id, 'PROFIT_TARGET');
        return;
      }
    }, 2000); // Check every 2 seconds
  }

  async exitTrade(tradeId: string, reason: string = 'SCHEDULED'): Promise<void> {
    const trade = this.activeTrades.get(tradeId);
    if (!trade || trade.status === 'CLOSED') {
      return;
    }

    console.log(`[Executor] Exiting trade ${tradeId} (reason: ${reason})`);

    try {
      const exitOrder = await this.polymarket.closePosition(
        trade.signal.marketId,
        trade.signal.direction
      );

      if (exitOrder) {
        trade.exitOrder = exitOrder;
        trade.exitTime = Date.now();

        // Calculate final PnL
        const entryValue = trade.entryOrder.avgPrice * trade.entryOrder.filledSize;
        const exitValue = exitOrder.avgPrice * exitOrder.filledSize;
        trade.pnl = exitValue - entryValue;
        trade.edgeCaptured = (exitOrder.avgPrice - trade.entryOrder.avgPrice) / trade.entryOrder.avgPrice;

        console.log(`[Executor] Trade closed: ${tradeId}`);
        console.log(`  Entry: ${trade.entryOrder.avgPrice.toFixed(4)} -> Exit: ${exitOrder.avgPrice.toFixed(4)}`);
        console.log(`  PnL: $${trade.pnl.toFixed(2)} (${(trade.edgeCaptured * 100).toFixed(2)}%)`);

        // Update stats
        this.dailyStats.pnl += trade.pnl;
        if (trade.pnl > 0) {
          this.dailyStats.wins++;
        } else {
          this.dailyStats.losses++;
        }

        if (this.config.mode === 'paper') {
          this.paperBalance += exitValue;
        }

        // Record in engine
        this.engine.recordTradeResult(trade.pnl, trade.edgeCaptured);
      }

      trade.status = 'CLOSED';
      this.activeTrades.delete(tradeId);
      this.tradeHistory.push(trade);

      this.emit('tradeClosed', trade);
    } catch (error: any) {
      console.error(`[Executor] Exit error for ${tradeId}:`, error.message);
      this.emit('exitError', { trade, error });
    }
  }

  private getAvailableCapital(): number {
    if (this.config.mode === 'paper') {
      return this.paperBalance;
    }

    // For live trading, sum available balance from positions
    const positions = this.polymarket.getAllPositions();
    const positionValue = positions.reduce((sum, p) => sum + p.size * p.currentPrice, 0);
    return positionValue;
  }

  enable(): void {
    this.isEnabled = true;
    console.log('[Executor] Trading enabled');
    this.emit('enabled');
  }

  disable(): void {
    this.isEnabled = false;
    console.log('[Executor] Trading disabled');
    this.emit('disabled');
  }

  async closeAllPositions(): Promise<void> {
    console.log('[Executor] Closing all positions...');
    for (const tradeId of this.activeTrades.keys()) {
      await this.exitTrade(tradeId, 'MANUAL_CLOSE');
    }
  }

  getActiveTrades(): Trade[] {
    return Array.from(this.activeTrades.values());
  }

  getTradeHistory(): Trade[] {
    return this.tradeHistory;
  }

  getDailyStats() {
    const winRate = this.dailyStats.trades > 0
      ? (this.dailyStats.wins / this.dailyStats.trades) * 100
      : 0;

    return {
      ...this.dailyStats,
      winRate,
      paperBalance: this.paperBalance
    };
  }

  resetDailyStats(): void {
    this.dailyStats = {
      trades: 0,
      wins: 0,
      losses: 0,
      pnl: 0,
      volume: 0
    };
  }

  getConfig(): ExecutorConfig {
    return { ...this.config };
  }

  updateConfig(updates: Partial<ExecutorConfig>): void {
    Object.assign(this.config, updates);
    this.emit('configUpdated', this.config);
  }

  get enabled(): boolean {
    return this.isEnabled;
  }

  get tradingMode(): 'paper' | 'live' {
    return this.config.mode;
  }
}
