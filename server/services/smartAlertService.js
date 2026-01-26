/**
 * 🔔 智能通知服務
 * 技術指標突破、成交量異常通知
 */

const { pool } = require('../db');
const stockService = require('./stockService');
const technicalService = require('./technicalService');
const lineService = require('./lineService');

class SmartAlertService {

  /**
   * 通知類型定義
   */
  static ALERT_TYPES = {
    RSI_OVERBOUGHT: 'rsi_overbought',      // RSI 超買 (>70)
    RSI_OVERSOLD: 'rsi_oversold',          // RSI 超賣 (<30)
    KD_GOLDEN_CROSS: 'kd_golden_cross',    // KD 黃金交叉
    KD_DEATH_CROSS: 'kd_death_cross',      // KD 死亡交叉
    MACD_BULLISH: 'macd_bullish',          // MACD 翻多
    MACD_BEARISH: 'macd_bearish',          // MACD 翻空
    VOLUME_SPIKE: 'volume_spike',          // 成交量暴增
    PRICE_BREAKOUT: 'price_breakout',      // 突破壓力
    PRICE_BREAKDOWN: 'price_breakdown',    // 跌破支撐
    MA_CROSS_UP: 'ma_cross_up',            // 突破均線
    MA_CROSS_DOWN: 'ma_cross_down'         // 跌破均線
  };

  /**
   * 新增智能通知設定
   */
  async addSmartAlert(userId, stockId, alertType, conditionValue = null) {
    try {
      const result = await pool.query(`
        INSERT INTO smart_alerts (user_id, stock_id, alert_type, condition_value)
        VALUES ($1, $2, $3, $4)
        RETURNING *
      `, [userId, stockId, alertType, conditionValue]);
      return result.rows[0];
    } catch (error) {
      console.error('新增智能通知失敗:', error.message);
      return null;
    }
  }

  /**
   * 取得使用者的智能通知設定
   */
  async getUserAlerts(userId) {
    try {
      const result = await pool.query(`
        SELECT sa.*, s.name as stock_name
        FROM smart_alerts sa
        LEFT JOIN stocks s ON sa.stock_id = s.id
        WHERE sa.user_id = $1 AND sa.is_active = true
        ORDER BY sa.created_at DESC
      `, [userId]);
      return result.rows;
    } catch (error) {
      console.error('取得智能通知失敗:', error.message);
      return [];
    }
  }

