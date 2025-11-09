import express from "express";
import axios from "axios";
import cors from "cors";

const app = express();
app.use(cors());

let cache = null;
let lastFetch = 0;
let fetchPromise = null;

const CACHE_DURATION = 15 * 60 * 1000; // 15 minutes
const KEEP_ALIVE_INTERVAL = 10 * 60 * 1000; // 10 minutes for self-ping
const PORT = process.env.PORT || 3000;
const SELF_URL = process.env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}`;

// -----------------------------
// Fetch Data (with caching + 429 tolerance)
// -----------------------------
async function fetchCoinData(force = false) {
  const now = Date.now();

  // Serve from cache if still fresh
  if (!force && cache && now - lastFetch < CACHE_DURATION) {
    console.log("🟢 Serving from cache");
    return cache;
  }

  // If another request is already fetching, reuse that promise
  if (fetchPromise) {
    console.log("🕓 Waiting for ongoing fetch...");
    return fetchPromise;
  }

  // Otherwise, start a new fetch
  fetchPromise = (async () => {
    console.log("🌍 Fetching data from CoinGecko...");
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
      console.log("✅ Fresh data fetched from CoinGecko");
    } catch (err) {
      console.error("❌ Error fetching from CoinGecko:", err.message);

      if (err.response?.status === 429) {
        console.warn("⚠️ Rate limited — returning stale cache if available");
        if (cache) return cache;
      }

      if (cache) {
        console.log("⚠️ Returning stale cache data");
        return cache;
      } else {
        console.warn("⚠️ No cache available — retry will handle it");
        throw err; // No cache to return yet
      }
    } finally {
      fetchPromise = null;
    }

    return cache;
  })();

  return fetchPromise;
}

// -----------------------------
// API Route
// -----------------------------
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

// -----------------------------
// Warm-Up Logic (delay + backoff retries)
// -----------------------------
async function warmUp(attempt = 1) {
  console.log(`🚀 Starting warm-up (attempt ${attempt})...`);
  try {
    await fetchCoinData(true);
    console.log("🟢 Cache preloaded successfully");
  } catch (err) {
    console.warn(`⚠️ Warm-up failed (attempt ${attempt}): ${err.message}`);
    if (attempt < 5) {
      const delay = attempt * 60000; // 1, 2, 3, 4, 5 min
      console.log(`⏳ Retrying warm-up in ${delay / 1000}s...`);
      setTimeout(() => warmUp(attempt + 1), delay);
    } else {
      console.warn("❌ Warm-up failed too many times, will rely on live fetches.");
    }
  }
}

// -----------------------------
// Keep-Alive Ping (prevents Render from sleeping)
// -----------------------------
function startKeepAlive() {
  if (SELF_URL.includes("localhost")) return; // skip locally
  console.log("🔄 Keep-alive pinger started every 10 minutes...");
  setInterval(async () => {
    try {
      await axios.get(`${SELF_URL}/api/prices`);
      console.log("💓 Keep-alive ping successful");
    } catch (err) {
      console.warn("⚠️ Keep-alive ping failed:", err.message);
    }
  }, KEEP_ALIVE_INTERVAL);
}

// -----------------------------
// Start Server
// -----------------------------
app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
  // Delay warm-up by 30s to avoid CoinGecko cold-start 429
  setTimeout(warmUp, 30000);
  // Start self-pinging to stay awake (free keep-alive)
  startKeepAlive();
});
