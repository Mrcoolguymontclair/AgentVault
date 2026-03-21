import { supabase } from "@/lib/supabase";

// ─── Company name lookup ──────────────────────────────────────────────────────
const COMPANY_NAMES: Record<string, string> = {
  SPY:  "S&P 500 ETF",
  QQQ:  "Nasdaq 100 ETF",
  AAPL: "Apple Inc.",
  MSFT: "Microsoft Corp.",
  NVDA: "NVIDIA Corp.",
  TSLA: "Tesla Inc.",
  AMZN: "Amazon.com",
  GOOGL: "Alphabet Inc.",
  META: "Meta Platforms",
  AMD:  "Advanced Micro",
  NFLX: "Netflix Inc.",
  JPM:  "JPMorgan Chase",
  V:    "Visa Inc.",
  UNH:  "UnitedHealth",
  COST: "Costco Wholesale",
};

export function getCompanyName(symbol: string): string {
  return COMPANY_NAMES[symbol] ?? symbol;
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface Holding {
  symbol: string;
  totalQuantity: number;
  avgCost: number;
  lastPrice: number;
  currentValue: number;
  unrealizedPnl: number;
  unrealizedPnlPct: number;
  agentCount: number;
  priceHistory: number[];
}

export interface AgentHolding {
  symbol: string;
  quantity: number;
  avgCost: number;
  lastPrice: number;
  currentValue: number;
  unrealizedPnl: number;
  unrealizedPnlPct: number;
  priceHistory: number[];
}

export interface PortfolioStats {
  totalTrades: number;
  winningTrades: number;
  winRate: number;
  totalPnl: number;
  avgTradePnl: number;
  bestTradeSymbol: string;
  bestTradePnl: number;
  worstTradeSymbol: string;
  worstTradePnl: number;
  activeSince: string | null;
  sharpeRatio: number | null;
  maxDrawdownPct: number;
}

// ─── Fetch functions ──────────────────────────────────────────────────────────

export async function fetchPortfolioHoldings(userId: string): Promise<Holding[]> {
  const { data, error } = await supabase.rpc("rpc_get_portfolio_holdings", {
    p_user_id: userId,
  });
  if (error || !data) return [];
  return (data as any[]).map((row) => ({
    symbol: row.symbol,
    totalQuantity: Number(row.total_quantity),
    avgCost: Number(row.avg_cost),
    lastPrice: Number(row.last_price),
    currentValue: Number(row.current_value),
    unrealizedPnl: Number(row.unrealized_pnl),
    unrealizedPnlPct: Number(row.unrealized_pnl_pct),
    agentCount: Number(row.agent_count),
    priceHistory: (row.price_history ?? []).map(Number),
  }));
}

export async function fetchPortfolioStats(userId: string): Promise<PortfolioStats | null> {
  const { data, error } = await supabase.rpc("rpc_get_portfolio_stats", {
    p_user_id: userId,
  });
  if (error || !data) return null;
  const rows = data as any[];
  if (!rows.length) return null;
  const row = rows[0];
  return {
    totalTrades: Number(row.total_trades),
    winningTrades: Number(row.winning_trades),
    winRate: Number(row.win_rate),
    totalPnl: Number(row.total_pnl),
    avgTradePnl: Number(row.avg_trade_pnl),
    bestTradeSymbol: row.best_trade_symbol ?? "—",
    bestTradePnl: Number(row.best_trade_pnl),
    worstTradeSymbol: row.worst_trade_symbol ?? "—",
    worstTradePnl: Number(row.worst_trade_pnl),
    activeSince: row.active_since ?? null,
    sharpeRatio: row.sharpe_ratio !== null && row.sharpe_ratio !== undefined
      ? Number(row.sharpe_ratio) : null,
    maxDrawdownPct: Number(row.max_drawdown_pct),
  };
}

/**
 * Apply fresh current prices to a holdings array.
 * Recomputes lastPrice, currentValue, unrealizedPnl, unrealizedPnlPct for each holding.
 * Holdings for symbols not in `prices` are returned unchanged.
 */
export function applyCurrentPrices(holdings: Holding[], prices: Record<string, number>): Holding[] {
  return holdings.map((h) => {
    const price = prices[h.symbol];
    if (!price || price <= 0) return h;

    const isShort = h.totalQuantity < 0;
    const absQty  = Math.abs(h.totalQuantity);

    // For longs:  currentValue = price * qty  (positive)
    // For shorts: currentValue = -(price * absQty)  (negative — a liability)
    const currentValue = isShort ? -(price * absQty) : price * h.totalQuantity;

    // P&L formula works for both signs of qty:
    // Long:  (price - avgCost) *  qty  → positive when price rises
    // Short: (price - avgCost) * -qty  → positive when price falls
    const unrealizedPnl = (price - h.avgCost) * h.totalQuantity;

    // Pct relative to invested capital (always positive denominator)
    const investedCapital  = absQty * h.avgCost;
    const unrealizedPnlPct = investedCapital > 0 ? (unrealizedPnl / investedCapital) * 100 : 0;

    return { ...h, lastPrice: price, currentValue, unrealizedPnl, unrealizedPnlPct };
  });
}

export async function fetchAgentHoldings(agentId: string): Promise<AgentHolding[]> {
  const { data, error } = await supabase.rpc("rpc_get_agent_holdings", {
    p_agent_id: agentId,
  });
  if (error || !data) return [];
  return (data as any[]).map((row) => ({
    symbol: row.symbol,
    quantity: Number(row.quantity),
    avgCost: Number(row.avg_cost),
    lastPrice: Number(row.last_price),
    currentValue: Number(row.current_value),
    unrealizedPnl: Number(row.unrealized_pnl),
    unrealizedPnlPct: Number(row.unrealized_pnl_pct),
    priceHistory: (row.price_history ?? []).map(Number),
  }));
}
