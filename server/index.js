/**
 * 📊 股海秘書 LINE 秘書 - 後端 API Server
 * 
 * 技術棧：Express + PostgreSQL + LINE Bot SDK
 */

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const rateLimit = require('express-rate-limit');

// 資料庫
const { pool, initDatabase, seedStocks, seedSettings } = require('./db');

// 路由
const stockRoutes = require('./routes/stock');
const watchlistRoutes = require('./routes/watchlist');
const portfolioRoutes = require('./routes/portfolio');
const holdingsRoutes = require('./routes/holdings');
const alertRoutes = require('./routes/alert');
const lineRoutes = require('./routes/line');
const aiRoutes = require('./routes/ai');
const chipRoutes = require('./routes/chip');
const performanceRoutes = require('./routes/performance');
const smartAlertsRoutes = require('./routes/smartAlerts');

const settingsRoutes = require('./routes/settings');
const voiceRoutes = require('./routes/voice');

// 排程
const scheduler = require('./cron/scheduler');

const app = express();
app.set('trust proxy', 1);
const PORT = process.env.PORT || 3000;

// ==================== 中間件 ====================

// CORS 設定
app.use(cors({
  origin: process.env.FRONTEND_URL || '*',
  credentials: true
}));

// JSON 解析
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// API 限流
const limiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 分鐘
  max: 100, // 最多 100 次請求
  message: { error: '請求太頻繁，請稍後再試' }
});
app.use('/api/', limiter);

// 靜態檔案（前端）
app.use(express.static(path.join(__dirname, '../client')));

// 🆕 波浪分析網頁版（public 資料夾）
app.use(express.static(path.join(__dirname, '../public')));

// ==================== API 路由 ====================

app.use('/api/stock', stockRoutes);
app.use('/api/watchlist', watchlistRoutes);
app.use('/api/portfolio', portfolioRoutes);
app.use('/api/holdings', holdingsRoutes);
app.use('/api/alert', alertRoutes);
app.use('/api/line', lineRoutes);

app.use('/api/settings', settingsRoutes);
app.use('/api/voice', voiceRoutes);
app.use('/api/ai', aiRoutes);
app.use('/api/chip', chipRoutes);
app.use('/api/performance', performanceRoutes);
app.use('/api/smart-alerts', smartAlertsRoutes);

// LINE Webhook（需要原始 body）
app.use('/webhook', express.raw({ type: 'application/json' }), lineRoutes);


// ==================== TPEx Proxy (繞過 CORS + Cloudflare) ====================
const axios = require('axios');
// yahoo-finance2 (自動處理 cookie/crumb 認證)
let yahooFinance = null;
try {
  const YF = require('yahoo-finance2').default;
  yahooFinance = (typeof YF === 'function') ? new YF({ suppressNotices: ['yahooSurvey'] }) : YF;
  console.log('✅ yahoo-finance2 loaded');
} catch(e) {
  console.log('⚠️ yahoo-finance2 未安裝，使用 axios fallback');
}

