import express from "express";
import axios from "axios";
import cors from "cors";

const app = express();
app.use(cors());

let cache = null;
let lastFetch = 0;
const CACHE_DURATION = 60 * 1000; // 1 minute

// Fetch CoinGecko data with built-in caching
async function fetchCoinData(force = false) {
  const now = Date.now();
  if (!force && cache && now - lastFetch < CACHE_DURATION) {
    console.log("🟢 Serving from cache");
    return cache;
  }

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
    return cache;
  } catch (err) {
    console.error("❌ Error fetching from CoinGecko:", err.message);
    if (cache) {
      console.log("⚠️ Returning stale cache data");
      return cache;
    }
    throw err;
  }
}

// API route
app.get("/api/prices", async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 250;
    const data = await fetchCoinData();
    res.json(data.slice(0, limit));
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch from CoinGecko" });
  }
});

const PORT = process.env.PORT || 3000;

// Warm-up with retry
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