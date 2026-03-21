/**
 * get-market-bars
 * Lightweight Alpaca market data proxy — returns daily OHLCV bars for any symbol.
 * Used by the frontend to fetch SPY (S&P 500) benchmark data for chart overlays.
 */

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const DATA_URL  = "https://data.alpaca.markets/v2";
const API_KEY    = Deno.env.get("ALPACA_API_KEY")    ?? "";
const API_SECRET = Deno.env.get("ALPACA_API_SECRET") ?? "";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const body = await req.json().catch(() => ({}));
  const symbol = (String(body.symbol ?? "SPY")).toUpperCase();
  const days   = Math.min(Math.max(Number(body.days ?? 90), 5), 400);

  const start = new Date();
  start.setDate(start.getDate() - days);
  const startStr = start.toISOString().split("T")[0];

  const url =
    `${DATA_URL}/stocks/${symbol}/bars` +
    `?timeframe=1Day&start=${startStr}&feed=sip&limit=${days + 10}`;

  try {
    const res = await fetch(url, {
      headers: {
        "APCA-API-KEY-ID":     API_KEY,
        "APCA-API-SECRET-KEY": API_SECRET,
      },
    });

    if (!res.ok) {
      console.error(`[get-market-bars] Alpaca ${res.status} for ${symbol}`);
      return new Response(JSON.stringify({ bars: [] }), {
        headers: { ...CORS, "Content-Type": "application/json" },
      });
    }

    const data = await res.json();
    const bars = ((data.bars ?? []) as any[]).map((b) => ({
      date:  (b.t as string).split("T")[0],
      close: Number(b.c),
    }));

    return new Response(JSON.stringify({ bars }), {
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("[get-market-bars] fetch error:", err);
    return new Response(JSON.stringify({ bars: [] }), {
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  }
});
