import express from "express";
import axios from "axios";
import cors from "cors";

const app = express();
app.use(cors());

let cache = null;
let lastFetch = 0;
let fetchPromise = null;
const CACHE_DURATION = 15 * 60 * 1000; // 15 minutes

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
        }
      );

      cache = response.data;
      lastFetch = now;
      console.log("✅ Fresh data fetched from CoinGecko");
    } catch (err) {
      console.error("❌ Error fetching from CoinGecko:", err.message);

      if (cache) {
        console.log("⚠️ Returning stale cache data");
        // Just return old cache — users still get data
      } else {
        console.warn("⚠️ No cache available — retry will handle it");
        throw err; // only throw if no cache yet
      }
    } finally {
      fetchPromise = null;
    }

    return cache;
  })();

  return fetchPromise;
}

// API route
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

const PORT = process.env.PORT || 3000;

// --- Improved Warm-Up Sequence ---
async function warmUp(retries = 3, delay = 30000) {
  console.log("🚀 Starting warm-up...");
  for (let i = 0; i < retries; i++) {
    try {
      await fetchCoinData(true);
      console.log("🟢 Cache preloaded successfully");
      return;
    } catch (err) {
      console.warn(`⚠️ Warm-up failed (attempt ${i + 1}): ${err.message}`);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  console.error("❌ All warm-up attempts failed — will retry in 5 min");
  setTimeout(warmUp, 5 * 60 * 1000);
}

// Add short delay before first warm-up to avoid CoinGecko rate-limits on cold boot
setTimeout(() => warmUp(), 10000);

// --- Optional Keep-Alive Ping (prevents sleeping) ---
setInterval(() => {
  axios
    .get(`http://localhost:${PORT}/api/prices?limit=1`)
    .then(() => console.log("💤 Keep-alive ping OK"))
    .catch(() => console.warn("💤 Keep-alive ping failed"));
}, 10 * 60 * 1000); // every 10 min

app.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));
