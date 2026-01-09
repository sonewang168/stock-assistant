/**
 * 📊 股票服務 - 即時股價抓取
 */

const axios = require('axios');
const { pool } = require('../db');

class StockService {
  
  /**
   * 取得即時股價（台股）
   */
  async getRealtimePrice(stockId) {
    try {
      // 大盤指數特殊處理
      if (stockId === 't00' || stockId === 'TAIEX' || stockId === '加權指數') {
        return await this.getTaiexIndex();
      }
      
      // 先嘗試上市
      let data = await this.fetchTWSE(stockId);
      
      // 如果失敗，嘗試上櫃
      if (!data) {
        data = await this.fetchOTC(stockId);
      }
      
      if (data) {
        data = this.calculateChange(data);
      }
      
      return data;
    } catch (error) {
      console.error(`取得 ${stockId} 股價失敗:`, error.message);
      return null;
    }
  }

  /**
   * 取得加權指數（大盤）
   */
  async getTaiexIndex() {
    try {
      const url = 'https://mis.twse.com.tw/stock/api/getStockInfo.jsp?ex_ch=tse_t00.tw';
      const response = await axios.get(url, {
        headers: { 'User-Agent': 'Mozilla/5.0' },
        timeout: 10000
      });

      const data = response.data;
      if (data.msgArray && data.msgArray.length > 0) {
        const index = data.msgArray[0];
        const price = parseFloat(index.z) || parseFloat(index.y) || 0;
        const yesterday = parseFloat(index.y) || 0;
        const change = price - yesterday;
        const changePercent = yesterday > 0 ? ((change / yesterday) * 100).toFixed(2) : 0;
        
        return {
          id: 't00',
          name: '加權指數',
          price: price,
          open: parseFloat(index.o) || 0,
          high: parseFloat(index.h) || 0,
          low: parseFloat(index.l) || 0,
          yesterday: yesterday,
          change: change,
          changePercent: parseFloat(changePercent),
          volume: parseInt(index.v) || 0,
          time: index.t || '',
          market: 'TAIEX'
        };
      }
      return null;
    } catch (error) {
      console.error('取得大盤失敗:', error.message);
      return null;
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

    const sql = `
      INSERT INTO price_history (stock_id, date, open_price, high_price, low_price, close_price, volume)
      VALUES ($1, CURRENT_DATE, $2, $3, $4, $5, $6)
      ON CONFLICT (stock_id, date) 
      DO UPDATE SET 
        open_price = $2, high_price = $3, low_price = $4, 
        close_price = $5, volume = $6
    `;

    try {
      await pool.query(sql, [
        stockData.id,
        stockData.open,
        stockData.high,
        stockData.low,
        stockData.price,
        stockData.volume
      ]);
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

  // ==================== 美股功能 ====================

  /**
   * 🇺🇸 取得美股即時報價（使用 Yahoo Finance）
   */
  async getUSStockPrice(symbol) {
    try {
      const upperSymbol = symbol.toUpperCase();
      const url = `https://query1.finance.yahoo.com/v8/finance/chart/${upperSymbol}?interval=1d&range=1d`;
      
      const response = await axios.get(url, {
        headers: { 
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        },
        timeout: 10000
      });

      const data = response.data;
      if (!data.chart || !data.chart.result || data.chart.result.length === 0) {
        return null;
      }

      const result = data.chart.result[0];
      const meta = result.meta;
      const quote = result.indicators.quote[0];
      
      const price = meta.regularMarketPrice || 0;
      const previousClose = meta.previousClose || meta.chartPreviousClose || 0;
      const change = price - previousClose;
      const changePercent = previousClose > 0 ? ((change / previousClose) * 100) : 0;

      // 盤前盤後價格
      const preMarketPrice = meta.preMarketPrice || null;
      const postMarketPrice = meta.postMarketPrice || null;

      return {
        id: upperSymbol,
        symbol: upperSymbol,
        name: meta.shortName || meta.symbol || upperSymbol,
        price: price,
        open: quote.open ? quote.open[quote.open.length - 1] : 0,
        high: quote.high ? Math.max(...quote.high.filter(h => h)) : 0,
        low: quote.low ? Math.min(...quote.low.filter(l => l)) : 0,
        yesterday: previousClose,
        change: change,
        changePercent: parseFloat(changePercent.toFixed(2)),
        volume: quote.volume ? quote.volume[quote.volume.length - 1] : 0,
        preMarketPrice: preMarketPrice,
        postMarketPrice: postMarketPrice,
        currency: meta.currency || 'USD',
        exchange: meta.exchangeName || 'NASDAQ',
        market: 'US',  // 標記為美股
        marketState: meta.marketState || 'CLOSED' // PRE, REGULAR, POST, CLOSED
      };

    } catch (error) {
      console.error(`取得美股 ${symbol} 失敗:`, error.message);
      return null;
    }
  }

  /**
   * 🇺🇸 取得美股三大指數
   */
  async getUSIndices() {
    const indices = [
      { symbol: '^DJI', name: '道瓊工業' },
      { symbol: '^GSPC', name: 'S&P 500' },
      { symbol: '^IXIC', name: '那斯達克' }
    ];

    const results = [];
    for (const index of indices) {
      const data = await this.getUSStockPrice(index.symbol);
      if (data) {
        data.name = index.name;
        results.push(data);
      }
      await this.sleep(300);
    }
    return results;
  }

  /**
   * 🇺🇸 取得熱門美股
   */
  async getHotUSStocks() {
    const hotStocks = [
      'AAPL', 'MSFT', 'GOOGL', 'AMZN', 'NVDA', 
      'META', 'TSLA', 'TSM', 'AMD', 'INTC'
    ];

    const results = [];
    for (const symbol of hotStocks) {
      const data = await this.getUSStockPrice(symbol);
      if (data) {
        results.push(data);
      }
      await this.sleep(300);
    }
    
    // 按漲跌幅排序
    results.sort((a, b) => b.changePercent - a.changePercent);
    return results;
  }

  /**
   * 🇹🇼🇺🇸 取得台積電 ADR 價差
   */
  async getTSMSpread() {
    try {
      const [twStock, usStock] = await Promise.all([
        this.getRealtimePrice('2330'),
        this.getUSStockPrice('TSM')
      ]);

      if (!twStock || !usStock) return null;

      // 假設匯率（實際應該抓即時匯率）
      const usdTwd = 31.5;
      
      // TSM ADR = 5 股台積電
      const adrInTwd = (usStock.price * usdTwd) / 5;
      const spread = ((adrInTwd - twStock.price) / twStock.price * 100).toFixed(2);

      return {
        tw: twStock,
        us: usStock,
        usdTwd: usdTwd,
        adrInTwd: adrInTwd.toFixed(2),
        spread: parseFloat(spread), // 正數=ADR溢價，負數=ADR折價
        spreadText: spread > 0 ? `ADR 溢價 ${spread}%` : `ADR 折價 ${Math.abs(spread)}%`
      };
    } catch (error) {
      console.error('取得 TSM 價差失敗:', error.message);
      return null;
    }
  }

  /**
   * 取得即時匯率
   */
  async getExchangeRate(from = 'USD', to = 'TWD') {
    try {
      const symbol = `${from}${to}=X`;
      const data = await this.getUSStockPrice(symbol);
      return data ? data.price : 31.5; // 預設匯率
    } catch (error) {
      return 31.5;
    }
  }
}

module.exports = new StockService();
