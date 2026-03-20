import type { BarData } from "./types.ts";

// Trading API (orders, account, positions)
const BASE = (Deno.env.get("ALPACA_BASE_URL") ?? "https://paper-api.alpaca.markets/v2").replace(/\/$/, "");
// Market data API — always data.alpaca.markets regardless of paper/live
const DATA = "https://data.alpaca.markets/v2";
const KEY    = Deno.env.get("ALPACA_API_KEY")    ?? "";
const SECRET = Deno.env.get("ALPACA_API_SECRET") ?? "";

// Log key presence once at module load so we can diagnose missing secrets
console.log(`[alpaca] KEY set=${KEY.length > 0} SECRET set=${SECRET.length > 0} BASE=${BASE}`);

const HEADERS: Record<string, string> = {
  "APCA-API-KEY-ID":     KEY,
  "APCA-API-SECRET-KEY": SECRET,
  "Content-Type":        "application/json",
};

async function alpacaFetch(url: string, init?: RequestInit): Promise<any> {
  const res = await fetch(url, { ...init, headers: { ...HEADERS, ...init?.headers } });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Alpaca HTTP ${res.status} ${url} — ${body.slice(0, 300)}`);
  }
  return res.json();
}

export async function getAccount() {
  return alpacaFetch(`${BASE}/account`);
}

/**
 * Fetch up to `limit` daily OHLCV bars for a symbol, newest-last.
 *
 * Feed priority:
 *   1. "sip"  — consolidated tape (requires paid data sub; works on live keys)
 *   2. "iex"  — free real-time feed (15-min delay; no after-hours history)
 *   3. no feed param — let Alpaca pick the best available for the key tier
 *
 * We try sip first; if that returns 0 bars or errors we fall back to iex,
 * then to no-feed. This handles both free and paid API keys transparently.
 */
export async function getDailyBars(symbol: string, limit: number): Promise<BarData[]> {
  const safeLimit = Math.min(limit, 1000);

  // Calculate start date as 60 days ago in ISO format
  const start = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10) + "T00:00:00Z";

  for (const feed of ["sip", "iex", null] as Array<string | null>) {
    const params = new URLSearchParams({
      timeframe: "1Day",
      limit:      String(safeLimit),
      start,
      adjustment: "raw",
      sort:       "asc",
    });
    if (feed) params.set("feed", feed);

    const url = `${DATA}/stocks/${symbol}/bars?${params}`;
    try {
      console.log(`[getDailyBars] ${symbol} feed=${feed ?? "default"} url=${url}`);
      const data = await alpacaFetch(url);
      const bars = (data.bars ?? []) as BarData[];
      console.log(`[getDailyBars] ${symbol} feed=${feed ?? "default"} → ${bars.length} bars`);
      if (bars.length > 0) return bars;
      // 0 bars on this feed — try next
    } catch (err) {
      console.error(`[getDailyBars] ${symbol} feed=${feed ?? "default"} ERROR:`, (err as Error).message);
      // try next feed
    }
  }

  console.error(`[getDailyBars] ${symbol} — all feeds returned 0 bars`);
  return [];
}

/** Latest trade price for a symbol */
export async function getLatestPrice(symbol: string): Promise<number> {
  for (const feed of ["sip", "iex", null] as Array<string | null>) {
    const qs = feed ? `?feed=${feed}` : "";
    try {
      const data = await alpacaFetch(`${DATA}/stocks/${symbol}/trades/latest${qs}`);
      const price = Number(data.trade?.p ?? 0);
      if (price > 0) return price;
    } catch {
      // try next feed
    }
  }
  // Last resort: use the most recent daily bar close
  const bars = await getDailyBars(symbol, 1);
  return bars[0]?.c ?? 0;
}

/** Alpaca news for a symbol (last N articles, default 5) */
export async function getNews(symbol: string, limit = 5): Promise<{ headline: string; summary: string }[]> {
  const params = new URLSearchParams({ symbols: symbol, limit: String(Math.min(limit, 50)), sort: "desc" });
  try {
    const data = await alpacaFetch(`${DATA}/news?${params}`);
    return (data.news ?? []).map((n: Record<string, string>) => ({
      headline: n.headline ?? "",
      summary: n.summary ?? "",
    }));
  } catch {
    return [];
  }
}

/**
 * Bulk news fetch across multiple symbols in one request.
 * Returns flat list of { symbol, headline } — each article assigned to its
 * first matching symbol from the provided list.
 */
export async function getNewsBulk(
  symbols: string[],
  limit = 50
): Promise<Array<{ symbol: string; headline: string }>> {
  const params = new URLSearchParams({
    symbols: symbols.join(","),
    limit: String(Math.min(limit, 50)),
    sort: "desc",
  });
  try {
    const data = await alpacaFetch(`${DATA}/news?${params}`);
    const results: Array<{ symbol: string; headline: string }> = [];
    for (const n of (data.news ?? []) as any[]) {
      const headline = String(n.headline ?? "").trim();
      if (!headline) continue;
      const artSymbols: string[] = (n.symbols ?? []).map((s: string) => s.toUpperCase());
      const matched = artSymbols.find((s) => symbols.includes(s)) ?? artSymbols[0] ?? "";
      if (matched) results.push({ symbol: matched, headline });
    }
    return results;
  } catch {
    return [];
  }
}

export interface AlpacaOrder {
  id: string;
  symbol: string;
  side: string;
  qty: string;
  filled_avg_price: string | null;
  status: string;
}

/** Place a market order.  qty must be a whole number (fractional shares not used here). */
export async function placeOrder(
  symbol: string,
  qty: number,
  side: "buy" | "sell"
): Promise<AlpacaOrder> {
  return alpacaFetch(`${BASE}/orders`, {
    method: "POST",
    body: JSON.stringify({ symbol, qty: String(qty), side, type: "market", time_in_force: "day" }),
  });
}

/** Get all current open positions */
export async function getPositions(): Promise<Record<string, { qty: number; avg_entry_price: number }>> {
  try {
    const data = await alpacaFetch(`${BASE}/positions`);
    const map: Record<string, { qty: number; avg_entry_price: number }> = {};
    for (const p of data as any[]) {
      map[p.symbol] = {
        qty: Number(p.qty),
        avg_entry_price: Number(p.avg_entry_price),
      };
    }
    return map;
  } catch {
    return {};
  }
}
