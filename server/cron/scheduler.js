/**
 * ⏰ 排程任務 - 自動股價監控
 */

const cron = require('node-cron');
const { pool } = require('../db');
const stockService = require('../services/stockService');
const technicalService = require('../services/technicalService');
const aiService = require('../services/aiService');
const lineService = require('../services/lineService');

class Scheduler {

  constructor() {
    this.jobs = [];
    this.isRunning = false;
  }

  /**
   * 啟動所有排程
   */
  start() {
    console.log('⏰ 排程任務啟動中...');

    // 盤中監控（週一到週五 09:00-13:30，每 5 分鐘）
    const marketCheck = cron.schedule('*/5 9-13 * * 1-5', () => {
      const now = new Date();
      const hour = now.getHours();
      const minute = now.getMinutes();
      
      // 只在 09:00-13:30 執行
      if (hour === 13 && minute > 30) return;
      
      this.checkStocks();
    }, {
      timezone: 'Asia/Taipei'
    });
    this.jobs.push(marketCheck);

    // 收盤日報（週一到週五 13:35）
    const dailyReport = cron.schedule('35 13 * * 1-5', () => {
      this.sendDailyReport();
    }, {
      timezone: 'Asia/Taipei'
    });
    this.jobs.push(dailyReport);

    // 籌碼更新（週一到週五 15:00）
    const chipUpdate = cron.schedule('0 15 * * 1-5', () => {
      this.updateChipData();
    }, {
      timezone: 'Asia/Taipei'
    });
    this.jobs.push(chipUpdate);

    // 每日清理（每天 03:00）
    const cleanup = cron.schedule('0 3 * * *', () => {
      this.cleanupOldData();
    }, {
      timezone: 'Asia/Taipei'
    });
    this.jobs.push(cleanup);

    console.log('✅ 排程任務已啟動：');
    console.log('   📊 盤中監控：09:00-13:30 每 5 分鐘');
    console.log('   📋 收盤日報：13:35');
    console.log('   💰 籌碼更新：15:00');
    console.log('   🧹 資料清理：03:00');
  }

  /**
   * 停止所有排程
   */
  stop() {
    this.jobs.forEach(job => job.stop());
    this.jobs = [];
    console.log('⏹️ 排程任務已停止');
  }

