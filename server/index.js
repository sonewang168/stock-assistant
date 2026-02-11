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




