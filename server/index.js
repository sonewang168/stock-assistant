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
const alertRoutes = require('./routes/alert');
const lineRoutes = require('./routes/line');
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

// ==================== API 路由 ====================

app.use('/api/stock', stockRoutes);
app.use('/api/watchlist', watchlistRoutes);
app.use('/api/portfolio', portfolioRoutes);
app.use('/api/alert', alertRoutes);
app.use('/api/line', lineRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/voice', voiceRoutes);

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

// ==================== 前端路由（SPA）====================

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../client/index.html'));
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

