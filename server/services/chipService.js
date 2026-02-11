/**
 * 📊 籌碼分析服務
 * 三大法人買賣超 - TWSE + TPEX 多重備援
 */

const axios = require('axios');
const { pool } = require('../db');

let twStocks = null;
try {
  twStocks = require('../data/twStocks');
} catch (e) {
  console.log('⚠️ chipService: twStocks 對照表載入失敗');
}

const BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  'Accept': 'application/json, text/plain, */*',
  'Accept-Language': 'zh-TW,zh;q=0.9,en;q=0.8',
  'Accept-Encoding': 'gzip, deflate, br',
  'Connection': 'keep-alive',
  'Cache-Control': 'no-cache',
};

class ChipService {

  isOTC(stockId) {
    if (twStocks) {
      const info = twStocks.getStockInfo(stockId);
      if (info) return info.market === 'OTC';
    }
    return false;
  }

  getRecentTradeDate() {
    const now = new Date();
    const twNow = new Date(now.getTime() + 8 * 60 * 60 * 1000);
    const dayOfWeek = twNow.getUTCDay();
    if (dayOfWeek === 0) twNow.setUTCDate(twNow.getUTCDate() - 2);
    else if (dayOfWeek === 6) twNow.setUTCDate(twNow.getUTCDate() - 1);
    return twNow.toISOString().slice(0, 10).replace(/-/g, '');
  }

  toROCDate(date) {
    const year = parseInt(date.slice(0, 4)) - 1911;
    return `${year}/${date.slice(4, 6)}/${date.slice(6, 8)}`;
  }

  toISODate(date) {
    return `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}`;
  }

  // ==================== TWSE ====================

  async fetchInstitutionalFromTWSE(stockId, date = null) {
    try {
      if (!date) date = this.getRecentTradeDate();
      console.log(`📡 查詢 TWSE 三大法人: ${stockId}, 日期: ${date}`);

      const url = `https://www.twse.com.tw/rwd/zh/fund/T86?date=${date}&selectType=ALLBUT0999&response=json`;
      const response = await axios.get(url, {
        headers: { ...BROWSER_HEADERS, 'Referer': 'https://www.twse.com.tw/' },
        timeout: 15000
      });

      if (response.data && response.data.data) {
        const stockData = response.data.data.find(row => String(row[0]).trim() === stockId);
        if (stockData) {
          const p = (str) => parseInt(String(str).replace(/,/g, '')) || 0;
          return {
            stockId: String(stockData[0]).trim(),
            stockName: String(stockData[1]).trim(),
            date: this.toISODate(date),
            foreign: { buy: p(stockData[2]), sell: p(stockData[3]), net: p(stockData[4]) },
            trust:   { buy: p(stockData[5]), sell: p(stockData[6]), net: p(stockData[7]) },
            dealer:  { buy: p(stockData[8]) + p(stockData[11]), sell: p(stockData[9]) + p(stockData[12]), net: p(stockData[10]) + p(stockData[13]) },
            totalNet: p(stockData[4]) + p(stockData[7]) + p(stockData[10]) + p(stockData[13])
          };
        }
        console.log(`⚠️ TWSE 找不到 ${stockId}（共 ${response.data.data.length} 筆）`);
      } else {
        console.log(`⚠️ TWSE 回傳無資料（假日或尚未更新）`);
      }
      return null;
    } catch (error) {
      console.error(`抓取 TWSE 三大法人失敗: [${error.response?.status || 'N/A'}] ${error.message}`);
      return null;
    }
  }

  // ==================== TPEX 多重備援 ====================

  /**
   * 方法1: TPEX OpenAPI（回傳最近交易日，Cloudflare 通常不擋）
   */
  async fetchTPEXFromOpenAPI(stockId) {
    const urls = [
      'https://www.tpex.org.tw/openapi/v1/tpex_mainboard_3itrade_hedge',
      'https://wwwov.tpex.org.tw/openapi/v1/tpex_mainboard_3itrade_hedge',
    ];

    for (const url of urls) {
      try {
        const label = url.includes('wwwov') ? '海外' : '主站';
        console.log(`📡 TPEX OpenAPI ${label}: ${stockId}`);
        const response = await axios.get(url, {
          headers: { ...BROWSER_HEADERS, 'Referer': 'https://www.tpex.org.tw/' },
          timeout: 20000
        });

        if (Array.isArray(response.data) && response.data.length > 0) {
          const item = response.data.find(d => {
            const vals = Object.values(d).map(v => String(v).trim());
            return vals.includes(stockId);
          });

          if (item) {
            console.log(`✅ TPEX OpenAPI ${label} 找到 ${stockId}`);
            return this._parseTPEXOpenAPI(item, stockId);
          }
          console.log(`⚠️ TPEX OpenAPI ${label}: ${response.data.length} 筆但找不到 ${stockId}`);
        }
      } catch (e) {
        const label = url.includes('wwwov') ? '海外' : '主站';
        console.log(`❌ TPEX OpenAPI ${label}: [${e.response?.status || 'N/A'}] ${e.message}`);
      }
    }
    return null;
  }

