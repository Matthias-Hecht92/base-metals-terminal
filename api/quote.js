export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  
  if (req.method === 'OPTIONS') return res.status(200).end();
  
  const { symbols } = req.query;
  if (!symbols) return res.status(400).json({ error: 'symbols required' });
  
  const fields = [
    'regularMarketPrice','regularMarketChange','regularMarketChangePercent',
    'regularMarketOpen','regularMarketDayHigh','regularMarketDayLow',
    'regularMarketPreviousClose','fiftyTwoWeekHigh','fiftyTwoWeekLow',
    'marketState','shortName'
  ].join(',');

  const url = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${symbols}&fields=${fields}&formatted=false&lang=en-US&region=US`;
  
  try {
    const r = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'application/json',
        'Accept-Language': 'en-US,en;q=0.9',
      }
    });
    const data = await r.json();
    res.status(200).json(data);
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
}
