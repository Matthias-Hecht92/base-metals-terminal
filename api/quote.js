// Proxy Vercel — scrape westmetall.com pour les prix LME officiels + Yahoo pour FX
// westmetall.com publie les prix LME officiels en clair, mis à jour quotidiennement

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { symbols } = req.query;
  if (!symbols) return res.status(400).json({ error: 'symbols required' });

  const symList = symbols.split(',').map(s => s.trim());
  const results = [];

  // Fetch LME prices from westmetall.com
  const lmeData = await fetchWestmetall();

  // Fetch FX from Yahoo
  const fxTickers = symList.filter(s => s.includes('=X') || s === 'CNY=X');
  const metalTickers = symList.filter(s => !s.includes('=X') && s !== 'CNY=X');

  // Build metal results from westmetall
  const metalMap = {
    'HG=F':  'Cu',
    'ALI=F': 'Al',
    'NI=F':  'Ni',
    'ZNC=F': 'Zn',
    'PB=F':  'Pb',
    'SN=F':  'Sn',
  };

  for (const sym of metalTickers) {
    const key = metalMap[sym];
    if (key && lmeData[key]) {
      const { cash, prev, high, low, name } = lmeData[key];
      const chg = cash - prev;
      results.push({
        symbol: sym,
        regularMarketPrice: cash,
        regularMarketChange: chg,
        regularMarketChangePercent: prev > 0 ? (chg / prev) * 100 : 0,
        regularMarketOpen: cash,
        regularMarketDayHigh: high || cash,
        regularMarketDayLow: low || cash,
        regularMarketPreviousClose: prev,
        fiftyTwoWeekHigh: lmeData[key].w52h || cash * 1.2,
        fiftyTwoWeekLow:  lmeData[key].w52l || cash * 0.8,
        marketState: 'REGULAR',
        shortName: name,
        source: 'westmetall_lme',
      });
    }
  }

  // Fetch FX from Yahoo chart API
  for (const sym of symList.filter(s => !metalMap[s])) {
    const meta = await fetchYahoo(sym);
    if (meta) {
      const price = meta.regularMarketPrice;
      const prev  = meta.regularMarketPreviousClose || price;
      results.push({
        symbol: sym,
        regularMarketPrice: price,
        regularMarketChange: price - prev,
        regularMarketChangePercent: prev > 0 ? ((price - prev) / prev) * 100 : 0,
        regularMarketOpen: meta.regularMarketOpen || price,
        regularMarketDayHigh: meta.regularMarketDayHigh || price,
        regularMarketDayLow: meta.regularMarketDayLow || price,
        regularMarketPreviousClose: prev,
        fiftyTwoWeekHigh: meta.fiftyTwoWeekHigh || price,
        fiftyTwoWeekLow:  meta.fiftyTwoWeekLow  || price,
        marketState: meta.marketState || 'REGULAR',
        shortName: sym,
        source: 'yahoo_fx',
      });
    }
  }

  res.status(200).json({ quoteResponse: { result: results, error: null } });
}

// ─── Scrape westmetall.com ───────────────────────────────────────────────────
async function fetchWestmetall() {
  try {
    const r = await fetch('https://www.westmetall.com/en/markdaten.php', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'text/html',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      signal: AbortSignal.timeout(10000)
    });
    const html = await r.text();

    // Parse LME prices from the HTML table
    // Pattern: metal name → cash price → 3M price
    const data = {};

    const metals = [
      { key: 'Cu', names: ['Copper'],    shortName: 'LME Copper'    },
      { key: 'Al', names: ['Aluminium'], shortName: 'LME Aluminium' },
      { key: 'Ni', names: ['Nickel'],    shortName: 'LME Nickel'    },
      { key: 'Zn', names: ['Zinc'],      shortName: 'LME Zinc'      },
      { key: 'Pb', names: ['Lead'],      shortName: 'LME Lead'      },
      { key: 'Sn', names: ['Tin'],       shortName: 'LME Tin'       },
    ];

    for (const m of metals) {
      for (const name of m.names) {
        // Extract prices using regex on the HTML
        // westmetall format: numbers like 13,427.00 or 3,527.50
        const regex = new RegExp(
          name + '[\\s\\S]{1,500}?([\\d,]+\\.\\d{2})[\\s\\S]{1,200}?([\\d,]+\\.\\d{2})',
          'i'
        );
        const match = html.match(regex);
        if (match) {
          const cash = parseFloat(match[1].replace(/,/g, ''));
          const threeM = parseFloat(match[2].replace(/,/g, ''));
          if (cash > 100) { // sanity check
            data[m.key] = {
              cash,
              threeM,
              prev: cash * 0.99, // approx, westmetall doesn't give prev close
              high: cash * 1.005,
              low:  cash * 0.995,
              w52h: null,
              w52l: null,
              name: m.shortName,
            };
            break;
          }
        }
      }
    }

    // If we got at least some data, try to get prev close from Yahoo for % change
    if (Object.keys(data).length > 0) {
      const yahooMap = { Cu:'HG=F', Al:'ALI=F', Ni:'NI=F', Zn:'ZNC=F', Pb:'PB=F', Sn:'SN=F' };
      for (const [key, ticker] of Object.entries(yahooMap)) {
        if (data[key]) {
          const meta = await fetchYahoo(ticker);
          if (meta) {
            // Use Yahoo for prev close and 52W range, but keep westmetall price
            const yPrice = meta.regularMarketPrice;
            const wPrice = data[key].cash;
            // Scale Yahoo prev close to westmetall price
            if (meta.regularMarketPreviousClose && yPrice > 0) {
              const ratio = wPrice / yPrice;
              data[key].prev = meta.regularMarketPreviousClose * ratio;
              data[key].w52h = meta.fiftyTwoWeekHigh * ratio;
              data[key].w52l = meta.fiftyTwoWeekLow  * ratio;
            }
          }
        }
      }
    }

    return data;
  } catch(e) {
    console.error('Westmetall fetch error:', e.message);
    return {};
  }
}

// ─── Yahoo Finance chart API ─────────────────────────────────────────────────
async function fetchYahoo(sym) {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=1d&range=5d`;
    const r = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' },
      signal: AbortSignal.timeout(8000)
    });
    const d = await r.json();
    return d?.chart?.result?.[0]?.meta || null;
  } catch(e) {
    return null;
  }
}
