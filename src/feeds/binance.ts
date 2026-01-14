import WebSocket from 'ws';
import { EventEmitter } from 'events';

export interface PriceTick {
  symbol: string;
  price: number;
  timestamp: number;
  volume24h?: number;
}

export interface PriceMovement {
  direction: 'UP' | 'DOWN' | 'NEUTRAL';
  magnitude: number;
  startPrice: number;
  currentPrice: number;
  durationMs: number;
  timestamp: number;
}

export class BinanceFeed extends EventEmitter {
  private ws: WebSocket | null = null;
  private readonly symbol: string;
  private readonly wsUrl: string;
  private priceHistory: PriceTick[] = [];
  private readonly maxHistorySize = 1000;
  private reconnectAttempts = 0;
  private readonly maxReconnectAttempts = 10;
  private isConnected = false;
  private lastPrice: number = 0;
  private windowStartPrice: number = 0;
  private windowStartTime: number = 0;
  private readonly priceWindowMs: number;

  constructor(symbol: string = 'btcusdt', priceWindowMs: number = 15000) {
    super();
    this.symbol = symbol.toLowerCase();
    this.priceWindowMs = priceWindowMs;
    this.wsUrl = `wss://stream.binance.me:9443/ws/${this.symbol}@trade`;
  }

  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.ws = new WebSocket(this.wsUrl);

        this.ws.on('open', () => {
          console.log(`[Binance] Connected to ${this.symbol} trade stream`);
          this.isConnected = true;
          this.reconnectAttempts = 0;
          this.emit('connected');
          resolve();
        });

        this.ws.on('message', (data: WebSocket.Data) => {
          this.handleMessage(data);
        });

        this.ws.on('close', () => {
          console.log('[Binance] Connection closed');
          this.isConnected = false;
          this.emit('disconnected');
          this.attemptReconnect();
        });

        this.ws.on('error', (error) => {
          console.error('[Binance] WebSocket error:', error.message);
          this.emit('error', error);
          if (!this.isConnected) {
            reject(error);
          }
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  private handleMessage(data: WebSocket.Data): void {
    try {
      const trade = JSON.parse(data.toString());
      const tick: PriceTick = {
        symbol: trade.s,
        price: parseFloat(trade.p),
        timestamp: trade.T,
        volume24h: parseFloat(trade.q)
      };

      this.lastPrice = tick.price;
      this.priceHistory.push(tick);

      // Trim history
      if (this.priceHistory.length > this.maxHistorySize) {
        this.priceHistory.shift();
      }

      // Initialize window if needed
      if (this.windowStartPrice === 0) {
        this.windowStartPrice = tick.price;
        this.windowStartTime = tick.timestamp;
      }

      // Emit tick
      this.emit('tick', tick);

      // Check for significant price movement
      const movement = this.detectMovement(tick);
      if (movement && movement.direction !== 'NEUTRAL') {
        this.emit('movement', movement);
      }

      // Reset window periodically
      if (tick.timestamp - this.windowStartTime >= this.priceWindowMs) {
        this.windowStartPrice = tick.price;
        this.windowStartTime = tick.timestamp;
      }
    } catch (error) {
      console.error('[Binance] Error parsing message:', error);
    }
  }

  private detectMovement(tick: PriceTick): PriceMovement | null {
    if (this.windowStartPrice === 0) return null;

    const priceDiff = tick.price - this.windowStartPrice;
    const magnitude = Math.abs(priceDiff) / this.windowStartPrice;
    const durationMs = tick.timestamp - this.windowStartTime;

    let direction: 'UP' | 'DOWN' | 'NEUTRAL' = 'NEUTRAL';
    if (priceDiff > 0) direction = 'UP';
    else if (priceDiff < 0) direction = 'DOWN';

    return {
      direction,
      magnitude,
      startPrice: this.windowStartPrice,
      currentPrice: tick.price,
      durationMs,
      timestamp: tick.timestamp
    };
  }

  private attemptReconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('[Binance] Max reconnection attempts reached');
      this.emit('maxReconnectAttempts');
      return;
    }

    this.reconnectAttempts++;
    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);
    console.log(`[Binance] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`);

    setTimeout(() => {
      this.connect().catch(console.error);
    }, delay);
  }

  getLastPrice(): number {
    return this.lastPrice;
  }

  getPriceHistory(count: number = 100): PriceTick[] {
    return this.priceHistory.slice(-count);
  }

  getCurrentMovement(): PriceMovement | null {
    if (this.priceHistory.length === 0) return null;
    const lastTick = this.priceHistory[this.priceHistory.length - 1];
    return this.detectMovement(lastTick);
  }

  getVWAP(windowMs: number = 60000): number {
    const now = Date.now();
    const windowTicks = this.priceHistory.filter(t => now - t.timestamp <= windowMs);

    if (windowTicks.length === 0) return this.lastPrice;

    let volumeSum = 0;
    let priceVolumeSum = 0;

    for (const tick of windowTicks) {
      const vol = tick.volume24h || 1;
      volumeSum += vol;
      priceVolumeSum += tick.price * vol;
    }

    return priceVolumeSum / volumeSum;
  }

  disconnect(): void {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.isConnected = false;
  }

  get connected(): boolean {
    return this.isConnected;
  }
}
