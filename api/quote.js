export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { symbols } = req.query;
  if (!symbols) return res.status(400).json({ error: 'symbols required' });

  try {
    // Step 1: get crumb & cookie from Yahoo
    const crumbRes = await fetch('https://query1.finance.yahoo.com/v1/test/csrfToken', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': '*/*',
        'Accept-Language': 'en-US,en;q=0.9',
      }
    });
    const cookie = crumbRes.headers.get('set-cookie') || '';
    const crumbData = await crumbRes.text();
    const crumb = crumbData.trim();

    // Step 2: fetch quotes with crumb
    const fields = 'regularMarketPrice,regularMarketChange,regularMarketChangePercent,regularMarketOpen,regularMarketDayHigh,regularMarketDayLow,regularMarketPreviousClose,fiftyTwoWeekHigh,fiftyTwoWeekLow,marketState,shortName';
    const url = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${symbols}&fields=${fields}&formatted=false&crumb=${encodeURIComponent(crumb)}`;

    const quoteRes = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/json',
        'Accept-Language': 'en-US,en;q=0.9',
        'Cookie': cookie,
      }
    });

    const data = await quoteRes.json();
    const results = data?.quoteResponse?.result;

    if (!results || results.length === 0) {
      // Try v8 as fallback
      const v8url = `https://query2.finance.yahoo.com/v8/finance/chart/${symbols.split(',')[0]}?interval=1d&range=1d`;
      const v8res = await fetch(v8url, {
        headers: { 'User-Agent': 'Mozilla/5.0', 'Cookie': cookie }
      });
      const v8data = await v8res.json();
      return res.status(200).json({ debug: 'v8 fallback', v8data });
    }

    res.status(200).json(data);
  } catch(e) {
    res.status(500).json({ error: e.message, stack: e.stack });
  }
}
