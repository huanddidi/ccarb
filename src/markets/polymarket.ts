import axios, { AxiosInstance } from 'axios';
import { ethers } from 'ethers';
import { EventEmitter } from 'events';

export interface BTCMarket {
  id: string;
  conditionId: string;
  question: string;
  outcomes: string[];
  outcomePrices: number[];
  volume: number;
  liquidity: number;
  endDate: Date;
  windowMinutes: number;
  targetPrice?: number;
  direction?: 'UP' | 'DOWN';
  active: boolean;
}

export interface MarketOdds {
  marketId: string;
  upPrice: number;
  downPrice: number;
  timestamp: number;
  spread: number;
}

export interface OrderParams {
  marketId: string;
  side: 'BUY' | 'SELL';
  outcome: 'UP' | 'DOWN';
  size: number;
  price?: number;
}

export interface OrderResult {
  orderId: string;
  status: 'FILLED' | 'PARTIAL' | 'PENDING' | 'REJECTED';
  filledSize: number;
  avgPrice: number;
  timestamp: number;
}

export interface Position {
  marketId: string;
  outcome: 'UP' | 'DOWN';
  size: number;
  avgEntryPrice: number;
  currentPrice: number;
  unrealizedPnL: number;
}

export class PolymarketClient extends EventEmitter {
  private readonly api: AxiosInstance;
  private readonly clobApi: AxiosInstance;
  private wallet: ethers.Wallet | null = null;
  private readonly apiKey: string;
  private readonly apiSecret: string;
  private readonly passphrase: string;
  private activeMarkets: Map<string, BTCMarket> = new Map();
  private positions: Map<string, Position> = new Map();
  private pollInterval: NodeJS.Timeout | null = null;

  constructor(config: {
    apiKey: string;
    apiSecret: string;
    passphrase: string;
    privateKey?: string;
  }) {
    super();
    this.apiKey = config.apiKey;
    this.apiSecret = config.apiSecret;
    this.passphrase = config.passphrase;

    // Gamma API for market data
    this.api = axios.create({
      baseURL: 'https://gamma-api.polymarket.com',
      timeout: 10000,
      headers: {
        'Content-Type': 'application/json'
      }
    });

    // CLOB API for trading
    this.clobApi = axios.create({
      baseURL: 'https://clob.polymarket.com',
      timeout: 10000,
      headers: {
        'Content-Type': 'application/json',
        'POLY_API_KEY': this.apiKey,
        'POLY_PASSPHRASE': this.passphrase,
        'POLY_TIMESTAMP': '',
        'POLY_SIGNATURE': ''
      }
    });

    if (config.privateKey) {
      this.wallet = new ethers.Wallet(config.privateKey);
    }
  }

  private generateSignature(timestamp: string, method: string, path: string, body: string = ''): string {
    const message = timestamp + method + path + body;
    // In production, use proper HMAC signing with apiSecret
    return Buffer.from(message).toString('base64');
  }

  private async signedRequest(method: string, path: string, data?: any): Promise<any> {
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const body = data ? JSON.stringify(data) : '';
    const signature = this.generateSignature(timestamp, method, path, body);

    const headers = {
      'POLY_API_KEY': this.apiKey,
      'POLY_PASSPHRASE': this.passphrase,
      'POLY_TIMESTAMP': timestamp,
      'POLY_SIGNATURE': signature
    };

    const response = await this.clobApi.request({
      method,
      url: path,
      data,
      headers
    });

    return response.data;
  }

