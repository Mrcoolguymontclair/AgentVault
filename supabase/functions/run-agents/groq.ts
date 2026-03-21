/**
 * groq.ts
 *
 * Groq AI helpers — each function uses the groq-tracker for rate limiting,
 * key rotation, and daily budget management.
 */

import { groqComplete, isConservativeMode } from "./groq-tracker.ts";

/**
 * Parse Groq response content into a JSON object.
 * Handles plain JSON AND markdown-fenced JSON (```json ... ```) that some
 * model versions output despite json_object response_format being set.
 */
function safeJson(raw: string): Record<string, unknown> {
  try {
    // Strip markdown fences: ```json ... ``` or ``` ... ```
    const stripped = raw
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/```\s*$/i, "")
      .trim();
    return JSON.parse(stripped);
  } catch {
    // Last-ditch: try to extract the first {...} block from the string
    const match = raw.match(/\{[\s\S]*\}/);
    if (match) {
      try { return JSON.parse(match[0]); } catch { /* fall through */ }
    }
    console.error("[safeJson] Failed to parse Groq response:", raw.slice(0, 300));
    return {};
  }
}

// ── confirmTrade ──────────────────────────────────────────────

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
      execute:    true,
      reasoning:  "Conservative mode: AI check skipped, technical signal accepted",
      confidence: 0.75,
    };
  }

  const facts = [
    `${opts.strategy}|${opts.symbol}|${opts.side.toUpperCase()}`,
    `Reason: ${opts.reason.slice(0, 100)}`,
    `Price:$${opts.currentPrice.toFixed(2)}`,
    opts.sma    !== undefined ? `SMA:$${opts.sma.toFixed(2)}`      : null,
    opts.rsi    !== undefined ? `RSI:${opts.rsi.toFixed(1)}`        : null,
    opts.dipPct !== undefined ? `Dip:${opts.dipPct.toFixed(1)}%`   : null,
  ].filter(Boolean).join(" ");

  const systemPrompt =
    "You are a paper-trading risk manager. " +
    "Output ONLY a raw JSON object — no markdown, no code fences, no explanation. " +
    'Example: {"execute":true,"reasoning":"signal is technically valid","confidence":0.75}';

  const userPrompt =
    `Evaluate this trade signal: ${facts}\n` +
    `Output ONLY raw JSON with these exact fields:\n` +
    `{"execute":<true or false>,"reasoning":"<10 words max>","confidence":<0.0 to 1.0>}`;

  try {
    const raw = await groqComplete(
      [
        { role: "system", content: systemPrompt },
        { role: "user",   content: userPrompt },
      ],
      80,
      "confirm_trade",
      200
    );
    const j = safeJson(raw);
    const confidence = Math.min(1, Math.max(0, Number(j.confidence) || 0));
    const execute = Boolean(j.execute);
    console.log(`[confirmTrade] ${opts.symbol} ${opts.side} execute=${execute} confidence=${confidence} reasoning=${j.reasoning}`);
    return {
      execute,
      reasoning:  String(j.reasoning ?? "AI validation"),
      confidence,
    };
  } catch (err: any) {
    if (err?.message === "CONSERVATIVE_MODE") {
      return { execute: true, reasoning: "Budget conserved — technical signal accepted", confidence: 0.75 };
    }
    // Groq unavailable — execute the trade on strategy signal alone
    console.error(`[confirmTrade] Groq failed for ${opts.symbol} ${opts.side}:`, err?.message ?? err);
    return {
      execute:    true,
      reasoning:  "AI unavailable — using strategy signal only",
      confidence: 0.50,
    };
  }
}

// ── scoreSentiment ────────────────────────────────────────────

export async function scoreSentiment(
  symbol: string,
  headlines: string[]
): Promise<{ score: number; summary: string; urgency: number; surprise: boolean }> {
  if (headlines.length === 0) return { score: 0, summary: "No news", urgency: 0, surprise: false };
  if (isConservativeMode()) return { score: 0, summary: "Conservative mode", urgency: 0, surprise: false };

  const hl = headlines.slice(0, 4).map((h, i) => `${i + 1}.${h.slice(0, 80)}`).join(" ");

  const systemPrompt =
    "You are a financial sentiment analyst. " +
    "Output ONLY a raw JSON object — no markdown, no code fences, no explanation.";

  const userPrompt =
    `${symbol} news headlines: ${hl}\n` +
    `Output ONLY raw JSON:\n` +
    `{"score":<-1.0 to 1.0>,"summary":"<10 words>","urgency":<1 to 10>,"surprise":<true or false>}\n` +
    `score: -1=very bearish, 0=neutral, 1=very bullish. urgency: 1=stale, 10=breaking. surprise=unexpected/not-priced-in.`;

  try {
    const raw = await groqComplete(
      [
        { role: "system", content: systemPrompt },
        { role: "user",   content: userPrompt },
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

// ── interpretCustomStrategy ───────────────────────────────────

export async function interpretCustomStrategy(opts: {
  strategyPrompt: string;
  marketData: Array<{
    symbol:       string;
    currentPrice: number;
    change1d:     number;
    sma20:        number;
    rsi14:        number;
    momentum5d:   number;
  }>;
  currentPositions: Record<string, number>;
}): Promise<{ execute: boolean; symbol: string; side: "buy" | "sell"; reasoning: string; confidence: number }> {
  if (isConservativeMode()) {
    return { execute: false, symbol: "", side: "buy", reasoning: "Conservative mode: custom strategy skipped", confidence: 0 };
  }

  const mkt = opts.marketData.slice(0, 8)
    .map((d) =>
      `${d.symbol}:$${d.currentPrice.toFixed(0)} 1d:${d.change1d.toFixed(1)}% RSI:${d.rsi14.toFixed(0)} SMA:$${d.sma20.toFixed(0)}`
    )
    .join(" | ");

  const longPos  = Object.keys(opts.currentPositions)
    .filter((s) => (opts.currentPositions[s] ?? 0) > 0)
    .join(",") || "none";
  const shortPos = Object.keys(opts.currentPositions)
    .filter((s) => (opts.currentPositions[s] ?? 0) < 0)
    .join(",") || "none";

  const validSymbols = opts.marketData.map((d) => d.symbol).join(", ");

  const systemPrompt =
    "You are an AI trading agent. Follow the user's strategy instructions exactly. " +
    "You can buy (go long) or sell (go short / close a long). " +
    "Output ONLY a raw JSON object — no markdown, no code fences, no explanation.";

  const userPrompt =
    `Strategy instructions: "${opts.strategyPrompt}"\n` +
    `Market data: ${mkt}\n` +
    `Currently long: ${longPos}\n` +
    `Currently short: ${shortPos}\n` +
    `Valid symbols: ${validSymbols}\n` +
    `Output ONLY raw JSON:\n` +
    `{"execute":<true or false>,"symbol":"<one of the valid symbols>","side":"buy or sell","reasoning":"<15 words>","confidence":<0.0 to 1.0>}`;

  try {
    const raw = await groqComplete(
      [
        { role: "system", content: systemPrompt },
        { role: "user",   content: userPrompt },
      ],
      100,
      "custom",
      320
    );
    const j = safeJson(raw);
    const validSymbolList = opts.marketData.map((d) => d.symbol);
    const symbol = validSymbolList.includes(String(j.symbol ?? "")) ? String(j.symbol) : "";
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
    console.error("[interpretCustomStrategy] Groq failed:", err?.message ?? err);
    return { execute: false, symbol: "", side: "buy", reasoning: "AI unavailable", confidence: 0 };
  }
}

// ── newsTraderDecision ────────────────────────────────────────

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
  const EMPTY = {
    execute: false, symbol: "", side: "buy" as const,
    reasoning: "No decision", confidence: 0, sentiment_score: 0,
  };
  if (isConservativeMode()) return { ...EMPTY, reasoning: "Conservative mode" };

  // Sort by headline count (most-covered stories first), take top 20 symbols,
  // 2 headlines each at 65 chars — keeps the prompt under ~800 tokens.
  const topEntries = Object.entries(opts.headlinesBySymbol)
    .filter(([, hl]) => hl.length > 0)
    .sort(([, a], [, b]) => b.length - a.length)
    .slice(0, 20);

  const newsBlock = topEntries
    .map(([sym, hl]) =>
      `${sym}: ${hl.slice(0, 2).map((h) => h.slice(0, 65)).join(" | ")}`
    )
    .join("\n");

  // Only expose symbols that actually appear in the newsBlock — no phantom choices
  const newsBlockSymbols = topEntries.map(([sym]) => sym);
  const held = opts.heldSymbols.join(",") || "none";

  const systemPrompt =
    "You are a news-only trading AI. Analyse ONLY the sentiment of the headlines below. " +
    "Output ONLY a raw JSON object — no markdown, no code fences, no explanation.";

  const userPrompt =
    `Headlines (ONLY these symbols are valid choices):\n${newsBlock}\n\n` +
    `Currently holding: ${held}\n` +
    `Pick the ONE symbol with the STRONGEST bullish or bearish sentiment.\n` +
    `Output ONLY raw JSON — example: {"execute":true,"symbol":"AAPL","side":"buy","reasoning":"headline says record earnings beat","confidence":0.85,"sentiment_score":0.9}\n` +
    `Rules: symbol must be one of the symbols above. side is "buy" for bullish, "sell" for bearish. sentiment_score is -1 (very bearish) to +1 (very bullish).`;

  console.log(`[newsTraderDecision] symbols_in_block=${newsBlockSymbols.length} held=${held} threshold=${opts.sentimentThreshold}`);
  console.log(`[newsTraderDecision] PROMPT:\n${userPrompt.slice(0, 1200)}`);

  try {
    const raw = await groqComplete(
      [
        { role: "system", content: systemPrompt },
        { role: "user",   content: userPrompt },
      ],
      150,
      "sentiment",
      700   // accurate estimate for 20 symbols × 2 headlines
    );

    console.log(`[newsTraderDecision] RAW_RESPONSE: ${raw}`);
    const j = safeJson(raw);
    console.log(`[newsTraderDecision] PARSED: ${JSON.stringify(j)}`);

    const symbol = newsBlockSymbols.includes(String(j.symbol ?? "")) ? String(j.symbol) : "";
    const side: "buy" | "sell" = j.side === "sell" ? "sell" : "buy";
    const confidence      = Math.min(1, Math.max(0,  Number(j.confidence)      || 0));
    const sentiment_score = Math.min(1, Math.max(-1, Number(j.sentiment_score) || 0));

    const result = {
      execute: Boolean(j.execute) && symbol !== "",
      symbol,
      side,
      reasoning:       String(j.reasoning ?? "News sentiment"),
      confidence,
      sentiment_score,
    };

    console.log(`[newsTraderDecision] RESULT: symbol=${result.symbol} execute=${result.execute} score=${sentiment_score.toFixed(2)} confidence=${confidence.toFixed(2)}`);
    return result;
  } catch (err: any) {
    if (err?.message === "CONSERVATIVE_MODE") return { ...EMPTY, reasoning: "Conservative mode" };
    console.error("[newsTraderDecision] Groq failed:", err?.message ?? err);
    return EMPTY;
  }
}

// ── blindQuantDecision ────────────────────────────────────────

export interface AnonAsset {
  asset_id: string;
  price_change_1d_pct: number;
  price_change_5d_pct: number;
  price_change_20d_pct: number;
  volume_vs_avg_20d: number;
  rsi_14: number;
  distance_from_20d_high_pct: number;
  distance_from_20d_low_pct: number;
  volatility_20d: number;
  sma_20_slope: number;
  bollinger_position: number;
}

export async function blindQuantDecision(opts: {
  assets: AnonAsset[];
  heldAssetIds: string[];
  shortedAssetIds: string[];
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
    .map((a) =>
      `${a.asset_id}: 1d=${a.price_change_1d_pct.toFixed(2)}% 5d=${a.price_change_5d_pct.toFixed(2)}% ` +
      `20d=${a.price_change_20d_pct.toFixed(2)}% vol=${a.volume_vs_avg_20d.toFixed(2)}x ` +
      `RSI=${a.rsi_14.toFixed(0)} hi%=${a.distance_from_20d_high_pct.toFixed(2)} lo%=${a.distance_from_20d_low_pct.toFixed(2)} ` +
      `bb=${a.bollinger_position.toFixed(2)} slope=${a.sma_20_slope.toFixed(4)} σ=${a.volatility_20d.toFixed(3)}`
    )
    .join("\n");

  const held    = opts.heldAssetIds.join(",")  || "none";
  const shorted = opts.shortedAssetIds.join(",") || "none";
  const validIds = opts.assets.map((a) => a.asset_id).join(", ");

  const systemPrompt =
    "You are a pure quantitative trading AI. Analyse ONLY the numbers provided — no company names, no tickers, no news. " +
    "You can go long (buy) OR short (sell) based on the data. " +
    "Output ONLY a raw JSON object — no markdown, no code fences, no explanation.";

  const userPrompt =
    `Anonymous assets (pure numbers — no ticker identities):\n${assetBlock}\n\n` +
    `Currently long: ${held}\n` +
    `Currently short: ${shorted}\n` +
    `Minimum confidence to act: ${opts.minConfidence.toFixed(1)}\n` +
    `Valid asset IDs: ${validIds}\n` +
    `Which asset has the best quantitative risk/reward setup? Choose "buy" for bullish or "sell" for bearish.\n` +
    `Rules: Do NOT buy an asset already in "Currently long". Do NOT sell an asset already in "Currently short".\n` +
    `Output ONLY raw JSON:\n` +
    `{"execute":<true or false>,"asset_id":"<one of the valid IDs>","side":"buy or sell","reasoning":"<20 words citing specific numbers>","confidence":<0.0 to 1.0>}`;

  console.log(`[blindQuantDecision] assets=${opts.assets.length} held=${held} minConf=${opts.minConfidence}`);

  try {
    const raw = await groqComplete(
      [
        { role: "system", content: systemPrompt },
        { role: "user",   content: userPrompt },
      ],
      120,
      "custom",
      450
    );
    console.log(`[blindQuantDecision] raw=${raw.slice(0, 300)}`);
    const j = safeJson(raw);
    console.log(`[blindQuantDecision] parsed: asset_id=${j.asset_id} execute=${j.execute} side=${j.side} confidence=${j.confidence}`);
    const asset_id = validIds.split(", ").includes(String(j.asset_id ?? "")) ? String(j.asset_id) : "";
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
    console.error("[blindQuantDecision] Groq failed:", err?.message ?? err);
    return EMPTY;
  }
}

// ── evalMispricing ────────────────────────────────────────────

export async function evalMispricing(opts: {
  symbol:       string;
  currentPrice: number;
  rsi:          number;
  momentum5d:   number;
}): Promise<{ direction: "buy" | "sell" | "hold"; confidence: number; marketProbability: number; reasoning: string }> {
  if (isConservativeMode()) {
    return { direction: "hold", confidence: 0, marketProbability: 0.5, reasoning: "Conservative mode" };
  }

  const systemPrompt =
    "You are a quantitative mispricing analyst. " +
    "Output ONLY a raw JSON object — no markdown, no code fences, no explanation.";

  const userPrompt =
    `Asset: ${opts.symbol} | Price:$${opts.currentPrice.toFixed(2)} | RSI:${opts.rsi.toFixed(1)} | 5d_momentum:${opts.momentum5d.toFixed(1)}%\n` +
    `Is this asset mispriced relative to fair value?\n` +
    `Output ONLY raw JSON:\n` +
    `{"direction":"buy","confidence":<0.0 to 1.0>,"marketProbability":<0.0 to 1.0>,"reasoning":"<12 words>"}\n` +
    `direction must be exactly "buy", "sell", or "hold".`;

  try {
    const raw = await groqComplete(
      [
        { role: "system", content: systemPrompt },
        { role: "user",   content: userPrompt },
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
  } catch (err: any) {
    console.error("[evalMispricing] Groq failed:", err?.message ?? err);
    return { direction: "hold", confidence: 0, marketProbability: 0.5, reasoning: "AI unavailable" };
  }
}
