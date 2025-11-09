import express from "express";
import axios from "axios";
import cors from "cors";

const app = express();
app.use(cors());

let cache = null;
let lastFetch = 0;
let fetchPromise = null;

const CACHE_DURATION = 15 * 60 * 1000; // 15 minutes
const KEEP_ALIVE_INTERVAL = 10 * 60 * 1000; // 10 minutes
const PORT = process.env.PORT || 3000;
const SELF_URL = process.env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}`;

// -----------------------------
// Fetch Data (with caching + 429 tolerance)
// -----------------------------
async function fetchCoinData(force = false) {
  const now = Date.now();
  const sinceLast = ((now - lastFetch) / 1000).toFixed(1);

  console.log(`\n🧩 fetchCoinData(force=${force}) — last fetch ${sinceLast}s ago`);

  // Serve from cache if still fresh
  if (!force && cache && now - lastFetch < CACHE_DURATION) {
    console.log("🟢 Cache still fresh — serving from cache");
    return cache;
  }

  // If another request is already fetching, reuse that promise
  if (fetchPromise) {
    console.log("🕓 Another fetch in progress — waiting...");
    return fetchPromise;
  }

  // Otherwise, start a new fetch
  fetchPromise = (async () => {
    console.log("🌍 Fetching data from CoinGecko API...");
    try {
      const response = await axios.get(
        "https://api.coingecko.com/api/v3/coins/markets",
        {
          params: {
            vs_currency: "usd",
            order: "market_cap_desc",
            per_page: 250,
            page: 1,
            sparkline: false,
          },
          timeout: 10000,
        }
      );

      cache = response.data;
      lastFetch = now;
      console.log(`✅ Fetched ${cache.length} coins successfully`);
    } catch (err) {
      console.error(`❌ CoinGecko fetch failed: ${err.message}`);

      if (err.response?.status === 429) {
        console.warn("⚠️ Rate limit (429) — using stale cache if available");
        if (cache) return cache;
      }

      if (cache) {
        console.warn("⚠️ Returning stale cache from previous fetch");
        return cache;
      } else {
        console.error("🚨 No cache available — will retry later");
        throw err;
      }
    } finally {
      fetchPromise = null;
    }

    return cache;
  })();

  return fetchPromise;
}

// -----------------------------
// API route
// -----------------------------
app.get("/api/prices", async (req, res) => {
  console.log(`📡 /api/prices requested (limit=${req.query.limit || 250})`);
  try {
    const limit = parseInt(req.query.limit) || 250;
    const data = await fetchCoinData();
    res.json(data.slice(0, limit));
  } catch (err) {
    console.error("❌ API Error:", err.message);
    res.status(200).json(cache || { error: "Temporarily unavailable" });
  }
});

// -----------------------------
// Health route for monitoring
// -----------------------------
app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    lastFetch: new Date(lastFetch).toISOString(),
    cacheAgeSec: ((Date.now() - lastFetch) / 1000).toFixed(0),
    cacheReady: !!cache,
  });
});

// -----------------------------
// Warm-Up Logic (delay + retries)
// -----------------------------
async function warmUp(attempt = 1) {
  console.log(`🚀 Warm-up starting (attempt ${attempt})...`);
  try {
    await fetchCoinData(true);
    console.log("🟢 Warm-up successful — cache ready");
  } catch (err) {
    console.warn(`⚠️ Warm-up failed (attempt ${attempt}): ${err.message}`);
    if (attempt < 5) {
      const delay = attempt * 60000; // 1, 2, 3, 4, 5 min
      console.log(`⏳ Retrying warm-up in ${delay / 1000}s...`);
      setTimeout(() => warmUp(attempt + 1), delay);
    } else {
      console.error("❌ Warm-up failed too many times — giving up for now");
    }
  }
}

// -----------------------------
// Keep-Alive Pinger
// -----------------------------
function startKeepAlive() {
  if (SELF_URL.includes("localhost")) return; // skip locally
  console.log(`🔄 Keep-alive pinger active — every ${KEEP_ALIVE_INTERVAL / 60000} min`);
  setInterval(async () => {
    try {
      await axios.get(`${SELF_URL}/health`);
      console.log("💓 Keep-alive ping OK");
    } catch (err) {
      console.warn("⚠️ Keep-alive ping failed:", err.message);
    }
  }, KEEP_ALIVE_INTERVAL);
}

// -----------------------------
// Server Start
// -----------------------------
app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
  console.log(`🌐 Public URL: ${SELF_URL}`);
  console.log("⏳ Waiting 30s before first warm-up...");
  setTimeout(warmUp, 30000);
  startKeepAlive();
});
