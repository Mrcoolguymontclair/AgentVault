export type TimeHorizonId = "fast" | "medium" | "slow";
export type RiskLevel = "low" | "medium" | "high";
export type StrategyId =
  | "momentum_rider"
  | "mean_reversion"
  | "news_sentiment"
  | "prediction_arb"
  | "dca_plus"
  | "custom"
  | "news_trader"
  | "blind_quant";

export type ModelId = "groq_llama" | "claude_haiku" | "claude_sonnet";

export interface StrategyParam {
  key: string;
  label: string;
  hint: string;
  min: number;
  max: number;
  step: number;
  unit: string;
  default: number;
}

export interface Strategy {
  id: StrategyId;
  name: string;
  tagline: string;
  description: string;
  icon: string;
  risk: RiskLevel;
  params: StrategyParam[];
  nameSuggestions: string[];
}

export interface AIModel {
  id: ModelId;
  name: string;
  provider: string;
  description: string;
  icon: string;
  requiredPlan: "free" | "pro" | "elite";
  badge: string;
}

export interface TimeHorizon {
  id: TimeHorizonId;
  name: string;
  subtitle: string;
  icon: string;
  description: string;
  holdPeriod: string;
  targets: string;
  stopLoss: string;
  rsiPeriod: number;
  smaPeriod: number;
  positionSizePct: number;
  bestFor: StrategyId[];
}

export const TIME_HORIZONS: TimeHorizon[] = [
  {
    id: "fast",
    name: "Fast",
    subtitle: "Day Trading",
    icon: "⚡",
    description: "Trades multiple times per day, holds positions for minutes to hours. Uses 1-min and 5-min candles. High turnover with tight stops.",
    holdPeriod: "Minutes to hours",
    targets: "0.5–2% moves",
    stopLoss: "1–2% tight stops",
    rsiPeriod: 7,
    smaPeriod: 9,
    positionSizePct: 5,
    bestFor: ["momentum_rider", "mean_reversion"],
  },
  {
    id: "medium",
    name: "Medium",
    subtitle: "Swing Trading",
    icon: "📊",
    description: "Trades a few times per week, holds positions for 1–5 days. Uses hourly and daily candles. Balanced risk and frequency.",
    holdPeriod: "1–5 days",
    targets: "2–8% moves",
    stopLoss: "3–5% moderate stops",
    rsiPeriod: 14,
    smaPeriod: 20,
    positionSizePct: 10,
    bestFor: ["momentum_rider", "mean_reversion", "news_sentiment", "prediction_arb", "dca_plus"],
  },
  {
    id: "slow",
    name: "Slow",
    subtitle: "Long-Term",
    icon: "🐢",
    description: "Trades a few times per month, holds positions for weeks to months. Uses daily and weekly candles. Wide stops, large target moves.",
    holdPeriod: "Weeks to months",
    targets: "8–20%+ moves",
    stopLoss: "8–15% wide stops",
    rsiPeriod: 21,
    smaPeriod: 50,
    positionSizePct: 15,
    bestFor: ["dca_plus", "news_sentiment"],
  },
];

