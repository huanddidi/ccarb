import dotenv from 'dotenv';

dotenv.config();

export interface AppConfig {
  polymarket: {
    apiKey: string;
    apiSecret: string;
    passphrase: string;
    privateKey: string;
  };
  trading: {
    mode: 'paper' | 'live';
    maxPositionSize: number;
    minEdgeThreshold: number;
    maxDailyTrades: number;
    riskPerTrade: number;
  };
  lag: {
    minLagSeconds: number;
    maxLagSeconds: number;
    priceMovementThreshold: number;
  };
  executor: {
    maxConcurrentTrades: number;
    exitDelayMs: number;
    maxSlippage: number;
    minProfitToExit: number;
    stopLoss: number;
  };
}

export function loadConfig(): AppConfig {
  return {
    polymarket: {
      apiKey: process.env.POLYMARKET_API_KEY || '',
      apiSecret: process.env.POLYMARKET_SECRET || '',
      passphrase: process.env.POLYMARKET_PASSPHRASE || '',
      privateKey: process.env.PRIVATE_KEY || ''
    },
    trading: {
      mode: (process.env.TRADING_MODE as 'paper' | 'live') || 'paper',
      maxPositionSize: parseFloat(process.env.MAX_POSITION_SIZE || '1000'),
      minEdgeThreshold: parseFloat(process.env.MIN_EDGE_THRESHOLD || '0.03'),
      maxDailyTrades: parseInt(process.env.MAX_DAILY_TRADES || '100', 10),
      riskPerTrade: parseFloat(process.env.RISK_PER_TRADE || '0.02')
    },
    lag: {
      minLagSeconds: parseFloat(process.env.MIN_LAG_SECONDS || '30'),
      maxLagSeconds: parseFloat(process.env.MAX_LAG_SECONDS || '90'),
      priceMovementThreshold: parseFloat(process.env.PRICE_MOVE_THRESHOLD || '0.001')
    },
    executor: {
      maxConcurrentTrades: parseInt(process.env.MAX_CONCURRENT_TRADES || '5', 10),
      exitDelayMs: parseInt(process.env.EXIT_DELAY_MS || '30000', 10),
      maxSlippage: parseFloat(process.env.MAX_SLIPPAGE || '0.02'),
      minProfitToExit: parseFloat(process.env.MIN_PROFIT_TO_EXIT || '0.01'),
      stopLoss: parseFloat(process.env.STOP_LOSS || '-0.1')
    }
  };
}

export function validateConfig(config: AppConfig): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  // For live trading, require API keys
  if (config.trading.mode === 'live') {
    if (!config.polymarket.apiKey) {
      errors.push('POLYMARKET_API_KEY is required for live trading');
    }
    if (!config.polymarket.apiSecret) {
      errors.push('POLYMARKET_SECRET is required for live trading');
    }
    if (!config.polymarket.passphrase) {
      errors.push('POLYMARKET_PASSPHRASE is required for live trading');
    }
    if (!config.polymarket.privateKey) {
      errors.push('PRIVATE_KEY is required for live trading');
    }
  }

  // Validate numeric ranges
  if (config.trading.minEdgeThreshold < 0 || config.trading.minEdgeThreshold > 1) {
    errors.push('MIN_EDGE_THRESHOLD must be between 0 and 1');
  }

  if (config.lag.minLagSeconds < 0 || config.lag.minLagSeconds > config.lag.maxLagSeconds) {
    errors.push('MIN_LAG_SECONDS must be positive and less than MAX_LAG_SECONDS');
  }

  if (config.trading.maxPositionSize <= 0) {
    errors.push('MAX_POSITION_SIZE must be positive');
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

export function printConfig(config: AppConfig): void {
  console.log('\n=== Configuration ===');
  console.log(`Mode:               ${config.trading.mode.toUpperCase()}`);
  console.log(`Max Position Size:  $${config.trading.maxPositionSize}`);
  console.log(`Min Edge Threshold: ${(config.trading.minEdgeThreshold * 100).toFixed(1)}%`);
  console.log(`Lag Window:         ${config.lag.minLagSeconds}s - ${config.lag.maxLagSeconds}s`);
  console.log(`Price Move Threshold: ${(config.lag.priceMovementThreshold * 100).toFixed(2)}%`);
  console.log(`Max Concurrent Trades: ${config.executor.maxConcurrentTrades}`);
  console.log(`Exit Delay:         ${config.executor.exitDelayMs / 1000}s`);
  console.log(`Stop Loss:          ${(config.executor.stopLoss * 100).toFixed(1)}%`);
  console.log('=====================\n');
}
