/**
 * get-current-prices
 *
 * Returns the latest price for each requested symbol.
 * Uses the Alpaca bulk latest-trades endpoint (SIP → IEX → default feed fallback).
 * For any symbol where a live trade price is unavailable (weekends, halted),
 * falls back to the most recent daily bar close — so it always returns a price.
 *
 * POST body: { symbols: string[] }
 * Response:  { prices: Record<string, number> }
 */

const DATA = "https://data.alpaca.markets/v2";

const KEY    = Deno.env.get("ALPACA_API_KEY")    ?? "";
const SECRET = Deno.env.get("ALPACA_API_SECRET") ?? "";

const HEADERS = {
  "APCA-API-KEY-ID":     KEY,
  "APCA-API-SECRET-KEY": SECRET,
};

const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    const body   = await req.json().catch(() => ({}));
    const symbols: string[] = ((body.symbols ?? []) as string[])
      .map((s) => s.toUpperCase().trim())
      .filter(Boolean);

    if (symbols.length === 0) return json({ prices: {} });

    const prices: Record<string, number> = {};

    // ── Step 1: Bulk latest trade price (SIP → IEX → default) ─────────────
    for (const feed of ["sip", "iex", null] as Array<string | null>) {
      const qs = new URLSearchParams({ symbols: symbols.join(",") });
      if (feed) qs.set("feed", feed);
      try {
        const res = await fetch(`${DATA}/stocks/trades/latest?${qs}`, { headers: HEADERS });
        if (res.ok) {
          const data = await res.json();
          const trades = data.trades ?? {};
          for (const sym of symbols) {
            const p = Number(trades[sym]?.p ?? 0);
            if (p > 0 && !prices[sym]) prices[sym] = p;
          }
          if (symbols.every((s) => (prices[s] ?? 0) > 0)) break; // all resolved
        }
      } catch {
        // try next feed
      }
    }

    // ── Step 2: Fall back to last daily bar close for remaining symbols ────
    const missing = symbols.filter((s) => !(prices[s] > 0));
    if (missing.length > 0) {
      // Try the bulk bars endpoint first (comma-separated symbols param)
      for (const feed of ["sip", "iex", null] as Array<string | null>) {
        const qs = new URLSearchParams({
          symbols:   missing.join(","),
          timeframe: "1Day",
          limit:     "1",
          sort:      "desc",
        });
        if (feed) qs.set("feed", feed);
        try {
          const res = await fetch(`${DATA}/stocks/bars?${qs}`, { headers: HEADERS });
          if (res.ok) {
            const data = await res.json();
            const bars = data.bars ?? {};
            for (const sym of missing) {
              const latest = (bars[sym] ?? [])[0];
              const c = Number(latest?.c ?? 0);
              if (c > 0 && !prices[sym]) prices[sym] = c;
            }
          }
        } catch {
          // try next feed
        }
        if (missing.every((s) => (prices[s] ?? 0) > 0)) break;
      }

      // Last resort: per-symbol single bar fetch for anything still missing
      for (const sym of missing.filter((s) => !(prices[s] > 0))) {
        for (const feed of ["sip", "iex", null] as Array<string | null>) {
          const qs = new URLSearchParams({ timeframe: "1Day", limit: "1", sort: "desc" });
          if (feed) qs.set("feed", feed);
          try {
            const res = await fetch(`${DATA}/stocks/${sym}/bars?${qs}`, { headers: HEADERS });
            if (res.ok) {
              const data = await res.json();
              const c = Number((data.bars ?? [])[0]?.c ?? 0);
              if (c > 0) { prices[sym] = c; break; }
            }
          } catch {
            // give up on this symbol
          }
        }
      }
    }

    console.log(`[get-current-prices] resolved ${Object.keys(prices).length}/${symbols.length} symbols`);
    return json({ prices });
  } catch (err) {
    console.error("[get-current-prices] fatal error:", err);
    return json({ error: String(err), prices: {} }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}