  _parseTPEXOpenAPI(item, stockId) {
    const p = (val) => parseInt(String(val || 0).replace(/,/g, '').replace(/−/g, '-')) || 0;
    let foreignBuy = 0, foreignSell = 0, foreignNet = 0;
    let trustBuy = 0, trustSell = 0, trustNet = 0;
    let dealerBuy = 0, dealerSell = 0, dealerNet = 0;
    let stockName = stockId;
    let dateStr = new Date().toISOString().slice(0, 10);

    for (const [k, v] of Object.entries(item)) {
      const kl = k;
      if (kl.includes('名稱') || kl.toLowerCase().includes('name')) stockName = String(v).trim();
      if (kl.includes('日期') || kl.toLowerCase().includes('date')) {
        const ds = String(v).trim();
        if (ds.includes('/')) {
          const parts = ds.split('/');
          if (parts[0].length <= 3) {
            dateStr = `${parseInt(parts[0]) + 1911}-${parts[1].padStart(2, '0')}-${parts[2].padStart(2, '0')}`;
          }
        }
      }
      // 外資 / 外陸資
      if ((kl.includes('外資') || kl.includes('外陸資'))) {
        if (kl.includes('買') && !kl.includes('淨') && !kl.includes('超')) foreignBuy += p(v);
        if (kl.includes('賣') && !kl.includes('淨') && !kl.includes('超')) foreignSell += p(v);
        if (kl.includes('淨') || kl.includes('超')) foreignNet += p(v);
      }
      // 投信
      if (kl.includes('投信')) {
        if (kl.includes('買') && !kl.includes('淨') && !kl.includes('超')) trustBuy = p(v);
        if (kl.includes('賣') && !kl.includes('淨') && !kl.includes('超')) trustSell = p(v);
        if (kl.includes('淨') || kl.includes('超')) trustNet = p(v);
      }
      // 自營 + 避險
      if (kl.includes('自營') || kl.includes('避險')) {
        if (kl.includes('買') && !kl.includes('淨') && !kl.includes('超')) dealerBuy += p(v);
        if (kl.includes('賣') && !kl.includes('淨') && !kl.includes('超')) dealerSell += p(v);
        if (kl.includes('淨') || kl.includes('超')) dealerNet += p(v);
      }
    }

    if (foreignNet === 0 && (foreignBuy || foreignSell)) foreignNet = foreignBuy - foreignSell;
    if (trustNet === 0 && (trustBuy || trustSell)) trustNet = trustBuy - trustSell;
    if (dealerNet === 0 && (dealerBuy || dealerSell)) dealerNet = dealerBuy - dealerSell;

    return {
      stockId, stockName, date: dateStr,
      foreign: { buy: foreignBuy, sell: foreignSell, net: foreignNet },
      trust:   { buy: trustBuy, sell: trustSell, net: trustNet },
      dealer:  { buy: dealerBuy, sell: dealerSell, net: dealerNet },
      totalNet: foreignNet + trustNet + dealerNet
    };
  }

