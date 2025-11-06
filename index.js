import express from "express";
import axios from "axios";
import cors from "cors";

const app = express();
app.use(cors());

let cache = null;
let lastFetch = 0;
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

async function fetchCoinData() {
  try {
    const response = await axios.get("https://api.coingecko.com/api/v3/coins/markets", {
      params: {
        vs_currency: "usd",
        order: "market_cap_desc",
        per_page: 250,
        page: 1,
        sparkline: false,
      },
      timeout: 10000,
    });
    cache = response.data;
    lastFetch = Date.now();
    console.log("✅ Fresh data fetched from CoinGecko");
  } catch (err) {
    console.warn("⚠️ CoinGecko fetch failed:", err.message);
  }
}

app.get("/api/prices", async (req, res) => {
  const now = Date.now();
  const limit = parseInt(req.query.limit) || 250;

  // Refresh if cache is old or missing
  if (!cache || now - lastFetch > CACHE_DURATION) {
    await fetchCoinData();
  }

  if (cache) {
    res.json(cache.slice(0, limit));
  } else {
    res.status(200).json([]); // respond safely with empty array
  }
});

app.get("/", (_, res) => {
  res.send("✅ CoinGecko Wrapper is running");
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
  fetchCoinData(); // pre-load cache
});