#!/usr/bin/env node

/**
 * 📊 資料庫初始化腳本
 * 
 * 使用方式：
 * npm run db:init
 */

require('dotenv').config();
const { pool, initDatabase, seedStocks, seedSettings } = require('./index');

async function main() {
  console.log('🚀 開始初始化資料庫...\n');

  try {
    // 測試連接
    console.log('1️⃣ 測試資料庫連接...');
    await pool.query('SELECT NOW()');
    console.log('   ✅ 連接成功\n');

    // 建立資料表
    console.log('2️⃣ 建立資料表...');
    await initDatabase();
    console.log('   ✅ 資料表建立完成\n');

    // 載入預設股票
    console.log('3️⃣ 載入預設股票清單...');
    await seedStocks();
    console.log('   ✅ 股票清單載入完成\n');

    // 載入預設設定
    console.log('4️⃣ 載入預設設定...');
    await seedSettings();
    console.log('   ✅ 設定載入完成\n');

    console.log('🎉 資料庫初始化完成！\n');

    // 顯示資料統計
    const stockCount = await pool.query('SELECT COUNT(*) FROM stocks');
    const settingCount = await pool.query('SELECT COUNT(*) FROM settings');

    console.log('📊 資料統計：');
    console.log(`   • 股票：${stockCount.rows[0].count} 檔`);
    console.log(`   • 設定：${settingCount.rows[0].count} 項`);

    process.exit(0);

  } catch (error) {
    console.error('\n❌ 初始化失敗:', error.message);
    console.error('\n請確認：');
    console.error('1. DATABASE_URL 環境變數是否正確設定');
    console.error('2. PostgreSQL 服務是否正常運作');
    console.error('3. 網路連接是否正常');
    process.exit(1);
  }
}

main();