  /**
   * 刪除智能通知
   */
  async deleteSmartAlert(alertId, userId) {
    try {
      await pool.query(`
        UPDATE smart_alerts SET is_active = false 
        WHERE id = $1 AND user_id = $2
      `, [alertId, userId]);
      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * 檢查所有智能通知條件
   */
  async checkAllAlerts() {
    console.log('🔔 開始檢查智能通知...');
    
    try {
      // 取得所有啟用的通知設定（按股票分組）
      const alerts = await pool.query(`
        SELECT DISTINCT stock_id FROM smart_alerts WHERE is_active = true
        UNION
        SELECT DISTINCT stock_id FROM watchlist WHERE is_active = true
        UNION
        SELECT DISTINCT stock_id FROM holdings WHERE is_won = true
      `);

      const triggeredAlerts = [];

      for (const row of alerts.rows) {
        const stockId = row.stock_id;
        
        try {
          // 取得股票資料
          const stockData = await stockService.getRealtimePrice(stockId);
          if (!stockData) continue;

          // 取得技術指標
          const technical = await technicalService.getFullIndicators(stockId);
          if (!technical) continue;

          // 檢查各種條件
          const alerts = await this.checkStockConditions(stockId, stockData, technical);
          triggeredAlerts.push(...alerts);

          await new Promise(r => setTimeout(r, 200));
        } catch (e) {
          console.log(`檢查 ${stockId} 失敗:`, e.message);
        }
      }

      // 發送通知
      if (triggeredAlerts.length > 0) {
        await this.sendAlertNotifications(triggeredAlerts);
      }

      console.log(`🔔 智能通知檢查完成，觸發 ${triggeredAlerts.length} 個通知`);
      return triggeredAlerts;

    } catch (error) {
      console.error('檢查智能通知失敗:', error.message);
      return [];
    }
  }

  /**
   * 檢查單一股票的所有條件
   */
  async checkStockConditions(stockId, stockData, technical) {
    const triggered = [];
    const now = new Date();
    const cooldownHours = 4; // 同一通知 4 小時內不重複

    // 取得該股票的通知設定
    const alertSettings = await pool.query(`
      SELECT * FROM smart_alerts 
      WHERE stock_id = $1 AND is_active = true
    `, [stockId]);

    // 檢查 RSI 超買超賣
    if (technical.rsi) {
      if (technical.rsi >= 70) {
        triggered.push({
          stockId,
          stockName: stockData.name,
          type: 'RSI_OVERBOUGHT',
          title: '📈 RSI 超買警示',
          message: `${stockData.name}(${stockId}) RSI=${technical.rsi.toFixed(1)} 已進入超買區，注意回檔風險`,
          value: technical.rsi,
          price: stockData.price
        });
      } else if (technical.rsi <= 30) {
        triggered.push({
          stockId,
          stockName: stockData.name,
          type: 'RSI_OVERSOLD',
          title: '📉 RSI 超賣警示',
          message: `${stockData.name}(${stockId}) RSI=${technical.rsi.toFixed(1)} 已進入超賣區，可留意反彈機會`,
          value: technical.rsi,
          price: stockData.price
        });
      }
    }

    // 檢查 KD 交叉
    if (technical.kd) {
      const { k, d, prevK, prevD } = technical.kd;
      if (prevK !== undefined && prevD !== undefined) {
        // 黃金交叉：K 從下往上穿越 D
        if (prevK < prevD && k > d && k < 50) {
          triggered.push({
            stockId,
            stockName: stockData.name,
            type: 'KD_GOLDEN_CROSS',
            title: '✨ KD 黃金交叉',
            message: `${stockData.name}(${stockId}) KD 低檔黃金交叉 K=${k.toFixed(1)} D=${d.toFixed(1)}，可能有反彈`,
            value: k,
            price: stockData.price
          });
        }
        // 死亡交叉：K 從上往下穿越 D
        if (prevK > prevD && k < d && k > 50) {
          triggered.push({
            stockId,
            stockName: stockData.name,
            type: 'KD_DEATH_CROSS',
            title: '⚠️ KD 死亡交叉',
            message: `${stockData.name}(${stockId}) KD 高檔死亡交叉 K=${k.toFixed(1)} D=${d.toFixed(1)}，注意回檔`,
            value: k,
            price: stockData.price
          });
        }
      }
    }

    // 檢查 MACD 翻多翻空
    if (technical.macd) {
      const { dif, macd, prevDif } = technical.macd;
      if (prevDif !== undefined) {
        if (prevDif < 0 && dif >= 0) {
          triggered.push({
            stockId,
            stockName: stockData.name,
            type: 'MACD_BULLISH',
            title: '🔥 MACD 翻多',
            message: `${stockData.name}(${stockId}) MACD DIF 由負轉正，多頭訊號出現`,
            value: dif,
            price: stockData.price
          });
        } else if (prevDif > 0 && dif <= 0) {
          triggered.push({
            stockId,
            stockName: stockData.name,
            type: 'MACD_BEARISH',
            title: '❄️ MACD 翻空',
            message: `${stockData.name}(${stockId}) MACD DIF 由正轉負，空頭訊號出現`,
            value: dif,
            price: stockData.price
          });
        }
      }
    }

    // 檢查成交量異常（需要均量資料）
    if (stockData.volume && technical.avgVolume) {
      const volumeRatio = stockData.volume / technical.avgVolume;
      if (volumeRatio >= 2) {
        triggered.push({
          stockId,
          stockName: stockData.name,
          type: 'VOLUME_SPIKE',
          title: '📊 成交量暴增',
          message: `${stockData.name}(${stockId}) 今日成交量是近期均量的 ${volumeRatio.toFixed(1)} 倍！`,
          value: volumeRatio,
          price: stockData.price
        });
      }
    }

    // 檢查均線突破/跌破
    if (technical.ma20 && stockData.price && stockData.prevClose) {
      const prevPrice = stockData.prevClose;
      const ma20 = technical.ma20;
      
      // 突破 MA20
      if (prevPrice < ma20 && stockData.price > ma20) {
        triggered.push({
          stockId,
          stockName: stockData.name,
          type: 'MA_CROSS_UP',
          title: '📈 突破月線',
          message: `${stockData.name}(${stockId}) 股價突破 20 日均線 $${ma20.toFixed(1)}`,
          value: ma20,
          price: stockData.price
        });
      }
      // 跌破 MA20
      if (prevPrice > ma20 && stockData.price < ma20) {
        triggered.push({
          stockId,
          stockName: stockData.name,
          type: 'MA_CROSS_DOWN',
          title: '📉 跌破月線',
          message: `${stockData.name}(${stockId}) 股價跌破 20 日均線 $${ma20.toFixed(1)}`,
          value: ma20,
          price: stockData.price
        });
      }
    }

    // 過濾已觸發過的通知（冷卻時間內不重複）
    const filtered = [];
    for (const alert of triggered) {
      const recent = await pool.query(`
        SELECT * FROM smart_alerts 
        WHERE stock_id = $1 AND alert_type = $2 
        AND last_triggered > NOW() - INTERVAL '${cooldownHours} hours'
      `, [alert.stockId, alert.type]);
      
      if (recent.rows.length === 0) {
        filtered.push(alert);
        // 更新觸發時間
        await pool.query(`
          UPDATE smart_alerts SET last_triggered = NOW()
          WHERE stock_id = $1 AND alert_type = $2
        `, [alert.stockId, alert.type]);
      }
    }

    return filtered;
  }

  /**
   * 發送通知到 LINE
   */
  async sendAlertNotifications(alerts) {
    if (alerts.length === 0) return;

    try {
      // 建立 Flex Message
      const bubbles = alerts.slice(0, 5).map(alert => {
        const isPositive = ['RSI_OVERSOLD', 'KD_GOLDEN_CROSS', 'MACD_BULLISH', 'MA_CROSS_UP'].includes(alert.type);
        const bgColor = isPositive ? '#4CAF50' : '#F44336';
        
        return {
          type: 'bubble',
          size: 'kilo',
          header: {
            type: 'box',
            layout: 'vertical',
            contents: [
              { type: 'text', text: alert.title, size: 'md', color: '#ffffff', weight: 'bold' }
            ],
            backgroundColor: bgColor,
            paddingAll: '12px'
          },
          body: {
            type: 'box',
            layout: 'vertical',
            contents: [
              { type: 'text', text: `${alert.stockName}(${alert.stockId})`, size: 'lg', weight: 'bold' },
              { type: 'text', text: `現價: $${alert.price}`, size: 'sm', color: '#666666', margin: 'sm' },
              { type: 'separator', margin: 'md' },
              { type: 'text', text: alert.message, size: 'sm', wrap: true, margin: 'md' }
            ],
            paddingAll: '15px'
          }
        };
      });

      const flexMessage = {
        type: 'flex',
        altText: `🔔 ${alerts.length} 個智能通知`,
        contents: alerts.length === 1 ? bubbles[0] : { type: 'carousel', contents: bubbles }
      };

      await lineService.broadcastMessage(flexMessage);
      console.log(`📤 已推送 ${alerts.length} 個智能通知`);

    } catch (error) {
      console.error('發送智能通知失敗:', error.message);
    }
  }

  /**
   * 取得通知類型的中文說明
   */
  getAlertTypeDescription(type) {
    const descriptions = {
      'rsi_overbought': 'RSI 超買 (>70)',
      'rsi_oversold': 'RSI 超賣 (<30)',
      'kd_golden_cross': 'KD 黃金交叉',
      'kd_death_cross': 'KD 死亡交叉',
      'macd_bullish': 'MACD 翻多',
      'macd_bearish': 'MACD 翻空',
      'volume_spike': '成交量暴增 (2倍以上)',
      'ma_cross_up': '突破 20 日均線',
      'ma_cross_down': '跌破 20 日均線'
    };
    return descriptions[type] || type;
  }

  /**
   * 為股票設定所有基本智能通知
   */
  async setupDefaultAlerts(userId, stockId) {
    const types = [
      'rsi_overbought', 'rsi_oversold',
      'kd_golden_cross', 'kd_death_cross',
      'macd_bullish', 'macd_bearish',
      'volume_spike', 'ma_cross_up', 'ma_cross_down'
    ];

    for (const type of types) {
      try {
        await pool.query(`
          INSERT INTO smart_alerts (user_id, stock_id, alert_type)
          VALUES ($1, $2, $3)
          ON CONFLICT DO NOTHING
        `, [userId, stockId, type]);
      } catch (e) {}
    }

    return true;
  }
}

module.exports = new SmartAlertService();
