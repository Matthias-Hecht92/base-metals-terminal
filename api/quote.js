// Proxy Vercel — base-metals-terminal
// Métaux : westmetall.com (LME officiel)
// FX     : Yahoo Finance chart API
// COT    : CFTC publicreporting.cftc.gov (bon endpoint)
// News   : Mining.com RSS via proxy
// History: Yahoo Finance chart API

const METAL_FIELDS = {
  'HG=F':  { field: 'LME_Cu_cash', name: 'LME Copper'    },
  'ALI=F': { field: 'LME_Al_cash', name: 'LME Aluminium' },
  'NI=F':  { field: 'LME_Ni_cash', name: 'LME Nickel'    },
  'ZNC=F': { field: 'LME_Zn_cash', name: 'LME Zinc'      },
  'PB=F':  { field: 'LME_Pb_cash', name: 'LME Lead'      },
  'SN=F':  { field: 'LME_Sn_cash', name: 'LME Tin'       },
};

// Yahoo tickers for historical data (ALI=F has no history, use alternative)
const HISTORY_TICKERS = {
  'HG=F':  'HG=F',    // Copper COMEX — has full history
  'ALI=F': 'ALUM.L',  // Aluminium — try London
  'NI=F':  'NI=F',
  'ZNC=F': 'ZNC=F',
  'PB=F':  'PB=F',
  'SN=F':  'SN=F',
};

// ─── westmetall ──────────────────────────────────────────────────────────────
async function fetchWestmetallTable(field) {
  const url = `https://www.westmetall.com/en/markdaten.php?action=table&field=${field}`;
  const r = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'text/html' },
    signal: AbortSignal.timeout(10000)
  });
  const html = await r.text();
  const rows = [];
  const rowRe = /(\d{1,2}\.\s+\w+\s+\d{4})\s*\|\s*([\d,]+\.?\d*)\s*\|\s*([\d,]+\.?\d*)/g;
  let m;
  while ((m = rowRe.exec(html)) !== null) {
    const cash = parseFloat(m[2].replace(/,/g, ''));
    const threeM = parseFloat(m[3].replace(/,/g, ''));
    if (cash > 100) rows.push({ date: m[1].trim(), cash, threeM });
  }
  if (rows.length < 2) {
    const numRe = /([\d]{1,3}(?:,\d{3})+\.\d{2})/g;
    const nums = [];
    let nm;
    while ((nm = numRe.exec(html)) !== null) {
      const v = parseFloat(nm[1].replace(/,/g, ''));
      if (v > 100 && v < 100000) nums.push(v);
    }
    if (nums.length >= 2) {
      return { today: nums[0], threeM: nums[1], prev: nums[2] || nums[0],
        w52h: nums.length > 4 ? Math.max(...nums.slice(0,20)) : nums[0]*1.2,
        w52l: nums.length > 4 ? Math.min(...nums.slice(0,20)) : nums[0]*0.8 };
    }
  }
  if (rows.length < 1) return null;
  const allPrices = rows.map(r => r.cash);
  return {
    today: rows[0].cash, threeM: rows[0].threeM,
    prev: rows.length > 1 ? rows[1].cash : rows[0].cash,
    w52h: Math.max(...allPrices), w52l: Math.min(...allPrices)
  };
}

// ─── Yahoo chart ─────────────────────────────────────────────────────────────
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

