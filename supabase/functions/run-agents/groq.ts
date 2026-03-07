const GROQ_KEY = Deno.env.get("GROQ_API_KEY") ?? "";
const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const MODEL = "llama-3.1-8b-instant";

interface Message {
  role: "system" | "user";
  content: string;
}

async function complete(messages: Message[], maxTokens = 256): Promise<string> {
  const res = await fetch(GROQ_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${GROQ_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      messages,
      response_format: { type: "json_object" },
      max_tokens: maxTokens,
      temperature: 0.1,
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Groq ${res.status}: ${text.slice(0, 200)}`);
  }

  const data = await res.json();
  return data.choices?.[0]?.message?.content ?? "{}";
}

function safeJson(raw: string): Record<string, unknown> {
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

/** Ask the AI to validate a trade signal.  Returns { execute, reasoning, confidence }. */
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
  const lines = [
    `Strategy: ${opts.strategy}`,
    `Symbol: ${opts.symbol}`,
    `Signal: ${opts.side.toUpperCase()}`,
    `Reason: ${opts.reason}`,
    `Current Price: $${opts.currentPrice.toFixed(2)}`,
    opts.sma !== undefined ? `SMA: $${opts.sma.toFixed(2)}` : null,
    opts.rsi !== undefined ? `RSI(14): ${opts.rsi.toFixed(1)}` : null,
    opts.dipPct !== undefined ? `Price vs avg: ${opts.dipPct > 0 ? "-" : "+"}${Math.abs(opts.dipPct).toFixed(2)}%` : null,
  ]
    .filter(Boolean)
    .join("\n");

  const prompt = `You are a conservative AI trading risk manager. Evaluate this paper-trading signal and respond ONLY with JSON.

${lines}

Respond: {"execute":boolean,"reasoning":"one sentence","confidence":0.0-1.0}
Approve only when the signal is technically sound. confidence > 0.6 means execute.`;

  try {
    const raw = await complete(
      [
        { role: "system", content: "Respond only with valid JSON. Be concise and conservative." },
        { role: "user", content: prompt },
      ],
      192
    );
    const j = safeJson(raw);
    return {
      execute: Boolean(j.execute),
      reasoning: String(j.reasoning ?? "No reasoning provided"),
      confidence: Math.min(1, Math.max(0, Number(j.confidence) || 0)),
    };
  } catch (err) {
    console.error("confirmTrade groq error:", err);
    return { execute: false, reasoning: "AI validation unavailable", confidence: 0 };
  }
}

/** Score news sentiment for a symbol.  Returns score in [-1, 1]. */
export async function scoreSentiment(
  symbol: string,
  headlines: string[]
): Promise<{ score: number; summary: string }> {
  if (headlines.length === 0) return { score: 0, summary: "No news" };

  const prompt = `Score the market sentiment for ${symbol} from these headlines:
${headlines.slice(0, 5).map((h, i) => `${i + 1}. ${h}`).join("\n")}

Respond: {"score":-1.0_to_1.0,"summary":"one sentence"}
-1 = very bearish, 0 = neutral, +1 = very bullish.`;

  try {
    const raw = await complete(
      [
        { role: "system", content: "You are a financial sentiment analyst. Respond only with valid JSON." },
        { role: "user", content: prompt },
      ],
      128
    );
    const j = safeJson(raw);
    return {
      score: Math.min(1, Math.max(-1, Number(j.score) || 0)),
      summary: String(j.summary ?? ""),
    };
  } catch {
    return { score: 0, summary: "Sentiment unavailable" };
  }
}

/** Evaluate prediction market / mispricing opportunity. */
export async function evalMispricing(opts: {
  symbol: string;
  currentPrice: number;
  rsi: number;
  momentum5d: number;
}): Promise<{ direction: "buy" | "sell" | "hold"; confidence: number; reasoning: string }> {
  const prompt = `Evaluate if ${opts.symbol} is mispriced based on:
- Price: $${opts.currentPrice.toFixed(2)}
- RSI(14): ${opts.rsi.toFixed(1)}
- 5-day momentum: ${opts.momentum5d.toFixed(2)}%

Respond: {"direction":"buy"|"sell"|"hold","confidence":0.0-1.0,"reasoning":"one sentence"}`;

  try {
    const raw = await complete(
      [
        { role: "system", content: "You are a quantitative analyst. Respond only with valid JSON." },
        { role: "user", content: prompt },
      ],
      128
    );
    const j = safeJson(raw);
    const dir = ["buy", "sell", "hold"].includes(j.direction as string)
      ? (j.direction as "buy" | "sell" | "hold")
      : "hold";
    return {
      direction: dir,
      confidence: Math.min(1, Math.max(0, Number(j.confidence) || 0)),
      reasoning: String(j.reasoning ?? ""),
    };
  } catch {
    return { direction: "hold", confidence: 0, reasoning: "AI unavailable" };
  }
}
