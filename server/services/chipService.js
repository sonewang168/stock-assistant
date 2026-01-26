/**
 * 📊 籌碼分析服務
 * 三大法人買賣超 - 從 TWSE 抓取真實數據
 */

const axios = require('axios');
const { pool } = require('../db');

class ChipService {

  /**
   * 從 TWSE 抓取個股三大法人買賣超
   * @param {string} stockId - 股票代碼
   * @param {string} date - 日期 YYYYMMDD（可選，預設最近交易日）
   */
  async fetchInstitutionalFromTWSE(stockId, date = null) {
    try {
      // 計算查詢日期（如果是週末，回推到週五）
      if (!date) {
        const today = new Date();
        today.setHours(today.getHours() + 8); // 台灣時區
        
        const dayOfWeek = today.getDay();
        // 週日回推 2 天到週五
        if (dayOfWeek === 0) {
          today.setDate(today.getDate() - 2);
        }
        // 週六回推 1 天到週五
        else if (dayOfWeek === 6) {
          today.setDate(today.getDate() - 1);
        }
        
        date = today.toISOString().slice(0, 10).replace(/-/g, '');
      }

      console.log(`📡 查詢 TWSE 三大法人: ${stockId}, 日期: ${date}`);

      // TWSE 三大法人買賣超 API
      const url = `https://www.twse.com.tw/rwd/zh/fund/T86?date=${date}&selectType=ALLBUT0999&response=json`;
      
      const response = await axios.get(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept': 'application/json'
        },
        timeout: 15000
      });

      if (response.data && response.data.data) {
        const stockData = response.data.data.find(row => row[0] === stockId);
        
        if (stockData) {
          const parseNum = (str) => parseInt(String(str).replace(/,/g, '')) || 0;
          
          return {
            stockId: stockData[0],
            stockName: stockData[1],
            date: `${date.slice(0,4)}-${date.slice(4,6)}-${date.slice(6,8)}`,
            foreign: {
              buy: parseNum(stockData[2]),
              sell: parseNum(stockData[3]),
              net: parseNum(stockData[4])
            },
            trust: {
              buy: parseNum(stockData[5]),
              sell: parseNum(stockData[6]),
              net: parseNum(stockData[7])
            },
            dealer: {
              buy: parseNum(stockData[8]) + parseNum(stockData[11]),
              sell: parseNum(stockData[9]) + parseNum(stockData[12]),
              net: parseNum(stockData[10]) + parseNum(stockData[13])
            },
            totalNet: parseNum(stockData[4]) + parseNum(stockData[7]) + parseNum(stockData[10]) + parseNum(stockData[13])
          };
        } else {
          console.log(`⚠️ TWSE 資料中找不到 ${stockId}`);
        }
      } else {
        console.log(`⚠️ TWSE 回傳無資料，可能是假日或尚未更新`);
        
        // 如果當日無資料，嘗試往前一天查詢（最多嘗試 5 天）
        const dateObj = new Date(`${date.slice(0,4)}-${date.slice(4,6)}-${date.slice(6,8)}`);
        for (let i = 0; i < 5; i++) {
          dateObj.setDate(dateObj.getDate() - 1);
          const prevDate = dateObj.toISOString().slice(0, 10).replace(/-/g, '');
          console.log(`   嘗試查詢 ${prevDate}...`);
          
          const prevResult = await this.fetchInstitutionalFromTWSE(stockId, prevDate);
          if (prevResult) {
            return prevResult;
          }
          
          await new Promise(r => setTimeout(r, 500));
        }
      }
      