// ─── Yahoo history ────────────────────────────────────────────────────────────
async function fetchHistory(sym, range, interval) {
  // Try primary ticker, then fallback for metals with no history
  const tickers = [sym, HISTORY_TICKERS[sym]].filter(Boolean).filter((v,i,a)=>a.indexOf(v)===i);
  for (const ticker of tickers) {
    try {
      const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=${interval}&range=${range}`;
      const r = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' },
        signal: AbortSignal.timeout(10000)
      });
      const d = await r.json();
      const res2 = d?.chart?.result?.[0];
      if (!res2?.timestamp || !res2?.indicators?.quote?.[0]?.close) continue;
      const closes = res2.indicators.quote[0].close;
      const points = res2.timestamp
        .map((t, i) => ({ t: t * 1000, c: closes[i] }))
        .filter(p => p.c != null && !isNaN(p.c));
      if (points.length > 5) return points;
    } catch(e) { continue; }
  }
  return [];
}

// ─── COT CFTC ────────────────────────────────────────────────────────────────
// Uses CFTC publicreporting Socrata API with correct field names
async function fetchCOT() {
  // Correct endpoint and field names from CFTC Socrata
  // Dataset: Disaggregated Futures Only (fin7-q036) — has managed_money fields
  // Legacy dataset (jun7-ma8e) uses noncomm_positions_long_all
  const contracts = [
    { code:'085692', name:'Copper (COMEX)',   col:'#f0a020' },
    { code:'033661', name:'Gold (COMEX)',     col:'#ffd700' },
  ];
  const results = [];
  for (const c of contracts) {
    try {
      // Try legacy report first (most reliable for metals)
      const url = `https://publicreporting.cftc.gov/resource/jun7-ma8e.json?$where=cftc_commodity_code=%27${c.code}%27&$order=report_date_as_yyyy_mm_dd+DESC&$limit=2`;
      const r = await fetch(url, {
        headers: { 'Accept': 'application/json' },
        signal: AbortSignal.timeout(10000)
      });
      const data = await r.json();
      if (!Array.isArray(data) || data.length < 1) continue;
      const latest = data[0];
      const prev   = data[1] || data[0];
      // Field names in CFTC legacy dataset
      const longL  = parseInt(latest.noncomm_positions_long_all  || latest.noncommercial_positions_long  || 0);
      const shortL = parseInt(latest.noncomm_positions_short_all || latest.noncommercial_positions_short || 0);
      const longP  = parseInt(prev.noncomm_positions_long_all    || prev.noncommercial_positions_long    || 0);
      const shortP = parseInt(prev.noncomm_positions_short_all   || prev.noncommercial_positions_short   || 0);
      const net = longL - shortL, netP = longP - shortP, chg = net - netP;
      const date = (latest.report_date_as_yyyy_mm_dd || latest.as_of_date_in_form_yymmdd || '—').split('T')[0];
      results.push({ ...c, longL, shortL, net, chg, date });
    } catch(e) {
      console.error(`COT [${c.code}]:`, e.message);
    }
  }
  return results;
}

// ─── News RSS proxy ───────────────────────────────────────────────────────────
async function fetchNews() {
  const feeds = [
    'https://www.mining.com/feed/',
    'https://www.kitco.com/rss/metals-news.rss',
  ];
  const items = [];
  for (const feed of feeds) {
    try {
      const r = await fetch(feed, {
        headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/rss+xml, application/xml, text/xml' },
        signal: AbortSignal.timeout(8000)
      });
      const xml = await r.text();
      // Parse RSS XML
      const titleRe = /<item[^>]*>[\s\S]*?<title[^>]*><!\[CDATA\[(.*?)\]\]><\/title>|<item[^>]*>[\s\S]*?<title[^>]*>(.*?)<\/title>/g;
      const linkRe  = /<link[^>]*>(https?:\/\/[^<]+)<\/link>/g;
      const dateRe  = /<pubDate>(.*?)<\/pubDate>/g;
      const titles = [], links = [], dates = [];
      let tm, lm, dm;
      while ((tm = titleRe.exec(xml)) !== null) titles.push((tm[1]||tm[2]||'').trim());
      while ((lm = linkRe.exec(xml))  !== null) links.push(lm[1].trim());
      while ((dm = dateRe.exec(xml))  !== null) dates.push(dm[1].trim());
      const src = new URL(feed).hostname.replace('www.','');
      titles.forEach((title, i) => {
        if (!title) return;
        items.push({ title, link: links[i]||feed, date: dates[i]||'', src });
      });
    } catch(e) {
      console.error('RSS:', e.message);
    }
  }
  // Sort by date desc
  items.sort((a,b) => new Date(b.date) - new Date(a.date));
  return items.slice(0, 15);
}