  /**
   * 檢查股價（主要監控邏輯）
   */
  async checkStocks() {
    if (this.isRunning) {
      console.log('⏳ 上一次檢查尚未完成，跳過');
      return;
    }

    this.isRunning = true;
    console.log(`\n📊 開始檢查股價 ${new Date().toLocaleString('zh-TW')}`);

    try {
      // 取得設定
      const settings = await this.getSettings();
      const threshold = parseFloat(settings.price_threshold) || 3;
      const maPeriod = parseInt(settings.ma_period) || 20;
      const highLowDays = parseInt(settings.highlow_days) || 20;
      const enableMA = settings.enable_ma_alert === 'true';
      const enableHighLow = settings.enable_highlow_alert === 'true';

      // 取得監控清單
      const watchlist = await this.getWatchlist();
      console.log(`   監控 ${watchlist.length} 檔股票`);

      const alerts = [];

      for (const stock of watchlist) {
        const stockData = await stockService.getRealtimePrice(stock.stock_id);
        
        if (!stockData) continue;

        // 儲存價格歷史
        await stockService.savePriceHistory(stockData);

        // 取得自訂閾值
        const customThreshold = stock.custom_threshold 
          ? parseFloat(stock.custom_threshold) 
          : threshold;

        const absChange = Math.abs(parseFloat(stockData.changePercent));

        // 1. 檢查漲跌幅
        if (absChange >= customThreshold) {
          alerts.push({
            type: 'PRICE_CHANGE',
            stock: stockData,
            message: `${stockData.changePercent > 0 ? '🚀 大漲' : '📉 大跌'} ${absChange}%`
          });
        }

        // 2. 檢查均線突破
        if (enableMA) {
          const maResult = await technicalService.checkMABreakout(
            stock.stock_id, 
            stockData.price, 
            maPeriod
          );
          
          if (maResult) {
            alerts.push({
              type: maResult.type === 'breakout' ? 'MA_BREAKOUT' : 'MA_BREAKDOWN',
              stock: stockData,
              message: `${maResult.type === 'breakout' ? '📈 突破' : '📉 跌破'} ${maPeriod}MA`
            });
          }
        }

        // 3. 檢查 N 日高低點
        if (enableHighLow) {
          const highLowResult = await technicalService.checkHighLow(
            stock.stock_id,
            stockData.price,
            highLowDays
          );
          
          if (highLowResult) {
            alerts.push({
              type: highLowResult.type === 'new_high' ? 'NEW_HIGH' : 'NEW_LOW',
              stock: stockData,
              message: `${highLowResult.type === 'new_high' ? '🏆 創' : '⚠️ 創'} ${highLowDays} 日${highLowResult.type === 'new_high' ? '新高' : '新低'}`
            });
          }
        }

        // 避免 API 限制
        await this.sleep(500);
      }

      // 4. 檢查到價提醒
      const priceAlerts = await this.checkPriceAlerts();
      alerts.push(...priceAlerts);

      // 5. 檢查停損停利
      const slpAlerts = await this.checkStopLossProfit(settings);
      alerts.push(...slpAlerts);

      // 發送警報
      if (alerts.length > 0) {
        console.log(`   🚨 ${alerts.length} 個警報`);
        await this.sendAlerts(alerts);
      } else {
        console.log('   ✅ 沒有警報');
      }

    } catch (error) {
      console.error('❌ 檢查股價錯誤:', error);
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * 檢查到價提醒
   */
  async checkPriceAlerts() {
    const sql = `
      SELECT a.*, s.name as stock_name
      FROM price_alerts a
      JOIN stocks s ON a.stock_id = s.id
      WHERE a.is_active = true AND a.is_triggered = false
    `;

    const result = await pool.query(sql);
    const alerts = [];

    for (const alert of result.rows) {
      const stockData = await stockService.getRealtimePrice(alert.stock_id);
      if (!stockData) continue;

      let shouldAlert = false;

      if (alert.condition === 'above' && stockData.price >= parseFloat(alert.target_price)) {
        shouldAlert = true;
      } else if (alert.condition === 'below' && stockData.price <= parseFloat(alert.target_price)) {
        shouldAlert = true;
      }

      if (shouldAlert) {
        // 標記為已觸發
        await pool.query(
          `UPDATE price_alerts SET is_triggered = true, triggered_at = CURRENT_TIMESTAMP WHERE id = $1`,
          [alert.id]
        );

        alerts.push({
          type: 'PRICE_ALERT',
          stock: stockData,
          message: `🎯 到價提醒：${alert.condition === 'above' ? '高於' : '低於'} ${alert.target_price}`
        });
      }

      await this.sleep(300);
    }

    return alerts;
  }

  /**
   * 檢查停損停利
   */
  async checkStopLossProfit(settings) {
    const stopLoss = parseFloat(settings.stop_loss_percent) || -10;
    const takeProfit = parseFloat(settings.take_profit_percent) || 20;

    const sql = `
      SELECT p.*, s.name as stock_name
      FROM portfolio p
      JOIN stocks s ON p.stock_id = s.id
      WHERE p.shares > 0
    `;

    const result = await pool.query(sql);
    const alerts = [];

    for (const holding of result.rows) {
      const stockData = await stockService.getRealtimePrice(holding.stock_id);
      if (!stockData) continue;

      const cost = holding.shares * parseFloat(holding.avg_cost);
      const value = holding.shares * stockData.price;
      const profitPercent = ((value - cost) / cost * 100);

      if (profitPercent <= stopLoss) {
        alerts.push({
          type: 'STOP_LOSS',
          stock: { ...stockData, name: holding.stock_name },
          message: `🛑 停損警報：已虧損 ${profitPercent.toFixed(2)}%`
        });
      }

      if (profitPercent >= takeProfit) {
        alerts.push({
          type: 'TAKE_PROFIT',
          stock: { ...stockData, name: holding.stock_name },
          message: `💰 停利提醒：已獲利 ${profitPercent.toFixed(2)}%`
        });
      }

      await this.sleep(300);
    }

    return alerts;
  }

  /**
   * 發送警報
   */
  async sendAlerts(alerts) {
    // 取得 LINE User ID
    const result = await pool.query(
      "SELECT value FROM settings WHERE key = 'line_user_id'"
    );
    const userId = result.rows[0]?.value || process.env.LINE_USER_ID;

    if (!userId) {
      console.log('⚠️ 未設定 LINE User ID，無法推播');
      return;
    }

    for (const alert of alerts) {
      // 產生 AI 評論
      const aiComment = await aiService.generateComment(alert);

      // 建立 Flex Message
      const flexMessage = lineService.createStockAlertFlex(alert, aiComment);

      // 發送
      await lineService.sendFlexMessage(userId, flexMessage);

      // 記錄
      await lineService.logAlert(alert, aiComment);

      await this.sleep(1000);
    }
  }

  /**
   * 發送收盤日報
   */
  async sendDailyReport() {
    console.log('\n📋 產生收盤日報...');

    try {
      const watchlist = await this.getWatchlist();
      const stockDataList = [];

      for (const stock of watchlist) {
        const data = await stockService.getRealtimePrice(stock.stock_id);
        if (data) {
          stockDataList.push(data);
        }
        await this.sleep(300);
      }

      if (stockDataList.length === 0) {
        console.log('   沒有監控股票');
        return;
      }

      // 排序：漲幅最大到最小
      stockDataList.sort((a, b) => 
        parseFloat(b.changePercent) - parseFloat(a.changePercent)
      );

      // AI 總結
      const aiSummary = await aiService.generateDailySummary(stockDataList);

      // 建立日報 Flex
      const flexMessage = lineService.createDailyReportFlex(stockDataList, aiSummary);

      // 發送
      const result = await pool.query(
        "SELECT value FROM settings WHERE key = 'line_user_id'"
      );
      const userId = result.rows[0]?.value || process.env.LINE_USER_ID;

      if (userId) {
        await lineService.sendFlexMessage(userId, flexMessage);
        console.log('   ✅ 日報已發送');
      }

    } catch (error) {
      console.error('❌ 日報錯誤:', error);
    }
  }

  /**
   * 更新籌碼資料
   */
  async updateChipData() {
    console.log('\n💰 更新籌碼資料...');

    try {
      const watchlist = await this.getWatchlist();
      let success = 0;

      for (const stock of watchlist) {
        const chipData = await stockService.getInstitutionalData(stock.stock_id);
        if (chipData) {
          await stockService.saveChipData(chipData);
          success++;
        }
        await this.sleep(1000);
      }

      console.log(`   ✅ 更新 ${success} 檔`);

    } catch (error) {
      console.error('❌ 籌碼更新錯誤:', error);
    }
  }

  /**
   * 清理舊資料
   */
  async cleanupOldData() {
    console.log('\n🧹 清理舊資料...');

    try {
      // 保留 90 天價格歷史
      await pool.query(
        `DELETE FROM price_history WHERE date < CURRENT_DATE - INTERVAL '90 days'`
      );

      // 保留 90 天籌碼資料
      await pool.query(
        `DELETE FROM chip_data WHERE date < CURRENT_DATE - INTERVAL '90 days'`
      );

      // 保留 30 天推播紀錄
      await pool.query(
        `DELETE FROM alert_logs WHERE created_at < CURRENT_DATE - INTERVAL '30 days'`
      );

      console.log('   ✅ 清理完成');

    } catch (error) {
      console.error('❌ 清理錯誤:', error);
    }
  }

  /**
   * 取得設定
   */
  async getSettings() {
    const result = await pool.query('SELECT * FROM settings');
    const settings = {};
    result.rows.forEach(row => {
      settings[row.key] = row.value;
    });
    return settings;
  }

  /**
   * 取得監控清單
   */
  async getWatchlist() {
    const sql = `
      SELECT w.stock_id, w.custom_threshold, s.name as stock_name
      FROM watchlist w
      LEFT JOIN stocks s ON w.stock_id = s.id
      WHERE w.is_active = true AND w.user_id = 'default'
    `;
    const result = await pool.query(sql);
    return result.rows;
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

module.exports = new Scheduler();