  /**
   * 方法2: TPEX 3itrade 頁面（直連 + 海外域名）
   */
  async fetchTPEXFromPage(stockId, date = null) {
    if (!date) date = this.getRecentTradeDate();
    const rocDate = this.toROCDate(date);

    const domains = [
      { base: 'https://wwwov.tpex.org.tw', label: '海外' },
      { base: 'https://www.tpex.org.tw', label: '主站' },
    ];

    for (const { base, label } of domains) {
      try {
        const url = `${base}/web/stock/3insti/daily_trade/3itrade_hedge_result.php?l=zh-tw&o=json&se=AL&t=D&d=${rocDate}&s=0,asc,0`;
        console.log(`📡 TPEX ${label} 頁面: ${stockId}, ${rocDate}`);

        const response = await axios.get(url, {
          headers: {
            ...BROWSER_HEADERS,
            'Referer': `${base}/web/stock/3insti/daily_trade/3itrade_hedge.php`,
            'Origin': base,
          },
          timeout: 15000
        });

        const aaData = response.data?.aaData;
        if (aaData && aaData.length > 0) {
          const stockData = aaData.find(row => String(row[0]).trim() === stockId);
          if (stockData) {
            console.log(`✅ TPEX ${label} 找到 ${stockId}（欄位數: ${stockData.length}）`);
            return this._parseTPEXPageRow(stockData, date, stockId);
          }
          console.log(`⚠️ TPEX ${label}: ${aaData.length} 筆但找不到 ${stockId}`);
        }
      } catch (e) {
        console.log(`❌ TPEX ${label} 頁面: [${e.response?.status || 'N/A'}] ${e.message}`);
      }
    }
    return null;
  }

  _parseTPEXPageRow(row, date, stockId) {
    const p = (str) => parseInt(String(str).replace(/,/g, '').replace(/−/g, '-')) || 0;
    const isNewFormat = row.length >= 21;

    let foreignNet, trustNet, dealerNet, foreignBuy, foreignSell, trustBuy, trustSell, dealerBuy, dealerSell;

    if (isNewFormat) {
      foreignBuy = p(row[2]); foreignSell = p(row[3]); foreignNet = p(row[4]) + p(row[7]);
      trustBuy = p(row[11]); trustSell = p(row[12]); trustNet = p(row[13]);
      dealerBuy = p(row[14]) + p(row[17]); dealerSell = p(row[15]) + p(row[18]);
      dealerNet = p(row[16]) + p(row[19]);
    } else {
      foreignBuy = p(row[2]); foreignSell = p(row[3]); foreignNet = p(row[4]);
      trustBuy = p(row[5]); trustSell = p(row[6]); trustNet = p(row[7]);
      dealerBuy = p(row[8]) + p(row[11]); dealerSell = p(row[9]) + p(row[12]);
      dealerNet = p(row[10]) + p(row[13]);
    }

    return {
      stockId: stockId || String(row[0]).trim(),
      stockName: String(row[1]).trim(),
      date: this.toISODate(date),
      foreign: { buy: foreignBuy, sell: foreignSell, net: foreignNet },
      trust:   { buy: trustBuy, sell: trustSell, net: trustNet },
      dealer:  { buy: dealerBuy, sell: dealerSell, net: dealerNet },
      totalNet: foreignNet + trustNet + dealerNet
    };
  }

  /**
   * TPEX 統一入口：OpenAPI → 頁面 → 往前找
   */
  async fetchInstitutionalFromTPEX(stockId, date = null) {
    const openApiResult = await this.fetchTPEXFromOpenAPI(stockId);
    if (openApiResult) return openApiResult;

    if (!date) date = this.getRecentTradeDate();
    const pageResult = await this.fetchTPEXFromPage(stockId, date);
    if (pageResult) return pageResult;

    console.log(`⚠️ TPEX ${stockId} 當日無資料，往前找...`);
    const dateObj = new Date(this.toISODate(date));
    for (let i = 1; i <= 5; i++) {
      dateObj.setDate(dateObj.getDate() - 1);
      if (dateObj.getDay() === 0 || dateObj.getDay() === 6) continue;
      const prevDate = dateObj.toISOString().slice(0, 10).replace(/-/g, '');
      const result = await this.fetchTPEXFromPage(stockId, prevDate);
      if (result) return result;
      await new Promise(r => setTimeout(r, 500));
    }
    return null;
  }

  // ==================== 統一入口 ====================

  async fetchInstitutional(stockId, date = null) {
    if (this.isOTC(stockId)) {
      console.log(`📋 ${stockId} 為上櫃股票，優先 TPEX`);
      const data = await this.fetchInstitutionalFromTPEX(stockId, date);
      if (data) return data;
      return await this.fetchInstitutionalFromTWSE(stockId, date);
    } else {
      const data = await this.fetchInstitutionalFromTWSE(stockId, date);
      if (data) return data;
      console.log(`   TWSE 找不到 ${stockId}，嘗試 TPEX...`);
      return await this.fetchInstitutionalFromTPEX(stockId, date);
    }
  }

