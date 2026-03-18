/**
 * groq.ts
 *
 * Groq AI helpers — each function uses the groq-tracker for rate limiting,
 * key rotation, and daily budget management.
 *
 * Token budgets (rough estimates):
 *   confirmTrade       ~200 prompt + 80 completion  = ~280 tokens/call
 *   scoreSentiment     ~180 prompt + 80 completion  = ~260 tokens/call
 *   evalMispricing     ~130 prompt + 80 completion  = ~210 tokens/call
 *   interpretCustom    ~320 prompt + 100 completion = ~420 tokens/call
 */

import { groqComplete, isConservativeMode } from "./groq-tracker.ts";

function safeJson(raw: string): Record<string, unknown> {
  try { return JSON.parse(raw); } catch { return {}; }
}

// ── confirmTrade ─────────────────────────────────────────────

/** Ask the AI to validate a trade signal. Returns { execute, reasoning, confidence }. */
export async function confirmTrade(opts: {
  strategy: string;
  symbol: string;
  side: "buy" | "sell";
  reason: string;
  currentPrice: number;
  sma?: number;
  rsi?: number;
  dipPct?: number;
}): Promise<{ execute: boolean; reasoning: string; confidence: number }> {
  // Conservative mode: auto-approve technically-valid signals to preserve budget
  if (isConservativeMode()) {
    return {
      execute:   true,
      reasoning: "Conservative mode: AI check skipped, technical signal accepted",
      confidence: 0.75,
    };
  }

  // Compact prompt — keep under 220 tokens
  const facts = [
    `${opts.strategy}|${opts.symbol}|${opts.side.toUpperCase()}`,
    `Reason: ${opts.reason.slice(0, 100)}`,
    `Price:$${opts.currentPrice.toFixed(2)}`,
    opts.sma  !== undefined ? `SMA:$${opts.sma.toFixed(2)}`    : null,
    opts.rsi  !== undefined ? `RSI:${opts.rsi.toFixed(1)}`      : null,
    opts.dipPct !== undefined ? `Dip:${opts.dipPct.toFixed(1)}%` : null,
  ].filter(Boolean).join(" ");

  try {
    const raw = await groqComplete(
      [
        { role: "system", content: "Paper-trading risk manager. JSON only. Be conservative." },
        {
          role: "user",
          content: `Evaluate: ${facts}\nRespond: {"execute":bool,"reasoning":"<20 words","confidence":0.0-1.0}`,
        },
      ],
      80,           // max completion tokens
      "confirm_trade",
      200           // estimated prompt tokens
    );
    const j = safeJson(raw);
    return {
      execute:    Boolean(j.execute),
      reasoning:  String(j.reasoning ?? "No reasoning provided"),
      confidence: Math.min(1, Math.max(0, Number(j.confidence) || 0)),
    };
  } catch (err: any) {
    if (err?.message === "CONSERVATIVE_MODE") {
      return { execute: true, reasoning: "Budget conserved — technical signal accepted", confidence: 0.75 };
    }
    console.error("confirmTrade error:", err);
    return { execute: false, reasoning: "AI validation unavailable", confidence: 0 };
  }
}

// ── scoreSentiment ───────────────────────────────────────────

