import express from "express";
import axios from "axios";
import cors from "cors";

const app = express();
app.use(cors());

let cache = null;
let lastFetch = 0;
const CACHE_DURATION = 60 * 1000; // 1 minute

// Function to fetch and cache data
async function fetchCoinData(force = false) {
  const now = Date.now();
  if (!force && cache && now - lastFetch < CACHE_DURATION) {
    console.log("✅ Using cached data");
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

  } catch (error) {
    console.error("❌ Error fetching from CoinGecko:", error.message);
    // Return cached data even if fresh fetch fails
    if (cache) {
      console.warn("⚠️ Serving stale cache");
      return cache;
    }
    throw error;
  }
}

app.get("/api/prices", async (req, res) => {
  try {
    const data = await fetchCoinData();
    const limit = parseInt(req.query.limit) || 250;
    res.json(data.slice(0, limit));
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch from CoinGecko" });
  }
});

const PORT = process.env.PORT || 3000;

// Warm cache at startup
fetchCoinData(true)
  .then(() => console.log("🟢 Cache preloaded"))
  .catch(err => console.warn("⚠️ Warm-up failed:", err.message));

app.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));