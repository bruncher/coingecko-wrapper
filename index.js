const express = require("express");
const axios = require("axios");
const cors = require("cors");

const app = express();
app.use(cors());

const PORT = process.env.PORT || 3000;

// ✅ Main endpoint: fetch top 250 coins by default
app.get("/api/prices", async (req, res) => {
  try {
    const limit = req.query.limit || 250;

    const { data } = await axios.get(
      "https://api.coingecko.com/api/v3/coins/markets",
      {
        params: {
          vs_currency: "usd",
          order: "market_cap_desc",
          per_page: limit,
          page: 1,
        },
      }
    );

    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Health check
app.get("/", (req, res) => {
  res.send("✅ CoinGecko Wrapper is running!");
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

