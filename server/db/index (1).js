/**
 * 📊 資料庫連接與初始化
 */

const { Pool } = require('pg');

// 資料庫連接池
const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://localhost:5432/stockassistant',
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000
});

// 測試連接
pool.on('connect', () => {
  console.log('✅ PostgreSQL 已連接');
});

pool.on('error', (err) => {
  console.error('❌ PostgreSQL 連接錯誤:', err.message);
  // 不要讓錯誤終止程序
});

// ==================== 資料表結構 ====================

const initSQL = `
-- 股票清單
CREATE TABLE IF NOT EXISTS stocks (
  id VARCHAR(10) PRIMARY KEY,
  name VARCHAR(50) NOT NULL,
  market VARCHAR(10) DEFAULT 'TSE',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 監控清單
CREATE TABLE IF NOT EXISTS watchlist (
  id SERIAL PRIMARY KEY,
  stock_id VARCHAR(10) REFERENCES stocks(id),
  user_id VARCHAR(100) DEFAULT 'default',
  custom_threshold DECIMAL(5,2),
  notes TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(stock_id, user_id)
);

-- 持股組合
CREATE TABLE IF NOT EXISTS portfolio (
  id SERIAL PRIMARY KEY,
  stock_id VARCHAR(10) REFERENCES stocks(id),
  user_id VARCHAR(100) DEFAULT 'default',
  shares INTEGER NOT NULL,
  avg_cost DECIMAL(10,2) NOT NULL,
  buy_date DATE,
  notes TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 到價提醒
CREATE TABLE IF NOT EXISTS price_alerts (
  id SERIAL PRIMARY KEY,
  stock_id VARCHAR(10) REFERENCES stocks(id),
  user_id VARCHAR(100) DEFAULT 'default',
  target_price DECIMAL(10,2) NOT NULL,
  condition VARCHAR(10) NOT NULL CHECK (condition IN ('above', 'below')),
  is_triggered BOOLEAN DEFAULT false,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  triggered_at TIMESTAMP
);

-- 價格歷史
CREATE TABLE IF NOT EXISTS price_history (
  id SERIAL PRIMARY KEY,
  stock_id VARCHAR(10) REFERENCES stocks(id),
  date DATE NOT NULL,
  open_price DECIMAL(10,2),
  high_price DECIMAL(10,2),
  low_price DECIMAL(10,2),
  close_price DECIMAL(10,2),
  volume BIGINT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(stock_id, date)
);

-- 籌碼資料
CREATE TABLE IF NOT EXISTS chip_data (
  id SERIAL PRIMARY KEY,
  stock_id VARCHAR(10) REFERENCES stocks(id),
  date DATE NOT NULL,
  foreign_buy BIGINT DEFAULT 0,
  investment_buy BIGINT DEFAULT 0,
  dealer_buy BIGINT DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(stock_id, date)
);

-- 推播紀錄
CREATE TABLE IF NOT EXISTS alert_logs (
  id SERIAL PRIMARY KEY,
  stock_id VARCHAR(10),
  stock_name VARCHAR(50),
  alert_type VARCHAR(50),
  price DECIMAL(10,2),
  change_percent DECIMAL(5,2),
  ai_comment TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 系統設定
CREATE TABLE IF NOT EXISTS settings (
  key VARCHAR(50) PRIMARY KEY,
  value TEXT,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 建立索引
CREATE INDEX IF NOT EXISTS idx_price_history_stock_date ON price_history(stock_id, date DESC);
CREATE INDEX IF NOT EXISTS idx_chip_data_stock_date ON chip_data(stock_id, date DESC);
CREATE INDEX IF NOT EXISTS idx_watchlist_user ON watchlist(user_id);
CREATE INDEX IF NOT EXISTS idx_portfolio_user ON portfolio(user_id);
`;

// 初始化資料庫
async function initDatabase() {
  try {
    await pool.query(initSQL);
    console.log('✅ 資料表初始化完成');
    return true;
  } catch (error) {
    console.error('❌ 資料表初始化失敗:', error);
    return false;
  }
}

// 插入預設股票清單
async function seedStocks() {
  const stocks = [
    // 權值股
    ['2330', '台積電', 'TSE'],
    ['2317', '鴻海', 'TSE'],
    ['2454', '聯發科', 'TSE'],
    ['2308', '台達電', 'TSE'],
    ['2881', '富邦金', 'TSE'],
    ['2882', '國泰金', 'TSE'],
    ['2891', '中信金', 'TSE'],
    ['2303', '聯電', 'TSE'],
    ['2412', '中華電', 'TSE'],
    ['1301', '台塑', 'TSE'],
    // ETF
    ['0050', '元大台灣50', 'TSE'],
    ['0056', '元大高股息', 'TSE'],
    ['00878', '國泰永續高股息', 'TSE'],
    ['00919', '群益台灣精選高息', 'TSE'],
    ['00929', '復華台灣科技優息', 'TSE'],
    ['006208', '富邦台50', 'TSE'],
    // AI 概念股
    ['3661', '世芯-KY', 'TSE'],
    ['3443', '創意', 'TSE'],
    ['2379', '瑞昱', 'TSE'],
    ['3034', '聯詠', 'TSE'],
    ['2357', '華碩', 'TSE'],
    ['2382', '廣達', 'TSE'],
    // 航運
    ['2603', '長榮', 'TSE'],
    ['2609', '陽明', 'TSE'],
    ['2615', '萬海', 'TSE'],
    // 其他
    ['2002', '中鋼', 'TSE'],
    ['1216', '統一', 'TSE'],
    ['2912', '統一超', 'TSE']
  ];

  const insertSQL = `
    INSERT INTO stocks (id, name, market) 
    VALUES ($1, $2, $3) 
    ON CONFLICT (id) DO NOTHING
  `;

  for (const [id, name, market] of stocks) {
    await pool.query(insertSQL, [id, name, market]);
  }

  console.log('✅ 預設股票清單已載入');
}

// 預設設定
async function seedSettings() {
  const settings = [
    ['check_interval', '5'],
    ['price_threshold', '3'],
    ['ai_style', 'sarcastic'],
    ['enable_voice', 'false'],
    ['enable_ma_alert', 'true'],
    ['ma_period', '20'],
    ['enable_highlow_alert', 'true'],
    ['highlow_days', '20'],
    ['stop_loss_percent', '-10'],
    ['take_profit_percent', '20']
  ];

  const insertSQL = `
    INSERT INTO settings (key, value) 
    VALUES ($1, $2) 
    ON CONFLICT (key) DO NOTHING
  `;

  for (const [key, value] of settings) {
    await pool.query(insertSQL, [key, value]);
  }

  console.log('✅ 預設設定已載入');
}

// 執行初始化
async function init() {
  await initDatabase();
  await seedStocks();
  await seedSettings();
  console.log('🎉 資料庫初始化完成！');
}

// 如果直接執行此檔案
if (require.main === module) {
  init().then(() => process.exit(0)).catch(() => process.exit(1));
}

module.exports = { pool, initDatabase, seedStocks, seedSettings };
