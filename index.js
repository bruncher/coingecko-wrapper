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

// === Compare cache ===
const compareCache = {};
const compareLocks = {};
const COMPARE_CACHE_DURATION = 60 * 60 * 1000; // 1 hour

// === Throttling + retry queue ===
let lastMarketChartFetch = 0;
const CHART_THROTTLE_MS = 3000;
const retryQueue = [];

// Throttled fetch wrapper
async function throttledFetch(url, params) {
  const delay = Math.max(0, CHART_THROTTLE_MS - (Date.now() - lastMarketChartFetch));
  if (delay > 0) await new Promise(r => setTimeout(r, delay));
  lastMarketChartFetch = Date.now();
  return axios.get(url, { params, timeout: 20000 });
}

// Helper: retry with exponential backoff
async function fetchWithRetry(url, params, attempt = 1) {
try {
  const resp = await throttledFetch(url, params);
  return resp.data;
  } catch (err) {
    const status = err.response?.status;
    if ((status === 429 || !status) && attempt < 5) {
      const delay = 1500 * attempt + Math.random() * 500;
      console.warn(`⚠️ Retry ${attempt}/5 for ${url} after ${delay.toFixed(0)}ms`);
      await new Promise(r => setTimeout(r, delay));
      return fetchWithRetry(url, params, attempt + 1);
    }
    throw err;
  }
}

app.get("/api/compare", async (req, res) => {
  const { coin1 = "bitcoin", coin2 = "ethereum" } = req.query;
  const key = [coin1, coin2].sort().join("_");
  console.log(`🔍 Compare request: ${coin1} vs ${coin2}`);

  // Serve from cache if still fresh
  const cached = compareCache[key];
  if (cached && Date.now() - cached.timestamp < COMPARE_CACHE_DURATION) {
    console.log(`🟢 Served ${key} from cache`);
    return res.json(cached.data);
  }

  // Prevent duplicate concurrent fetches
  if (compareLocks[key]) {
    console.log(`⏳ Waiting for existing fetch for ${key}`);
    try {
      const result = await compareLocks[key];
      return res.json(result.data);
    } catch {
      return res.status(500).json({ error: "Failed to fetch comparison data" });
    }
  }

  compareLocks[key] = (async () => {
    const url1 = `https://api.coingecko.com/api/v3/coins/${coin1}/market_chart`;
    const url2 = `https://api.coingecko.com/api/v3/coins/${coin2}/market_chart`;
    const params = { vs_currency: "usd", days: 365 };

    let data1 = null;
    let data2 = null;
    let warning = null;

    try {
      // Fetch first coin
      data1 = await fetchWithRetry(url1, params);

      // Randomized delay before second request
      const randomDelay = 1500 + Math.random() * 2000;
      console.log(`⏳ Waiting ${randomDelay.toFixed(0)}ms before second coin request...`);
      await new Promise(r => setTimeout(r, randomDelay));

      // Fetch second coin
      data2 = await fetchWithRetry(url2, params);
    } catch (err) {
      console.error(`⚠️ Partial failure fetching ${coin1} vs ${coin2}:`, err.message);
      warning = `Partial data — ${!data1 ? coin1 : coin2} failed to fetch`;
    } finally {
      delete compareLocks[key];
    }

    if (!data1 && !data2) {
      console.error(`❌ Both coin fetches failed for ${key}`);
      throw new Error("Both coin fetches failed");
    }

    const result = {
      coin1,
      coin2,
      data: [
        ...(data1 ? [{ name: coin1, prices: data1.prices || [] }] : []),
        ...(data2 ? [{ name: coin2, prices: data2.prices || [] }] : []),
      ],
      ...(warning ? { warning } : {}),
    };

    compareCache[key] = { timestamp: Date.now(), data: result };
    console.log(`✅ Cached compare ${key}${warning ? " (partial)" : ""} — ${data1?.prices?.length || 0}/${data2?.prices?.length || 0} points`);
    return { data: result };
  })();

  try {
    const result = await compareLocks[key];
    res.json(result.data);
  } catch {
  console.warn(`⚠️ Compare request failed for ${coin1}_${coin2}, enqueuing background retry`);
  retryQueue.push({ coin1, coin2, attempt: 1 });
  const cached = compareCache[key];
  res.status(200).json(
    cached
      ? { ...cached.data, warning: "Served stale data after error" }
      : { coin1, coin2, data: [], warning: "Data temporarily unavailable — retrying in background" }
  );
}
});

// === Background retry worker ===
setInterval(async () => {
  if (retryQueue.length === 0) return;
  const task = retryQueue.shift();
  const { coin1, coin2, attempt } = task;
  const key = [coin1, coin2].sort().join("_");
  console.log(`🔁 Background retry for ${key} (attempt ${attempt})`);

  try {
    const params = { vs_currency: "usd", days: 365 };
    const url1 = `https://api.coingecko.com/api/v3/coins/${coin1}/market_chart`;
    const url2 = `https://api.coingecko.com/api/v3/coins/${coin2}/market_chart`;
    const [data1, data2] = await Promise.all([
      fetchWithRetry(url1, params),
      fetchWithRetry(url2, params)
    ]);
    compareCache[key] = {
      timestamp: Date.now(),
      data: {
        coin1,
        coin2,
        data: [
          { name: coin1, prices: data1.prices || [] },
          { name: coin2, prices: data2.prices || [] },
        ]
      }
    };
    console.log(`✅ Background retry successful for ${key}`);
  } catch (err) {
    console.warn(`⚠️ Background retry failed for ${key}: ${err.message}`);
    if (attempt < 5) retryQueue.push({ coin1, coin2, attempt: attempt + 1 });
  }
}, 60 * 1000); // every 60 seconds

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

// === Prewarm top compare pairs hourly ===
const topPairs = [["bitcoin", "ethereum"], ["solana", "cardano"], ["dogecoin", "shiba-inu"]];
setInterval(() => {
  console.log("🔥 Prewarming top compare pairs...");
  topPairs.forEach(([a, b]) =>
    retryQueue.push({ coin1: a, coin2: b, attempt: 1 })
  );
}, 60 * 60 * 1000);

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