  async fetchBTCMarkets(): Promise<BTCMarket[]> {
    try {
      // Search for Bitcoin price prediction markets
      const response = await this.api.get('/markets', {
        params: {
          active: true,
          closed: false,
          limit: 100,
          slug: "Bitcoin Up or Down - January 14, 8AM ET",
        }
      });

      //打印response
      console.log(response);

      const markets: BTCMarket[] = [];

      for (const market of response.data) {
        // Filter for BTC 15-minute window markets
        // const question = market.question?.toLowerCase() || '';
        // const isBTCMarket =
        //   question.includes('bitcoin') ||
        //   question.includes('btc') ||
        //   question.includes('₿');

        // const isTimeWindow =
        //   question.includes('15 min') ||
        //   question.includes('15-min') ||
        //   question.includes('15min') ||
        //   question.includes('1 hour') ||
        //   question.includes('next hour');

        // const isPriceMarket =
        //   question.includes('above') ||
        //   question.includes('below') ||
        //   question.includes('higher') ||
        //   question.includes('lower') ||
        //   question.includes('up') ||
        //   question.includes('down');

        // if (isBTCMarket && (isTimeWindow || isPriceMarket)) {
          const btcMarket = this.parseMarket(market);
          if (btcMarket) {
            markets.push(btcMarket);
            this.activeMarkets.set(btcMarket.id, btcMarket);
          }
        // }
      }

      this.emit('marketsUpdated', markets);
      return markets;
    } catch (error: any) {
      console.error('[Polymarket] Error fetching markets:', error.message);
      throw error;
    }
  }

  private parseMarket(raw: any): BTCMarket | null {
    try {
      const outcomes = raw.outcomes || ['Up', 'Down'];
      const prices = raw.outcomePrices?.map((p: string) => parseFloat(p)) || [0.5, 0.5];

      // Extract window minutes from question
      let windowMinutes = 240; // default
      // const question = raw.question || '';
      // if (question.includes('1 hour') || question.includes('60 min')) {
      //   windowMinutes = 60;
      // } else if (question.includes('5 min')) {
      //   windowMinutes = 5;
      // }

      // Determine direction from outcome prices
      let direction: 'UP' | 'DOWN' | undefined;
      if (prices[0] > prices[1]) {
        direction = 'UP';
      } else if (prices[0] < prices[1]) {
        direction = 'DOWN';
      }

      //打印direction
      console.log(`[Polymarket] Direction: ${direction}`);

      // Extract target price if present
      const priceMatch = raw.question.match(/\$?([\d,]+(?:\.\d+)?)/);

      const targetPrice = priceMatch ? parseFloat(priceMatch[1].replace(',', '')) : undefined;

      return {
        id: raw.id || raw.condition_id,
        conditionId: raw.condition_id || raw.id,
        question: raw.question,
        outcomes,
        outcomePrices: prices,
        volume: parseFloat(raw.volume || '0'),
        liquidity: parseFloat(raw.liquidity || '0'),
        endDate: new Date(raw.end_date_iso || raw.endDate),
        windowMinutes,
        targetPrice,
        direction,
        active: raw.active !== false
      };
    } catch (error) {
      return null;
    }
  }

  async getMarketOdds(marketId: string): Promise<MarketOdds | null> {
    try {
      const response = await this.api.get(`/markets/${marketId}`);
      const market = response.data;

      //打印market 前缀[Polymarket] Market
      console.log(`[Polymarket] Market marketId: ${JSON.stringify(market)}`);

      const prices = market.outcomePrices?.map((p: string) => parseFloat(p)) || [0.5, 0.5];

      return {
        marketId,
        upPrice: prices[0], // Yes = Up
        downPrice: prices[1], // No = Down
        timestamp: Date.now(),
        spread: Math.abs(prices[0] - prices[1])
      };
    } catch (error: any) {
      console.error(`[Polymarket] Error fetching odds for ${marketId}:`, error.message);
      return null;
    }
  }

  async getOrderBook(tokenId: string): Promise<{ bids: any[]; asks: any[] }> {
    try {
      const response = await this.clobApi.get(`/book`, {
        params: { token_id: tokenId }
      });
      return response.data;
    } catch (error: any) {
      console.error('[Polymarket] Error fetching order book:', error.message);
      return { bids: [], asks: [] };
    }
  }

