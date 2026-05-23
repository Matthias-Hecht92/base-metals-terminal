const TWELVE_KEY = 'ff374a1fa6ad46d7940b84d725868e08';

// Twelve Data symbols for base metals + FX
const METAL_SYMBOLS = {
  'HG=F':    { td: 'COPPER',    mult: 2204.62 }, // Copper futures $/lb → $/t
  'ALI=F':   { td: 'ALUMINUM',  mult: 1       }, // Aluminium $/t
  'NI=F':    { td: 'NICKEL',    mult: 1       }, // Nickel $/t
  'ZNC=F':   { td: 'ZINC',      mult: 2204.62 }, // Zinc $/lb → $/t
  'PB=F':    { td: 'LEAD',      mult: 2204.62 }, // Lead $/lb → $/t
  'SN=F':    { td: 'TIN',       mult: 1       }, // Tin $/t
};

const FX_SYMBOLS = {
  'EURUSD=X': 'EUR/USD',
  'CNY=X':    'USD/CNY',
  'AUDUSD=X': 'AUD/USD',
  'CLPUSD=X': 'USD/CLP',
  'GBPUSD=X': 'GBP/USD',
};

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { symbols } = req.query;
  if (!symbols) return res.status(400).json({ error: 'symbols required' });

  const symList = symbols.split(',').map(s => s.trim());
  const results = [];

  for (const sym of symList) {
    try {
      // Check if it's a metal or FX
      if (METAL_SYMBOLS[sym]) {
        const { td, mult } = METAL_SYMBOLS[sym];
        const url = `https://api.twelvedata.com/quote?symbol=${td}&apikey=${TWELVE_KEY}`;
        const r = await fetch(url);
        const d = await r.json();

        if (d.status === 'error' || !d.close) {
          // Fallback to Yahoo chart API
          const yurl = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=1d&range=5d`;
          const yr = await fetch(yurl, { headers: { 'User-Agent': 'Mozilla/5.0' } });
          const yd = await yr.json();
          const meta = yd?.chart?.result?.[0]?.meta;
          if (meta) {
            const price = meta.regularMarketPrice;
            const prev = meta.regularMarketPreviousClose || price;
            results.push({
              symbol: sym,
              regularMarketPrice: price,
              regularMarketChange: price - prev,
              regularMarketChangePercent: ((price - prev) / prev) * 100,
              regularMarketOpen: meta.regularMarketOpen || price,
              regularMarketDayHigh: meta.regularMarketDayHigh || price,
              regularMarketDayLow: meta.regularMarketDayLow || price,
              regularMarketPreviousClose: prev,
              fiftyTwoWeekHigh: meta.fiftyTwoWeekHigh || price,
              fiftyTwoWeekLow: meta.fiftyTwoWeekLow || price,
              marketState: meta.marketState || 'CLOSED',
              shortName: meta.shortName || sym,
              source: 'yahoo_fallback',
            });
          }
          continue;
        }

        const price = parseFloat(d.close) * mult;
        const open = parseFloat(d.open) * mult;
        const high = parseFloat(d.high) * mult;
        const low = parseFloat(d.low) * mult;
        const prev = parseFloat(d.previous_close) * mult;
        const change = price - prev;

        results.push({
          symbol: sym,
          regularMarketPrice: price,
          regularMarketChange: change,
          regularMarketChangePercent: (change / prev) * 100,
          regularMarketOpen: open,
          regularMarketDayHigh: high,
          regularMarketDayLow: low,
          regularMarketPreviousClose: prev,
          fiftyTwoWeekHigh: parseFloat(d['52_week']['high']) * mult,
          fiftyTwoWeekLow: parseFloat(d['52_week']['low']) * mult,
          marketState: d.is_market_open ? 'REGULAR' : 'CLOSED',
          shortName: d.name || td,
          source: 'twelvedata',
        });

      } else if (FX_SYMBOLS[sym]) {
        // FX via Yahoo (works fine for FX)
        const yurl = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=1d&range=2d`;
        const yr = await fetch(yurl, { headers: { 'User-Agent': 'Mozilla/5.0' } });
        const yd = await yr.json();
        const meta = yd?.chart?.result?.[0]?.meta;
        if (meta) {
          const price = meta.regularMarketPrice;
          const prev = meta.regularMarketPreviousClose || price;
          results.push({
            symbol: sym,
            regularMarketPrice: price,
            regularMarketChange: price - prev,
            regularMarketChangePercent: ((price - prev) / prev) * 100,
            regularMarketOpen: meta.regularMarketOpen || price,
            regularMarketDayHigh: meta.regularMarketDayHigh || price,
            regularMarketDayLow: meta.regularMarketDayLow || price,
            regularMarketPreviousClose: prev,
            fiftyTwoWeekHigh: meta.fiftyTwoWeekHigh || price,
            fiftyTwoWeekLow: meta.fiftyTwoWeekLow || price,
            marketState: meta.marketState || 'REGULAR',
            shortName: FX_SYMBOLS[sym],
            source: 'yahoo_fx',
          });
        }
      }
    } catch(e) {
      console.error(`Error fetching ${sym}:`, e.message);
    }
  }

  res.status(200).json({
    quoteResponse: { result: results, error: null }
  });
}
