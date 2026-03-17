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