// ─── Main handler ─────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { symbols, history, range, interval, pboc, cot, news } = req.query;

  // ── PBOC rate ─────────────────────────────────────────────────
  if (pboc === 'true') {
    try {
      const r = await fetch('https://stats.bis.org/api/v1/data/BIS,WS_CBPOL,1.0/Q.CN.policy_rate?lastNObservations=1&format=jsondata', {
        signal: AbortSignal.timeout(8000)
      });
      const d = await r.json();
      const obs = d?.data?.dataSets?.[0]?.series?.['0:0:0']?.observations;
      if (obs) {
        const vals = Object.values(obs);
        const rate = vals[vals.length-1]?.[0];
        return res.status(200).json({ pboc: rate ? parseFloat(rate).toFixed(2) : null });
      }
    } catch(e) {}
    return res.status(200).json({ pboc: null });
  }

  // ── COT CFTC ──────────────────────────────────────────────────
  if (cot === 'true') {
    const data = await fetchCOT();
    return res.status(200).json({ cot: data });
  }

  // ── News RSS ───────────────────────────────────────────────────
  if (news === 'true') {
    const data = await fetchNews();
    return res.status(200).json({ news: data });
  }


  // ── FRED API ──────────────────────────────────────────────────────────
  if (req.query.fred) {
    const id = req.query.fred;
    const yoy = req.query.yoy === '1';
    try {
      const r = await fetch(`https://fred.stlouisfed.org/graph/fredgraph.csv?id=${encodeURIComponent(id)}`, {
        headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'text/csv' },
        signal: AbortSignal.timeout(12000)
      });
      const txt = await r.text();
      const lines = txt.trim().split('\n').filter(l => !l.startsWith('DATE') && l.trim());
      if (!lines.length) return res.status(200).json({ value: null, prev: null, date: null });
      const lastParts = lines[lines.length-1].split(',');
      const prevParts = lines[lines.length-2]?.split(',');
      let value = parseFloat(lastParts[1]);
      let prev  = prevParts ? parseFloat(prevParts[1]) : null;
      const date = lastParts[0];
      if (yoy && lines.length > 13) {
        const yAgo = parseFloat(lines[lines.length-13]?.split(',')[1]);
        if (yAgo > 0) {
          prev  = prev  ? ((prev/yAgo)-1)*100  : null;
          value = ((value/yAgo)-1)*100;
        }
      }
      return res.status(200).json({ value: isNaN(value)?null:Math.round(value*100)/100, prev: prev&&!isNaN(prev)?Math.round(prev*100)/100:null, date });
    } catch(e) {
      return res.status(200).json({ value: null, prev: null, date: null, error: e.message });
    }
  }

  if (!symbols) return res.status(400).json({ error: 'symbols required' });

  // ── History ────────────────────────────────────────────────────
  if (history === 'true') {
    const points = await fetchHistory(symbols, range || '1y', interval || '1wk');
    return res.status(200).json({ history: points });
  }

  // ── Quote ──────────────────────────────────────────────────────
  const symList = symbols.split(',').map(s => s.trim());
  const results = [];

  for (const sym of symList) {
    try {
      if (METAL_FIELDS[sym]) {
        const { field, name } = METAL_FIELDS[sym];
        const data = await fetchWestmetallTable(field);
        if (data && data.today > 0) {
          const price = data.today, prev = data.prev, chg = price - prev;
          results.push({
            symbol: sym, regularMarketPrice: price,
            regularMarketChange: chg,
            regularMarketChangePercent: prev > 0 ? (chg/prev)*100 : 0,
            regularMarketOpen: prev, regularMarketDayHigh: Math.max(price,prev),
            regularMarketDayLow: Math.min(price,prev), regularMarketPreviousClose: prev,
            fiftyTwoWeekHigh: data.w52h, fiftyTwoWeekLow: data.w52l,
            threeMonthPrice: data.threeM, marketState: 'REGULAR',
            shortName: name, source: 'westmetall',
          });
        } else {
          const meta = await fetchYahooChart(sym);
          if (meta) {
            const price = meta.regularMarketPrice, prev = meta.regularMarketPreviousClose || price;
            results.push({
              symbol: sym, regularMarketPrice: price,
              regularMarketChange: price-prev,
              regularMarketChangePercent: prev>0?((price-prev)/prev)*100:0,
              regularMarketOpen: meta.regularMarketOpen||price,
              regularMarketDayHigh: meta.regularMarketDayHigh||price,
              regularMarketDayLow: meta.regularMarketDayLow||price,
              regularMarketPreviousClose: prev,
              fiftyTwoWeekHigh: meta.fiftyTwoWeekHigh||price,
              fiftyTwoWeekLow: meta.fiftyTwoWeekLow||price,
              marketState: meta.marketState||'CLOSED', shortName: name, source: 'yahoo_fallback',
            });
          }
        }
      } else {
        const meta = await fetchYahooChart(sym);
        if (meta) {
          const price = meta.regularMarketPrice, prev = meta.regularMarketPreviousClose||price, chg = price-prev;
          results.push({
            symbol: sym, regularMarketPrice: price,
            regularMarketChange: chg, regularMarketChangePercent: prev>0?(chg/prev)*100:0,
            regularMarketOpen: meta.regularMarketOpen||price,
            regularMarketDayHigh: meta.regularMarketDayHigh||price,
            regularMarketDayLow: meta.regularMarketDayLow||price,
            regularMarketPreviousClose: prev,
            fiftyTwoWeekHigh: meta.fiftyTwoWeekHigh||price,
            fiftyTwoWeekLow: meta.fiftyTwoWeekLow||price,
            marketState: meta.marketState||'REGULAR', shortName: sym, source: 'yahoo_fx',
          });
        }
      }
    } catch(e) {
      console.error(`[${sym}]:`, e.message);
    }
  }

  res.status(200).json({ quoteResponse: { result: results, error: null } });
}
