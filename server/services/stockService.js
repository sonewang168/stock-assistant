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
}

module.exports = new StockService();
