export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');
  const { symbols } = req.query;
  if (!symbols) return res.status(400).json({ error: 'symbols required' });
  const fields = 'regularMarketPrice,regularMarketChange,regularMarketChangePercent,regularMarketOpen,regularMarketDayHigh,regularMarketDayLow,regularMarketPreviousClose,fiftyTwoWeekHigh,fiftyTwoWeekLow,marketState,shortName';
  const url = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${symbols}&fields=${fields}&formatted=false`;
  const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  const data = await r.json();
  res.json(data);
}