// TPEx 多域名 + OpenAPI 策略
async function fetchTPExData(rocDate, stockId) {
  const HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    'Accept': 'application/json, text/javascript, */*; q=0.01',
    'Accept-Language': 'zh-TW,zh;q=0.9,en-US;q=0.8,en;q=0.7',
    'Connection': 'keep-alive'
  };

  // 策略1: 多域名嘗試 (海外域名通常沒 Cloudflare)
  const webUrls = [
    { name: 'TPEx-overseas', url: `https://wwwov.tpex.org.tw/web/stock/3insti/daily_trade/3itrade_hedge_result.php?l=zh-tw&o=json&se=AL&t=D&d=${rocDate}&s=0,asc` },
    { name: 'TPEx-main', url: `https://www.tpex.org.tw/web/stock/3insti/daily_trade/3itrade_hedge_result.php?l=zh-tw&o=json&se=AL&t=D&d=${rocDate}&s=0,asc` },
  ];

  for (const { name, url } of webUrls) {
    try {
      console.log(`  🔄 嘗試 ${name}...`);
      const response = await axios.get(url, { headers: HEADERS, timeout: 15000 });
      if (response.data && response.data.aaData && response.data.aaData.length > 0) {
        const row = response.data.aaData.find(r => String(r[0]).trim() === stockId);
        if (row) {
          console.log(`  ✅ ${name} 找到 ${stockId} (${row.length}欄)`);
          return { success: true, data: row, columns: row.length, source: name, totalRows: response.data.aaData.length };
        } else {
          console.log(`  ⚠️ ${name}: ${response.data.aaData.length} 筆但無 ${stockId}`);
        }
      } else {
        console.log(`  ⚠️ ${name}: 無 aaData`);
      }
    } catch(e) {
      console.log(`  ❌ ${name}: ${e.response?.status || e.message}`);
    }
  }

  // 策略2: OpenAPI (政府開放資料端點)
  const openApiUrls = [
    'https://www.tpex.org.tw/openapi/v1/tpex_mainboard_3itrade_hedge',
    'https://wwwov.tpex.org.tw/openapi/v1/tpex_mainboard_3itrade_hedge',
  ];
  
  for (const apiUrl of openApiUrls) {
    try {
      const domain = apiUrl.includes('wwwov') ? 'overseas' : 'main';
      console.log(`  🔄 嘗試 OpenAPI (${domain})...`);
      const response = await axios.get(apiUrl, { headers: HEADERS, timeout: 15000 });
      if (Array.isArray(response.data) && response.data.length > 0) {
        // 找到正確的欄位名稱
        const keys = Object.keys(response.data[0]);
        console.log(`  📋 OpenAPI 欄位: ${keys.slice(0,6).join(', ')}...`);
        const item = response.data.find(d => {
          const vals = Object.values(d).map(v => String(v).trim());
          return vals.includes(stockId);
        });
        if (item) {
          console.log(`  ✅ OpenAPI 找到 ${stockId}`);
          return { success: true, openApiData: item, source: `openapi-${domain}`, keys };
        }
      } else {
        console.log(`  ⚠️ OpenAPI: 非陣列或空`);
      }
    } catch(e) {
      console.log(`  ❌ OpenAPI: ${e.response?.status || e.message}`);
    }
  }

  return { success: false, error: '所有 TPEx 端點皆失敗' };
}

