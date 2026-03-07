import type { BarData } from "./types.ts";

// ALPACA_BASE_URL already contains /v2  (e.g. https://paper-api.alpaca.markets/v2)
const BASE = (Deno.env.get("ALPACA_BASE_URL") ?? "https://paper-api.alpaca.markets/v2").replace(/\/$/, "");
const DATA = "https://data.alpaca.markets/v2";
const KEY = Deno.env.get("ALPACA_API_KEY") ?? "";
const SECRET = Deno.env.get("ALPACA_API_SECRET") ?? "";

const HEADERS: Record<string, string> = {
  "APCA-API-KEY-ID": KEY,
  "APCA-API-SECRET-KEY": SECRET,
  "Content-Type": "application/json",
};

async function alpacaFetch(url: string, init?: RequestInit) {
  const res = await fetch(url, { ...init, headers: { ...HEADERS, ...init?.headers } });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Alpaca ${res.status}: ${url} — ${body.slice(0, 200)}`);
  }
  return res.json();
}

export async function getAccount() {
  return alpacaFetch(`${BASE}/account`);
}

/** Fetch up to `limit` daily bars for a symbol.  Returns newest-last. */
export async function getDailyBars(symbol: string, limit: number): Promise<BarData[]> {
  const params = new URLSearchParams({
    timeframe: "1Day",
    limit: String(Math.min(limit, 1000)),
    adjustment: "raw",
    feed: "iex",
    sort: "asc",
  });
  try {
    const data = await alpacaFetch(`${DATA}/stocks/${symbol}/bars?${params}`);
    return (data.bars ?? []) as BarData[];
  } catch {
    return [];
  }
}

/** Latest trade price for a symbol */
export async function getLatestPrice(symbol: string): Promise<number> {
  try {
    const data = await alpacaFetch(`${DATA}/stocks/${symbol}/trades/latest?feed=iex`);
    return Number(data.trade?.p ?? 0);
  } catch {
    // fallback to latest bar close
    const bars = await getDailyBars(symbol, 1);
    return bars[0]?.c ?? 0;
  }
}

/** Alpaca news for a symbol (last 5 articles) */
export async function getNews(symbol: string): Promise<{ headline: string; summary: string }[]> {
  const params = new URLSearchParams({ symbols: symbol, limit: "5", sort: "desc" });
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
