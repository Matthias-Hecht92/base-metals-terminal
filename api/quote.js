export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { symbols } = req.query;
  if (!symbols) return res.status(400).json({ error: 'symbols required' });

  const fields = 'regularMarketPrice,regularMarketChange,regularMarketChangePercent,regularMarketOpen,regularMarketDayHigh,regularMarketDayLow,regularMarketPreviousClose,fiftyTwoWeekHigh,fiftyTwoWeekLow,marketState,shortName';

  // Try multiple Yahoo Finance endpoints
  const endpoints = [
    `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${symbols}&fields=${fields}&formatted=false`,
    `https://query2.finance.yahoo.com/v7/finance/quote?symbols=${symbols}&fields=${fields}&formatted=false`,
    `https://query1.finance.yahoo.com/v8/finance/spark?symbols=${symbols}&range=1d&interval=1d`,
  ];

  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Accept': 'application/json, text/plain, */*',
    'Accept-Language': 'en-US,en;q=0.9',
    'Accept-Encoding': 'gzip, deflate, br',
    'Origin': 'https://finance.yahoo.com',
    'Referer': 'https://finance.yahoo.com/',
  };

  for (const url of endpoints) {
    try {
      const r = await fetch(url, { headers });
      if (!r.ok) continue;
      const data = await r.json();
      const results = data?.quoteResponse?.result || data?.spark?.result;
      if (results && results.length > 0) {
        return res.status(200).json(data);
      }
    } catch(e) {
      continue;
    }
  }

  // All Yahoo endpoints failed — try Yahoo Finance chart API per symbol
  try {
    const syms = symbols.split(',');
    const results = await Promise.all(syms.map(async (sym) => {
      const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=1d&range=5d`;
      const r = await fetch(url, { headers });
      if (!r.ok) return null;
      const d = await r.json();
      const meta = d?.chart?.result?.[0]?.meta;
      if (!meta) return null;
      const quotes = d?.chart?.result?.[0]?.indicators?.quote?.[0];
      const closes = d?.chart?.result?.[0]?.timestamp ? d.chart.result[0].indicators.quote[0].close.filter(Boolean) : [];
      const prev = closes.length > 1 ? closes[closes.length - 2] : meta.previousClose;
      const price = meta.regularMarketPrice;
      const change = price - (prev || price);
      return {
        symbol: sym,
        regularMarketPrice: price,
        regularMarketChange: change,
        regularMarketChangePercent: prev ? (change / prev) * 100 : 0,
        regularMarketOpen: meta.regularMarketOpen || price,
        regularMarketDayHigh: meta.regularMarketDayHigh || price,
        regularMarketDayLow: meta.regularMarketDayLow || price,
        regularMarketPreviousClose: prev || price,
        fiftyTwoWeekHigh: meta.fiftyTwoWeekHigh || price,
        fiftyTwoWeekLow: meta.fiftyTwoWeekLow || price,
        marketState: meta.marketState || 'REGULAR',
        shortName: meta.shortName || sym,
      };
    }));

    const valid = results.filter(Boolean);
    if (valid.length > 0) {
      return res.status(200).json({ quoteResponse: { result: valid, error: null } });
    }
  } catch(e) {
    return res.status(500).json({ error: 'All endpoints failed: ' + e.message });
  }

  res.status(503).json({ error: 'Yahoo Finance unavailable' });
}
