/**
 * 📈 技術分析服務 - RSI, KD, MACD, 布林通道
 */

const { pool } = require('../db');

class TechnicalService {

  /**
   * 取得完整技術指標
   */
  async getFullIndicators(stockId) {
    const history = await this.getPriceHistory(stockId, 60);
    
    if (history.length < 26) {
      return null;
    }

    const closes = history.map(h => parseFloat(h.close_price));
    const highs = history.map(h => parseFloat(h.high_price));
    const lows = history.map(h => parseFloat(h.low_price));

    return {
      rsi: this.calculateRSI(closes, 14),
      kd: this.calculateKD(highs, lows, closes, 9),
      macd: this.calculateMACD(closes),
      bollinger: this.calculateBollingerBands(closes, 20),
      ma5: this.calculateMA(closes, 5),
      ma10: this.calculateMA(closes, 10),
      ma20: this.calculateMA(closes, 20),
      ma60: this.calculateMA(closes, 60)
    };
  }

  /**
   * 取得價格歷史
   */
  async getPriceHistory(stockId, days) {
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
   * 計算 RSI
   */
  calculateRSI(prices, period = 14) {
    if (prices.length < period + 1) return null;

    let gains = 0;
    let losses = 0;

    for (let i = 0; i < period; i++) {
      const change = prices[i] - prices[i + 1];
      if (change > 0) gains += change;
      else losses += Math.abs(change);
    }

    const avgGain = gains / period;
    const avgLoss = losses / period;

    if (avgLoss === 0) return 100;

    const rs = avgGain / avgLoss;
    const rsi = 100 - (100 / (1 + rs));

    return Math.round(rsi * 100) / 100;
  }

  /**
   * 計算 KD 指標
   */
  calculateKD(highs, lows, closes, period = 9) {
    if (closes.length < period) return null;

    const highestHigh = Math.max(...highs.slice(0, period));
    const lowestLow = Math.min(...lows.slice(0, period));
    const currentClose = closes[0];

    if (highestHigh === lowestLow) return { k: 50, d: 50, rsv: 50 };

    const rsv = ((currentClose - lowestLow) / (highestHigh - lowestLow)) * 100;
    const k = Math.round(rsv * 100) / 100;
    const d = k; // 簡化

    return { k, d, rsv: Math.round(rsv * 100) / 100 };
  }

  /**
   * 計算 MACD
   */
  calculateMACD(prices) {
    if (prices.length < 26) return null;

    const ema12 = this.calculateEMA(prices, 12);
    const ema26 = this.calculateEMA(prices, 26);

    if (!ema12 || !ema26) return null;

    const dif = ema12 - ema26;
    const macd = dif * 2;
    const osc = dif - (dif * 0.8);

    return {
      dif: Math.round(dif * 100) / 100,
      macd: Math.round(macd * 100) / 100,
      osc: Math.round(osc * 100) / 100
    };
  }

  /**
   * 計算 EMA
   */
  calculateEMA(prices, period) {
    if (prices.length < period) return null;

    const multiplier = 2 / (period + 1);
    let ema = prices.slice(0, period).reduce((a, b) => a + b, 0) / period;

    for (let i = period - 1; i >= 0; i--) {
      ema = (prices[i] - ema) * multiplier + ema;
    }

    return ema;
  }

  /**
   * 計算簡單移動平均線
   */
  calculateMA(prices, period) {
    if (prices.length < period) return null;

    const sum = prices.slice(0, period).reduce((a, b) => a + b, 0);
    return Math.round((sum / period) * 100) / 100;
  }

  /**
   * 計算布林通道
   */
  calculateBollingerBands(prices, period = 20, stdDev = 2) {
    if (prices.length < period) return null;

    const slice = prices.slice(0, period);
    const ma = slice.reduce((a, b) => a + b, 0) / period;

    const squaredDiffs = slice.map(p => Math.pow(p - ma, 2));
    const variance = squaredDiffs.reduce((a, b) => a + b, 0) / period;
    const std = Math.sqrt(variance);

    return {
      upper: Math.round((ma + stdDev * std) * 100) / 100,
      middle: Math.round(ma * 100) / 100,
      lower: Math.round((ma - stdDev * std) * 100) / 100,
      bandwidth: Math.round((std * stdDev * 2 / ma) * 10000) / 100
    };
  }

  /**
   * 檢查均線突破
   */
  async checkMABreakout(stockId, currentPrice, period = 20) {
    const history = await this.getPriceHistory(stockId, period + 1);
    if (history.length < period + 1) return null;

    const closes = history.map(h => parseFloat(h.close_price));
    const ma = this.calculateMA(closes.slice(1), period);
    const prevPrice = closes[1];

    if (!ma) return null;

    // 突破
    if (prevPrice < ma && currentPrice > ma) {
      return { type: 'breakout', ma, period };
    }
    // 跌破
    if (prevPrice > ma && currentPrice < ma) {
      return { type: 'breakdown', ma, period };
    }

    return null;
  }

  /**
   * 檢查 N 日高低點
   */
  async checkHighLow(stockId, currentPrice, days = 20) {
    const history = await this.getPriceHistory(stockId, days);
    if (history.length < days) return null;

    const highs = history.map(h => parseFloat(h.high_price));
    const lows = history.map(h => parseFloat(h.low_price));

    const maxPrice = Math.max(...highs);
    const minPrice = Math.min(...lows);

    if (currentPrice > maxPrice) {
      return { type: 'new_high', days, price: maxPrice };
    }
    if (currentPrice < minPrice) {
      return { type: 'new_low', days, price: minPrice };
    }

    return null;
  }

  /**
   * 取得 RSI 狀態描述
   */
  getRSIStatus(rsi) {
    if (rsi >= 80) return { status: '嚴重超買', color: '#ff4444' };
    if (rsi >= 70) return { status: '超買', color: '#ff8800' };
    if (rsi <= 20) return { status: '嚴重超賣', color: '#00aa00' };
    if (rsi <= 30) return { status: '超賣', color: '#00cc00' };
    return { status: '中性', color: '#888888' };
  }

  /**
   * 取得 KD 狀態描述
   */
  getKDStatus(k, d) {
    if (k > d && k > 80) return { status: '高檔鈍化', color: '#ff8800' };
    if (k < d && k < 20) return { status: '低檔鈍化', color: '#00cc00' };
    if (k > d) return { status: '黃金交叉', color: '#00cc00' };
    if (k < d) return { status: '死亡交叉', color: '#ff4444' };
    return { status: '中性', color: '#888888' };
  }
}

module.exports = new TechnicalService();