  /**
   * 給 /api/tpex-proxy 路由用
   */
  async tpexProxyFetch(stockId, rocDate) {
    const openApiResult = await this.fetchTPEXFromOpenAPI(stockId);
    if (openApiResult) {
      return { success: true, source: 'openapi', openApiData: openApiResult };
    }

    const domains = [
      { base: 'https://wwwov.tpex.org.tw', label: '海外' },
      { base: 'https://www.tpex.org.tw', label: '主站' },
    ];

    for (const { base, label } of domains) {
      try {
        const url = `${base}/web/stock/3insti/daily_trade/3itrade_hedge_result.php?l=zh-tw&o=json&se=AL&t=D&d=${rocDate}&s=0,asc,0`;
        const response = await axios.get(url, {
          headers: {
            ...BROWSER_HEADERS,
            'Referer': `${base}/web/stock/3insti/daily_trade/3itrade_hedge.php`,
            'Origin': base,
          },
          timeout: 15000
        });

        const aaData = response.data?.aaData;
        if (aaData && aaData.length > 0) {
          const stockData = aaData.find(row => String(row[0]).trim() === stockId);
          if (stockData) {
            return { success: true, source: `tpex-${label}`, data: stockData };
          }
        }
      } catch (e) {
        console.log(`❌ tpexProxy ${label}: [${e.response?.status || 'N/A'}] ${e.message}`);
      }
    }

    return { success: false, error: `TPEX ${stockId} 所有來源都失敗` };
  }

  // ==================== 資料庫 ====================

  async getInstitutionalTrading(stockId, days = 5) {
    try {
      let dbResult = await pool.query(
        'SELECT * FROM institutional_trading WHERE stock_id = $1 ORDER BY trade_date DESC LIMIT $2',
        [stockId, days]
      );

      const now = new Date();
      const twNow = new Date(now.getTime() + 8 * 60 * 60 * 1000);
      const hour = twNow.getUTCHours();
      const dayOfWeek = twNow.getUTCDay();
      const today = twNow.toISOString().slice(0, 10);
      const isAfterUpdate = hour >= 15;
      const isWeekday = dayOfWeek >= 1 && dayOfWeek <= 5;
      const hasToday = dbResult.rows.some(row => row.trade_date.toISOString().slice(0, 10) === today);

      if (isWeekday && isAfterUpdate && !hasToday) {
        console.log(`📡 嘗試抓取 ${stockId} 三大法人...`);
        const freshData = await this.fetchInstitutional(stockId);
        if (freshData) {
          await this.saveInstitutionalData(freshData);
          dbResult = await pool.query(
            'SELECT * FROM institutional_trading WHERE stock_id = $1 ORDER BY trade_date DESC LIMIT $2',
            [stockId, days]
          );
        }
      }

      if (dbResult.rows.length > 0) return this.formatInstitutionalData(dbResult.rows);

      console.log(`📡 DB 無資料，抓取 ${stockId}...`);
      const freshData = await this.fetchInstitutional(stockId);
      if (freshData) {
        await this.saveInstitutionalData(freshData);
        const newResult = await pool.query(
          'SELECT * FROM institutional_trading WHERE stock_id = $1 ORDER BY trade_date DESC LIMIT $2',
          [stockId, days]
        );
        if (newResult.rows.length > 0) return this.formatInstitutionalData(newResult.rows);
      }

      return null;
    } catch (error) {
      console.error('取得三大法人資料失敗:', error.message);
      return null;
    }
  }

