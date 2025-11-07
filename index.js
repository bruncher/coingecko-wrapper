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
        // Still return stale cache even on 429
      } else {
        throw err; // No cache to return
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

async function warmUp() {
  try {
    await fetchCoinData(true);
    console.log("🟢 Cache preloaded successfully");
  } catch (err) {
    console.warn("⚠️ Warm-up failed, retrying in 60s...");
    setTimeout(warmUp, 60000);
  }
}

warmUp();

app.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));