/** Score news sentiment for a symbol. Returns score in [-1, 1] plus urgency and surprise flag. */
export async function scoreSentiment(
  symbol: string,
  headlines: string[]
): Promise<{ score: number; summary: string; urgency: number; surprise: boolean }> {
  if (headlines.length === 0) return { score: 0, summary: "No news", urgency: 0, surprise: false };
  if (isConservativeMode()) return { score: 0, summary: "Conservative mode", urgency: 0, surprise: false };

  // Batch up to 4 headlines, each capped at 80 chars
  const hl = headlines.slice(0, 4).map((h, i) => `${i + 1}.${h.slice(0, 80)}`).join(" ");

  try {
    const raw = await groqComplete(
      [
        { role: "system", content: "Financial sentiment analyst. JSON only." },
        {
          role: "user",
          content:
            `${symbol} news: ${hl}\n` +
            `Respond: {"score":-1to1,"summary":"<15 words","urgency":1-10,"surprise":bool}\n` +
            `urgency=how time-sensitive(1=stale,10=breaking). surprise=unexpected/not-priced-in.`,
        },
      ],
      80,
      "sentiment",
      180
    );
    const j = safeJson(raw);
    return {
      score:    Math.min(1, Math.max(-1, Number(j.score) || 0)),
      summary:  String(j.summary ?? ""),
      urgency:  Math.min(10, Math.max(1, Math.round(Number(j.urgency) || 5))),
      surprise: Boolean(j.surprise),
    };
  } catch {
    return { score: 0, summary: "Sentiment unavailable", urgency: 0, surprise: false };
  }
}

// ── interpretCustomStrategy ──────────────────────────────────

/** Execute a custom natural-language strategy with compact market data. */
export async function interpretCustomStrategy(opts: {
  strategyPrompt: string;          // already capped to 500 chars by strategies.ts
  marketData: Array<{
    symbol:      string;
    currentPrice: number;
    change1d:    number;
    sma20:       number;
    rsi14:       number;
    momentum5d:  number;
  }>;
  currentPositions: Record<string, number>;
}): Promise<{ execute: boolean; symbol: string; side: "buy" | "sell"; reasoning: string; confidence: number }> {
  if (isConservativeMode()) {
    return { execute: false, symbol: "", side: "buy", reasoning: "Conservative mode: custom strategy skipped", confidence: 0 };
  }

  // Compact market line — 8 symbols max, integers for prices to save tokens
  const mkt = opts.marketData.slice(0, 8)
    .map((d) =>
      `${d.symbol}:$${d.currentPrice.toFixed(0)} 1d:${d.change1d.toFixed(1)}% RSI:${d.rsi14.toFixed(0)} SMA:$${d.sma20.toFixed(0)}`
    )
    .join(" | ");

  const held = Object.keys(opts.currentPositions)
    .filter((s) => (opts.currentPositions[s] ?? 0) > 0)
    .join(",") || "none";

  try {
    const raw = await groqComplete(
      [
        { role: "system", content: "AI trading agent. Follow instructions exactly. JSON only." },
        {
          role: "user",
          content:
            `Instructions: "${opts.strategyPrompt}"\n` +
            `Market: ${mkt}\nHeld: ${held}\n` +
            `Respond: {"execute":bool,"symbol":"TICKER","side":"buy","reasoning":"<20 words","confidence":0.0-1.0}`,
        },
      ],
      100,
      "custom",
      320
    );
    const j = safeJson(raw);
    const validSymbols = opts.marketData.map((d) => d.symbol);
    const symbol = validSymbols.includes(String(j.symbol ?? "")) ? String(j.symbol) : "";
    const side: "buy" | "sell" = j.side === "sell" ? "sell" : "buy";
    return {
      execute:    Boolean(j.execute) && symbol !== "",
      symbol,
      side,
      reasoning:  String(j.reasoning ?? "Custom strategy decision"),
      confidence: Math.min(1, Math.max(0, Number(j.confidence) || 0.5)),
    };
  } catch (err: any) {
    if (err?.message === "CONSERVATIVE_MODE") {
      return { execute: false, symbol: "", side: "buy", reasoning: "Conservative mode", confidence: 0 };
    }
    console.error("interpretCustomStrategy error:", err);
    return { execute: false, symbol: "", side: "buy", reasoning: "AI unavailable", confidence: 0 };
  }
}

// ── newsTraderDecision ────────────────────────────────────────

/**
 * News Trader: one Groq call evaluates all symbols' headlines and picks the
 * strongest sentiment trade. Returns { execute, symbol, side, reasoning,
 * confidence, sentiment_score }.
 */
