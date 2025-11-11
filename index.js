import express from "express";
import axios from "axios";
import cors from "cors";

const app = express();
app.use(cors());

// === Cache + timing ===
let cache = null;
let lastFetch = 0;
let fetchPromise = null;
const CACHE_DURATION = 15 * 60 * 1000; // 15 min
const COINGECKO_URL = "https://api.coingecko.com/api/v3/coins/markets";

// === Fetch logic ===
async function fetchCoinData(force = false) {
  const now = Date.now();

  // Serve from cache if recent enough
  if (!force && cache && now - lastFetch < CACHE_DURATION) {
    console.log("🟢 Serving from cache");
    return cache;
  }

  // Avoid concurrent fetches
  if (fetchPromise) {
    console.log("🕓 Waiting for ongoing fetch...");
    return fetchPromise;
  }

  fetchPromise = (async () => {
    console.log(`🧩 fetchCoinData(force=${force}) — last fetch ${((now - lastFetch) / 1000).toFixed(1)}s ago`);
    try {
      console.log("🌍 Fetching data from CoinGecko API...");
      const response = await axios.get(COINGECKO_URL, {
        params: {
          vs_currency: "usd",
          order: "market_cap_desc",
          per_page: 250,
          page: 1,
          sparkline: false,
        },
        timeout: 15000,
      });

      // === Normalize fields for Looker ===
      cache = response.data.map((coin) => ({
        id: coin.id || null,
        symbol: coin.symbol || null,
        name: coin.name || null,
        current_price: coin.current_price ?? null,
        market_cap: coin.market_cap ?? null,
        total_volume: coin.total_volume ?? null,
        price_change_percentage_24h: coin.price_change_percentage_24h ?? null,
      }));

      lastFetch = now;
      console.log(`✅ Fetched ${cache.length} coins successfully`);
    } catch (err) {
      console.error("❌ Error fetching from CoinGecko:", err.message);
      if (cache) {
        console.log("⚠️ Returning stale cache data");
      } else {
        console.log("⚠️ No cache available — retry will handle it");
        throw err;
      }
    } finally {
      fetchPromise = null;
    }

    return cache;
  })();

  return fetchPromise;
}

// === API route ===
app.get("/api/prices", async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 250;
    const data = await fetchCoinData();
    res.json(data.slice(0, limit));
  } catch (err) {
    console.error("❌ API Error:", err.message);
    res.status(200).json(cache || { error: "Temporarily unavailable" });
  }
});

app.get("/api/compare", async (req, res) => {
  const { coin1 = "bitcoin", coin2 = "ethereum" } = req.query;
  try {
    const [resp1, resp2] = await Promise.all([
      axios.get(`https://api.coingecko.com/api/v3/coins/${coin1}/market_chart`, {
        params: { vs_currency: "usd", days: 365 },
      }),
      axios.get(`https://api.coingecko.com/api/v3/coins/${coin2}/market_chart`, {
        params: { vs_currency: "usd", days: 365 },
      }),
    ]);

    res.json({
      coin1,
      coin2,
      data: [
        { name: coin1, prices: resp1.data.prices },
        { name: coin2, prices: resp2.data.prices },
      ],
    });
  } catch (err) {
    console.error("❌ Compare API error:", err.message);
    res.status(500).json({ error: "Failed to fetch comparison data" });
  }
});

// === Health check ===
app.get("/health", (req, res) => {
  const ageSec = ((Date.now() - lastFetch) / 1000).toFixed(0);
  res.json({
    status: "ok",
    lastFetch: new Date(lastFetch).toISOString(),
    cacheAgeSec: ageSec,
    cacheReady: !!cache,
  });
});

// === Startup warm-up ===
async function warmUp(attempt = 1) {
  console.log(`🚀 Warm-up starting (attempt ${attempt})...`);
  try {
    await fetchCoinData(true);
    console.log("🟢 Warm-up successful — cache ready");
  } catch (err) {
    console.warn(`⚠️ Warm-up failed (attempt ${attempt}): ${err.message}`);
    if (attempt < 5) setTimeout(() => warmUp(attempt + 1), 60000);
  }
}

// === Keep-alive self-ping ===
function startKeepAlive() {
  const url = process.env.RENDER_EXTERNAL_URL || "https://coingecko-wrapper.onrender.com";
  console.log("🔄 Keep-alive pinger active — every 10 min");
  setInterval(async () => {
    try {
      await axios.get(`${url}/health`);
      console.log("💓 Keep-alive ping successful");
    } catch (err) {
      console.warn("💔 Keep-alive ping failed:", err.message);
    }
  }, 10 * 60 * 1000);
}

// === Start server ===
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
  console.log(`🌐 Public URL: ${process.env.RENDER_EXTERNAL_URL || "https://coingecko-wrapper.onrender.com"}`);
  console.log("⏳ Waiting 30s before first warm-up...");
  setTimeout(() => warmUp(), 30000);
  startKeepAlive();
});
