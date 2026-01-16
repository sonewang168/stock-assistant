/**
 * 📊 股票服務 - 即時股價抓取（台股 + 美股）
 */

const axios = require('axios');
const { pool } = require('../db');

class StockService {
  
  /**
   * 判斷是否為美股代碼
   */
  isUSStock(stockId) {
    // 美股代碼：全英文字母，1-5個字元
    return /^[A-Za-z]{1,5}$/.test(stockId);
  }

  /**
   * 取得即時股價（自動判斷台股/美股）
   */
  async getRealtimePrice(stockId) {
    try {
      // 判斷是美股還是台股
      if (this.isUSStock(stockId)) {
        return await this.getUSStockPrice(stockId.toUpperCase());
      }
      
      // 台股：先嘗試上市
      let data = await this.fetchTWSE(stockId);
      
      // 如果失敗，嘗試上櫃
      if (!data) {
        data = await this.fetchOTC(stockId);
      }
      
      if (data) {
        data = this.calculateChange(data);
        data.colorMode = 'tw'; // 台灣：紅漲綠跌
      }
      
      return data;
    } catch (error) {
      console.error(`取得 ${stockId} 股價失敗:`, error.message);
      return null;
    }
  }

  /**
   * 🇺🇸 取得美股即時股價（使用 Yahoo Finance）
   */
  async getUSStockPrice(symbol) {
    try {
      // 使用 Yahoo Finance API
      const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d&range=1d`;
      
      const response = await axios.get(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        },
        timeout: 10000
      });

      const result = response.data?.chart?.result?.[0];
      if (!result) return null;

      const meta = result.meta;
      const quote = result.indicators?.quote?.[0];
      
      if (!meta || !quote) return null;

      const price = meta.regularMarketPrice || 0;
      const previousClose = meta.previousClose || meta.chartPreviousClose || 0;
      const change = price - previousClose;
      const changePercent = previousClose > 0 ? ((change / previousClose) * 100).toFixed(2) : 0;

      // 美股名稱對照
      const usStockNames = {
        'AAPL': '蘋果', 'TSLA': '特斯拉', 'NVDA': '輝達', 'MSFT': '微軟',
        'GOOGL': '谷歌', 'GOOG': '谷歌', 'AMZN': '亞馬遜', 'META': 'Meta',
        'AMD': '超微', 'INTC': '英特爾', 'TSM': '台積電ADR', 'BABA': '阿里巴巴',
        'JD': '京東', 'PDD': '拼多多', 'NIO': '蔚來', 'XPEV': '小鵬',
        'LI': '理想', 'PLTR': 'Palantir', 'COIN': 'Coinbase', 'ROKU': 'Roku',
        'SQ': 'Block', 'PYPL': 'PayPal', 'NFLX': 'Netflix', 'DIS': '迪士尼',
        'BA': '波音', 'F': '福特', 'GM': '通用', 'JPM': '摩根大通',
        'V': 'Visa', 'MA': 'Mastercard', 'WMT': '沃爾瑪', 'COST': '好市多',
        'SPY': 'S&P500 ETF', 'QQQ': '納指100 ETF', 'VOO': 'Vanguard S&P500'
      };

      const stockData = {
        id: symbol,
        name: usStockNames[symbol] || meta.shortName || symbol,
        price: parseFloat(price.toFixed(2)),
        open: quote.open?.[quote.open.length - 1] || 0,
        high: quote.high?.[quote.high.length - 1] || 0,
        low: quote.low?.[quote.low.length - 1] || 0,
        yesterday: previousClose,
        volume: quote.volume?.[quote.volume.length - 1] || 0,
        change: parseFloat(change.toFixed(2)),
        changePercent: changePercent,
        market: 'US',
        colorMode: 'us', // 美國：綠漲紅跌
        currency: meta.currency || 'USD',
        time: new Date().toLocaleTimeString('zh-TW', { timeZone: 'America/New_York' })
      };

      return stockData;

    } catch (error) {
      console.error(`取得美股 ${symbol} 失敗:`, error.message);
      return null;
    }
  }

  /**
   * 🇺🇸 取得美股指數
   */
  async getUSIndices() {
    try {
      const indices = [
        { symbol: '^DJI', name: '道瓊工業' },
        { symbol: '^GSPC', name: 'S&P 500' },
        { symbol: '^IXIC', name: '納斯達克' },
        { symbol: '^SOX', name: '費城半導體' }
      ];

      const results = [];
      
      for (const index of indices) {
        const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(index.symbol)}?interval=1d&range=1d`;
        
        try {
          const response = await axios.get(url, {
            headers: { 'User-Agent': 'Mozilla/5.0' },
            timeout: 8000
          });

          const result = response.data?.chart?.result?.[0];
          if (result) {
            const meta = result.meta;
            const price = meta.regularMarketPrice || 0;
            const previousClose = meta.previousClose || 0;
            const change = price - previousClose;
            const changePercent = previousClose > 0 ? ((change / previousClose) * 100).toFixed(2) : 0;

            results.push({
              symbol: index.symbol,
              name: index.name,
              price: parseFloat(price.toFixed(2)),
              change: parseFloat(change.toFixed(2)),
              changePercent: changePercent,
              colorMode: 'us'
            });
          }
        } catch (e) {
          console.error(`取得 ${index.name} 失敗`);
        }
        
        await this.sleep(300);
      }

      return results;

    } catch (error) {
      console.error('取得美股指數失敗:', error.message);
      return [];
    }
  }

  /**
   * 抓取上市股票
   */
  async fetchTWSE(stockId) {
    try {
      const url = `https://mis.twse.com.tw/stock/api/getStockInfo.jsp?ex_ch=tse_${stockId}.tw`;
      const response = await axios.get(url, {
        headers: { 'User-Agent': 'Mozilla/5.0' },
        timeout: 10000
      });

      const data = response.data;
      if (data.msgArray && data.msgArray.length > 0) {
        const stock = data.msgArray[0];
        return {
          id: stockId,
          name: stock.n || stockId,
          price: parseFloat(stock.z) || parseFloat(stock.y) || 0,
          open: parseFloat(stock.o) || 0,
          high: parseFloat(stock.h) || 0,
          low: parseFloat(stock.l) || 0,
          yesterday: parseFloat(stock.y) || 0,
          volume: parseInt(stock.v) || 0,
          time: stock.t || '',
          market: 'TSE'
        };
      }
      return null;
    } catch (error) {
      return null;
    }
  }

  /**
   * 抓取上櫃股票
   */
  async fetchOTC(stockId) {
    try {
      const url = `https://mis.twse.com.tw/stock/api/getStockInfo.jsp?ex_ch=otc_${stockId}.tw`;
      const response = await axios.get(url, {
        headers: { 'User-Agent': 'Mozilla/5.0' },
        timeout: 10000
      });

      const data = response.data;
      if (data.msgArray && data.msgArray.length > 0) {
        const stock = data.msgArray[0];
        return {
          id: stockId,
          name: stock.n || stockId,
          price: parseFloat(stock.z) || parseFloat(stock.y) || 0,
          open: parseFloat(stock.o) || 0,
          high: parseFloat(stock.h) || 0,
          low: parseFloat(stock.l) || 0,
          yesterday: parseFloat(stock.y) || 0,
          volume: parseInt(stock.v) || 0,
          time: stock.t || '',
          market: 'OTC'
        };
      }
      return null;
    } catch (error) {
      return null;
    }
  }

  /**
   * 計算漲跌幅
   */
  calculateChange(stockData) {
    if (!stockData || !stockData.yesterday || stockData.yesterday === 0) {
      return stockData;
    }

    stockData.change = stockData.price - stockData.yesterday;
    stockData.changePercent = ((stockData.change / stockData.yesterday) * 100).toFixed(2);
    
    return stockData;
  }

  /**
   * 批次取得多檔股票
   */
  async getBatchPrices(stockIds) {
    const results = [];
    
    for (const stockId of stockIds) {
      const data = await this.getRealtimePrice(stockId);
      if (data) {
        results.push(data);
      }
      // 避免請求太快
      await this.sleep(300);
    }
    
    return results;
  }

  /**
   * 取得三大法人買賣超
   */
  async getInstitutionalData(stockId) {
    try {
      const today = new Date();
      const dateStr = today.toISOString().slice(0, 10).replace(/-/g, '');
      
      const url = `https://www.twse.com.tw/rwd/zh/fund/T86?date=${dateStr}&selectType=ALLBUT0999&response=json`;
      const response = await axios.get(url, {
        headers: { 'User-Agent': 'Mozilla/5.0' },
        timeout: 15000
      });

      const data = response.data;
      if (data.data) {
        for (const row of data.data) {
          if (row[0].trim() === stockId) {
            return {
              stockId: stockId,
              date: today.toISOString().slice(0, 10),
              foreign: this.parseNumber(row[4]),
              investment: this.parseNumber(row[10]),
              dealer: this.parseNumber(row[11]),
              total: this.parseNumber(row[18])
            };
          }
        }
      }
      return null;
    } catch (error) {
      console.error(`取得 ${stockId} 籌碼資料失敗:`, error.message);
      return null;
    }
  }

  parseNumber(str) {
    if (!str) return 0;
    return parseInt(str.toString().replace(/,/g, '')) || 0;
  }

  /**
   * 儲存價格歷史
   */
  async savePriceHistory(stockData) {
    if (!stockData) return;

    try {
      // 先確保股票存在於 stocks 表中（解決外鍵約束問題）
      const ensureStockSQL = `
        INSERT INTO stocks (id, name, market) 
        VALUES ($1, $2, $3) 
        ON CONFLICT (id) DO UPDATE SET name = $2, market = $3
      `;
      await pool.query(ensureStockSQL, [
        stockData.id,
        stockData.name || stockData.id,
        stockData.market || 'TSE'
      ]);

      // 儲存價格歷史
      const sql = `
        INSERT INTO price_history (stock_id, date, open_price, high_price, low_price, close_price, volume)
        VALUES ($1, CURRENT_DATE, $2, $3, $4, $5, $6)
        ON CONFLICT (stock_id, date) 
        DO UPDATE SET 
          open_price = $2, high_price = $3, low_price = $4, 
          close_price = $5, volume = $6
      `;

      await pool.query(sql, [
        stockData.id,
        stockData.open,
        stockData.high,
        stockData.low,
        stockData.price,
        stockData.volume
      ]);
      
      console.log(`✅ 已更新 ${stockData.id} ${stockData.name} 價格歷史`);
    } catch (error) {
      console.error('儲存價格歷史失敗:', error.message);
    }
  }

  /**
   * 儲存籌碼資料
   */
  async saveChipData(chipData) {
    if (!chipData) return;

    const sql = `
      INSERT INTO chip_data (stock_id, date, foreign_buy, investment_buy, dealer_buy)
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (stock_id, date) 
      DO UPDATE SET 
        foreign_buy = $3, investment_buy = $4, dealer_buy = $5
    `;

    try {
      await pool.query(sql, [
        chipData.stockId,
        chipData.date,
        chipData.foreign,
        chipData.investment,
        chipData.dealer
      ]);
    } catch (error) {
      console.error('儲存籌碼資料失敗:', error.message);
    }
  }

  /**
   * 取得價格歷史
   */
  async getPriceHistory(stockId, days = 60) {
    const sql = `
      SELECT * FROM price_history 
      WHERE stock_id = $1 
      ORDER BY date DESC 
      LIMIT $2
    `;

    const result = await pool.query(sql, [stockId, days]);
    return result.rows;
  }

  /**
   * 取得籌碼歷史
   */
  async getChipHistory(stockId, days = 30) {
    const sql = `
      SELECT * FROM chip_data 
      WHERE stock_id = $1 
      ORDER BY date DESC 
      LIMIT $2
    `;

    const result = await pool.query(sql, [stockId, days]);
    return result.rows;
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

module.exports = new StockService();
