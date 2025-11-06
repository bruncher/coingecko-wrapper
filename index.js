import express from "express";
import axios from "axios";
import cors from "cors";

const app = express();
app.use(cors());

// Simple cache to avoid hitting CoinGecko too often
let cache = null;
let lastFetch = 0;
const CACHE_DURATION = 60 * 1000; // 1 minute

app.get("/api/prices", async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 250;
    const now = Date.now();

    // Use cached data if it's fresh
    if (cache && (now - lastFetch < CACHE_DURATION)) {
      console.log("Serving from cache");
      return res.json(cache.slice(0, limit));
    }

    console.log("Fetching fresh data from CoinGecko...");
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
    res.json(cache.slice(0, limit));

  } catch (error) {
    console.error(error.message);
    res.status(500).json({ error: "Failed to fetch from CoinGecko" });
  }
});

const PORT = process.env.PORT || 3000;

// Warm up cache when the server starts
fetchCoinData()
  .then(() => console.log("🟢 Cache pre-loaded with CoinGecko data"))
  .catch(err => console.warn("⚠️ Warm-up failed:", err.message));

app.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));