export async function newsTraderDecision(opts: {
  headlinesBySymbol: Record<string, string[]>;
  heldSymbols: string[];
  sentimentThreshold: number;
}): Promise<{
  execute: boolean;
  symbol: string;
  side: "buy" | "sell";
  reasoning: string;
  confidence: number;
  sentiment_score: number;
}> {
  const EMPTY = { execute: false, symbol: "", side: "buy" as const, reasoning: "No decision", confidence: 0, sentiment_score: 0 };
  if (isConservativeMode()) return { ...EMPTY, reasoning: "Conservative mode" };

  // Build compact news block — max 12 symbols, 3 headlines each (60 chars)
  const newsBlock = Object.entries(opts.headlinesBySymbol)
    .filter(([, hl]) => hl.length > 0)
    .slice(0, 12)
    .map(([sym, hl]) => `${sym}: ${hl.slice(0, 3).map((h) => h.slice(0, 60)).join(" | ")}`)
    .join("\n");

  const held = opts.heldSymbols.join(",") || "none";

  try {
    const raw = await groqComplete(
      [
        { role: "system", content: "News-only trading AI. No charts, no prices — ONLY news headlines. JSON only." },
        {
          role: "user",
          content:
            `Headlines:\n${newsBlock}\n\nCurrently holding: ${held}\n` +
            `Threshold: ${opts.sentimentThreshold.toFixed(1)}. Don't execute buy if already held.\n` +
            `Which stock has the STRONGEST positive or negative sentiment right now?\n` +
            `Respond: {"execute":bool,"symbol":"TICKER","side":"buy"or"sell","reasoning":"<30 words citing specific words in headlines","confidence":0-1,"sentiment_score":-1to1}`,
        },
      ],
      120,
      "sentiment",
      400
    );
    const j = safeJson(raw);
    const validSymbols = Object.keys(opts.headlinesBySymbol);
    const symbol = validSymbols.includes(String(j.symbol ?? "")) ? String(j.symbol) : "";
    const side: "buy" | "sell" = j.side === "sell" ? "sell" : "buy";
    return {
      execute:         Boolean(j.execute) && symbol !== "",
      symbol,
      side,
      reasoning:       String(j.reasoning ?? "News sentiment"),
      confidence:      Math.min(1, Math.max(0, Number(j.confidence) || 0)),
      sentiment_score: Math.min(1, Math.max(-1, Number(j.sentiment_score) || 0)),
    };
  } catch (err: any) {
    if (err?.message === "CONSERVATIVE_MODE") return { ...EMPTY, reasoning: "Conservative mode" };
    console.error("newsTraderDecision error:", err);
    return EMPTY;
  }
}

// ── blindQuantDecision ────────────────────────────────────────

/** Anonymized asset packet sent to Groq for Blind Quant strategy. */
export interface AnonAsset {
  asset_id: string;           // "Asset_A", "Asset_B", …
  price_change_1d_pct: number;
  price_change_5d_pct: number;
  price_change_20d_pct: number;
  volume_vs_avg_20d: number;
  rsi_14: number;
  distance_from_20d_high_pct: number;
  distance_from_20d_low_pct: number;
  volatility_20d: number;
  sma_20_slope: number;
  bollinger_position: number; // 0 = lower band, 1 = upper band
}

/**
 * Blind Quant: sends fully anonymized numerical packets — no tickers, no names.
 * Returns { execute, asset_id, side, reasoning, confidence }.
 */