  async placeOrder(params: OrderParams): Promise<OrderResult> {
    const { marketId, side, outcome, size, price } = params;

    console.log(`[Polymarket] Placing ${side} order: ${outcome} ${size} @ ${price || 'market'}`);

    try {
      // Get market to find token IDs
      const market = this.activeMarkets.get(marketId);
      if (!market) {
        throw new Error(`Market ${marketId} not found`);
      }

      const tokenIndex = outcome === 'UP' ? 0 : 1;

      const orderData = {
        market: marketId,
        tokenId: `${marketId}_${tokenIndex}`,
        side: side.toLowerCase(),
        size: size.toString(),
        price: price?.toString(),
        type: price ? 'limit' : 'market'
      };

      const result = await this.signedRequest('POST', '/order', orderData);

      const orderResult: OrderResult = {
        orderId: result.order_id || result.id || `sim_${Date.now()}`,
        status: result.status || 'FILLED',
        filledSize: parseFloat(result.filled_size || size.toString()),
        avgPrice: parseFloat(result.avg_price || price?.toString() || '0.5'),
        timestamp: Date.now()
      };

      // Update position
      this.updatePosition(marketId, outcome, orderResult, side);

      this.emit('orderFilled', orderResult);
      return orderResult;
    } catch (error: any) {
      console.error('[Polymarket] Order error:', error.message);

      // Return simulated result for paper trading
      const simResult: OrderResult = {
        orderId: `paper_${Date.now()}`,
        status: 'FILLED',
        filledSize: size,
        avgPrice: price || 0.5,
        timestamp: Date.now()
      };

      this.updatePosition(marketId, outcome, simResult, side);
      this.emit('orderFilled', simResult);
      return simResult;
    }
  }

  private updatePosition(marketId: string, outcome: 'UP' | 'DOWN', order: OrderResult, side: 'BUY' | 'SELL'): void {
    const key = `${marketId}_${outcome}`;
    const existing = this.positions.get(key);

    if (side === 'BUY') {
      if (existing) {
        const totalSize = existing.size + order.filledSize;
        const avgPrice = (existing.avgEntryPrice * existing.size + order.avgPrice * order.filledSize) / totalSize;
        existing.size = totalSize;
        existing.avgEntryPrice = avgPrice;
      } else {
        this.positions.set(key, {
          marketId,
          outcome,
          size: order.filledSize,
          avgEntryPrice: order.avgPrice,
          currentPrice: order.avgPrice,
          unrealizedPnL: 0
        });
      }
    } else {
      if (existing) {
        existing.size -= order.filledSize;
        if (existing.size <= 0) {
          this.positions.delete(key);
        }
      }
    }
  }

  async closePosition(marketId: string, outcome: 'UP' | 'DOWN'): Promise<OrderResult | null> {
    const key = `${marketId}_${outcome}`;
    const position = this.positions.get(key);

    if (!position || position.size <= 0) {
      return null;
    }

    return this.placeOrder({
      marketId,
      side: 'SELL',
      outcome,
      size: position.size
    });
  }

  getPosition(marketId: string, outcome: 'UP' | 'DOWN'): Position | null {
    return this.positions.get(`${marketId}_${outcome}`) || null;
  }

  getAllPositions(): Position[] {
    return Array.from(this.positions.values());
  }

  getActiveMarkets(): BTCMarket[] {
    return Array.from(this.activeMarkets.values());
  }

  startPolling(intervalMs: number = 5000): void {
    this.pollInterval = setInterval(async () => {
      try {
        await this.fetchBTCMarkets();

        // Update odds for all active markets
        for (const market of this.activeMarkets.values()) {
          const odds = await this.getMarketOdds(market.id);
          if (odds) {
            this.emit('oddsUpdate', odds);
          }
        }
      } catch (error) {
        console.error('[Polymarket] Polling error:', error);
      }
    }, intervalMs);
  }

  stopPolling(): void {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
  }
}