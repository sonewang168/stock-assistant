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
const axios = require('axios');

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

// ==================== TPEX Proxy（上櫃法人數據代理） ====================
const chipService = require('./services/chipService');

app.get('/api/tpex-proxy', async (req, res) => {
  try {
    const { d: rocDate, stockId } = req.query;
    if (!stockId) return res.status(400).json({ success: false, error: '缺少 stockId' });

    const dateParam = rocDate || chipService.toROCDate(chipService.getRecentTradeDate());
    console.log(`🔄 TPEX Proxy: ${stockId}, 日期: ${dateParam}`);

    const result = await chipService.tpexProxyFetch(stockId, dateParam);
    res.json(result);
  } catch (error) {
    console.error('TPEX Proxy 錯誤:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/tpex-diag', async (req, res) => {
  try {
    const { stockId } = req.query;
    if (!stockId) return res.status(400).json({ success: false, error: '缺少 stockId' });

    const results = {};
    const isOTC = chipService.isOTC(stockId);
    results.isOTC = isOTC;
    results.stockId = stockId;

    // 測試 OpenAPI
    try {
      const openApi = await chipService.fetchTPEXFromOpenAPI(stockId);
      results.openApi = openApi ? { success: true, data: openApi } : { success: false };
    } catch (e) { results.openApi = { success: false, error: e.message }; }

    // 測試頁面直連
    try {
      const page = await chipService.fetchTPEXFromPage(stockId);
      results.page = page ? { success: true, data: page } : { success: false };
    } catch (e) { results.page = { success: false, error: e.message }; }

    res.json({ success: true, results });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ==================== 日韓亞洲指數 API ====================

const ASIA_SYMBOLS = [
  { symbol: '^N225',     label: '日經225',     region: 'japan', cat: 'index' },
  { symbol: '8035.T',   label: '東京威力科創', region: 'japan', cat: 'semi' },
  { symbol: '6857.T',   label: '愛德萬測試',   region: 'japan', cat: 'semi' },
  { symbol: '6146.T',   label: 'DISCO',        region: 'japan', cat: 'semi' },
  { symbol: '6920.T',   label: 'Lasertec',     region: 'japan', cat: 'semi' },
  { symbol: '4063.T',   label: '信越化學',     region: 'japan', cat: 'semi' },
  { symbol: '^KS11',    label: 'KOSPI',        region: 'korea', cat: 'index' },
  { symbol: '000660.KS', label: 'SK海力士',    region: 'korea', cat: 'semi' },
  { symbol: '005930.KS', label: '三星電子',    region: 'korea', cat: 'semi' },
  { symbol: '042700.KQ', label: '韓美半導體',  region: 'korea', cat: 'semi' },
  { symbol: '403870.KS', label: 'HPSP',        region: 'korea', cat: 'semi' },
  { symbol: '091160.KS', label: 'KODEX半導體', region: 'korea', cat: 'semi' }
];

let asiaCache = { data: null, time: 0 };

app.get('/api/asia-indices', async (req, res) => {
  try {
    const now = Date.now();
    // 30 秒快取
    if (asiaCache.data && (now - asiaCache.time) < 30000) {
      return res.json({ ...asiaCache.data, cached: true });
    }

    const CF_WORKER_URL = process.env.CF_INDICES_URL;
    if (!CF_WORKER_URL) {
      return res.json({ success: false, error: 'CF_INDICES_URL 未設定' });
    }

    const symbolStr = ASIA_SYMBOLS.map(s => s.symbol).join(',');
    const resp = await axios.get(`${CF_WORKER_URL}/?symbols=${encodeURIComponent(symbolStr)}&_t=${now}`, { timeout: 15000 });

    const results = [];
    if (resp.data?.success && resp.data.data?.length > 0) {
      resp.data.data.forEach(d => {
        const def = ASIA_SYMBOLS.find(s => s.symbol === d.symbol);
        if (def && d.price > 0) {
          results.push({
            symbol: d.symbol, label: def.label, region: def.region, cat: def.cat,
            price: d.price, change: d.change || 0, changePercent: d.changePercent || 0
          });
        }
      });
    }

    const response = {
      success: true, data: results, count: results.length,
      time: new Date().toLocaleTimeString('zh-TW', { timeZone: 'Asia/Taipei' })
    };
    asiaCache = { data: response, time: now };
    res.json(response);
  } catch (error) {
    console.error('Asia indices error:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ==================== 本益比河流圖 API ====================

const peRiverCache = {};

app.get('/api/pe-river/:stockId', async (req, res) => {
  try {
    const { stockId } = req.params;
    const years = parseInt(req.query.years) || 5;
    const cacheKey = `${stockId}_${years}`;
    
    // 5 分鐘快取
    if (peRiverCache[cacheKey] && (Date.now() - peRiverCache[cacheKey].time) < 300000) {
      return res.json({ ...peRiverCache[cacheKey].data, cached: true });
    }

    const YAHOO_HEADERS = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Accept': 'application/json'
    };

    // 計算 period1/period2（UNIX timestamp）
    const endDate = Math.floor(Date.now() / 1000);
    const startDate = endDate - (years * 365.25 * 24 * 60 * 60);

    // 嘗試 .TW 和 .TWO，query1 和 query2 備援
    let symbol = `${stockId}.TW`;
    let chartData = null;

    const suffixes = ['.TW', '.TWO'];
    const queries = ['query1', 'query2'];

    for (const query of queries) {
      if (chartData) break;
      for (const suffix of suffixes) {
        const sym = `${stockId}${suffix}`;
        try {
          const url = `https://${query}.finance.yahoo.com/v8/finance/chart/${sym}?period1=${Math.floor(startDate)}&period2=${endDate}&interval=1mo`;
          console.log(`📊 PE River 嘗試 ${query} ${sym}...`);
          const chartRes = await axios.get(url, { headers: YAHOO_HEADERS, timeout: 15000 });
          const result = chartRes.data?.chart?.result?.[0];
          if (result && result.timestamp && result.timestamp.length > 0) {
            chartData = result;
            symbol = sym;
            console.log(`✅ PE River ${sym} 成功: ${result.timestamp.length} 筆`);
            break;
          }
        } catch (e) {
          console.log(`PE River ${sym} (${query}) 失敗: ${e.message}`);
        }
      }
    }

    if (!chartData) {
      return res.status(404).json({ success: false, error: `找不到 ${stockId} 的歷史數據` });
    }

    // 2) 取得 EPS / PE / 股名
    let eps = null, currentPE = null, stockName = stockId;
    for (const query of ['query2', 'query1']) {
      if (eps) break;
      try {
        const sumRes = await axios.get(
          `https://${query}.finance.yahoo.com/v10/finance/quoteSummary/${symbol}?modules=defaultKeyStatistics,financialData,price,earningsHistory`,
          { headers: YAHOO_HEADERS, timeout: 15000 }
        );
        const modules = sumRes.data?.quoteSummary?.result?.[0];
        if (modules) {
          const fin = modules.financialData || {};
          const stats = modules.defaultKeyStatistics || {};
          const priceM = modules.price || {};
          const earningsHist = modules.earningsHistory?.history || [];

          stockName = priceM.shortName || priceM.longName || stockId;
          
          eps = stats.trailingEps?.raw || fin.earningsPerShare?.raw || null;
          
          if (!eps && earningsHist.length >= 4) {
            const recent4 = earningsHist.slice(-4);
            const sum = recent4.reduce((acc, q) => acc + (q.epsActual?.raw || 0), 0);
            if (sum > 0) eps = parseFloat(sum.toFixed(2));
          }

          currentPE = stats.trailingPE?.raw || priceM.trailingPE?.raw || null;
          
          if (!eps && currentPE && currentPE > 0) {
            const curPrice = priceM.regularMarketPrice?.raw || chartData.meta?.regularMarketPrice;
            if (curPrice > 0) eps = parseFloat((curPrice / currentPE).toFixed(2));
          }
        }
      } catch (e) { console.log(`PE summary (${query}) failed for ${stockId}:`, e.message); }
    }

    // 3) 用 v7 quote 再嘗試一次
    if (!eps) {
      for (const query of ['query1', 'query2']) {
        if (eps) break;
        try {
          const quoteRes = await axios.get(
            `https://${query}.finance.yahoo.com/v7/finance/quote?symbols=${symbol}`,
            { headers: YAHOO_HEADERS, timeout: 10000 }
          );
          const q = quoteRes.data?.quoteResponse?.result?.[0];
          if (q) {
            eps = q.epsTrailingTwelveMonths || null;
            currentPE = q.trailingPE || currentPE;
            stockName = q.shortName || q.longName || stockName;
          }
        } catch (e) { /* ignore */ }
      }
    }

    // 4) stockName fallback from chart meta
    if (stockName === stockId) {
      stockName = chartData.meta?.shortName || chartData.meta?.longName || stockId;
    }

    // 5) 解析月線數據
    const timestamps = chartData.timestamp || [];
    const closes = chartData.indicators?.quote?.[0]?.close || [];
    const currentPrice = chartData.meta?.regularMarketPrice || closes[closes.length - 1] || 0;

    const monthlyData = [];
    for (let i = 0; i < timestamps.length; i++) {
      const close = closes[i];
      if (close && close > 0) {
        const d = new Date(timestamps[i] * 1000);
        monthlyData.push({
          date: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`,
          close: parseFloat(close.toFixed(2))
        });
      }
    }

    // 6) 計算 PE 河流帶
    // 如果有 EPS，計算固定 PE 倍數的價格線
    // 如果沒有 EPS，用歷史價格分佈做百分位帶
    let peBands = null;
    let peMethod = 'none';

    if (eps && eps > 0) {
      peMethod = 'eps';
      // 根據產業調整 PE 帶（半導體/電子 PE 偏高）
      const allPEs = monthlyData.map(d => d.close / eps).filter(pe => pe > 0 && pe < 200);
      const sortedPEs = [...allPEs].sort((a, b) => a - b);
      
      // 用歷史 PE 分佈的百分位
      const p10 = sortedPEs[Math.floor(sortedPEs.length * 0.10)] || 8;
      const p30 = sortedPEs[Math.floor(sortedPEs.length * 0.30)] || 12;
      const p50 = sortedPEs[Math.floor(sortedPEs.length * 0.50)] || 16;
      const p70 = sortedPEs[Math.floor(sortedPEs.length * 0.70)] || 20;
      const p90 = sortedPEs[Math.floor(sortedPEs.length * 0.90)] || 28;

      const levels = [
        { pe: parseFloat(p10.toFixed(1)), label: '極低估', zone: 'deep-value' },
        { pe: parseFloat(p30.toFixed(1)), label: '低估', zone: 'value' },
        { pe: parseFloat(p50.toFixed(1)), label: '合理', zone: 'fair' },
        { pe: parseFloat(p70.toFixed(1)), label: '偏高', zone: 'rich' },
        { pe: parseFloat(p90.toFixed(1)), label: '極高估', zone: 'expensive' }
      ];

      // 每個月份對應各 PE 帶的價格
      peBands = {
        levels,
        eps,
        data: monthlyData.map(d => {
          const pe = d.close / eps;
          let zone = 'extreme';
          if (pe <= levels[0].pe) zone = 'deep-value';
          else if (pe <= levels[1].pe) zone = 'value';
          else if (pe <= levels[2].pe) zone = 'fair-low';
          else if (pe <= levels[3].pe) zone = 'fair-high';
          else if (pe <= levels[4].pe) zone = 'rich';
          else zone = 'expensive';
          
          return {
            date: d.date,
            close: d.close,
            pe: parseFloat(pe.toFixed(2)),
            zone,
            bandPrices: levels.map(l => parseFloat((eps * l.pe).toFixed(2)))
          };
        })
      };
    } else {
      // 無 EPS：用價格百分位（簡化版）
      peMethod = 'percentile';
      const prices = monthlyData.map(d => d.close).sort((a, b) => a - b);
      const getPercentile = (arr, pct) => arr[Math.floor(arr.length * pct)] || 0;
      
      peBands = {
        levels: [
          { price: getPercentile(prices, 0.10), label: '極低價', zone: 'deep-value' },
          { price: getPercentile(prices, 0.30), label: '低價', zone: 'value' },
          { price: getPercentile(prices, 0.50), label: '合理價', zone: 'fair' },
          { price: getPercentile(prices, 0.70), label: '偏高價', zone: 'rich' },
          { price: getPercentile(prices, 0.90), label: '極高價', zone: 'expensive' }
        ],
        eps: null,
        data: monthlyData
      };
    }

    // 7) 判斷目前估值區間
    let currentZone = '未知';
    if (eps && eps > 0 && currentPrice > 0) {
      const pe = currentPrice / eps;
      const levels = peBands.levels;
      if (pe <= levels[0].pe) currentZone = '極低估（買進）';
      else if (pe <= levels[1].pe) currentZone = '低估（可買）';
      else if (pe <= levels[2].pe) currentZone = '合理偏低';
      else if (pe <= levels[3].pe) currentZone = '合理偏高';
      else if (pe <= levels[4].pe) currentZone = '高估（考慮減碼）';
      else currentZone = '極高估（賣出）';
    }

    const responseData = {
      success: true,
      stockId,
      stockName,
      symbol,
      currentPrice: parseFloat(currentPrice.toFixed(2)),
      eps,
      currentPE: eps && eps > 0 && currentPrice > 0 ? parseFloat((currentPrice / eps).toFixed(2)) : currentPE,
      currentZone,
      peMethod,
      peBands,
      monthlyData,
      dataPoints: monthlyData.length
    };

    peRiverCache[cacheKey] = { data: responseData, time: Date.now() };
    res.json(responseData);

  } catch (error) {
    console.error('PE River error:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// LINE Webhook（需要原始 body）
app.use('/webhook', express.raw({ type: 'application/json' }), lineRoutes);

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

// 🌏 手動觸發全球市場日報（測試用）
app.get('/api/test/global-daily', async (req, res) => {
  try {
    console.log('🧪 手動觸發全球市場日報...');
    await scheduler.sendGlobalMarketDailyReport();
    res.json({ success: true, message: '全球市場日報已發送，請檢查 LINE' });
  } catch(e) {
    console.error('測試失敗:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
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