app.get('/api/tpex-proxy', async (req, res) => {
  try {
    const { d, stockId } = req.query;
    if (!d || !stockId) return res.status(400).json({ success: false, error: '需要 d 和 stockId' });
    console.log(`🔄 TPEx Proxy: ${stockId}, date=${d}`);
    
    // 先嘗試 TPEx 各域名
    const result = await fetchTPExData(d, stockId);
    if (result.success) return res.json(result);
    
    // TPEx 全敗，嘗試 FinMind
    // 民國年轉西元: d = "115/02/09"
    const parts = d.split('/');
    const westernDate = `${parseInt(parts[0])+1911}-${parts[1]}-${parts[2]}`;
    console.log(`🔄 TPEx 全敗，嘗試 FinMind (${westernDate})...`);
    
    const fmResult = await fetchFromFinMind(stockId, westernDate);
    if (fmResult) {
      return res.json({ success: true, source: 'finmind', finmindData: fmResult });
    }
    
    res.json(result); // 全部失敗
  } catch (error) {
    console.error('TPEx Proxy 錯誤:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// 診斷端點
app.get('/api/tpex-diag', async (req, res) => {
  const stockId = req.query.stockId || '5347';
  const now = new Date();
  const twNow = new Date(now.getTime() + (now.getTimezoneOffset() + 480) * 60000);
  const dt = new Date(twNow);
  while (dt.getDay() === 0 || dt.getDay() === 6) dt.setDate(dt.getDate() - 1);
  const rocDate = `${dt.getFullYear()-1911}/${String(dt.getMonth()+1).padStart(2,'0')}/${String(dt.getDate()).padStart(2,'0')}`;
  const westernDate = `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,'0')}-${String(dt.getDate()).padStart(2,'0')}`;
  
  console.log(`🔍 TPEx 診斷: ${stockId}, ${rocDate}`);
  const result = await fetchTPExData(rocDate, stockId);
  
  // 如果 TPEx 全部失敗，嘗試 FinMind
  if (!result.success) {
    console.log(`🔄 TPEx 全敗，嘗試 FinMind...`);
    try {
      const fmResult = await fetchFromFinMind(stockId, westernDate);
      if (fmResult) {
        res.json({ stockId, rocDate, serverTime: twNow.toISOString(), success: true, source: 'finmind', finmindData: fmResult, tpexError: result.error });
        return;
      }
    } catch(e) {
      console.log(`❌ FinMind: ${e.message}`);
    }
  }
  
  res.json({ stockId, rocDate, serverTime: twNow.toISOString(), ...result });
});

// FinMind 台股三大法人數據 (免費 API，不受 Cloudflare 影響)
async function fetchFromFinMind(stockId, date) {
  try {
    const url = `https://api.finmindtrade.com/api/v4/data?dataset=TaiwanStockInstitutionalInvestorsBuySell&data_id=${stockId}&start_date=${date}`;
    console.log(`  🔄 FinMind: ${stockId} from ${date}`);
    const response = await axios.get(url, { timeout: 15000 });
    
    if (response.data && response.data.status === 200 && response.data.data && response.data.data.length > 0) {
      const rows = response.data.data;
      // FinMind 每種法人一筆，需要彙總
      let foreignBuy = 0, foreignSell = 0;
      let trustBuy = 0, trustSell = 0;
      let dealerBuy = 0, dealerSell = 0;
      let dataDate = date;
      
      for (const row of rows) {
        const name = row.name || '';
        dataDate = row.date || date;
        if (name.includes('外陸資') && !name.includes('自營')) {
          foreignBuy += row.buy || 0;
          foreignSell += row.sell || 0;
        } else if (name.includes('外資自營')) {
          foreignBuy += row.buy || 0;
          foreignSell += row.sell || 0;
        } else if (name.includes('投信')) {
          trustBuy += row.buy || 0;
          trustSell += row.sell || 0;
        } else if (name.includes('自營商')) {
          dealerBuy += row.buy || 0;
          dealerSell += row.sell || 0;
        } else if (name === 'Foreign_Investor') {
          foreignBuy += row.buy || 0;
          foreignSell += row.sell || 0;
        } else if (name === 'Investment_Trust') {
          trustBuy += row.buy || 0;
          trustSell += row.sell || 0;
        } else if (name === 'Dealer_self' || name === 'Dealer_Hedging') {
          dealerBuy += row.buy || 0;
          dealerSell += row.sell || 0;
        }
      }
      
      console.log(`  ✅ FinMind ${stockId}: 外資=${foreignBuy-foreignSell} 投信=${trustBuy-trustSell} 自營=${dealerBuy-dealerSell}`);
      return {
        date: dataDate,
        foreign: { buy: foreignBuy, sell: foreignSell, net: foreignBuy - foreignSell },
        trust: { buy: trustBuy, sell: trustSell, net: trustBuy - trustSell },
        dealer: { buy: dealerBuy, sell: dealerSell, net: dealerBuy - dealerSell },
        totalNet: (foreignBuy - foreignSell) + (trustBuy - trustSell) + (dealerBuy - dealerSell),
        rawRows: rows.length
      };
    }
    console.log(`  ⚠️ FinMind: 無資料 (status=${response.data?.status}, msg=${response.data?.msg})`);
    return null;
  } catch(e) {
    console.log(`  ❌ FinMind 錯誤: ${e.message}`);
    return null;
  }
}

// TWSE 類股指數 Proxy（mis.twse.com.tw 被 CORS 擋）
app.get('/api/sector-index', async (req, res) => {
  try {
    const codes = req.query.codes || 'tse_IX0001.tw|tse_IX0021.tw';
    const url = `https://mis.twse.com.tw/stock/api/getStockInfo.jsp?ex_ch=${codes}&json=1&delay=0&_=${Date.now()}`;
    const response = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        'Accept': 'application/json',
        'Referer': 'https://mis.twse.com.tw/'
      },
      timeout: 10000
    });
    res.json(response.data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 直接測試 FinMind 端點
app.get('/api/finmind-test', async (req, res) => {
  const stockId = req.query.stockId || '5347';
  const now = new Date();
  const twNow = new Date(now.getTime() + (now.getTimezoneOffset() + 480) * 60000);
  const dt = new Date(twNow);
  while (dt.getDay() === 0 || dt.getDay() === 6) dt.setDate(dt.getDate() - 1);
  // 往前多抓幾天確保有資料
  const startDt = new Date(dt);
  startDt.setDate(startDt.getDate() - 5);
  const startDate = startDt.toISOString().slice(0,10);
  const endDate = dt.toISOString().slice(0,10);
  
  try {
    const url = `https://api.finmindtrade.com/api/v4/data?dataset=TaiwanStockInstitutionalInvestorsBuySell&data_id=${stockId}&start_date=${startDate}&end_date=${endDate}`;
    console.log(`🔍 FinMind 測試: ${url}`);
    const response = await axios.get(url, { timeout: 15000 });
    res.json({ 
      stockId, startDate, endDate, 
      status: response.data?.status,
      msg: response.data?.msg,
      rowCount: response.data?.data?.length || 0,
      sample: response.data?.data?.slice(0, 5),
      parsed: response.data?.data?.length > 0 ? await fetchFromFinMind(stockId, startDate) : null
    });
  } catch(e) {
    res.json({ error: e.message, status: e.response?.status });
  }
});

// ==================== 🇯🇵🇰🇷 亞洲指數 Proxy ====================
const ASIA_INDICES = [
  // 🇯🇵 日本 — 大盤
  { symbol: '^N225',     label: '日經225',       region: 'japan', cat: 'index', desc: '日本主要大盤指數' },
  { symbol: '1306.T',   label: 'TOPIX ETF',     region: 'japan', cat: 'index', desc: '東證一部全體' },
  // 🇯🇵 日本 — 半導體
  { symbol: '8035.T',   label: '東京威力科創',    region: 'japan', cat: 'semi', desc: '半導體設備全球第3→台積電設備商' },
  { symbol: '6857.T',   label: '愛德萬測試',      region: 'japan', cat: 'semi', desc: 'IC測試設備→京元電/矽格' },
  { symbol: '6146.T',   label: 'DISCO',          region: 'japan', cat: 'semi', desc: '晶圓切割研磨→先進封裝' },
  { symbol: '6920.T',   label: 'Lasertec',       region: 'japan', cat: 'semi', desc: 'EUV光罩檢測→台積電N2' },
  { symbol: '6723.T',   label: 'Renesas瑞薩',    region: 'japan', cat: 'semi', desc: '車用MCU龍頭→瑞昱/聯發科' },
  { symbol: '4063.T',   label: '信越化學',        region: 'japan', cat: 'semi', desc: '矽晶圓全球第1→環球晶' },
  // 🇰🇷 韓國 — 大盤
  { symbol: '^KS11',    label: 'KOSPI',          region: 'korea', cat: 'index', desc: '韓國主要大盤指數' },
  { symbol: '^KQ11',    label: 'KOSDAQ',         region: 'korea', cat: 'index', desc: '韓國科技成長股' },
  // 🇰🇷 韓國 — 半導體
  { symbol: '000660.KS', label: 'SK海力士',       region: 'korea', cat: 'semi', desc: 'HBM記憶體龍頭→南亞科' },
  { symbol: '005930.KS', label: '三星電子',       region: 'korea', cat: 'semi', desc: '晶圓代工+記憶體→台積電競爭' },
  { symbol: '042700.KQ', label: '韓美半導體',     region: 'korea', cat: 'semi', desc: '封測設備→日月光/力成' },
  { symbol: '403870.KS', label: 'HPSP',          region: 'korea', cat: 'semi', desc: '高壓退火設備→先進製程' },
  { symbol: '091160.KS', label: 'KODEX半導體',   region: 'korea', cat: 'semi', desc: '韓國半導體ETF→看整體趨勢' },
  { symbol: '036930.KQ', label: '主星電子',       region: 'korea', cat: 'semi', desc: 'MLCC被動元件→國巨/華新科' },
];

// 日韓數據快取（避免重複請求）
let asiaCache = { data: null, time: 0 };
const ASIA_CACHE_MS = 15000; // 15秒快取

app.get('/api/asia-indices', async (req, res) => {
  try {
    const now = Date.now();
    
    // 快取有效就直接回傳
    if (asiaCache.data && (now - asiaCache.time) < ASIA_CACHE_MS) {
      const twNow = new Date(now + (new Date().getTimezoneOffset() + 480) * 60000);
      return res.json({
        success: true,
        data: asiaCache.data,
        time: twNow.toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit' }),
        count: asiaCache.data.filter(d => d.price !== null).length,
        cached: true
      });
    }

    // 所有 symbol（去重）
    const symbols = [...new Set(ASIA_INDICES.map(i => i.symbol))];
    const dataMap = {};

    // === 方法1: yahoo-finance2（自動處理 crumb 認證）===
    if (yahooFinance) {
      try {
        const quotes = await yahooFinance.quote(symbols);
        const quoteArr = Array.isArray(quotes) ? quotes : [quotes];
        quoteArr.forEach(q => {
          if (q && q.symbol && q.regularMarketPrice) {
            dataMap[q.symbol] = {
              price: q.regularMarketPrice,
              prevClose: q.regularMarketPreviousClose || 0,
              change: q.regularMarketChange || 0,
              changePercent: q.regularMarketChangePercent || 0
            };
          }
        });
        console.log(`✅ Asia yf2: ${Object.keys(dataMap).length}/${symbols.length}`);
      } catch(e) {
        console.log(`⚠️ Asia yf2 batch failed: ${e.message?.substring(0, 80)}`);
        // 逐一查詢 fallback
        for (const symbol of symbols) {
          if (dataMap[symbol]) continue;
          try {
            const q = await yahooFinance.quote(symbol);
            if (q?.regularMarketPrice) {
              dataMap[q.symbol || symbol] = {
                price: q.regularMarketPrice,
                prevClose: q.regularMarketPreviousClose || 0,
                change: q.regularMarketChange || 0,
                changePercent: q.regularMarketChangePercent || 0
              };
            }
          } catch(e2) { /* skip */ }
        }
        console.log(`⚠️ Asia yf2 single: ${Object.keys(dataMap).length}/${symbols.length}`);
      }
    }

    // === 方法2: axios v8 chart fallback（沒裝 yf2 或 yf2 全失敗時）===
    const missing = symbols.filter(s => !dataMap[s]);
    if (missing.length > 0) {
      console.log(`🔄 Asia axios fallback for ${missing.length} symbols...`);
      for (let i = 0; i < missing.length; i += 4) {
        const batch = missing.slice(i, i + 4);
        const results = await Promise.allSettled(batch.map(async (symbol) => {
          const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=2d&includePrePost=false`;
          const resp = await axios.get(url, {
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
              'Accept': '*/*'
            },
            timeout: 10000
          });
          const meta = resp.data?.chart?.result?.[0]?.meta;
          if (meta) {
            const price = meta.regularMarketPrice;
            const prevClose = meta.chartPreviousClose || meta.previousClose;
            return { symbol, price, prevClose, change: price - prevClose, changePercent: prevClose > 0 ? ((price - prevClose) / prevClose * 100) : 0 };
          }
          return null;
        }));
        results.forEach(r => {
          if (r.status === 'fulfilled' && r.value) dataMap[r.value.symbol] = r.value;
        });
        if (i + 4 < missing.length) await new Promise(r => setTimeout(r, 500));
      }
      console.log(`📊 Asia total: ${Object.keys(dataMap).length}/${symbols.length}`);
    }

    // 組裝結果
    const data = ASIA_INDICES.map(idx => {
      const d = dataMap[idx.symbol];
      return {
        symbol: idx.symbol,
        label: idx.label,
        region: idx.region,
        cat: idx.cat,
        desc: idx.desc,
        price: d?.price || null,
        prevClose: d?.prevClose || null,
        change: d?.change || 0,
        changePercent: d?.changePercent || 0
      };
    });

    // 更新快取
    asiaCache = { data, time: now };

    const nowDate = new Date();
    const twNow = new Date(nowDate.getTime() + (nowDate.getTimezoneOffset() + 480) * 60000);
    const twH = twNow.getHours(), twM = twNow.getMinutes();
    const twMin = twH * 60 + twM;
    const dayOfWeek = twNow.getDay();
    let marketStatus = 'closed';
    if (dayOfWeek > 0 && dayOfWeek < 6) {
      if (twMin >= 480 && twMin < 870) marketStatus = 'open';
      else if (twMin < 480) marketStatus = 'pre';
    }

    res.json({
      success: true,
      data,
      time: twNow.toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit' }),
      count: data.filter(d => d.price !== null).length,
      marketStatus
    });
  } catch(e) {
    console.error('亞洲指數錯誤:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

// ==================== 健康檢查 ====================

app.get('/api/health', async (req, res) => {
  let dbStatus = 'unknown';
  
  try {
    await pool.query('SELECT 1');
    dbStatus = 'connected';
  } catch (error) {
    dbStatus = 'disconnected';
  }
  
  // 即使資料庫未連接也回傳 200，讓 Render 認為服務正常
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    version: '1.0.0',
    database: dbStatus
  });
});

// Keep Alive（防止 Render 休眠）
app.get('/api/ping', (req, res) => {
  res.send('pong');
});

// ==================== 前端路由（SPA）====================

app.get('*', (req, res) => {
  // 🔧 排除 API 路徑，不要被 SPA fallback 攔截
  if (req.path.startsWith('/api/') || req.path.startsWith('/webhook')) {
    return res.status(404).json({ error: 'API endpoint not found' });
  }
  
  // 只處理非檔案請求（SPA fallback）
  if (!req.path.includes('.')) {
    res.sendFile(path.join(__dirname, '../client/index.html'));
  } else {
    res.status(404).send('Not found');
  }
});

// ==================== 錯誤處理 ====================

app.use((err, req, res, next) => {
  console.error('Error:', err);
  res.status(500).json({ 
    error: '伺服器錯誤',
    message: process.env.NODE_ENV === 'development' ? err.message : undefined
  });
});

// ==================== 啟動伺服器 ====================

async function startServer() {
  // 先啟動伺服器（不等資料庫）
  app.listen(PORT, () => {
    console.log(`
╔═══════════════════════════════════════════╗
║                                           ║
║     📊 股海秘書 LINE 秘書                  ║
║     Server running on port ${PORT}           ║
║                                           ║
║     🌐 http://localhost:${PORT}              ║
║                                           ║
╚═══════════════════════════════════════════╝
    `);
  });

  // 背景初始化資料庫（不阻塞啟動）
  setTimeout(async () => {
    try {
      console.log('🔄 檢查資料庫...');
      await initDatabase();
      
      // 檢查是否需要載入初始資料
      const stockCount = await pool.query('SELECT COUNT(*) FROM stocks');
      if (parseInt(stockCount.rows[0].count) === 0) {
        console.log('📦 載入初始資料...');
        await seedStocks();
        await seedSettings();
      }
      
      console.log('✅ 資料庫初始化完成');
      
      // 啟動排程任務
      if (process.env.NODE_ENV === 'production') {
        scheduler.start();
      } else {
        console.log('⚠️ 開發模式：排程任務未啟動');
      }
      
    } catch (error) {
      console.error('⚠️ 資料庫初始化失敗:', error.message);
      console.log('   伺服器將繼續運行，部分功能可能不可用');
    }
  }, 2000);
}

startServer();

module.exports = app;




