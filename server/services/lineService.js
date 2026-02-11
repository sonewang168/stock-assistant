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
   * 建立股票警報 Flex Message（🔥 雙 AI 各自獨立卡片）
   */
  createStockAlertFlex(alert, aiComment) {
    const stock = alert.stock;
    const isUp = stock.change >= 0;
    // 台灣股市：紅漲綠跌
    const color = isUp ? '#ff4444' : '#00C851';
    const arrow = isUp ? '▲' : '▼';

    // 解析雙 AI 分析結果
    const { bullish, bearish, summary, aiSource1, aiSource2 } = this.parseAIComment(aiComment);

    // 📊 卡片 1：股價資訊
    const card1 = {
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
          }
        ],
        paddingAll: '20px'
      },
      footer: {
        type: 'box',
        layout: 'horizontal',
        contents: [
          { type: 'text', text: '👉 滑動看雙 AI 分析', size: 'xs', color: '#888888', align: 'center' }
        ],
        paddingAll: '10px'
      }
    };

    // 🟢 卡片 2：Gemini 樂觀派（獨立完整卡片）
    const card2 = {
      type: 'bubble',
      size: 'mega',
      header: {
        type: 'box',
        layout: 'vertical',
        contents: [
          { type: 'text', text: `🟢 ${aiSource1} 樂觀派`, color: '#ffffff', size: 'lg', weight: 'bold' },
          { type: 'text', text: `${stock.name} 多頭觀點`, color: '#ffffffcc', size: 'sm', margin: 'sm' }
        ],
        backgroundColor: '#2E7D32',
        paddingAll: '20px'
      },
      body: {
        type: 'box',
        layout: 'vertical',
        contents: [
          { type: 'text', text: bullish, size: 'md', wrap: true }
        ],
        paddingAll: '20px'
      },
      footer: {
        type: 'box',
        layout: 'horizontal',
        contents: [
          { type: 'text', text: '👉 滑動看風險分析', size: 'xs', color: '#888888', align: 'center' }
        ],
        paddingAll: '10px'
      }
    };

    // 🔴 卡片 3：GPT-5.2 謹慎派（獨立完整卡片）
    const card3 = {
      type: 'bubble',
      size: 'mega',
      header: {
        type: 'box',
        layout: 'vertical',
        contents: [
          { type: 'text', text: `🔴 ${aiSource2} 謹慎派`, color: '#ffffff', size: 'lg', weight: 'bold' },
          { type: 'text', text: `${stock.name} 風控觀點`, color: '#ffffffcc', size: 'sm', margin: 'sm' }
        ],
        backgroundColor: '#C62828',
        paddingAll: '20px'
      },
      body: {
        type: 'box',
        layout: 'vertical',
        contents: [
          { type: 'text', text: bearish, size: 'md', wrap: true }
        ],
        paddingAll: '20px'
      },
      footer: {
        type: 'box',
        layout: 'horizontal',
        contents: [
          { type: 'text', text: '👉 滑動看操作建議', size: 'xs', color: '#888888', align: 'center' }
        ],
        paddingAll: '10px'
      }
    };

    // 📊 卡片 4：綜合策略
    const card4 = {
      type: 'bubble',
      size: 'mega',
      header: {
        type: 'box',
        layout: 'vertical',
        contents: [
          { type: 'text', text: '📊 綜合操作策略', color: '#ffffff', size: 'lg', weight: 'bold' },
          { type: 'text', text: `${stock.name} 投資建議`, color: '#ffffffcc', size: 'sm', margin: 'sm' }
        ],
        backgroundColor: '#1565C0',
        paddingAll: '20px'
      },
      body: {
        type: 'box',
        layout: 'vertical',
        contents: [
          { type: 'text', text: summary, size: 'md', wrap: true }
        ],
        paddingAll: '20px'
      },
      footer: {
        type: 'box',
        layout: 'horizontal',
        contents: [
          { type: 'text', text: `⏰ ${this.getTaiwanTime()}`, size: 'xs', color: '#888888', align: 'center' }
        ],
        paddingAll: '10px'
      }
    };

    return {
      type: 'flex',
      altText: `${stock.name} ${alert.message}`,
      contents: {
        type: 'carousel',
        contents: [card1, card2, card3, card4]
      }
    };
  }

  /**
   * 解析雙 AI 評論
   */
  parseAIComment(aiComment) {
    let bullish = '';
    let bearish = '';
    let summary = '';
    let aiSource1 = 'Gemini';
    let aiSource2 = 'GPT-5.2';

    try {
      // 解析 AI 來源
      const source1Match = aiComment.match(/🟢【([^】]+)】/);
      const source2Match = aiComment.match(/🔴【([^】]+)】/);
      
      if (source1Match) aiSource1 = source1Match[1].replace('樂觀派', '').replace('謹慎派', '').trim();
      if (source2Match) aiSource2 = source2Match[1].replace('樂觀派', '').replace('謹慎派', '').trim();

      // 解析內容
      const bullishMatch = aiComment.match(/🟢【[^】]+】\n?([\s\S]*?)(?=\n\n🔴|$)/);
      const bearishMatch = aiComment.match(/🔴【[^】]+】\n?([\s\S]*?)(?=\n\n📊|$)/);
      const summaryMatch = aiComment.match(/📊【[^】]+】\n?([\s\S]*?)$/);

      bullish = bullishMatch?.[1]?.trim() || '';
      bearish = bearishMatch?.[1]?.trim() || '';
      summary = summaryMatch?.[1]?.trim() || '';

      // 如果解析失敗，使用簡單分割
      if (!bullish && !bearish) {
        const parts = aiComment.split('\n\n');
        bullish = parts[0] || aiComment;
        bearish = parts[1] || '';
        summary = parts[2] || '';
      }

    } catch (e) {
      bullish = aiComment.substring(0, 500);
      bearish = '請查看完整分析';
      summary = '';
    }

    return { 
      bullish: bullish || '分析產生中...', 
      bearish: bearish || '分析產生中...', 
      summary: summary || '請綜合多空觀點自行判斷',
      aiSource1,
      aiSource2
    };
  }

  /**
   * 截斷文字
   */
  truncateText(text, maxLength) {
    if (!text) return '';
    if (text.length <= maxLength) return text;
    return text.substring(0, maxLength - 3) + '...';
  }

  /**
   * 建立日報 Flex Message
   */
  createDailyReportFlex(stockDataList, aiSummary) {
    const today = this.getTaiwanDate();

    // 解析雙 AI 日報
    const { bullish, bearish, strategy, aiSource1, aiSource2 } = this.parseDailySummary(aiSummary);

    // 股票表格（最多 8 檔）
    const stockRows = stockDataList.slice(0, 8).map(stock => {
      const isUp = stock.change >= 0;
      const color = isUp ? '#ff4444' : '#00C851';
      const arrow = isUp ? '▲' : '▼';

      return {
        type: 'box',
        layout: 'horizontal',
        contents: [
          { type: 'text', text: stock.name, size: 'xs', flex: 3 },
          { type: 'text', text: `${stock.price}`, size: 'xs', align: 'end', flex: 2 },
          { type: 'text', text: `${arrow}${stock.changePercent}%`, size: 'xs', color: color, align: 'end', flex: 2 }
        ],
        margin: 'sm'
      };
    });

    // 統計
    const upCount = stockDataList.filter(s => s.change >= 0).length;
    const downCount = stockDataList.filter(s => s.change < 0).length;

    // 📊 卡片 1：股票清單
    const card1 = {
      type: 'bubble',
      size: 'mega',
      header: {
        type: 'box',
        layout: 'vertical',
        contents: [
          { type: 'text', text: '📊 收盤日報', size: 'xl', weight: 'bold', color: '#ffffff' },
          { type: 'text', text: `${today} | ↑${upCount} ↓${downCount}`, size: 'sm', color: '#ffffffaa', margin: 'sm' }
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
              { type: 'text', text: '收盤', size: 'xs', color: '#888888', align: 'end', flex: 2 },
              { type: 'text', text: '漲跌', size: 'xs', color: '#888888', align: 'end', flex: 2 }
            ]
          },
          { type: 'separator', margin: 'sm' },
          ...stockRows
        ],
        paddingAll: '15px'
      },
      footer: {
        type: 'box',
        layout: 'horizontal',
        contents: [
          { type: 'text', text: '👉 滑動看雙 AI 分析', size: 'xs', color: '#888888', align: 'center' }
        ],
        paddingAll: '10px'
      }
    };

    // 🟢 卡片 2：Gemini 樂觀派（獨立完整卡片）
    const card2 = {
      type: 'bubble',
      size: 'mega',
      header: {
        type: 'box',
        layout: 'vertical',
        contents: [
          { type: 'text', text: `🟢 ${aiSource1} 樂觀派`, color: '#ffffff', size: 'lg', weight: 'bold' },
          { type: 'text', text: '今日多頭觀點', color: '#ffffffcc', size: 'sm', margin: 'sm' }
        ],
        backgroundColor: '#2E7D32',
        paddingAll: '20px'
      },
      body: {
        type: 'box',
        layout: 'vertical',
        contents: [
          { type: 'text', text: bullish, size: 'md', wrap: true }
        ],
        paddingAll: '20px'
      },
      footer: {
        type: 'box',
        layout: 'horizontal',
        contents: [
          { type: 'text', text: '👉 滑動看風險分析', size: 'xs', color: '#888888', align: 'center' }
        ],
        paddingAll: '10px'
      }
    };

    // 🔴 卡片 3：GPT-5.2 謹慎派（獨立完整卡片）
    const card3 = {
      type: 'bubble',
      size: 'mega',
      header: {
        type: 'box',
        layout: 'vertical',
        contents: [
          { type: 'text', text: `🔴 ${aiSource2} 謹慎派`, color: '#ffffff', size: 'lg', weight: 'bold' },
          { type: 'text', text: '今日風控觀點', color: '#ffffffcc', size: 'sm', margin: 'sm' }
        ],
        backgroundColor: '#C62828',
        paddingAll: '20px'
      },
      body: {
        type: 'box',
        layout: 'vertical',
        contents: [
          { type: 'text', text: bearish, size: 'md', wrap: true }
        ],
        paddingAll: '20px'
      },
      footer: {
        type: 'box',
        layout: 'horizontal',
        contents: [
          { type: 'text', text: '👉 滑動看明日策略', size: 'xs', color: '#888888', align: 'center' }
        ],
        paddingAll: '10px'
      }
    };

    // 📊 卡片 4：明日策略
    const card4 = {
      type: 'bubble',
      size: 'mega',
      header: {
        type: 'box',
        layout: 'vertical',
        contents: [
          { type: 'text', text: '📊 明日操作策略', color: '#ffffff', size: 'lg', weight: 'bold' },
          { type: 'text', text: '綜合投資建議', color: '#ffffffcc', size: 'sm', margin: 'sm' }
        ],
        backgroundColor: '#1565C0',
        paddingAll: '20px'
      },
      body: {
        type: 'box',
        layout: 'vertical',
        contents: [
          { type: 'text', text: strategy, size: 'md', wrap: true }
        ],
        paddingAll: '20px'
      },
      footer: {
        type: 'box',
        layout: 'horizontal',
        contents: [
          { type: 'text', text: `⏰ ${this.getTaiwanTime()}`, size: 'xs', color: '#888888', align: 'center' }
        ],
        paddingAll: '10px'
      }
    };

    return {
      type: 'flex',
      altText: `📊 ${today} 收盤日報`,
      contents: {
        type: 'carousel',
        contents: [card1, card2, card3, card4]
      }
    };
  }

  /**
   * 解析雙 AI 日報
   */
  parseDailySummary(aiSummary) {
    let bullish = '';
    let bearish = '';
    let strategy = '';
    let aiSource1 = 'Gemini';
    let aiSource2 = 'GPT-5.2';

    try {
      // 解析 AI 來源
      const source1Match = aiSummary.match(/🟢【([^】]+)】/);
      const source2Match = aiSummary.match(/🔴【([^】]+)】/);
      
      if (source1Match) aiSource1 = source1Match[1].replace('樂觀派', '').replace('謹慎派', '').trim();
      if (source2Match) aiSource2 = source2Match[1].replace('樂觀派', '').replace('謹慎派', '').trim();

      const bullishMatch = aiSummary.match(/🟢【[^】]+】\n?([\s\S]*?)(?=\n\n🔴|$)/);
      const bearishMatch = aiSummary.match(/🔴【[^】]+】\n?([\s\S]*?)(?=\n\n📊|$)/);
      const strategyMatch = aiSummary.match(/📊【[^】]+】\n?([\s\S]*?)$/);

      bullish = bullishMatch?.[1]?.trim() || '';
      bearish = bearishMatch?.[1]?.trim() || '';
      strategy = strategyMatch?.[1]?.trim() || '';

      if (!bullish && !bearish) {
        const parts = aiSummary.split('\n\n');
        bullish = parts[0] || aiSummary;
        bearish = parts[1] || '';
        strategy = parts[2] || '';
      }

    } catch (e) {
      bullish = aiSummary.substring(0, 500);
      bearish = '請查看完整分析';
      strategy = '';
    }

    return { 
      bullish: bullish || '分析產生中...', 
      bearish: bearish || '分析產生中...', 
      strategy: strategy || '綜合多空觀點，審慎操作',
      aiSource1,
      aiSource2
    };
  }

  /**
   * 建立持股報告 Flex
   */
  createPortfolioFlex(portfolio) {
    const isProfit = portfolio.totalProfit >= 0;
    // 台灣股市：紅漲綠跌（獲利紅色、虧損綠色）
    const color = isProfit ? '#ff4444' : '#00C851';

    const holdingRows = portfolio.holdings.slice(0, 8).map(h => {
      // 台灣股市：紅漲綠跌
      const hColor = h.profit >= 0 ? '#ff4444' : '#00C851';
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
   * 🆕 廣播訊息（發送給預設用戶）
   * 用於排程通知（三大法人異動等）
   */
  async broadcastMessage(message) {
    const userId = process.env.LINE_USER_ID;
    if (!userId) {
      console.log('⚠️ broadcastMessage: LINE_USER_ID 未設定');
      return false;
    }
    return await this.sendFlexMessage(userId, message);
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
