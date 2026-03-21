export interface DbAgent {
  id: string;
  user_id: string;
  name: string;
  strategy: string;
  status: string;
  mode: string;
  config: Record<string, number | string>;
  budget: number;
  model_id: string;
  pnl: number;
  pnl_pct: number;
  trades_count: number;
  win_rate: number;
  max_drawdown: number;
}

export interface AgentLogInsert {
  agent_id: string;
  user_id: string;
  agent_name: string;
  strategy: string;
  signal_detected: boolean;
  signal_symbol?: string;
  signal_side?: string;
  ai_reasoning?: string;
  ai_confidence?: number;
  action: "traded" | "skipped" | "error";
  skip_reason?: string;
  trade_symbol?: string;
  trade_qty?: number;
  trade_price?: number;
  trade_pnl?: number;
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
  /**
   * For buys: percentage of budget (e.g. 10 = 10%).
   * For sells: dollar value of the position to close.
   *   - Full sell: pass heldQty * currentPrice.
   *   - Partial sell: pass partialQty * currentPrice (index.ts calculates qty from dollarAmount).
   */
  notional: number;
  reason: string;
  strategyConfidence: number;
  marketData: {
    currentPrice: number;
    sma?: number;
    rsi?: number;
    dipPct?: number;
    sentimentScore?: number;
  };
  /**
   * When true, the strategy already made the Groq AI decision (e.g. News Trader, Blind Quant).
   * index.ts will skip the confirmTrade call and use strategyConfidence + reason directly.
   */
  skipAiConfirmation?: boolean;
  /**
   * Short-selling flag.
   * side="sell" + isShort=true → open a new short position (sell shares we don't own).
   *   notional = % of budget (same as a buy).
   * side="buy"  + isShort=true → cover an existing short position (buy back).
   *   notional = dollar value of the short to close (same as a regular sell).
   */
  isShort?: boolean;
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
