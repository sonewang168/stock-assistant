/**
 * 📊 籌碼分析服務
 * 三大法人買賣超 - 從 TWSE/TPEx 抓取真實數據
 * 
 * 修正：
 * - TPEx Cloudflare 520 問題：完整瀏覽器 headers + 重試機制
 * - TWSE 19/22 欄新格式相容
 * - 時區修正（Railway 在 UTC，需正確轉台灣時間）
 * - TWSE/TPEx stock code .trim() 比對
 * - parseNum 處理全形減號 −
 */

const axios = require('axios');
const { pool } = require('../db');

// ★ 完整瀏覽器 headers（繞過 Cloudflare 基本防護）
const BROWSER_HEADERS_TWSE = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'application/json, text/javascript, */*; q=0.01',
  'Accept-Language': 'zh-TW,zh;q=0.9,en-US;q=0.8,en;q=0.7',
  'Accept-Encoding': 'gzip, deflate, br',
  'Connection': 'keep-alive',
  'Referer': 'https://www.twse.com.tw/zh/trading/fund/T86.html'
};

const BROWSER_HEADERS_TPEX = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'application/json, text/javascript, */*; q=0.01',
  'Accept-Language': 'zh-TW,zh;q=0.9,en-US;q=0.8,en;q=0.7',
  'Accept-Encoding': 'gzip, deflate, br',
  'Connection': 'keep-alive',
  'Referer': 'https://www.tpex.org.tw/web/stock/3insti/daily_trade/3itrade_hedge.php?l=zh-tw',
  'Origin': 'https://www.tpex.org.tw',
  'Sec-Fetch-Dest': 'empty',
  'Sec-Fetch-Mode': 'cors',
  'Sec-Fetch-Site': 'same-origin',
  'X-Requested-With': 'XMLHttpRequest'
};

/**
 * ★ 取得台灣時間的 Date 物件（不依賴 setHours hack）
 */
function getTaiwanNow() {
  const now = new Date();
  const utc = now.getTime() + now.getTimezoneOffset() * 60000;
  return new Date(utc + 8 * 3600000);
}

/**
 * 通用數值解析（處理逗號、全形減號 −、空值）
 */
function parseNum(val) {
  if (val === null || val === undefined) return 0;
  return parseInt(String(val).replace(/,/g, '').replace(/−/g, '-')) || 0;
}

class ChipService {

