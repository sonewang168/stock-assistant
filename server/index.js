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
    const result = await fetchTPExData(d, stockId);
    res.json(result);
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
  console.log(`🔍 TPEx 診斷: ${stockId}, ${rocDate}`);
  const result = await fetchTPExData(rocDate, stockId);
  res.json({ stockId, rocDate, serverTime: twNow.toISOString(), ...result });
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