export const STRATEGIES: Strategy[] = [
  {
    id: "momentum_rider",
    name: "Momentum Rider",
    tagline: "Ride the trend until it bends",
    description:
      "Buys when price breaks above its 20-day moving average, sells when it breaks below. Captures strong directional moves.",
    icon: "🚀",
    risk: "medium",
    nameSuggestions: ["Alpha Rider", "Trend Hawk", "Bull Runner", "Wave Breaker", "Momentum X"],
    params: [
      { key: "lookback", label: "Lookback Period", hint: "Days for moving average", min: 5, max: 50, step: 1, unit: " days", default: 20 },
      { key: "position_size", label: "Position Size", hint: "% of budget per trade", min: 1, max: 20, step: 1, unit: "%", default: 10 },
      { key: "stop_loss", label: "Stop Loss", hint: "Max loss before exit", min: 1, max: 15, step: 0.5, unit: "%", default: 5 },
    ],
  },
  {
    id: "mean_reversion",
    name: "Mean Reversion",
    tagline: "Buy low, sell high — systematically",
    description:
      "Buys oversold conditions (RSI < 30) and sells overbought (RSI > 70). Profits from price extremes snapping back.",
    icon: "📈",
    risk: "medium",
    nameSuggestions: ["Mean Machine", "Bounce Bot", "Snap Master", "Equilibrium X", "Rubber Band"],
    params: [
      { key: "rsi_oversold", label: "RSI Oversold", hint: "Buy when RSI falls below", min: 20, max: 40, step: 1, unit: "", default: 30 },
      { key: "rsi_overbought", label: "RSI Overbought", hint: "Sell when RSI rises above", min: 60, max: 85, step: 1, unit: "", default: 70 },
      { key: "position_size", label: "Position Size", hint: "% of budget per trade", min: 1, max: 20, step: 1, unit: "%", default: 10 },
    ],
  },
  {
    id: "news_sentiment",
    name: "News Sentiment",
    tagline: "Trade the headlines before they move the market",
    description:
      "AI reads breaking news and earnings calls in real time, scoring sentiment to enter positions before market reaction.",
    icon: "📰",
    risk: "high",
    nameSuggestions: ["News Ninja", "Headline Bot", "Sentiment 9K", "Media Hawk", "Alpha Reader"],
    params: [
      { key: "sentiment_threshold", label: "Sentiment Threshold", hint: "Min confidence to trade (×10)", min: 3, max: 9, step: 1, unit: "×0.1", default: 6 },
      { key: "max_positions", label: "Max Positions", hint: "Max open positions", min: 1, max: 10, step: 1, unit: "", default: 3 },
      { key: "position_size", label: "Position Size", hint: "% of budget per trade", min: 1, max: 15, step: 1, unit: "%", default: 8 },
    ],
  },
  {
    id: "prediction_arb",
    name: "Prediction Arbitrage",
    tagline: "Find mispriced outcomes before the market does",
    description:
      "Uses ML to identify mispriced probabilities in prediction markets, entering positions when model confidence exceeds threshold.",
    icon: "🎯",
    risk: "high",
    nameSuggestions: ["Edge Finder", "Arb Wizard", "Value Hunter", "Edge Bot", "Alpha Arb"],
    params: [
      { key: "confidence_threshold", label: "Confidence Threshold", hint: "Min model confidence (×10)", min: 5, max: 9, step: 1, unit: "×0.1", default: 7 },
      { key: "max_bet", label: "Max Bet Size", hint: "Max % of budget per trade", min: 1, max: 10, step: 1, unit: "%", default: 5 },
      { key: "max_positions", label: "Max Positions", hint: "Max concurrent bets", min: 1, max: 10, step: 1, unit: "", default: 5 },
    ],
  },
  {
    id: "dca_plus",
    name: "Dollar Cost Average+",
    tagline: "Smart DCA that doubles down on dips",
    description:
      "Buys on a schedule but multiplies position size when the asset dips below threshold, averaging down intelligently.",
    icon: "🐷",
    risk: "low",
    nameSuggestions: ["The Stacker", "Dip Hunter", "Smart DCA", "Buy The Dip", "Accumulator"],
    params: [
      { key: "base_amount", label: "Base Amount", hint: "Regular buy amount (USD)", min: 10, max: 500, step: 10, unit: "$", default: 100 },
      { key: "dip_multiplier", label: "Dip Multiplier", hint: "Multiply on dip (×)", min: 1, max: 4, step: 1, unit: "×", default: 2 },
      { key: "dip_threshold", label: "Dip Threshold", hint: "Price drop to trigger dip buy", min: 1, max: 15, step: 1, unit: "%", default: 3 },
    ],
  },
  {
    id: "custom",
    name: "Custom Strategy",
    tagline: "Your rules, AI execution",
    description:
      "Write your own trading rules in plain English. The AI reads your instructions and current market data on every run to decide whether to trade.",
    icon: "✏️",
    risk: "medium",
    nameSuggestions: ["My Strategy", "Alpha Rules", "Custom Bot", "Rule Engine", "My Playbook"],
    params: [],
  },
  {
    id: "news_trader",
    name: "News Trader",
    tagline: "Trade the headline, ignore the chart",
    description:
      "Trades purely on news sentiment — zero technical analysis. Fetches the latest 10 headlines per stock every run and asks the AI: which story is moving markets right now?",
    icon: "🗞️",
    risk: "high",
    nameSuggestions: ["Headline Hawk", "Press Bot", "News Ninja", "Story Seeker", "Media Edge"],
    params: [
      { key: "sentiment_threshold", label: "Sentiment Threshold", hint: "Min score to trade (×10)", min: 4, max: 9, step: 1, unit: "×0.1", default: 6 },
      { key: "max_positions", label: "Max Positions", hint: "Max open positions", min: 1, max: 5, step: 1, unit: "", default: 3 },
      { key: "hold_hours", label: "Hold Period", hint: "Hours before sentiment re-evaluated", min: 4, max: 72, step: 4, unit: "h", default: 24 },
    ],
  },
  {
    id: "blind_quant",
    name: "Blind Quant",
    tagline: "Pure math, zero bias",
    description:
      "Trades purely on anonymized numbers. The AI sees no tickers, no company names — only RSI, momentum, volume ratios, Bollinger position, and volatility. No brand bias possible.",
    icon: "🔢",
    risk: "medium",
    nameSuggestions: ["Math Bot", "Quant Zero", "Pure Alpha", "Signal AI", "Number Cruncher"],
    params: [
      { key: "min_confidence", label: "Min Confidence", hint: "Min AI confidence to trade (×10)", min: 5, max: 9, step: 1, unit: "×0.1", default: 6 },
      { key: "max_positions", label: "Max Positions", hint: "Max open positions", min: 1, max: 5, step: 1, unit: "", default: 3 },
    ],
  },
];

export const AI_MODELS: AIModel[] = [
  {
    id: "groq_llama",
    name: "Groq Llama 3.1",
    provider: "Groq",
    description: "Fast inference · 8B parameters · Best for speed",
    icon: "⚡",
    requiredPlan: "free",
    badge: "Free",
  },
  {
    id: "claude_haiku",
    name: "Claude Haiku 4.5",
    provider: "Anthropic",
    description: "Smarter decisions · Faster than Sonnet · Great balance",
    icon: "✨",
    requiredPlan: "pro",
    badge: "Pro",
  },
  {
    id: "claude_sonnet",
    name: "Claude Sonnet 4.6",
    provider: "Anthropic",
    description: "Most intelligent · Best win rates · Slowest",
    icon: "🧠",
    requiredPlan: "elite",
    badge: "Pro+",
  },
];

export const TIER_LIMITS: Record<string, number> = {
  free: 1,
  pro: 5,
  elite: 20,
};

export const RISK_CONFIG: Record<RiskLevel, { label: string; color: string; bg: string }> = {
  low: { label: "Low Risk", color: "#00D68F", bg: "rgba(0,214,143,0.12)" },
  medium: { label: "Med Risk", color: "#FFA94D", bg: "rgba(255,169,77,0.12)" },
  high: { label: "High Risk", color: "#FF6B6B", bg: "rgba(255,107,107,0.12)" },
};

export const BUDGET_PRESETS = [100, 500, 1000, 5000, 10000];

export function getStrategy(id: StrategyId): Strategy {
  return STRATEGIES.find((s) => s.id === id)!;
}