  /**
   * 從 TWSE 抓取個股三大法人買賣超
   * ★ 支援 18/19/22 欄自動偵測
   */
  async fetchInstitutionalFromTWSE(stockId, date = null) {
    try {
      if (!date) {
        const today = getTaiwanNow();
        const dayOfWeek = today.getDay();
        if (dayOfWeek === 0) today.setDate(today.getDate() - 2);
        else if (dayOfWeek === 6) today.setDate(today.getDate() - 1);
        date = today.toISOString().slice(0, 10).replace(/-/g, '');
      }

      console.log(`📡 查詢 TWSE 三大法人: ${stockId}, 日期: ${date}`);

      const url = `https://www.twse.com.tw/rwd/zh/fund/T86?date=${date}&selectType=ALLBUT0999&response=json`;
      
      const response = await axios.get(url, {
        headers: BROWSER_HEADERS_TWSE,
        timeout: 15000
      });

      if (response.data && response.data.data) {
        // ★ 加 .trim() 比對，TWSE 有時回傳帶空格的代號
        const stockData = response.data.data.find(row => 
          String(row[0]).trim() === stockId
        );
        
        if (stockData) {
          const colCount = stockData.length;
          let foreignBuy, foreignSell, foreignNet;
          let trustBuy, trustSell, trustNet;
          let dealerBuy, dealerSell, dealerNet;
          
          // 外資永遠在 [2~7]（所有格式一致）
          foreignBuy = parseNum(stockData[2]) + parseNum(stockData[5]);
          foreignSell = parseNum(stockData[3]) + parseNum(stockData[6]);
          foreignNet = parseNum(stockData[4]) + parseNum(stockData[7]);

          if (colCount >= 22) {
            // ★ 新版 22 欄：[8~10] 為外資合計（新增），投信從 [11] 開始
            console.log(`  TWSE ${stockId}: 新格式(${colCount}欄)`);
            trustBuy = parseNum(stockData[11]); trustSell = parseNum(stockData[12]); trustNet = parseNum(stockData[13]);
            dealerBuy = parseNum(stockData[14]) + parseNum(stockData[17]);
            dealerSell = parseNum(stockData[15]) + parseNum(stockData[18]);
            dealerNet = parseNum(stockData[16]) + parseNum(stockData[19]);
          } else {
            // 18~19 欄：投信從 [8] 開始（19 欄只是多了自營合計和三大法人合計欄位）
            console.log(`  TWSE ${stockId}: ${colCount}欄格式`);
            trustBuy = parseNum(stockData[8]); trustSell = parseNum(stockData[9]); trustNet = parseNum(stockData[10]);
            dealerBuy = parseNum(stockData[11]) + parseNum(stockData[14]);
            dealerSell = parseNum(stockData[12]) + parseNum(stockData[15]);
            dealerNet = parseNum(stockData[13]) + parseNum(stockData[16]);
          }
          
          return {
            stockId: String(stockData[0]).trim(),
            stockName: String(stockData[1]).trim(),
            date: `${date.slice(0,4)}-${date.slice(4,6)}-${date.slice(6,8)}`,
            foreign: { buy: foreignBuy, sell: foreignSell, net: foreignNet },
            trust: { buy: trustBuy, sell: trustSell, net: trustNet },
            dealer: { buy: dealerBuy, sell: dealerSell, net: dealerNet },
            totalNet: foreignNet + trustNet + dealerNet
          };
        } else {
          console.log(`⚠️ TWSE 資料中找不到 ${stockId} (共 ${response.data.data.length} 筆)`);
        }
      } else {
        console.log(`⚠️ TWSE 回傳無資料 (stat=${response.data?.stat})，可能是假日或尚未更新`);
        
        // 如果當日無資料，嘗試往前查詢（最多嘗試 5 天）
        const dateObj = new Date(`${date.slice(0,4)}-${date.slice(4,6)}-${date.slice(6,8)}`);
        for (let i = 0; i < 5; i++) {
          dateObj.setDate(dateObj.getDate() - 1);
          if (dateObj.getDay() === 0 || dateObj.getDay() === 6) continue;
          const prevDate = dateObj.toISOString().slice(0, 10).replace(/-/g, '');
          console.log(`   嘗試查詢 ${prevDate}...`);
          
          const prevResult = await this.fetchInstitutionalFromTWSE(stockId, prevDate);
          if (prevResult) return prevResult;
          
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
   * 從 TPEx 抓取上櫃個股三大法人買賣超
   * ★ 完整 headers + 重試機制（繞過 Cloudflare 520）
   */
  async fetchInstitutionalFromTPEx(stockId, date = null) {
    try {
      if (!date) {
        const today = getTaiwanNow();
        const dayOfWeek = today.getDay();
        if (dayOfWeek === 0) today.setDate(today.getDate() - 2);
        else if (dayOfWeek === 6) today.setDate(today.getDate() - 1);
        date = today.toISOString().slice(0, 10).replace(/-/g, '');
      }

      const y = parseInt(date.slice(0, 4)) - 1911;
      const m = date.slice(4, 6);
      const d = date.slice(6, 8);
      const rocDate = `${y}/${m}/${d}`;

      console.log(`📡 查詢 TPEx 三大法人: ${stockId}, 日期: ${rocDate} (西元:${date})`);

      // ★ 嘗試多個域名：海外域名通常不受 Cloudflare 阻擋
      const urls = [
        { name: 'overseas', url: `https://wwwov.tpex.org.tw/web/stock/3insti/daily_trade/3itrade_hedge_result.php?l=zh-tw&o=json&se=AL&t=D&d=${rocDate}&s=0,asc` },
        { name: 'main', url: `https://www.tpex.org.tw/web/stock/3insti/daily_trade/3itrade_hedge_result.php?l=zh-tw&o=json&se=AL&t=D&d=${rocDate}&s=0,asc` },
      ];

      // ★ 嘗試每個域名（海外域名優先，不重試同一個被擋的域名）
      let lastError = null;
      for (const { name, url } of urls) {
        try {
          console.log(`   嘗試 ${name}...`);
          const response = await axios.get(url, {
            headers: BROWSER_HEADERS_TPEX,
            timeout: 15000,
            decompress: true
          });

          if (response.data && response.data.aaData && response.data.aaData.length > 0) {
            const stockData = response.data.aaData.find(row => String(row[0]).trim() === stockId);

            if (stockData) {
              const isNewFormat = stockData.length >= 21;
              console.log(`  TPEx ${stockId}: ${isNewFormat ? '新' : '舊'}格式(${stockData.length}欄) ✅`);

              let foreign, trust, dealer, totalNet;
              if (isNewFormat) {
                const foreignNet = parseNum(stockData[4]) + parseNum(stockData[7]);
                const trustNet = parseNum(stockData[13]);
                const dealerNet = parseNum(stockData[16]) + parseNum(stockData[19]);
                foreign = { buy: parseNum(stockData[2]) + parseNum(stockData[5]), sell: parseNum(stockData[3]) + parseNum(stockData[6]), net: foreignNet };
                trust = { buy: parseNum(stockData[11]), sell: parseNum(stockData[12]), net: trustNet };
                dealer = { buy: parseNum(stockData[14]) + parseNum(stockData[17]), sell: parseNum(stockData[15]) + parseNum(stockData[18]), net: dealerNet };
                totalNet = foreignNet + trustNet + dealerNet;
              } else {
                const foreignNet = parseNum(stockData[3]) + parseNum(stockData[6]);
                const trustNet = parseNum(stockData[9]);
                const dealerNet = parseNum(stockData[12]) + parseNum(stockData[15]);
                foreign = { buy: parseNum(stockData[1]) + parseNum(stockData[4]), sell: parseNum(stockData[2]) + parseNum(stockData[5]), net: foreignNet };
                trust = { buy: parseNum(stockData[7]), sell: parseNum(stockData[8]), net: trustNet };
                dealer = { buy: parseNum(stockData[10]) + parseNum(stockData[13]), sell: parseNum(stockData[11]) + parseNum(stockData[14]), net: dealerNet };
                totalNet = foreignNet + trustNet + dealerNet;
              }

              return {
                stockId: String(stockData[0]).trim(),
                stockName: isNewFormat ? String(stockData[1]).trim() : stockId,
                date: `${date.slice(0,4)}-${date.slice(4,6)}-${date.slice(6,8)}`,
                foreign, trust, dealer, totalNet,
                market: 'tpex'
              };
            } else {
              console.log(`⚠️ TPEx 資料中找不到 ${stockId} (共 ${response.data.aaData.length} 筆)`);
              break; // 有 aaData 但沒有此股票 → 不需重試
            }
          } else if (response.data && response.data.iTotalRecords === 0) {
            console.log(`⚠️ TPEx ${rocDate} 無資料 (iTotalRecords=0)`);
            break; // 該日無資料（假日），不需重試
          } else {
            console.log(`⚠️ TPEx 回傳格式異常: ${JSON.stringify(response.data).slice(0, 100)}`);
          }
        } catch (e) {
          lastError = e;
          console.log(`❌ TPEx ${name} 失敗: ${e.message} (HTTP ${e.response?.status || 'N/A'})`);
        }
      }

      // 所有重試都失敗，嘗試往前查詢
      if (lastError) {
        console.log(`⚠️ TPEx ${stockId} ${rocDate} 全部重試失敗，嘗試往前查詢...`);
      }
      const dateObj = new Date(`${date.slice(0,4)}-${date.slice(4,6)}-${date.slice(6,8)}`);
      for (let i = 0; i < 5; i++) {
        dateObj.setDate(dateObj.getDate() - 1);
        if (dateObj.getDay() === 0 || dateObj.getDay() === 6) continue;
        const prevDate = dateObj.toISOString().slice(0, 10).replace(/-/g, '');
        console.log(`   嘗試查詢 ${prevDate}...`);
        const prevResult = await this.fetchInstitutionalFromTPEx(stockId, prevDate);
        if (prevResult) return prevResult;
        await new Promise(r => setTimeout(r, 800));
      }

      return null;
    } catch (error) {
      console.error('抓取 TPEx 三大法人失敗:', error.message);
      return null;
    }
  }

  /**
   * 取得三大法人買賣超（優先從資料庫，沒有則抓取）
   * 自動嘗試 TWSE + TPEx
   */
  async getInstitutionalTrading(stockId, days = 5, market = null, force = false) {
    try {
      // 0. 強制更新：清除舊資料再重抓
      if (force) {
        console.log(`🔄 強制更新 ${stockId} (market=${market})`);
        await pool.query('DELETE FROM institutional_trading WHERE stock_id = $1', [stockId]);
      }

      // 1. 先查詢資料庫
      let dbResult = await pool.query(`
        SELECT * FROM institutional_trading 
        WHERE stock_id = $1 
        ORDER BY trade_date DESC 
        LIMIT $2
      `, [stockId, days]);

      // 2. 檢查是否需要抓取新資料（★ 使用台灣時間）
      const twNow = getTaiwanNow();
      const hour = twNow.getHours();
      const dayOfWeek = twNow.getDay();
      const today = twNow.toISOString().slice(0, 10);
      
      const isAfterUpdate = hour >= 15; // 收盤後 15:00 三大法人資料才更新
      const isWeekday = dayOfWeek >= 1 && dayOfWeek <= 5;
      
      const hasToday = dbResult.rows.some(row => 
        row.trade_date.toISOString().slice(0, 10) === today
      );

      // 3. 如果是交易日且已過更新時間，但沒有今天的資料，嘗試抓取
      if ((isWeekday && isAfterUpdate && !hasToday) || force) {
        console.log(`📡 嘗試抓取 ${stockId} (market=${market}) 的三大法人資料...`);
        let freshData = null;
        if (market === 'tpex') {
          freshData = await this.fetchInstitutionalFromTPEx(stockId);
          if (!freshData) freshData = await this.fetchInstitutionalFromTWSE(stockId);
        } else if (market === 'twse') {
          freshData = await this.fetchInstitutionalFromTWSE(stockId);
          if (!freshData) freshData = await this.fetchInstitutionalFromTPEx(stockId);
        } else {
          // market 未指定，兩邊都試
          freshData = await this.fetchInstitutionalFromTWSE(stockId);
          if (!freshData) freshData = await this.fetchInstitutionalFromTPEx(stockId);
        }
        if (freshData) {
          await this.saveInstitutionalData(freshData);
          dbResult = await pool.query(`
            SELECT * FROM institutional_trading 
            WHERE stock_id = $1 
            ORDER BY trade_date DESC 
            LIMIT $2
          `, [stockId, days]);
        }
      }

      // 4. 如果資料庫有資料，返回
      if (dbResult.rows.length > 0) {
        return this.formatInstitutionalData(dbResult.rows);
      }

      // 5. 資料庫沒資料，嘗試抓取 ─ 根據 market 優先順序
      console.log(`📡 資料庫無資料，抓取 ${stockId} (market=${market})...`);
      let freshData = null;
      if (market === 'tpex') {
        freshData = await this.fetchInstitutionalFromTPEx(stockId);
        if (!freshData) freshData = await this.fetchInstitutionalFromTWSE(stockId);
      } else if (market === 'twse') {
        freshData = await this.fetchInstitutionalFromTWSE(stockId);
        if (!freshData) freshData = await this.fetchInstitutionalFromTPEx(stockId);
      } else {
        freshData = await this.fetchInstitutionalFromTWSE(stockId);
        if (!freshData) freshData = await this.fetchInstitutionalFromTPEx(stockId);
      }
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
        let data = await this.fetchInstitutionalFromTWSE(row.stock_id);
        if (!data) data = await this.fetchInstitutionalFromTPEx(row.stock_id);
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
      const today = getTaiwanNow();
      const dayOfWeek = today.getDay();
      if (dayOfWeek === 0) today.setDate(today.getDate() - 2);
      else if (dayOfWeek === 6) today.setDate(today.getDate() - 1);
      
      for (let i = 0; i < 5; i++) {
        const queryDate = new Date(today);
        queryDate.setDate(queryDate.getDate() - i);
        if (queryDate.getDay() === 0 || queryDate.getDay() === 6) continue;
        const date = queryDate.toISOString().slice(0, 10).replace(/-/g, '');
        
        console.log(`📡 查詢三大法人排行: ${date}`);
        
        const url = `https://www.twse.com.tw/rwd/zh/fund/T86?date=${date}&selectType=ALLBUT0999&response=json`;
        
        const response = await axios.get(url, {
          headers: BROWSER_HEADERS_TWSE,
          timeout: 15000
        });

        if (response.data && response.data.data && response.data.data.length > 0) {
          const columnMap = { foreign: 4, trust: 7, dealer: 10 };
          const col = columnMap[type] || 4;
          
          let sorted = response.data.data
            .map(row => ({
              stockId: String(row[0]).trim(),
              stockName: String(row[1]).trim(),
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