export async function blindQuantDecision(opts: {
  assets: AnonAsset[];
  heldAssetIds: string[];
  minConfidence: number;
}): Promise<{
  execute: boolean;
  asset_id: string;
  side: "buy" | "sell";
  reasoning: string;
  confidence: number;
}> {
  const EMPTY = { execute: false, asset_id: "", side: "buy" as const, reasoning: "No decision", confidence: 0 };
  if (isConservativeMode()) return { ...EMPTY, reasoning: "Conservative mode" };

  const assetBlock = opts.assets
    .map(
      (a) =>
        `${a.asset_id}: 1d=${a.price_change_1d_pct.toFixed(2)}% 5d=${a.price_change_5d_pct.toFixed(2)}% ` +
        `20d=${a.price_change_20d_pct.toFixed(2)}% vol=${a.volume_vs_avg_20d.toFixed(2)}x ` +
        `RSI=${a.rsi_14.toFixed(0)} hi%=${a.distance_from_20d_high_pct.toFixed(2)} lo%=${a.distance_from_20d_low_pct.toFixed(2)} ` +
        `bb=${a.bollinger_position.toFixed(2)} slope=${a.sma_20_slope.toFixed(4)} σ=${a.volatility_20d.toFixed(3)}`
    )
    .join("\n");

  const held = opts.heldAssetIds.join(",") || "none";

  try {
    const raw = await groqComplete(
      [
        { role: "system", content: "Pure quantitative trading AI. No company names, no tickers, no news — ONLY numbers. JSON only." },
        {
          role: "user",
          content:
            `Anonymous assets (pure math — no ticker names):\n${assetBlock}\n\n` +
            `Currently holding: ${held}\n` +
            `Min confidence to act: ${opts.minConfidence.toFixed(1)}. Don't buy if already held.\n` +
            `Which asset has the best risk/reward setup based purely on the numbers?\n` +
            `Respond: {"execute":bool,"asset_id":"Asset_X","side":"buy"or"sell","reasoning":"<30 words citing specific numbers","confidence":0-1}`,
        },
      ],
      120,
      "custom",
      450
    );
    const j = safeJson(raw);
    const validIds = opts.assets.map((a) => a.asset_id);
    const asset_id = validIds.includes(String(j.asset_id ?? "")) ? String(j.asset_id) : "";
    const side: "buy" | "sell" = j.side === "sell" ? "sell" : "buy";
    return {
      execute:    Boolean(j.execute) && asset_id !== "",
      asset_id,
      side,
      reasoning:  String(j.reasoning ?? "Quantitative analysis"),
      confidence: Math.min(1, Math.max(0, Number(j.confidence) || 0)),
    };
  } catch (err: any) {
    if (err?.message === "CONSERVATIVE_MODE") return { ...EMPTY, reasoning: "Conservative mode" };
    console.error("blindQuantDecision error:", err);
    return EMPTY;
  }
}

// ── evalMispricing ───────────────────────────────────────────

/** Evaluate prediction-market / mispricing opportunity with Kelly edge. */
export async function evalMispricing(opts: {
  symbol:     string;
  currentPrice: number;
  rsi:        number;
  momentum5d: number;
}): Promise<{ direction: "buy" | "sell" | "hold"; confidence: number; marketProbability: number; reasoning: string }> {
  if (isConservativeMode()) {
    return { direction: "hold", confidence: 0, marketProbability: 0.5, reasoning: "Conservative mode" };
  }

  try {
    const raw = await groqComplete(
      [
        { role: "system", content: "Quant analyst — mispricing detection. JSON only." },
        {
          role: "user",
          content:
            `${opts.symbol}: $${opts.currentPrice.toFixed(2)} RSI:${opts.rsi.toFixed(1)} 5d:${opts.momentum5d.toFixed(1)}%\n` +
            `Respond: {"direction":"buy|sell|hold","confidence":0-1,"marketProbability":0-1,"reasoning":"<15 words"}`,
        },
      ],
      80,
      "mispricing",
      130
    );
    const j = safeJson(raw);
    const dir = ["buy", "sell", "hold"].includes(j.direction as string)
      ? (j.direction as "buy" | "sell" | "hold")
      : "hold";
    return {
      direction:         dir,
      confidence:        Math.min(1, Math.max(0, Number(j.confidence) || 0)),
      marketProbability: Math.min(1, Math.max(0, Number(j.marketProbability) || 0.5)),
      reasoning:         String(j.reasoning ?? ""),
    };
  } catch {
    return { direction: "hold", confidence: 0, marketProbability: 0.5, reasoning: "AI unavailable" };
  }
}
