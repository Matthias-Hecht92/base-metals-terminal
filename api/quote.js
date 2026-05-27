// Proxy Vercel — base-metals-terminal
// Métaux : westmetall.com (LME officiel) + fallback Yahoo Finance
// FX     : Yahoo Finance chart API
// COT    : CFTC
// News   : Mining.com + Kitco RSS

const METAL_FIELDS = {
  'HG=F':  { field: 'LME_Cu_cash', name: 'LME Copper'    },
  'ALI=F': { field: 'LME_Al_cash', name: 'LME Aluminium' },
  'NI=F':  { field: 'LME_Ni_cash', name: 'LME Nickel'    },
  'ZNC=F': { field: 'LME_Zn_cash', name: 'LME Zinc'      },
  'PB=F':  { field: 'LME_Pb_cash', name: 'LME Lead'      },
  'SN=F':  { field: 'LME_Sn_cash', name: 'LME Tin'       },
};

const HISTORY_TICKERS = {
  'HG=F': 'HG=F', 'ALI=F': 'ALUM.L',
  'NI=F': 'NI=F', 'ZNC=F': 'ZNC=F', 'PB=F': 'PB=F', 'SN=F': 'SN=F',
};

const HEADERS = { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' };

// ─── westmetall ───────────────────────────────────────────────────────────────
async function fetchWestmetall(field) {
  try {
    const url = `https://www.westmetall.com/en/markdaten.php?action=table&field=${field}`;
    const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'text/html' }, signal: AbortSignal.timeout(10000) });
    const html = await r.text();
    const rows = [];
    const re = /(\d{1,2}\.\s+\w+\s+\d{4})\s*\|\s*([\d,]+\.?\d*)\s*\|\s*([\d,]+\.?\d*)/g;
    let m;
    while ((m = re.exec(html)) !== null) {
      const cash = parseFloat(m[2].replace(/,/g, ''));
      if (cash > 100) rows.push({ cash, threeM: parseFloat(m[3].replace(/,/g, '')) });
    }
    if (!rows.length) {
      const nums = [];
      const nr = /([\d]{1,3}(?:,\d{3})+\.\d{2})/g;
      let nm;
      while ((nm = nr.exec(html)) !== null) { const v = parseFloat(nm[1].replace(/,/g,'')); if(v>100&&v<100000) nums.push(v); }
      if (nums.length >= 2) return { today: nums[0], threeM: nums[1], prev: nums[2]||nums[0], w52h: Math.max(...nums.slice(0,20)), w52l: Math.min(...nums.slice(0,20)) };
      return null;
    }
    const prices = rows.map(r => r.cash);
    return { today: rows[0].cash, threeM: rows[0].threeM, prev: rows[1]?.cash||rows[0].cash, w52h: Math.max(...prices), w52l: Math.min(...prices) };
  } catch(e) { return null; }
}

// ─── Yahoo chart ──────────────────────────────────────────────────────────────
async function fetchYahoo(sym) {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=1d&range=5d`;
    const r = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(8000) });
    const d = await r.json();
    return d?.chart?.result?.[0]?.meta || null;
  } catch(e) { return null; }
}

// ─── Yahoo history ────────────────────────────────────────────────────────────
async function fetchHistory(sym, range, interval) {
  const tickers = [sym, HISTORY_TICKERS[sym]].filter(Boolean).filter((v,i,a)=>a.indexOf(v)===i);
  for (const ticker of tickers) {
    try {
      const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=${interval}&range=${range}`;
      const r = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(10000) });
      const d = await r.json();
      const res = d?.chart?.result?.[0];
      if (!res?.timestamp || !res?.indicators?.quote?.[0]?.close) continue;
      const closes = res.indicators.quote[0].close;
      const pts = res.timestamp.map((t,i)=>({t:t*1000,c:closes[i]})).filter(p=>p.c!=null&&!isNaN(p.c));
      if (pts.length > 5) return pts;
    } catch(e) { continue; }
  }
  return [];
}

// ─── COT CFTC ─────────────────────────────────────────────────────────────────
async function fetchCOT() {
  const contracts = [
    { code:'085692', name:'Copper (COMEX)', col:'#1a3a5c' },
    { code:'033661', name:'Gold (COMEX)',   col:'#c9a227' },
  ];
  const results = [];
  for (const c of contracts) {
    try {
      const url = `https://publicreporting.cftc.gov/resource/jun7-ma8e.json?$where=cftc_commodity_code=%27${c.code}%27&$order=report_date_as_yyyy_mm_dd+DESC&$limit=2`;
      const r = await fetch(url, { headers: {'Accept':'application/json'}, signal: AbortSignal.timeout(10000) });
      const data = await r.json();
      if (!Array.isArray(data) || !data.length) continue;
      const l = data[0], p = data[1]||data[0];
      const longL  = parseInt(l.noncomm_positions_long_all  || l.noncommercial_positions_long  || 0);
      const shortL = parseInt(l.noncomm_positions_short_all || l.noncommercial_positions_short || 0);
      const longP  = parseInt(p.noncomm_positions_long_all  || p.noncommercial_positions_long  || 0);
      const shortP = parseInt(p.noncomm_positions_short_all || p.noncommercial_positions_short || 0);
      const net = longL-shortL, chg = net-(longP-shortP);
      const date = (l.report_date_as_yyyy_mm_dd||'—').split('T')[0];
      results.push({ ...c, longL, shortL, net, chg, date });
    } catch(e) {}
  }
  return results;
}

