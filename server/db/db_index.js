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
  target_price_high DECIMAL(10,2),
  target_price_low DECIMAL(10,2),
  alert_percent_up DECIMAL(5,2),
  alert_percent_down DECIMAL(5,2),
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

-- 競標持股（新版）
CREATE TABLE IF NOT EXISTS holdings (
  id SERIAL PRIMARY KEY,
  user_id VARCHAR(100) DEFAULT 'default',
  stock_id VARCHAR(10) NOT NULL,
  stock_name VARCHAR(50),
  lots INTEGER DEFAULT 0,
  odd_shares INTEGER DEFAULT 0,
  shares INTEGER DEFAULT 0,
  bid_price DECIMAL(10,2),
  won_price DECIMAL(10,2),
  is_won BOOLEAN DEFAULT false,
  target_price_high DECIMAL(10,2),
  target_price_low DECIMAL(10,2),
  notify_enabled BOOLEAN DEFAULT true,
  notes TEXT,
  bid_date DATE,
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

-- ==================== v4.0 新增資料表 ====================

-- 智能通知設定
CREATE TABLE IF NOT EXISTS smart_alerts (
  id SERIAL PRIMARY KEY,
  user_id VARCHAR(100) DEFAULT 'default',
  stock_id VARCHAR(10) NOT NULL,
  alert_type VARCHAR(50) NOT NULL,
  condition_operator VARCHAR(10),
  condition_value DECIMAL(10,2),
  is_active BOOLEAN DEFAULT true,
  last_triggered TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 三大法人每日籌碼
CREATE TABLE IF NOT EXISTS institutional_trading (
  id SERIAL PRIMARY KEY,
  stock_id VARCHAR(10) NOT NULL,
  trade_date DATE NOT NULL,
  foreign_buy BIGINT DEFAULT 0,
  foreign_sell BIGINT DEFAULT 0,
  foreign_net BIGINT DEFAULT 0,
  trust_buy BIGINT DEFAULT 0,
  trust_sell BIGINT DEFAULT 0,
  trust_net BIGINT DEFAULT 0,
  dealer_buy BIGINT DEFAULT 0,
  dealer_sell BIGINT DEFAULT 0,
  dealer_net BIGINT DEFAULT 0,
  total_net BIGINT DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(stock_id, trade_date)
);

-- 績效快照
CREATE TABLE IF NOT EXISTS performance_snapshots (
  id SERIAL PRIMARY KEY,
  user_id VARCHAR(100) DEFAULT 'default',
  snapshot_date DATE NOT NULL,
  total_cost DECIMAL(15,2),
  total_value DECIMAL(15,2),
  total_profit DECIMAL(15,2),
  profit_percent DECIMAL(8,4),
  holdings_count INTEGER,
  snapshot_data JSONB,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, snapshot_date)
);

-- 建立新索引
CREATE INDEX IF NOT EXISTS idx_smart_alerts_user ON smart_alerts(user_id, is_active);
CREATE INDEX IF NOT EXISTS idx_institutional_stock ON institutional_trading(stock_id, trade_date DESC);
CREATE INDEX IF NOT EXISTS idx_performance_user ON performance_snapshots(user_id, snapshot_date DESC);
`;

// 初始化資料庫
async function initDatabase() {
  try {
    await pool.query(initSQL);
    console.log('✅ 資料表初始化完成');
    
    // 更新 watchlist 資料表加入警報欄位（如果不存在）
    try {
      await pool.query(`
        ALTER TABLE watchlist 
        ADD COLUMN IF NOT EXISTS target_price_high DECIMAL(10,2),
        ADD COLUMN IF NOT EXISTS target_price_low DECIMAL(10,2),
        ADD COLUMN IF NOT EXISTS alert_percent_up DECIMAL(5,2),
        ADD COLUMN IF NOT EXISTS alert_percent_down DECIMAL(5,2)
      `);
      console.log('✅ 警報欄位已更新');
    } catch (alterError) {
      // 忽略欄位已存在的錯誤
      if (!alterError.message.includes('already exists')) {
        console.log('警報欄位更新:', alterError.message);
      }
    }
    
    return true;
  } catch (error) {
    console.error('❌ 資料表初始化失敗:', error);
    return false;
  }
}

// 插入預設股票清單
async function seedStocks() {
  const stocks = [
    // ===== 上市股票 (TSE) =====
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
    ['2884', '玉山金', 'TSE'],
    ['2886', '兆豐金', 'TSE'],
    ['2892', '第一金', 'TSE'],
    ['2885', '元大金', 'TSE'],
    ['2887', '台新金', 'TSE'],
    ['2880', '華南金', 'TSE'],
    ['2883', '開發金', 'TSE'],
    ['1303', '南亞', 'TSE'],
    ['1326', '台化', 'TSE'],
    ['6505', '台塑化', 'TSE'],
    // ETF
    ['0050', '元大台灣50', 'TSE'],
    ['0056', '元大高股息', 'TSE'],
    ['00878', '國泰永續高股息', 'TSE'],
    ['00919', '群益台灣精選高息', 'TSE'],
    ['00929', '復華台灣科技優息', 'TSE'],
    ['006208', '富邦台50', 'TSE'],
    ['00940', '元大台灣價值高息', 'TSE'],
    ['00939', '統一台灣高息動能', 'TSE'],
    // AI / 伺服器概念股
    ['3661', '世芯-KY', 'TSE'],
    ['3443', '創意', 'TSE'],
    ['2379', '瑞昱', 'TSE'],
    ['3034', '聯詠', 'TSE'],
    ['2357', '華碩', 'TSE'],
    ['2382', '廣達', 'TSE'],
    ['3231', '緯創', 'TSE'],
    ['2356', '英業達', 'TSE'],
    ['2324', '仁寶', 'TSE'],
    ['2353', '宏碁', 'TSE'],
    ['2376', '技嘉', 'TSE'],
    ['2377', '微星', 'TSE'],
    ['6669', '緯穎', 'TSE'],
    ['2395', '研華', 'TSE'],
    ['4938', '和碩', 'TSE'],
    // 記憶體
    ['2408', '南亞科', 'TSE'],
    ['2344', '華邦電', 'TSE'],
    ['2337', '旺宏', 'TSE'],
    // 航運
    ['2603', '長榮', 'TSE'],
    ['2609', '陽明', 'TSE'],
    ['2615', '萬海', 'TSE'],
    ['2618', '長榮航', 'TSE'],
    ['2610', '華航', 'TSE'],
    // 電子零組件
    ['2327', '國巨', 'TSE'],
    ['2301', '光寶科', 'TSE'],
    ['2311', '日月光投控', 'TSE'],
    ['3037', '欣興', 'TSE'],
    ['3044', '健鼎', 'TSE'],
    ['2383', '台光電', 'TSE'],
    ['6239', '力成', 'TSE'],
    ['8046', '南電', 'TSE'],
    ['6515', '穎崴', 'TSE'],
    ['6488', '環球晶', 'TSE'],
    // 其他上市
    ['2002', '中鋼', 'TSE'],
    ['1216', '統一', 'TSE'],
    ['2912', '統一超', 'TSE'],
    ['2207', '和泰車', 'TSE'],
    ['2301', '光寶科', 'TSE'],
    ['3045', '台灣大', 'TSE'],
    ['4904', '遠傳', 'TSE'],
    ['9910', '豐泰', 'TSE'],
    ['9914', '美利達', 'TSE'],
    ['9921', '巨大', 'TSE'],
    
    // ===== 上櫃股票 (OTC) =====
    // 記憶體/DRAM
    ['3260', '威剛', 'OTC'],
    ['8299', '群聯', 'OTC'],
    ['8271', '宇瞻', 'OTC'],
    // IC 設計
    ['3008', '大立光', 'OTC'],
    ['6415', '矽力-KY', 'OTC'],
    ['5274', '信驊', 'OTC'],
    ['5269', '祥碩', 'OTC'],
    ['6533', '晶心科', 'OTC'],
    ['3227', '原相', 'OTC'],
    ['6462', '神盾', 'OTC'],
    ['8016', '矽創', 'OTC'],
    ['3105', '穩懋', 'OTC'],
    ['4966', '譜瑞-KY', 'OTC'],
    ['6510', '精測', 'OTC'],
    // PCB/封測
    ['3189', '景碩', 'OTC'],
    ['8150', '南茂', 'OTC'],
    ['6147', '頎邦', 'OTC'],
    ['6257', '矽格', 'OTC'],
    // AI/伺服器相關
    ['3017', '奇鋐', 'OTC'],
    ['6679', '鈺太', 'OTC'],
    ['3653', '健策', 'OTC'],
    ['6719', '力智', 'OTC'],
    ['6770', '力積電', 'OTC'],
    ['3529', '力旺', 'OTC'],
    ['3533', '嘉澤', 'OTC'],
    ['3023', '信邦', 'OTC'],
    // 光學
    ['3406', '玉晶光', 'OTC'],
    ['3504', '揚明光', 'OTC'],
    // 生技醫療
    ['6547', '高端疫苗', 'OTC'],
    ['4147', '中裕', 'OTC'],
    ['4174', '浩鼎', 'OTC'],
    ['4123', '晟德', 'OTC'],
    ['6472', '保瑞', 'OTC'],
    // 其他上櫃
    ['6446', '藥華藥', 'OTC'],
    ['3293', '鈊象', 'OTC'],
    ['5478', '智冠', 'OTC'],
    ['8454', '富邦媒', 'OTC'],
    ['5904', '寶雅', 'OTC'],
    ['6414', '樺漢', 'OTC'],
    ['3680', '家登', 'OTC'],
    ['6121', '新普', 'OTC'],
    ['6274', '台燿', 'OTC'],
    ['6138', '茂達', 'OTC'],
    ['8044', '網家', 'OTC']
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
    ['take_profit_percent', '20'],
    // 語音設定
    ['voice_enabled', 'false'],
    ['voice_provider', 'gemini'],  // 'elevenlabs' 或 'gemini'
    ['elevenlabs_voice_id', 'pNInz6obpgDQGcFmaJgB']  // Adam
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
