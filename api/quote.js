// Proxy Vercel
// Métaux : westmetall.com (prix LME officiels + historique pour prev close)
// FX : Yahoo Finance chart API (vrai prev close)

const METAL_FIELDS = {
  'HG=F':  { field: 'LME_Cu_cash', name: 'LME Copper'    },
  'ALI=F': { field: 'LME_Al_cash', name: 'LME Aluminium' },
  'NI=F':  { field: 'LME_Ni_cash', name: 'LME Nickel'    },
  'ZNC=F': { field: 'LME_Zn_cash', name: 'LME Zinc'      },
  'PB=F':  { field: 'LME_Pb_cash', name: 'LME Lead'      },
  'SN=F':  { field: 'LME_Sn_cash', name: 'LME Tin'       },
};

// Fetch westmetall table page for a given field → returns {today, prev, w52h, w52l, stock}
async function fetchWestmetallTable(field) {
  const url = `https://www.westmetall.com/en/markdaten.php?action=table&field=${field}`;
  const r = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'text/html' },
    signal: AbortSignal.timeout(10000)
  });
  const html = await r.text();

  // Extract all price entries — format: "DD. Mon YYYY | 12,345.00 | 12,456.00 | 123,456"
  // We match lines with a 4-digit year and a price like 12,345.00
  const rows = [];
  const rowRe = /(\d{1,2}\.\s+\w+\s+\d{4})\s*\|\s*([\d,]+\.?\d*)\s*\|\s*([\d,]+\.?\d*)/g;
  let m;
  while ((m = rowRe.exec(html)) !== null) {
    const cash = parseFloat(m[2].replace(/,/g, ''));
    const threeM = parseFloat(m[3].replace(/,/g, ''));
    if (cash > 100) rows.push({ date: m[1].trim(), cash, threeM });
  }

  // Fallback: try simpler number extraction if table parsing fails
  if (rows.length < 2) {
    // Try extracting numbers directly from HTML
    const numRe = /([\d]{1,3}(?:,\d{3})+\.\d{2})/g;
    const nums = [];
    let nm;
    while ((nm = numRe.exec(html)) !== null) {
      const v = parseFloat(nm[1].replace(/,/g, ''));
      if (v > 100 && v < 100000) nums.push(v);
    }
    if (nums.length >= 2) {
      return {
        today: nums[0],
        threeM: nums[1],
        prev: nums[2] || nums[0],
        w52h: nums.length > 4 ? Math.max(...nums.slice(0, 20)) : nums[0] * 1.2,
        w52l: nums.length > 4 ? Math.min(...nums.slice(0, 20)) : nums[0] * 0.8,
      };
    }
  }

  if (rows.length < 1) return null;

  const today = rows[0].cash;
  const threeM = rows[0].threeM;
  const prev = rows.length > 1 ? rows[1].cash : today;

  // 52W range from all available rows (up to 260 trading days)
  const allPrices = rows.map(r => r.cash);
  const w52h = Math.max(...allPrices);
  const w52l = Math.min(...allPrices);

  return { today, threeM, prev, w52h, w52l };
}

// Fetch Yahoo Finance chart API for FX and % change
async function fetchYahooChart(sym) {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=1d&range=5d`;
    const r = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' },
      signal: AbortSignal.timeout(8000)
    });
    const d = await r.json();
    return d?.chart?.result?.[0]?.meta || null;
  } catch(e) { return null; }
}

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
      if (METAL_FIELDS[sym]) {
        // ── METALS: westmetall table → today + prev close
        const { field, name } = METAL_FIELDS[sym];
        const data = await fetchWestmetallTable(field);

        if (data && data.today > 0) {
          const price = data.today;
          const prev  = data.prev;
          const chg   = price - prev;
          const pct   = prev > 0 ? (chg / prev) * 100 : 0;

          results.push({
            symbol: sym,
            regularMarketPrice: price,
            regularMarketChange: chg,
            regularMarketChangePercent: pct,
            regularMarketOpen: prev, // open ≈ prev close (LME doesn't have intraday open)
            regularMarketDayHigh: Math.max(price, prev),
            regularMarketDayLow:  Math.min(price, prev),
            regularMarketPreviousClose: prev,
            fiftyTwoWeekHigh: data.w52h,
            fiftyTwoWeekLow:  data.w52l,
            threeMonthPrice:  data.threeM,
            marketState: 'REGULAR',
            shortName: name,
            source: 'westmetall',
          });
        } else {
          // Westmetall failed → fallback Yahoo
          const meta = await fetchYahooChart(sym);
          if (meta) {
            const price = meta.regularMarketPrice;
            const prev  = meta.regularMarketPreviousClose || price;
            results.push({
              symbol: sym,
              regularMarketPrice: price,
              regularMarketChange: price - prev,
              regularMarketChangePercent: prev > 0 ? ((price-prev)/prev)*100 : 0,
              regularMarketOpen: meta.regularMarketOpen || price,
              regularMarketDayHigh: meta.regularMarketDayHigh || price,
              regularMarketDayLow:  meta.regularMarketDayLow  || price,
              regularMarketPreviousClose: prev,
              fiftyTwoWeekHigh: meta.fiftyTwoWeekHigh || price,
              fiftyTwoWeekLow:  meta.fiftyTwoWeekLow  || price,
              marketState: meta.marketState || 'CLOSED',
              shortName: name,
              source: 'yahoo_fallback',
            });
          }
        }
      } else {
        // ── FX: Yahoo Finance → vrai prev close, vrai %
        const meta = await fetchYahooChart(sym);
        if (meta) {
          const price = meta.regularMarketPrice;
          const prev  = meta.regularMarketPreviousClose || price;
          const chg   = price - prev;
          results.push({
            symbol: sym,
            regularMarketPrice: price,
            regularMarketChange: chg,
            regularMarketChangePercent: prev > 0 ? (chg/prev)*100 : 0,
            regularMarketOpen: meta.regularMarketOpen || price,
            regularMarketDayHigh: meta.regularMarketDayHigh || price,
            regularMarketDayLow:  meta.regularMarketDayLow  || price,
            regularMarketPreviousClose: prev,
            fiftyTwoWeekHigh: meta.fiftyTwoWeekHigh || price,
            fiftyTwoWeekLow:  meta.fiftyTwoWeekLow  || price,
            marketState: meta.marketState || 'REGULAR',
            shortName: sym,
            source: 'yahoo_fx',
          });
        }
      }
    } catch(e) {
      console.error(`[${sym}] Error:`, e.message);
    }
  }

  res.status(200).json({ quoteResponse: { result: results, error: null } });
}
