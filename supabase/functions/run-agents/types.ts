export interface DbAgent {
  id: string;
  user_id: string;
  name: string;
  strategy: string;
  status: string;
  mode: string;
  config: Record<string, number>;
  budget: number;
  model_id: string;
  pnl: number;
  pnl_pct: number;
  trades_count: number;
  win_rate: number;
  max_drawdown: number;
}

export interface BarData {
  t: string;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
  vw?: number;
}

export interface TradeSignal {
  symbol: string;
  side: "buy" | "sell";
  /** Dollar amount to allocate */
  notional: number;
  reason: string;
  strategyConfidence: number;
  marketData: {
    currentPrice: number;
    sma?: number;
    rsi?: number;
    dipPct?: number;
  };
}

export interface AIDecision {
  execute: boolean;
  reasoning: string;
  confidence: number;
}

export interface ExecutionResult {
  agentId: string;
  agentName: string;
  success: boolean;
  skipped?: boolean;
  skipReason?: string;
  symbol?: string;
  side?: string;
  qty?: number;
  price?: number;
  pnl?: number;
  aiReasoning?: string;
  error?: string;
}
