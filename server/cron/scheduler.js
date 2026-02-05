/**
 * ⏰ 排程任務 - 自動股價監控
 */

const cron = require('node-cron');
const { pool } = require('../db');
const stockService = require('../services/stockService');
const technicalService = require('../services/technicalService');
const aiService = require('../services/aiService');
const lineService = require('../services/lineService');
const chipService = require('../services/chipService');
const smartAlertService = require('../services/smartAlertService');
const performanceService = require('../services/performanceService');

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

    // 🔔 台股開盤前提醒（08:30 啟動，根據設定決定發送時間）
    const twMarketOpen = cron.schedule('30 8 * * 1-5', () => {
      this.scheduleTWMarketReminder();
    }, {
      timezone: 'Asia/Taipei'
    });
    this.jobs.push(twMarketOpen);

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

    // 🔔 智能通知檢查（週一到週五 09:30-13:30，每 15 分鐘）
    const smartAlertCheck = cron.schedule('*/15 9-13 * * 1-5', () => {
      const now = new Date();
      const hour = now.getHours();
      const minute = now.getMinutes();
      if (hour === 9 && minute < 30) return;
      if (hour === 13 && minute > 30) return;
      
      this.checkSmartAlerts();
    }, {
      timezone: 'Asia/Taipei'
    });
    this.jobs.push(smartAlertCheck);

    // 📊 每日績效報告（週一到週五 13:35）
    const dailyPerformance = cron.schedule('35 13 * * 1-5', () => {
      this.sendPerformanceReport();
    }, {
      timezone: 'Asia/Taipei'
    });
    this.jobs.push(dailyPerformance);

    // 收盤日報（週一到週五 13:40）
    const dailyReport = cron.schedule('40 13 * * 1-5', () => {
      this.sendDailyReport();
    }, {
      timezone: 'Asia/Taipei'
    });
    this.jobs.push(dailyReport);

    // 📈 持股收盤摘要（週一到週五 14:00）
    const holdingsSummary = cron.schedule('0 14 * * 1-5', () => {
      this.sendHoldingsSummary();
    }, {
      timezone: 'Asia/Taipei'
    });
    this.jobs.push(holdingsSummary);

    // 🎯 停利停損檢查（週一到週五 09:30-13:30，每 10 分鐘）
    const stopLossCheck = cron.schedule('*/10 9-13 * * 1-5', () => {
      const now = new Date();
      const hour = now.getHours();
      const minute = now.getMinutes();
      if (hour === 9 && minute < 30) return;
      if (hour === 13 && minute > 30) return;
      
      this.checkStopLossTargets();
    }, {
      timezone: 'Asia/Taipei'
    });
    this.jobs.push(stopLossCheck);

    // 🏦 三大法人更新（週一到週五 15:30）- TWSE 資料約 15:00 後更新
    const institutionalUpdate = cron.schedule('30 15 * * 1-5', () => {
      this.updateInstitutionalData();
    }, {
      timezone: 'Asia/Taipei'
    });
    this.jobs.push(institutionalUpdate);

    // 籌碼更新（週一到週五 16:00）
    const chipUpdate = cron.schedule('0 16 * * 1-5', () => {
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

    // 🇺🇸 美股開盤提示（週一到週五 21:00 啟動，根據設定決定發送時間）
    const usMarketOpen = cron.schedule('0 21 * * 1-5', () => {
      this.scheduleUSMarketReminder();
    }, {
      timezone: 'Asia/Taipei'
    });
    this.jobs.push(usMarketOpen);

    // 🇺🇸 美股盤中監控（週二到週六 22:00-05:00，每 30 分鐘）
    const usMarketCheck = cron.schedule('*/30 22-23,0-5 * * 2-6', () => {
      this.checkUSStocks();
    }, {
      timezone: 'Asia/Taipei'
    });
    this.jobs.push(usMarketCheck);

    console.log('✅ 排程任務已啟動：');
    console.log('   🔔 台股開盤提醒：08:30 啟動（根據設定）');
    console.log('   📊 盤中監控：09:00-13:30 每 5 分鐘');
    console.log('   🔔 智能通知：09:30-13:30 每 15 分鐘');
    console.log('   🎯 停利停損：09:30-13:30 每 10 分鐘');
    console.log('   📈 績效報告：13:35');
    console.log('   📋 收盤日報：13:40');
    console.log('   💼 持股摘要：14:00');
    console.log('   🏦 三大法人：15:30');
    console.log('   💰 籌碼更新：16:00');
    console.log('   🧹 資料清理：03:00');
    console.log('   🇺🇸 美股開盤：根據設定');
    console.log('   🇺🇸 美股監控：22:00-05:00');
  }

  /**
   * 🔔 排程台股開盤提醒（根據設定）
   */
  async scheduleTWMarketReminder() {
    try {
      const settings = await this.getSettings();
      const reminderMinutes = parseInt(settings.tw_market_reminder) || 5;
      
      // 如果設定為 0，不發送
      if (reminderMinutes === 0) {
        console.log('🔔 台股開盤提醒已關閉');
        return;
      }

      // 計算要等待的時間
      // 09:00 開盤，提前 reminderMinutes 分鐘
      // 現在是 08:30，要等到 (30 - reminderMinutes) 分鐘後發送
      const waitMinutes = 30 - reminderMinutes;
      const waitMs = waitMinutes * 60 * 1000;

      if (waitMinutes <= 0) {
        // 如果設定 30 分鐘，立即發送
        console.log(`🔔 台股開盤提醒：設定 ${reminderMinutes} 分鐘前，立即發送`);
        await this.sendTWMarketOpenAlert(reminderMinutes);
      } else {
        console.log(`🔔 台股開盤提醒：設定 ${reminderMinutes} 分鐘前，將在 ${waitMinutes} 分鐘後發送`);
        setTimeout(async () => {
          await this.sendTWMarketOpenAlert(reminderMinutes);
        }, waitMs);
      }
    } catch (error) {
      console.error('❌ 排程台股開盤提醒錯誤:', error.message);
    }
  }

  /**
   * 🔔 台股開盤前提醒
   */
  async sendTWMarketOpenAlert(reminderMinutes = 5) {
    console.log(`\n🔔 台股開盤前提醒（提前 ${reminderMinutes} 分鐘） ${new Date().toLocaleString('zh-TW')}`);

    try {
      // 取得 LINE User ID
      const result = await pool.query(
        "SELECT value FROM settings WHERE key = 'line_user_id'"
      );
      const userId = result.rows[0]?.value || process.env.LINE_USER_ID;

      if (!userId) {
        console.log('   ⚠️ 未設定 LINE User ID');
        return;
      }

      // 取得持股
      const holdings = await pool.query(`
        SELECT h.*, s.name as stock_name
        FROM holdings h
        LEFT JOIN stocks s ON h.stock_id = s.id
        WHERE h.user_id = 'default' AND h.is_won = true
      `);

      // 取得監控清單
      const watchlist = await pool.query(`
        SELECT w.stock_id, s.name as stock_name
        FROM watchlist w
        LEFT JOIN stocks s ON w.stock_id = s.id
        WHERE w.user_id = 'default' AND w.is_active = true
        LIMIT 20
      `);

      // 建立訊息內容
      const today = new Date().toLocaleDateString('zh-TW', { 
        month: 'numeric', 
        day: 'numeric',
        weekday: 'short'
      });

      // 計算開盤時間
      const openTime = `09:00（還有 ${reminderMinutes} 分鐘）`;

      // 建立 Flex Message
      const flexMessage = {
        type: 'flex',
        altText: `🔔 ${today} 台股即將開盤`,
        contents: {
          type: 'bubble',
          size: 'mega',
          header: {
            type: 'box',
            layout: 'vertical',
            contents: [
              { type: 'text', text: '🔔 台股即將開盤', size: 'xl', weight: 'bold', color: '#ffffff' },
              { type: 'text', text: `${today} ${openTime}`, size: 'sm', color: '#ffffffaa', margin: 'sm' }
            ],
            backgroundColor: '#D32F2F',
            paddingAll: '20px'
          },
          body: {
            type: 'box',
            layout: 'vertical',
            contents: [
              {
                type: 'text',
                text: `📦 持股：${holdings.rows.length} 檔`,
                size: 'md',
                weight: 'bold'
              },
              holdings.rows.length > 0 ? {
                type: 'text',
                text: holdings.rows.slice(0, 5).map(h => h.stock_name || h.stock_id).join('、'),
                size: 'sm',
                color: '#666666',
                wrap: true,
                margin: 'sm'
              } : { type: 'filler' },
              { type: 'separator', margin: 'lg' },
              {
                type: 'text',
                text: `👀 監控：${watchlist.rows.length} 檔`,
                size: 'md',
                weight: 'bold',
                margin: 'lg'
              },
              watchlist.rows.length > 0 ? {
                type: 'text',
                text: watchlist.rows.slice(0, 8).map(w => w.stock_id).join('、'),
                size: 'sm',
                color: '#666666',
                wrap: true,
                margin: 'sm'
              } : { type: 'filler' },
              { type: 'separator', margin: 'lg' },
              {
                type: 'box',
                layout: 'vertical',
                margin: 'lg',
                contents: [
                  { type: 'text', text: '💡 快速指令', size: 'sm', color: '#888888' },
                  { type: 'text', text: '「績效」「持股」「大盤」', size: 'sm', margin: 'sm' }
                ]
              }
            ],
            paddingAll: '20px'
          },
          footer: {
            type: 'box',
            layout: 'horizontal',
            contents: [
              {
                type: 'button',
                action: { type: 'message', label: '📊 大盤', text: '大盤' },
                style: 'secondary',
                height: 'sm',
                flex: 1
              },
              {
                type: 'button',
                action: { type: 'message', label: '💼 持股', text: '持股' },
                style: 'secondary',
                height: 'sm',
                flex: 1,
                margin: 'sm'
              },
              {
                type: 'button',
                action: { type: 'message', label: '📈 績效', text: '績效' },
                style: 'primary',
                height: 'sm',
                flex: 1,
                margin: 'sm'
              }
            ],
            paddingAll: '15px'
          }
        }
      };

      await lineService.sendFlexMessage(userId, flexMessage);
      console.log('   ✅ 台股開盤提醒已發送');

    } catch (error) {
      console.error('❌ 台股開盤提醒錯誤:', error.message);
    }
  }

  /**
   * 🔔 檢查智能通知
   */
  async checkSmartAlerts() {
    console.log(`\n🔔 檢查智能通知 ${new Date().toLocaleString('zh-TW')}`);
    try {
      await smartAlertService.checkAllAlerts();
    } catch (error) {
      console.error('❌ 智能通知檢查錯誤:', error.message);
    }
  }

  /**
   * 📈 發送績效報告
   */
  async sendPerformanceReport() {
    console.log(`\n📈 發送績效報告 ${new Date().toLocaleString('zh-TW')}`);
    try {
      await performanceService.sendDailyReport('default');
    } catch (error) {
      console.error('❌ 績效報告錯誤:', error.message);
    }
  }

  /**
   * 🏦 更新三大法人資料
   */
  async updateInstitutionalData() {
    console.log(`\n🏦 更新三大法人資料 ${new Date().toLocaleString('zh-TW')}`);
    try {
      const results = await chipService.updateWatchlistInstitutional();
      console.log(`   ✅ 更新 ${results.length} 檔股票的三大法人資料`);
      
      // 發送三大法人異動通知（外資/投信大買或大賣）
      await this.sendInstitutionalAlerts(results);
    } catch (error) {
      console.error('❌ 三大法人更新錯誤:', error.message);
    }
  }

  /**
   * 發送三大法人異動通知
   */
  async sendInstitutionalAlerts(dataList) {
    if (!dataList || dataList.length === 0) return;

    const alerts = [];
    
    for (const data of dataList) {
      // 外資單日買超 5000 張以上
      if (data.foreign.net >= 5000000) {
        alerts.push({
          stockId: data.stockId,
          stockName: data.stockName,
          type: 'foreign_buy',
          message: `🏦 外資大買 ${Math.round(data.foreign.net / 1000)} 張`
        });
      }
      // 外資單日賣超 5000 張以上
      if (data.foreign.net <= -5000000) {
        alerts.push({
          stockId: data.stockId,
          stockName: data.stockName,
          type: 'foreign_sell',
          message: `🏦 外資大賣 ${Math.round(Math.abs(data.foreign.net) / 1000)} 張`
        });
      }
      // 投信單日買超 1000 張以上
      if (data.trust.net >= 1000000) {
        alerts.push({
          stockId: data.stockId,
          stockName: data.stockName,
          type: 'trust_buy',
          message: `🏛️ 投信大買 ${Math.round(data.trust.net / 1000)} 張`
        });
      }
    }

    if (alerts.length > 0) {
      // 建立通知訊息
      const message = `🏦 三大法人異動通知\n` +
        `━━━━━━━━━━━━\n` +
        alerts.map(a => `${a.stockName}(${a.stockId})\n${a.message}`).join('\n\n');
      
      await lineService.broadcastMessage({ type: 'text', text: message });
      console.log(`   📤 發送 ${alerts.length} 個三大法人異動通知`);
    }
  }

  /**
   * 🇺🇸 排程美股開盤提醒（根據設定）
   */
  async scheduleUSMarketReminder() {
    try {
      const settings = await this.getSettings();
      const reminderMinutes = parseInt(settings.us_market_reminder) || 60;
      
      // 如果設定為 0，不發送
      if (reminderMinutes === 0) {
        console.log('🇺🇸 美股開盤提醒已關閉');
        return;
      }

      // 美股開盤 22:30（冬令）
      // 現在是 21:00，要等到 (90 - reminderMinutes) 分鐘後發送
      const waitMinutes = 90 - reminderMinutes;
      const waitMs = waitMinutes * 60 * 1000;

      if (waitMinutes <= 0) {
        // 如果設定 90 分鐘，立即發送
        console.log(`🇺🇸 美股開盤提醒：設定 ${reminderMinutes} 分鐘前，立即發送`);
        await this.sendUSMarketOpenAlert();
      } else {
        console.log(`🇺🇸 美股開盤提醒：設定 ${reminderMinutes} 分鐘前，將在 ${waitMinutes} 分鐘後發送`);
        setTimeout(async () => {
          await this.sendUSMarketOpenAlert();
        }, waitMs);
      }
    } catch (error) {
      console.error('❌ 排程美股開盤提醒錯誤:', error.message);
    }
  }

  /**
   * 🇺🇸 發送美股開盤提示
   */
  async sendUSMarketOpenAlert() {
    console.log('\n🇺🇸 美股即將開盤提示...');

    try {
      // 取得美股指數
      const indices = await stockService.getUSIndices();
      
      if (!indices || indices.length === 0) {
        console.log('   ⚠️ 無法取得美股指數');
        return;
      }

      // 取得 LINE User ID
      const result = await pool.query(
        "SELECT value FROM settings WHERE key = 'line_user_id'"
      );
      const userId = result.rows[0]?.value || process.env.LINE_USER_ID;

      if (!userId) {
        console.log('   ⚠️ 未設定 LINE User ID');
        return;
      }

      // 建立美股開盤提示 Flex Message
      const indexRows = indices.map(idx => {
        const isUp = idx.change >= 0;
        const color = isUp ? '#00C851' : '#ff4444'; // 美股：綠漲紅跌
        const arrow = isUp ? '▲' : '▼';
        
        return {
          type: 'box',
          layout: 'horizontal',
          contents: [
            { type: 'text', text: idx.name, size: 'sm', flex: 3 },
            { type: 'text', text: `${idx.price.toLocaleString()}`, size: 'sm', align: 'end', flex: 2 },
            { type: 'text', text: `${arrow}${idx.changePercent}%`, size: 'sm', color: color, align: 'end', flex: 2 }
          ],
          margin: 'sm'
        };
      });

      const flexMessage = {
        type: 'flex',
        altText: '🇺🇸 美股即將開盤',
        contents: {
          type: 'bubble',
          size: 'mega',
          header: {
            type: 'box',
            layout: 'vertical',
            contents: [
              { type: 'text', text: '🇺🇸 美股即將開盤', size: 'xl', weight: 'bold', color: '#ffffff' },
              { type: 'text', text: '22:30 正式開盤（冬令時間）', size: 'xs', color: '#ffffffaa', margin: 'sm' }
            ],
            backgroundColor: '#1a1a2e',
            paddingAll: '20px'
          },
          body: {
            type: 'box',
            layout: 'vertical',
            contents: [
              { type: 'text', text: '📊 盤前指數（綠漲紅跌）', size: 'sm', color: '#888888', weight: 'bold' },
              { type: 'separator', margin: 'md' },
              ...indexRows,
              { type: 'separator', margin: 'lg' },
              { type: 'text', text: '💡 輸入美股代碼如 AAPL 查詢', size: 'xs', color: '#888888', margin: 'lg' }
            ],
            paddingAll: '20px'
          },
          footer: {
            type: 'box',
            layout: 'horizontal',
            contents: [
              { type: 'text', text: `⏰ ${new Date().toLocaleTimeString('zh-TW', { timeZone: 'Asia/Taipei' })}`, size: 'xs', color: '#888888' }
            ],
            paddingAll: '15px'
          }
        }
      };

      await lineService.sendFlexMessage(userId, flexMessage);
      console.log('   ✅ 美股開盤提示已發送');

    } catch (error) {
      console.error('❌ 美股開盤提示錯誤:', error);
    }
  }

  /**
   * 🇺🇸 檢查美股（盤中監控）
   */
  async checkUSStocks() {
    console.log(`\n🇺🇸 檢查美股 ${new Date().toLocaleString('zh-TW')}`);

    try {
      // 取得監控清單中的美股
      const watchlist = await this.getWatchlist();
      const usStocks = watchlist.filter(w => /^[A-Za-z]{1,5}$/.test(w.stock_id));
      
      if (usStocks.length === 0) {
        console.log('   沒有監控美股');
        return;
      }

      console.log(`   監控 ${usStocks.length} 檔美股`);

      const settings = await this.getSettings();
      const threshold = parseFloat(settings.us_price_threshold) || parseFloat(settings.price_threshold) || 3;
      const alerts = [];

      for (const stock of usStocks) {
        const stockData = await stockService.getUSStockPrice(stock.stock_id);
        
        if (!stockData) continue;

        // 儲存價格歷史
        await stockService.savePriceHistory(stockData);

        const customThreshold = stock.custom_threshold 
          ? parseFloat(stock.custom_threshold) 
          : threshold;

        const absChange = Math.abs(parseFloat(stockData.changePercent));

        // 檢查漲跌幅
        if (absChange >= customThreshold) {
          alerts.push({
            type: 'US_PRICE_CHANGE',
            stock: stockData,
            message: `${stockData.changePercent > 0 ? '🚀 大漲' : '📉 大跌'} ${absChange}%`
          });
        }

        await this.sleep(500);
      }

      // 發送警報
      if (alerts.length > 0) {
        console.log(`   🚨 ${alerts.length} 個美股警報`);
        await this.sendUSAlerts(alerts);
      } else {
        console.log('   ✅ 沒有美股警報');
      }

    } catch (error) {
      console.error('❌ 檢查美股錯誤:', error);
    }
  }

  /**
   * 🇺🇸 發送美股警報
   */
  async sendUSAlerts(alerts) {
    const result = await pool.query(
      "SELECT value FROM settings WHERE key = 'line_user_id'"
    );
    const userId = result.rows[0]?.value || process.env.LINE_USER_ID;

    if (!userId) {
      console.log('⚠️ 未設定 LINE User ID，無法推播');
      return;
    }

    for (const alert of alerts) {
      const stock = alert.stock;
      const isUp = stock.change >= 0;
      // 美股：綠漲紅跌
      const color = isUp ? '#00C851' : '#ff4444';
      const arrow = isUp ? '▲' : '▼';

      const flexMessage = {
        type: 'flex',
        altText: `🇺🇸 ${stock.name} ${alert.message}`,
        contents: {
          type: 'bubble',
          size: 'mega',
          header: {
            type: 'box',
            layout: 'vertical',
            contents: [
              {
                type: 'box',
                layout: 'horizontal',
                contents: [
                  { type: 'text', text: `🇺🇸 ${stock.name}`, color: '#ffffff', size: 'xl', weight: 'bold', flex: 1 },
                  { type: 'text', text: stock.id, color: '#ffffffaa', size: 'sm', align: 'end' }
                ]
              },
              { type: 'text', text: alert.message, color: '#ffffff', size: 'sm', margin: 'md' }
            ],
            backgroundColor: color,
            paddingAll: '20px'
          },
          body: {
            type: 'box',
            layout: 'vertical',
            contents: [
              {
                type: 'box',
                layout: 'horizontal',
                contents: [
                  { type: 'text', text: `$${stock.price.toFixed(2)}`, size: 'xxl', weight: 'bold', color: color },
                  { type: 'text', text: `${arrow} ${stock.changePercent}%`, size: 'lg', color: color, align: 'end', gravity: 'bottom' }
                ]
              },
              { type: 'separator', margin: 'lg' },
              { type: 'text', text: '💡 美股綠漲紅跌', size: 'xs', color: '#888888', margin: 'lg' }
            ],
            paddingAll: '20px'
          },
          footer: {
            type: 'box',
            layout: 'horizontal',
            contents: [
              { type: 'text', text: `⏰ ${new Date().toLocaleTimeString('zh-TW', { timeZone: 'Asia/Taipei' })}`, size: 'xs', color: '#888888' }
            ],
            paddingAll: '15px'
          }
        }
      };

      await lineService.sendFlexMessage(userId, flexMessage);
      await this.sleep(1000);
    }
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
   * 📈 發送持股收盤摘要
   */
  async sendHoldingsSummary() {
    console.log('\n💼 產生持股收盤摘要...');

    try {
      // 檢查是否啟用
      const settings = await this.getSettings();
      if (settings.holdings_summary_enabled === 'false') {
        console.log('   持股摘要已關閉');
        return;
      }

      // 取得持股
      const holdingsResult = await pool.query(
        "SELECT * FROM holdings WHERE user_id = 'default' AND is_won = true AND (is_sold = false OR is_sold IS NULL)"
      );

      if (holdingsResult.rows.length === 0) {
        console.log('   沒有持股');
        return;
      }

      const holdings = [];
      let totalCost = 0;
      let totalValue = 0;

      for (const row of holdingsResult.rows) {
        const stockData = await stockService.getRealtimePrice(row.stock_id);
        if (stockData) {
          const lots = parseInt(row.lots) || 0;
          const oddShares = parseInt(row.odd_shares) || 0;
          const totalShares = lots * 1000 + oddShares;
          const costPrice = parseFloat(row.won_price) || 0;
          const cost = costPrice * totalShares;
          const value = stockData.price * totalShares;
          const profit = value - cost;
          const profitPercent = cost > 0 ? ((profit / cost) * 100).toFixed(2) : 0;
          
          // 🔧 修正：顯示格式「名稱(代碼)」
          const stockName = row.stock_name || stockData.name || row.stock_id;
          const displayName = `${stockName}(${row.stock_id})`;

          holdings.push({
            stockId: row.stock_id,
            stockName: displayName,
            currentPrice: stockData.price,
            change: stockData.change || 0,
            changePercent: stockData.changePercent || 0,
            costPrice,
            profit,
            profitPercent,
            lots,
            oddShares
          });

          totalCost += cost;
          totalValue += value;
        }
        await this.sleep(300);
      }

      if (holdings.length === 0) return;

      // 排序：今日漲跌幅
      holdings.sort((a, b) => parseFloat(b.changePercent) - parseFloat(a.changePercent));

      const totalProfit = totalValue - totalCost;
      const totalProfitPercent = totalCost > 0 ? ((totalProfit / totalCost) * 100).toFixed(2) : 0;

      // 建立 Flex Message
      const upCount = holdings.filter(h => parseFloat(h.changePercent) > 0).length;
      const downCount = holdings.filter(h => parseFloat(h.changePercent) < 0).length;
      const isProfit = totalProfit >= 0;

      // 🔀 雙軌設計：讀取閾值（預設 8）
      const cardThreshold = parseInt(settings.holdings_card_threshold) || 8;
      console.log(`   🔀 持股 ${holdings.length} 檔, 閾值 ${cardThreshold} → ${holdings.length <= cardThreshold ? '單卡模式' : '輪播模式'}`);

      let flexMessage;

      if (holdings.length <= cardThreshold) {
        // ========================================
        // ✅ 原設計：單一 bubble（持股 ≤ 閾值）
        // ========================================
        const stockRows = holdings.map(h => {
          const dayUp = parseFloat(h.changePercent) >= 0;
          const holdUp = parseFloat(h.profitPercent) >= 0;
          return {
            type: 'box',
            layout: 'horizontal',
            contents: [
              { type: 'text', text: h.stockName, size: 'sm', flex: 3 },
              { type: 'text', text: '$' + h.currentPrice, size: 'sm', flex: 2, align: 'end' },
              { type: 'text', text: (dayUp ? '▲' : '▼') + h.changePercent + '%', size: 'sm', flex: 2, align: 'end', color: dayUp ? '#D32F2F' : '#388E3C' },
              { type: 'text', text: (holdUp ? '+' : '') + h.profitPercent + '%', size: 'sm', flex: 2, align: 'end', color: holdUp ? '#D32F2F' : '#388E3C' }
            ],
            margin: 'sm'
          };
        });

        flexMessage = {
          type: 'flex',
          altText: '💼 持股收盤摘要 ' + (isProfit ? '📈' : '📉') + ' ' + totalProfitPercent + '%',
          contents: {
            type: 'bubble',
            size: 'mega',
            header: {
              type: 'box',
              layout: 'vertical',
              contents: [
                { type: 'text', text: '💼 持股收盤摘要', size: 'lg', weight: 'bold', color: '#ffffff' },
                { type: 'text', text: new Date().toLocaleDateString('zh-TW') + ' 收盤', size: 'sm', color: '#ffffffaa', margin: 'sm' }
              ],
              backgroundColor: isProfit ? '#D32F2F' : '#388E3C',
              paddingAll: '20px'
            },
            body: {
              type: 'box',
              layout: 'vertical',
              contents: [
                {
                  type: 'box',
                  layout: 'horizontal',
                  contents: [
                    { type: 'text', text: '總損益', size: 'sm', color: '#666666' },
                    { type: 'text', text: (isProfit ? '+' : '') + '$' + Math.round(totalProfit).toLocaleString() + ' (' + totalProfitPercent + '%)', size: 'lg', weight: 'bold', color: isProfit ? '#D32F2F' : '#388E3C', align: 'end' }
                  ]
                },
                {
                  type: 'box',
                  layout: 'horizontal',
                  margin: 'md',
                  contents: [
                    { type: 'text', text: '📈 ' + upCount + ' 漲', size: 'sm', color: '#D32F2F' },
                    { type: 'text', text: '📉 ' + downCount + ' 跌', size: 'sm', color: '#388E3C', margin: 'lg' }
                  ]
                },
                { type: 'separator', margin: 'lg' },
                {
                  type: 'box',
                  layout: 'horizontal',
                  margin: 'lg',
                  contents: [
                    { type: 'text', text: '股票', size: 'xs', color: '#888888', flex: 3 },
                    { type: 'text', text: '現價', size: 'xs', color: '#888888', flex: 2, align: 'end' },
                    { type: 'text', text: '今日', size: 'xs', color: '#888888', flex: 2, align: 'end' },
                    { type: 'text', text: '持股', size: 'xs', color: '#888888', flex: 2, align: 'end' }
                  ]
                },
                ...stockRows
              ],
              paddingAll: '20px'
            }
          }
        };

      } else {
        // ========================================
        // 🔀 輪播模式：carousel（持股 > 閾值）
        // ========================================
        const STOCKS_PER_PAGE = 5;
        const MAX_BUBBLES = 12; // LINE carousel 上限
        const totalPages = Math.min(Math.ceil(holdings.length / STOCKS_PER_PAGE), MAX_BUBBLES - 1);
        const bubbles = [];

        // 📊 第 1 頁：總覽摘要
        bubbles.push({
          type: 'bubble',
          size: 'mega',
          header: {
            type: 'box',
            layout: 'vertical',
            contents: [
              { type: 'text', text: '💼 持股收盤摘要', size: 'lg', weight: 'bold', color: '#ffffff' },
              { type: 'text', text: new Date().toLocaleDateString('zh-TW') + ' 收盤', size: 'sm', color: '#ffffffaa', margin: 'sm' }
            ],
            backgroundColor: isProfit ? '#D32F2F' : '#388E3C',
            paddingAll: '20px'
          },
          body: {
            type: 'box',
            layout: 'vertical',
            contents: [
              {
                type: 'box',
                layout: 'horizontal',
                contents: [
                  { type: 'text', text: '總損益', size: 'sm', color: '#666666' },
                  { type: 'text', text: (isProfit ? '+' : '') + '$' + Math.round(totalProfit).toLocaleString() + ' (' + totalProfitPercent + '%)', size: 'lg', weight: 'bold', color: isProfit ? '#D32F2F' : '#388E3C', align: 'end' }
                ]
              },
              {
                type: 'box',
                layout: 'horizontal',
                margin: 'md',
                contents: [
                  { type: 'text', text: '📈 ' + upCount + ' 漲', size: 'sm', color: '#D32F2F' },
                  { type: 'text', text: '📉 ' + downCount + ' 跌', size: 'sm', color: '#388E3C', margin: 'lg' }
                ]
              },
              { type: 'separator', margin: 'lg' },
              {
                type: 'box',
                layout: 'vertical',
                margin: 'lg',
                contents: [
                  { type: 'text', text: '📋 共 ' + holdings.length + ' 檔持股', size: 'md', weight: 'bold', color: '#333333' },
                  { type: 'text', text: '📊 總成本 $' + Math.round(totalCost).toLocaleString(), size: 'sm', color: '#666666', margin: 'sm' },
                  { type: 'text', text: '💰 總市值 $' + Math.round(totalValue).toLocaleString(), size: 'sm', color: '#666666', margin: 'sm' },
                  { type: 'text', text: '👉 左滑查看個股明細', size: 'sm', color: '#2196F3', margin: 'lg' }
                ]
              }
            ],
            paddingAll: '20px'
          }
        });

        // 📄 第 2~N 頁：每頁 5 檔個股
        for (let page = 0; page < totalPages; page++) {
          const startIdx = page * STOCKS_PER_PAGE;
          const endIdx = Math.min(startIdx + STOCKS_PER_PAGE, holdings.length);
          const pageHoldings = holdings.slice(startIdx, endIdx);

          const pageRows = [];
          // 表頭
          pageRows.push({
            type: 'box',
            layout: 'horizontal',
            contents: [
              { type: 'text', text: '股票', size: 'xs', color: '#888888', flex: 3 },
              { type: 'text', text: '現價', size: 'xs', color: '#888888', flex: 2, align: 'end' },
              { type: 'text', text: '今日', size: 'xs', color: '#888888', flex: 2, align: 'end' },
              { type: 'text', text: '持股', size: 'xs', color: '#888888', flex: 2, align: 'end' }
            ]
          });

          // 個股資料
          for (const h of pageHoldings) {
            const dayUp = parseFloat(h.changePercent) >= 0;
            const holdUp = parseFloat(h.profitPercent) >= 0;
            pageRows.push({
              type: 'box',
              layout: 'horizontal',
              contents: [
                { type: 'text', text: h.stockName, size: 'sm', flex: 3 },
                { type: 'text', text: '$' + h.currentPrice, size: 'sm', flex: 2, align: 'end' },
                { type: 'text', text: (dayUp ? '▲' : '▼') + h.changePercent + '%', size: 'sm', flex: 2, align: 'end', color: dayUp ? '#D32F2F' : '#388E3C' },
                { type: 'text', text: (holdUp ? '+' : '') + h.profitPercent + '%', size: 'sm', flex: 2, align: 'end', color: holdUp ? '#D32F2F' : '#388E3C' }
              ],
              margin: 'sm'
            });
          }

          bubbles.push({
            type: 'bubble',
            size: 'mega',
            header: {
              type: 'box',
              layout: 'vertical',
              contents: [
                { type: 'text', text: '📄 第 ' + (page + 1) + '/' + totalPages + ' 頁', size: 'md', weight: 'bold', color: '#ffffff' },
                { type: 'text', text: (startIdx + 1) + '~' + endIdx + ' / ' + holdings.length + ' 檔', size: 'sm', color: '#ffffffaa', margin: 'sm' }
              ],
              backgroundColor: '#37474F',
              paddingAll: '15px'
            },
            body: {
              type: 'box',
              layout: 'vertical',
              contents: pageRows,
              paddingAll: '15px'
            }
          });
        }

        // 限制 carousel 最多 12 個 bubble
        const finalBubbles = bubbles.slice(0, 12);

        flexMessage = {
          type: 'flex',
          altText: '💼 持股收盤摘要 ' + (isProfit ? '📈' : '📉') + ' ' + totalProfitPercent + '% (' + holdings.length + '檔)',
          contents: {
            type: 'carousel',
            contents: finalBubbles
          }
        };

        console.log(`   📄 輪播模式：${finalBubbles.length} 頁 (${holdings.length} 檔持股)`);
      }


      // 發送
      const result = await pool.query("SELECT value FROM settings WHERE key = 'line_user_id'");
      const userId = result.rows[0]?.value || process.env.LINE_USER_ID;

      if (userId) {
        await lineService.sendFlexMessage(userId, flexMessage);
        console.log('   ✅ 持股摘要已發送');
      }

    } catch (error) {
      console.error('❌ 持股摘要錯誤:', error);
    }
  }

  /**
   * 🎯 檢查停利停損目標價
   */
  async checkStopLossTargets() {
    console.log('\n🎯 檢查停利停損...');

    try {
      // 取得有設定目標價的持股
      const result = await pool.query(`
        SELECT * FROM holdings 
        WHERE user_id = 'default' 
        AND is_won = true 
        AND (is_sold = false OR is_sold IS NULL)
        AND notify_enabled = true
        AND (target_price_high IS NOT NULL OR target_price_low IS NOT NULL)
      `);

      if (result.rows.length === 0) {
        console.log('   沒有需要監控的持股');
        return;
      }

      const alerts = [];

      for (const row of result.rows) {
        const stockData = await stockService.getRealtimePrice(row.stock_id);
        if (!stockData) continue;

        const currentPrice = stockData.price;
        const stockName = row.stock_name || row.stock_id;
        const lots = parseInt(row.lots) || 0;
        const oddShares = parseInt(row.odd_shares) || 0;
        const totalShares = lots * 1000 + oddShares;
        const costPrice = parseFloat(row.won_price) || 0;
        const profit = (currentPrice - costPrice) * totalShares;

        // 檢查停利（上漲目標）
        if (row.target_price_high && currentPrice >= parseFloat(row.target_price_high)) {
          alerts.push({
            type: 'high',
            stockId: row.stock_id,
            stockName,
            currentPrice,
            targetPrice: row.target_price_high,
            costPrice,
            profit,
            profitPercent: costPrice > 0 ? ((currentPrice - costPrice) / costPrice * 100).toFixed(2) : 0
          });
        }

        // 檢查停損（下跌目標）
        if (row.target_price_low && currentPrice <= parseFloat(row.target_price_low)) {
          alerts.push({
            type: 'low',
            stockId: row.stock_id,
            stockName,
            currentPrice,
            targetPrice: row.target_price_low,
            costPrice,
            profit,
            profitPercent: costPrice > 0 ? ((currentPrice - costPrice) / costPrice * 100).toFixed(2) : 0
          });
        }

        await this.sleep(300);
      }

      if (alerts.length === 0) {
        console.log('   沒有觸發目標價');
        return;
      }

      console.log('   🔔 觸發 ' + alerts.length + ' 個目標價');

      // 發送通知
      const userId = await this.getLineUserId();
      if (!userId) return;

      for (const alert of alerts) {
        const isHigh = alert.type === 'high';
        const isProfit = alert.profit >= 0;

        const flexMessage = {
          type: 'flex',
          altText: (isHigh ? '🎯 停利提醒' : '⚠️ 停損提醒') + ' ' + alert.stockName,
          contents: {
            type: 'bubble',
            size: 'kilo',
            header: {
              type: 'box',
              layout: 'vertical',
              contents: [
                { type: 'text', text: isHigh ? '🎯 停利提醒' : '⚠️ 停損提醒', size: 'lg', weight: 'bold', color: '#ffffff' },
                { type: 'text', text: alert.stockName + ' (' + alert.stockId + ')', size: 'sm', color: '#ffffffcc', margin: 'sm' }
              ],
              backgroundColor: isHigh ? '#D32F2F' : '#FF9800',
              paddingAll: '15px'
            },
            body: {
              type: 'box',
              layout: 'vertical',
              contents: [
                {
                  type: 'box',
                  layout: 'horizontal',
                  contents: [
                    { type: 'text', text: '目前價格', size: 'sm', color: '#666666' },
                    { type: 'text', text: '$' + alert.currentPrice, size: 'lg', weight: 'bold', align: 'end' }
                  ]
                },
                {
                  type: 'box',
                  layout: 'horizontal',
                  margin: 'md',
                  contents: [
                    { type: 'text', text: isHigh ? '停利目標' : '停損目標', size: 'sm', color: '#666666' },
                    { type: 'text', text: '$' + alert.targetPrice, size: 'sm', align: 'end', color: isHigh ? '#D32F2F' : '#FF9800' }
                  ]
                },
                { type: 'separator', margin: 'lg' },
                {
                  type: 'box',
                  layout: 'horizontal',
                  margin: 'lg',
                  contents: [
                    { type: 'text', text: '成本價', size: 'sm', color: '#666666' },
                    { type: 'text', text: '$' + alert.costPrice, size: 'sm', align: 'end' }
                  ]
                },
                {
                  type: 'box',
                  layout: 'horizontal',
                  margin: 'md',
                  contents: [
                    { type: 'text', text: '損益', size: 'sm', color: '#666666' },
                    { type: 'text', text: (isProfit ? '+' : '') + '$' + Math.round(alert.profit).toLocaleString() + ' (' + alert.profitPercent + '%)', size: 'sm', weight: 'bold', align: 'end', color: isProfit ? '#D32F2F' : '#388E3C' }
                  ]
                }
              ],
              paddingAll: '15px'
            }
          }
        };

        await lineService.sendFlexMessage(userId, flexMessage);
        
        // 關閉這個目標的通知（避免重複發送）
        if (isHigh) {
          await pool.query('UPDATE holdings SET target_price_high = NULL WHERE id = $1', [result.rows.find(r => r.stock_id === alert.stockId)?.id]);
        } else {
          await pool.query('UPDATE holdings SET target_price_low = NULL WHERE id = $1', [result.rows.find(r => r.stock_id === alert.stockId)?.id]);
        }

        await this.sleep(500);
      }

      console.log('   ✅ 已發送 ' + alerts.length + ' 個提醒');

    } catch (error) {
      console.error('❌ 停利停損檢查錯誤:', error);
    }
  }

  /**
   * 取得 LINE User ID
   */
  async getLineUserId() {
    const result = await pool.query("SELECT value FROM settings WHERE key = 'line_user_id'");
    return result.rows[0]?.value || process.env.LINE_USER_ID;
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