  async saveInstitutionalData(data) {
    try {
      await pool.query(`
        INSERT INTO institutional_trading 
        (stock_id, trade_date, foreign_buy, foreign_sell, foreign_net, 
         trust_buy, trust_sell, trust_net, dealer_buy, dealer_sell, dealer_net, total_net)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
        ON CONFLICT (stock_id, trade_date) DO UPDATE SET 
          foreign_buy = EXCLUDED.foreign_buy, foreign_sell = EXCLUDED.foreign_sell, foreign_net = EXCLUDED.foreign_net,
          trust_buy = EXCLUDED.trust_buy, trust_sell = EXCLUDED.trust_sell, trust_net = EXCLUDED.trust_net,
          dealer_buy = EXCLUDED.dealer_buy, dealer_sell = EXCLUDED.dealer_sell, dealer_net = EXCLUDED.dealer_net,
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

  formatInstitutionalData(rows) {
    if (!rows || rows.length === 0) return null;
    const fmt = (num) => {
      const n = parseInt(num) || 0;
      if (Math.abs(n) >= 1000000) return (n / 1000000).toFixed(2) + '百萬股';
      if (Math.abs(n) >= 1000) return Math.round(n / 1000) + '張';
      return n + '股';
    };
    const latest = rows[0];
    const streak = (field) => {
      const sign = Math.sign(latest[field]);
      let count = 0;
      for (const row of rows) {
        if (Math.sign(row[field]) === sign && sign !== 0) count++;
        else break;
      }
      return { count, text: sign > 0 ? `連${count}買` : sign < 0 ? `連${count}賣` : '持平' };
    };
    const fs = streak('foreign_net'), ts = streak('trust_net'), ds = streak('dealer_net');
    return {
      stockId: latest.stock_id, date: latest.trade_date,
      latest: {
        foreign: { buy: latest.foreign_buy, sell: latest.foreign_sell, net: latest.foreign_net, netText: fmt(latest.foreign_net), streak: fs.count, streakText: fs.text },
        trust:   { buy: latest.trust_buy, sell: latest.trust_sell, net: latest.trust_net, netText: fmt(latest.trust_net), streak: ts.count, streakText: ts.text },
        dealer:  { buy: latest.dealer_buy, sell: latest.dealer_sell, net: latest.dealer_net, netText: fmt(latest.dealer_net), streak: ds.count, streakText: ds.text },
        totalNet: latest.total_net, totalNetText: fmt(latest.total_net)
      },
      history: rows.map(row => ({ date: row.trade_date, foreignNet: row.foreign_net, trustNet: row.trust_net, dealerNet: row.dealer_net, totalNet: row.total_net })),
      sum5Days: rows.length >= 5 ? {
        foreign: rows.slice(0, 5).reduce((s, r) => s + parseInt(r.foreign_net), 0),
        trust: rows.slice(0, 5).reduce((s, r) => s + parseInt(r.trust_net), 0),
        dealer: rows.slice(0, 5).reduce((s, r) => s + parseInt(r.dealer_net), 0)
      } : null
    };
  }

  // ==================== 批次更新 + 排行 ====================

  async updateWatchlistInstitutional() {
    try {
      const watchlist = await pool.query(`
        SELECT DISTINCT stock_id FROM watchlist WHERE is_active = true
        UNION SELECT DISTINCT stock_id FROM holdings WHERE is_won = true
      `);
      const results = [];
      for (const row of watchlist.rows) {
        const data = await this.fetchInstitutional(row.stock_id);
        if (data) { await this.saveInstitutionalData(data); results.push(data); }
        await new Promise(r => setTimeout(r, 300));
      }
      console.log(`✅ 更新 ${results.length} 檔股票的三大法人資料`);
      return results;
    } catch (error) {
      console.error('批次更新三大法人失敗:', error.message);
      return [];
    }
  }

  async getTopInstitutionalRanking(type = 'foreign', direction = 'buy', limit = 10) {
    try {
      const today = new Date();
      today.setHours(today.getHours() + 8);
      const d = today.getDay();
      if (d === 0) today.setDate(today.getDate() - 2);
      else if (d === 6) today.setDate(today.getDate() - 1);

      for (let i = 0; i < 5; i++) {
        const qd = new Date(today); qd.setDate(qd.getDate() - i);
        const date = qd.toISOString().slice(0, 10).replace(/-/g, '');
        const url = `https://www.twse.com.tw/rwd/zh/fund/T86?date=${date}&selectType=ALLBUT0999&response=json`;
        const response = await axios.get(url, { headers: BROWSER_HEADERS, timeout: 15000 });
        if (response.data?.data?.length > 0) {
          const pn = (str) => parseInt(String(str).replace(/,/g, '')) || 0;
          const col = { foreign: 4, trust: 7, dealer: 10 }[type] || 4;
          let sorted = response.data.data
            .map(row => ({ stockId: row[0], stockName: row[1], net: pn(row[col]) }))
            .filter(item => item.stockId && /^\d{4}$/.test(item.stockId));
          sorted = direction === 'buy'
            ? sorted.sort((a, b) => b.net - a.net).slice(0, limit)
            : sorted.sort((a, b) => a.net - b.net).slice(0, limit);
          return { date: this.toISODate(date), type, direction, ranking: sorted };
        }
        await new Promise(r => setTimeout(r, 500));
      }
      return null;
    } catch (error) {
      console.error('取得三大法人排行失敗:', error.message);
      return null;
    }
  }
}

module.exports = new ChipService();