// ─── News RSS ─────────────────────────────────────────────────────────────────
async function fetchNews() {
  const feeds = ['https://www.mining.com/feed/', 'https://www.kitco.com/rss/metals-news.rss'];
  const items = [];
  for (const feed of feeds) {
    try {
      const r = await fetch(feed, { headers: {'User-Agent':'Mozilla/5.0','Accept':'text/xml'}, signal: AbortSignal.timeout(8000) });
      const xml = await r.text();
      const titleRe = /<item[^>]*>[\s\S]*?<title[^>]*>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/title>/g;
      const linkRe  = /<link[^>]*>(https?:\/\/[^<]+)<\/link>/g;
      const dateRe  = /<pubDate>(.*?)<\/pubDate>/g;
      const titles=[],links=[],dates=[];
      let tm,lm,dm;
      while((tm=titleRe.exec(xml))!==null) titles.push(tm[1].trim());
      while((lm=linkRe.exec(xml))!==null)  links.push(lm[1].trim());
      while((dm=dateRe.exec(xml))!==null)  dates.push(dm[1].trim());
      const src = new URL(feed).hostname.replace('www.','');
      titles.forEach((title,i)=>{ if(title) items.push({title,link:links[i]||feed,date:dates[i]||'',src}); });
    } catch(e) {}
  }
  items.sort((a,b)=>new Date(b.date)-new Date(a.date));
  return items.slice(0,15);
}

// ─── Main handler ─────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { symbols, history, range, interval, pboc, cot, news } = req.query;

  if (pboc === 'true') {
    try {
      const r = await fetch('https://stats.bis.org/api/v1/data/BIS,WS_CBPOL,1.0/Q.CN.policy_rate?lastNObservations=1&format=jsondata', {signal:AbortSignal.timeout(8000)});
      const d = await r.json();
      const obs = d?.data?.dataSets?.[0]?.series?.['0:0:0']?.observations;
      if (obs) { const vals=Object.values(obs); const rate=vals[vals.length-1]?.[0]; return res.status(200).json({pboc:rate?parseFloat(rate).toFixed(2):null}); }
    } catch(e) {}
    return res.status(200).json({pboc:null});
  }

  if (cot === 'true') return res.status(200).json({ cot: await fetchCOT() });
  if (news === 'true') return res.status(200).json({ news: await fetchNews() });
  if (!symbols) return res.status(400).json({ error: 'symbols required' });

  if (history === 'true') return res.status(200).json({ history: await fetchHistory(symbols, range||'1y', interval||'1wk') });

  const symList = symbols.split(',').map(s=>s.trim());
  const results = [];

  for (const sym of symList) {
    try {
      if (METAL_FIELDS[sym]) {
        const { field, name } = METAL_FIELDS[sym];
        // Try westmetall first
        const wm = await fetchWestmetall(field);
        if (wm && wm.today > 0) {
          const price=wm.today, prev=wm.prev, chg=price-prev;
          results.push({ symbol:sym, regularMarketPrice:price, regularMarketChange:chg, regularMarketChangePercent:prev>0?(chg/prev)*100:0, regularMarketOpen:prev, regularMarketDayHigh:Math.max(price,prev), regularMarketDayLow:Math.min(price,prev), regularMarketPreviousClose:prev, fiftyTwoWeekHigh:wm.w52h, fiftyTwoWeekLow:wm.w52l, threeMonthPrice:wm.threeM, marketState:'REGULAR', shortName:name, source:'westmetall' });
          continue;
        }
        // Fallback: Yahoo Finance
        const meta = await fetchYahoo(sym);
        if (meta) {
          const price=meta.regularMarketPrice, prev=meta.regularMarketPreviousClose||price, chg=price-prev;
          results.push({ symbol:sym, regularMarketPrice:price, regularMarketChange:chg, regularMarketChangePercent:prev>0?(chg/prev)*100:0, regularMarketOpen:meta.regularMarketOpen||price, regularMarketDayHigh:meta.regularMarketDayHigh||price, regularMarketDayLow:meta.regularMarketDayLow||price, regularMarketPreviousClose:prev, fiftyTwoWeekHigh:meta.fiftyTwoWeekHigh||price, fiftyTwoWeekLow:meta.fiftyTwoWeekLow||price, marketState:meta.marketState||'CLOSED', shortName:name, source:'yahoo_fallback' });
        }
      } else {
        // FX
        const meta = await fetchYahoo(sym);
        if (meta) {
          const price=meta.regularMarketPrice, prev=meta.regularMarketPreviousClose||price, chg=price-prev;
          results.push({ symbol:sym, regularMarketPrice:price, regularMarketChange:chg, regularMarketChangePercent:prev>0?(chg/prev)*100:0, regularMarketOpen:meta.regularMarketOpen||price, regularMarketDayHigh:meta.regularMarketDayHigh||price, regularMarketDayLow:meta.regularMarketDayLow||price, regularMarketPreviousClose:prev, fiftyTwoWeekHigh:meta.fiftyTwoWeekHigh||price, fiftyTwoWeekLow:meta.fiftyTwoWeekLow||price, marketState:meta.marketState||'REGULAR', shortName:sym, source:'yahoo_fx' });
        }
      }
    } catch(e) { console.error(`[${sym}]:`, e.message); }
  }

  res.status(200).json({ quoteResponse: { result: results, error: null } });
}
