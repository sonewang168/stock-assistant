/**
 * 💬 LINE 服務 - Flex Message 推播
 */

const axios = require('axios');
const { pool } = require('../db');

class LineService {

  /**
   * 🕐 取得台灣時間字串
   */
  getTaiwanTime() {
    return new Date().toLocaleTimeString('zh-TW', { 
      timeZone: 'Asia/Taipei',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
  }

  /**
   * 🕐 取得台灣日期字串
   */
  getTaiwanDate() {
    return new Date().toLocaleDateString('zh-TW', { 
      timeZone: 'Asia/Taipei',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric'
    });
  }

  /**
   * 發送 Flex Message
   */
  async sendFlexMessage(userId, flexContent) {
    const token = process.env.LINE_CHANNEL_ACCESS_TOKEN || process.env.LINE_CHANNEL_TOKEN;
    if (!token || !userId) {
      console.log('LINE 設定不完整');
      return false;
    }

    try {
      const response = await axios.post('https://api.line.me/v2/bot/message/push', {
        to: userId,
        messages: [flexContent]
      }, {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        timeout: 10000
      });

      console.log('LINE 推播成功');
      return true;

    } catch (error) {
      console.error('LINE 推播失敗:', error.response?.data || error.message);
      return false;
    }
  }

  /**
   * 回覆訊息
   */
  async replyMessage(replyToken, message) {
    const token = process.env.LINE_CHANNEL_ACCESS_TOKEN || process.env.LINE_CHANNEL_TOKEN;
    if (!token) return false;

    try {
      await axios.post('https://api.line.me/v2/bot/message/reply', {
        replyToken: replyToken,
        messages: [message]
      }, {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        }
      });
      return true;
    } catch (error) {
      console.error('LINE 回覆失敗:', error.message);
      return false;
    }
  }

  /**
   * 建立股票警報 Flex Message（台灣配色：紅漲綠跌）
   */
  createStockAlertFlex(alert, aiComment) {
    const stock = alert.stock;
    const isUp = stock.change >= 0;
    // 🆕 台灣股市配色：紅漲綠跌
    const color = isUp ? '#D32F2F' : '#388E3C';
    const arrow = isUp ? '▲' : '▼';

    return {
      type: 'flex',
      altText: `${stock.name} ${alert.message}`,
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
                { type: 'text', text: stock.name, color: '#ffffff', size: 'xl', weight: 'bold', flex: 1 },
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
                { type: 'text', text: `${stock.price}`, size: '3xl', weight: 'bold', color: color },
                { type: 'text', text: `${arrow} ${stock.changePercent}%`, size: 'xl', color: color, align: 'end', gravity: 'bottom' }
              ]
            },
            { type: 'separator', margin: 'lg' },
            {
              type: 'box',
              layout: 'horizontal',
              margin: 'lg',
              contents: [
                { type: 'text', text: '開盤', size: 'sm', color: '#888888', flex: 1 },
                { type: 'text', text: `${stock.open}`, size: 'sm', align: 'end', flex: 1 },
                { type: 'text', text: '最高', size: 'sm', color: '#888888', flex: 1 },
                { type: 'text', text: `${stock.high}`, size: 'sm', align: 'end', flex: 1 }
              ]
            },
            {
              type: 'box',
              layout: 'horizontal',
              margin: 'sm',
              contents: [
                { type: 'text', text: '昨收', size: 'sm', color: '#888888', flex: 1 },
                { type: 'text', text: `${stock.yesterday}`, size: 'sm', align: 'end', flex: 1 },
                { type: 'text', text: '最低', size: 'sm', color: '#888888', flex: 1 },
                { type: 'text', text: `${stock.low}`, size: 'sm', align: 'end', flex: 1 }
              ]
            },
            { type: 'separator', margin: 'lg' },
            {
              type: 'box',
              layout: 'vertical',
              margin: 'lg',
              contents: [
                { type: 'text', text: '💬 AI 短評', size: 'sm', color: '#888888' },
                { type: 'text', text: aiComment, size: 'md', wrap: true, margin: 'sm' }
              ]
            }
          ],
          paddingAll: '20px'
        },
        footer: {
          type: 'box',
          layout: 'horizontal',
          contents: [
            { type: 'text', text: `⏰ ${this.getTaiwanTime()}`, size: 'xs', color: '#888888' }
          ],
          paddingAll: '15px'
        }
      }
    };
  }

  /**
   * 建立日報 Flex Message
   */
  createDailyReportFlex(stockDataList, aiSummary) {
    const today = this.getTaiwanDate();

    const stockRows = stockDataList.slice(0, 10).map(stock => {
      const isUp = stock.change >= 0;
      // 🆕 台灣股市配色：紅漲綠跌
      const color = isUp ? '#D32F2F' : '#388E3C';
      const arrow = isUp ? '▲' : '▼';

      return {
        type: 'box',
        layout: 'horizontal',
        contents: [
          { type: 'text', text: stock.name, size: 'sm', flex: 3 },
          { type: 'text', text: `${stock.price}`, size: 'sm', align: 'end', flex: 2 },
          { type: 'text', text: `${arrow}${stock.changePercent}%`, size: 'sm', color: color, align: 'end', flex: 2 }
        ],
        margin: 'sm'
      };
    });

    return {
      type: 'flex',
      altText: `📊 ${today} 收盤日報`,
      contents: {
        type: 'bubble',
        size: 'mega',
        header: {
          type: 'box',
          layout: 'vertical',
          contents: [
            { type: 'text', text: '📊 收盤日報', size: 'xl', weight: 'bold', color: '#ffffff' },
            { type: 'text', text: today, size: 'sm', color: '#ffffffaa', margin: 'sm' }
          ],
          backgroundColor: '#2C3E50',
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
                { type: 'text', text: '股票', size: 'xs', color: '#888888', flex: 3 },
                { type: 'text', text: '收盤價', size: 'xs', color: '#888888', align: 'end', flex: 2 },
                { type: 'text', text: '漲跌', size: 'xs', color: '#888888', align: 'end', flex: 2 }
              ]
            },
            { type: 'separator', margin: 'md' },
            ...stockRows,
            { type: 'separator', margin: 'lg' },
            {
              type: 'box',
              layout: 'vertical',
              margin: 'lg',
              contents: [
                { type: 'text', text: '💬 AI 總評', size: 'sm', color: '#888888' },
                { type: 'text', text: aiSummary, size: 'sm', wrap: true, margin: 'sm' }
              ]
            }
          ],
          paddingAll: '20px'
        }
      }
    };
  }

  /**
   * 建立持股報告 Flex（台灣配色：紅漲綠跌）
   */
  createPortfolioFlex(portfolio) {
    const isProfit = portfolio.totalProfit >= 0;
    // 🆕 台灣股市配色：紅漲綠跌
    const color = isProfit ? '#D32F2F' : '#388E3C';

    const holdingRows = portfolio.holdings.slice(0, 8).map(h => {
      const hColor = h.profit >= 0 ? '#D32F2F' : '#388E3C';
      return {
        type: 'box',
        layout: 'horizontal',
        contents: [
          { type: 'text', text: h.name, size: 'xs', flex: 2 },
          { type: 'text', text: `${h.currentPrice}`, size: 'xs', align: 'end', flex: 1 },
          { type: 'text', text: `${h.profitPercent}%`, size: 'xs', color: hColor, align: 'end', flex: 1 }
        ],
        margin: 'sm'
      };
    });

    return {
      type: 'flex',
      altText: `💼 持股報告 ${isProfit ? '📈' : '📉'} ${portfolio.totalProfitPercent}%`,
      contents: {
        type: 'bubble',
        size: 'mega',
        header: {
          type: 'box',
          layout: 'vertical',
          contents: [
            { type: 'text', text: '💼 我的持股', size: 'xl', weight: 'bold', color: '#ffffff' },
            { type: 'text', text: `總報酬 ${isProfit ? '+' : ''}${portfolio.totalProfitPercent}%`, size: 'md', color: '#ffffff', margin: 'sm' }
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
                { type: 'text', text: '總市值', size: 'sm', color: '#888888' },
                { type: 'text', text: `$${portfolio.totalValue.toLocaleString()}`, size: 'lg', weight: 'bold', align: 'end' }
              ]
            },
            {
              type: 'box',
              layout: 'horizontal',
              margin: 'md',
              contents: [
                { type: 'text', text: '總損益', size: 'sm', color: '#888888' },
                { type: 'text', text: `${isProfit ? '+' : ''}$${portfolio.totalProfit.toLocaleString()}`, size: 'sm', color: color, align: 'end' }
              ]
            },
            { type: 'separator', margin: 'lg' },
            ...holdingRows
          ],
          paddingAll: '20px'
        }
      }
    };
  }

  /**
   * 記錄推播
   */
  async logAlert(alert, aiComment) {
    const sql = `
      INSERT INTO alert_logs (stock_id, stock_name, alert_type, price, change_percent, ai_comment)
      VALUES ($1, $2, $3, $4, $5, $6)
    `;

    try {
      await pool.query(sql, [
        alert.stock.id,
        alert.stock.name,
        alert.type,
        alert.stock.price,
        alert.stock.changePercent,
        aiComment
      ]);
    } catch (error) {
      console.error('記錄推播失敗:', error.message);
    }
  }

  /**
   * 🔊 發送語音訊息
   */
  async sendAudioMessage(userId, audioUrl, duration = 10000) {
    const token = process.env.LINE_CHANNEL_ACCESS_TOKEN || process.env.LINE_CHANNEL_TOKEN;
    if (!token || !userId) {
      console.log('LINE 設定不完整');
      return false;
    }

    try {
      await axios.post('https://api.line.me/v2/bot/message/push', {
        to: userId,
        messages: [{
          type: 'audio',
          originalContentUrl: audioUrl,
          duration: duration
        }]
      }, {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        timeout: 10000
      });

      console.log('LINE 語音推播成功');
      return true;

    } catch (error) {
      console.error('LINE 語音推播失敗:', error.response?.data || error.message);
      return false;
    }
  }

  /**
   * 🔊 發送股票語音播報
   */
  async sendStockVoiceAlert(userId, stock, voiceService) {
    const isUp = stock.change >= 0;
    const text = `${stock.name}，現價 ${stock.price} 元，` +
      `${isUp ? '上漲' : '下跌'} ${Math.abs(stock.change)} 元，` +
      `漲跌幅 ${Math.abs(stock.changePercent).toFixed(2)} 趴`;

    try {
      // 生成語音
      const voiceResult = await voiceService.textToSpeech(text);
      
      if (!voiceResult || voiceResult.useBrowserTTS) {
        // 如果無法生成語音，發送文字
        return await this.sendTextMessage(userId, `🔊 ${text}`);
      }

      // 儲存音訊檔案
      const filename = `stock_${stock.id}_${Date.now()}.mp3`;
      const audioPath = `/audio/${filename}`;
      const fullPath = require('path').join(__dirname, '../../client/audio', filename);
      
      // 確保目錄存在
      const audioDir = require('path').join(__dirname, '../../client/audio');
      if (!require('fs').existsSync(audioDir)) {
        require('fs').mkdirSync(audioDir, { recursive: true });
      }
      
      // 寫入檔案
      const audioBuffer = Buffer.from(voiceResult.audio, 'base64');
      require('fs').writeFileSync(fullPath, audioBuffer);

      // 取得公開 URL
      const baseUrl = process.env.FRONTEND_URL || `https://stock-assistant-577m.onrender.com`;
      const audioUrl = `${baseUrl}${audioPath}`;

      // 發送語音
      await this.sendAudioMessage(userId, audioUrl, 10000);
      
      // 清理舊檔案（保留最近 50 個）
      this.cleanupOldAudioFiles(audioDir, 50);
      
      return true;

    } catch (error) {
      console.error('發送語音播報失敗:', error.message);
      return false;
    }
  }

  /**
   * 發送純文字訊息
   */
  async sendTextMessage(userId, text) {
    const token = process.env.LINE_CHANNEL_ACCESS_TOKEN || process.env.LINE_CHANNEL_TOKEN;
    if (!token || !userId) return false;

    try {
      await axios.post('https://api.line.me/v2/bot/message/push', {
        to: userId,
        messages: [{
          type: 'text',
          text: text
        }]
      }, {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        timeout: 10000
      });
      return true;
    } catch (error) {
      console.error('LINE 文字推播失敗:', error.message);
      return false;
    }
  }

  /**
   * 清理舊的音訊檔案
   */
  cleanupOldAudioFiles(audioDir, keepCount) {
    try {
      const fs = require('fs');
      const path = require('path');
      
      const files = fs.readdirSync(audioDir)
        .filter(f => f.endsWith('.mp3'))
        .map(f => ({
          name: f,
          path: path.join(audioDir, f),
          time: fs.statSync(path.join(audioDir, f)).mtime.getTime()
        }))
        .sort((a, b) => b.time - a.time);

      // 刪除超過數量的舊檔案
      files.slice(keepCount).forEach(f => {
        fs.unlinkSync(f.path);
      });
    } catch (error) {
      // 忽略清理錯誤
    }
  }
}

module.exports = new LineService();