      return null;
    } catch (error) {
      console.error('抓取 TWSE 三大法人失敗:', error.message);
      return null;
    }
  }

  /**
   * 取得三大法人買賣超（優先從資料庫，沒有則抓取）
   */
  async getInstitutionalTrading(stockId, days = 5) {
    try {
      // 1. 先查詢資料庫
      let dbResult = await pool.query(`
        SELECT * FROM institutional_trading 
        WHERE stock_id = $1 
        ORDER BY trade_date DESC 
        LIMIT $2
      `, [stockId, days]);

      // 2. 檢查是否需要抓取新資料
      const now = new Date();
      const hour = now.getHours();
      const dayOfWeek = now.getDay();
      const today = now.toISOString().slice(0, 10);
      
      // 判斷是否為交易時間後（15:00 後資料才會更新）
      const isAfterUpdate = hour >= 15;
      // 判斷是否為交易日（週一到週五）
      const isWeekday = dayOfWeek >= 1 && dayOfWeek <= 5;
      
      const hasToday = dbResult.rows.some(row => 
        row.trade_date.toISOString().slice(0, 10) === today
      );

      // 3. 如果是交易日且已過更新時間，但沒有今天的資料，嘗試抓取
      if (isWeekday && isAfterUpdate && !hasToday) {
        console.log(`📡 嘗試從 TWSE 抓取 ${stockId} 的三大法人資料...`);
        const freshData = await this.fetchInstitutionalFromTWSE(stockId);
        if (freshData) {
          await this.saveInstitutionalData(freshData);
          // 重新查詢
          dbResult = await pool.query(`
            SELECT * FROM institutional_trading 
            WHERE stock_id = $1 
            ORDER BY trade_date DESC 
            LIMIT $2
          `, [stockId, days]);
        }
      }

      // 4. 如果資料庫有資料，返回（即使是舊資料）
      if (dbResult.rows.length > 0) {
        return this.formatInstitutionalData(dbResult.rows);
      }

      // 5. 資料庫沒資料，嘗試抓取（任何時間）
      console.log(`📡 資料庫無資料，嘗試從 TWSE 抓取 ${stockId}...`);
      const freshData = await this.fetchInstitutionalFromTWSE(stockId);
      if (freshData) {
        await this.saveInstitutionalData(freshData);
        const newResult = await pool.query(`
          SELECT * FROM institutional_trading 
          WHERE stock_id = $1 
          ORDER BY trade_date DESC 
          LIMIT $2
        `, [stockId, days]);
        if (newResult.rows.length > 0) {
          return this.formatInstitutionalData(newResult.rows);
        }
      }

      // 6. 真的沒資料
      return null;
    } catch (error) {
      console.error('取得三大法人資料失敗:', error.message);
      return null;
    }
  }

  /**
   * 儲存三大法人資料到資料庫
   */
  async saveInstitutionalData(data) {
    try {
      await pool.query(`
        INSERT INTO institutional_trading 
        (stock_id, trade_date, foreign_buy, foreign_sell, foreign_net, 
         trust_buy, trust_sell, trust_net, dealer_buy, dealer_sell, dealer_net, total_net)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
        ON CONFLICT (stock_id, trade_date) 
        DO UPDATE SET 
          foreign_buy = EXCLUDED.foreign_buy,
          foreign_sell = EXCLUDED.foreign_sell,
          foreign_net = EXCLUDED.foreign_net,
          trust_buy = EXCLUDED.trust_buy,
          trust_sell = EXCLUDED.trust_sell,
          trust_net = EXCLUDED.trust_net,
          dealer_buy = EXCLUDED.dealer_buy,
          dealer_sell = EXCLUDED.dealer_sell,
          dealer_net = EXCLUDED.dealer_net,
          total_net = EXCLUDED.total_net
      `, [
        data.stockId, data.date,
        data.foreign.buy, data.foreign.sell, data.foreign.net,
        data.trust.buy, data.trust.sell, data.trust.net,
        data.dealer.buy, data.dealer.sell, data.dealer.net,
        data.totalNet
      ]);
      return true;
    } catch (error) {
      console.error('儲存三大法人資料失敗:', error.message);
      return false;
    }
  }

  /**
   * 格式化三大法人資料
   */
  formatInstitutionalData(rows) {
    if (!rows || rows.length === 0) return null;

    const formatShares = (num) => {
      const n = parseInt(num) || 0;
      if (Math.abs(n) >= 1000000) {
        return (n / 1000000).toFixed(2) + '百萬股';
      } else if (Math.abs(n) >= 1000) {
        return Math.round(n / 1000) + '張';
      }
      return n + '股';
    };

    const latest = rows[0];
    
    // 計算連續買賣超天數
    let foreignStreak = 0, trustStreak = 0, dealerStreak = 0;
    const foreignSign = Math.sign(latest.foreign_net);
    const trustSign = Math.sign(latest.trust_net);
    const dealerSign = Math.sign(latest.dealer_net);
    
    for (const row of rows) {
      if (Math.sign(row.foreign_net) === foreignSign && foreignSign !== 0) foreignStreak++;
      else break;
    }
    for (const row of rows) {
      if (Math.sign(row.trust_net) === trustSign && trustSign !== 0) trustStreak++;
      else break;
    }
    for (const row of rows) {
      if (Math.sign(row.dealer_net) === dealerSign && dealerSign !== 0) dealerStreak++;
      else break;
    }

    return {
      stockId: latest.stock_id,
      date: latest.trade_date,
      latest: {
        foreign: {
          buy: latest.foreign_buy,
          sell: latest.foreign_sell,
          net: latest.foreign_net,
          netText: formatShares(latest.foreign_net),
          streak: foreignStreak,
          streakText: foreignSign > 0 ? `連${foreignStreak}買` : foreignSign < 0 ? `連${foreignStreak}賣` : '持平'
        },
        trust: {
          buy: latest.trust_buy,
          sell: latest.trust_sell,
          net: latest.trust_net,
          netText: formatShares(latest.trust_net),
          streak: trustStreak,
          streakText: trustSign > 0 ? `連${trustStreak}買` : trustSign < 0 ? `連${trustStreak}賣` : '持平'
        },
        dealer: {
          buy: latest.dealer_buy,
          sell: latest.dealer_sell,
          net: latest.dealer_net,
          netText: formatShares(latest.dealer_net),
          streak: dealerStreak,
          streakText: dealerSign > 0 ? `連${dealerStreak}買` : dealerSign < 0 ? `連${dealerStreak}賣` : '持平'
        },
        totalNet: latest.total_net,
        totalNetText: formatShares(latest.total_net)
      },
      history: rows.map(row => ({
        date: row.trade_date,
        foreignNet: row.foreign_net,
        trustNet: row.trust_net,
        dealerNet: row.dealer_net,
        totalNet: row.total_net
      })),
      sum5Days: rows.length >= 5 ? {
        foreign: rows.slice(0, 5).reduce((sum, r) => sum + parseInt(r.foreign_net), 0),
        trust: rows.slice(0, 5).reduce((sum, r) => sum + parseInt(r.trust_net), 0),
        dealer: rows.slice(0, 5).reduce((sum, r) => sum + parseInt(r.dealer_net), 0)
      } : null
    };
  }

  /**
   * 批次更新監控股票的三大法人資料
   */
  async updateWatchlistInstitutional() {
    try {
      const watchlist = await pool.query(`
        SELECT DISTINCT stock_id FROM watchlist WHERE is_active = true
        UNION
        SELECT DISTINCT stock_id FROM holdings WHERE is_won = true
      `);

      const results = [];
      for (const row of watchlist.rows) {
        const data = await this.fetchInstitutionalFromTWSE(row.stock_id);
        if (data) {
          await this.saveInstitutionalData(data);
          results.push(data);
        }
        await new Promise(r => setTimeout(r, 300));
      }

      console.log(`✅ 更新 ${results.length} 檔股票的三大法人資料`);
      return results;
    } catch (error) {
      console.error('批次更新三大法人失敗:', error.message);
      return [];
    }
  }

  /**
   * 取得三大法人買賣超排行
   */
  async getTopInstitutionalRanking(type = 'foreign', direction = 'buy', limit = 10) {
    try {
      // 計算查詢日期（如果是週末，回推到週五）
      const today = new Date();
      today.setHours(today.getHours() + 8);
      
      const dayOfWeek = today.getDay();
      if (dayOfWeek === 0) {
        today.setDate(today.getDate() - 2); // 週日 → 週五
      } else if (dayOfWeek === 6) {
        today.setDate(today.getDate() - 1); // 週六 → 週五
      }
      
      // 嘗試最近 5 個交易日
      for (let i = 0; i < 5; i++) {
        const queryDate = new Date(today);
        queryDate.setDate(queryDate.getDate() - i);
        const date = queryDate.toISOString().slice(0, 10).replace(/-/g, '');
        
        console.log(`📡 查詢三大法人排行: ${date}`);
        
        const url = `https://www.twse.com.tw/rwd/zh/fund/T86?date=${date}&selectType=ALLBUT0999&response=json`;
        
        const response = await axios.get(url, {
          headers: { 'User-Agent': 'Mozilla/5.0' },
          timeout: 15000
        });

        if (response.data && response.data.data && response.data.data.length > 0) {
          const parseNum = (str) => parseInt(String(str).replace(/,/g, '')) || 0;
          const columnMap = { foreign: 4, trust: 7, dealer: 10 };
          const col = columnMap[type] || 4;
          
          let sorted = response.data.data
            .map(row => ({
              stockId: row[0],
              stockName: row[1],
              net: parseNum(row[col])
            }))
            .filter(item => item.stockId && /^\d{4}$/.test(item.stockId));

          if (direction === 'buy') {
            sorted = sorted.sort((a, b) => b.net - a.net).slice(0, limit);
          } else {
            sorted = sorted.sort((a, b) => a.net - b.net).slice(0, limit);
          }

          return { 
            date: `${date.slice(0,4)}-${date.slice(4,6)}-${date.slice(6,8)}`, 
            type, 
            direction, 
            ranking: sorted 
          };
        }
        
        // 等待後再試下一天
        await new Promise(r => setTimeout(r, 500));
      }
      
      console.log('⚠️ 無法取得任何交易日的三大法人排行資料');
      return null;
    } catch (error) {
      console.error('取得三大法人排行失敗:', error.message);
      return null;
    }
  }
}

module.exports = new ChipService();
