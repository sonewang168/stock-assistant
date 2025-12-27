/**
 * 💬 LINE Bot 路由
 */

const express = require('express');
const router = express.Router();
const stockService = require('../services/stockService');
const technicalService = require('../services/technicalService');
const lineService = require('../services/lineService');
const { pool } = require('../db');

/**
 * POST /webhook
 * LINE Webhook 接收訊息
 */
router.post('/', async (req, res) => {
  try {
    // 解析 body
    const body = typeof req.body === 'string' 
      ? JSON.parse(req.body) 
      : req.body;
    
    if (!body.events || body.events.length === 0) {
      return res.status(200).send('OK');
    }
    
    const event = body.events[0];
    
    // 處理訊息事件
    if (event.type === 'message' && event.message.type === 'text') {
      const userId = event.source.userId;
      const userMessage = event.message.text.trim();
      const replyToken = event.replyToken;
      
      // 儲存 User ID
      await saveLineUserId(userId);
      
      // 處理指令
      const response = await handleCommand(userMessage, userId);
      
      if (response) {
        await lineService.replyMessage(replyToken, response);
      }
    }
    
    // Follow 事件
    if (event.type === 'follow') {
      const userId = event.source.userId;
      await saveLineUserId(userId);
      
      await lineService.replyMessage(event.replyToken, {
        type: 'text',
        text: '👋 歡迎使用股海秘書！\n\n輸入股票代碼（如 2330）查詢股價\n輸入「說明」查看所有指令'
      });
    }
    
    res.status(200).send('OK');
    
  } catch (error) {
    console.error('Webhook 錯誤:', error);
    res.status(200).send('OK');
  }
});

/**
 * 處理使用者指令
 */
async function handleCommand(message, userId) {
  const msg = message.trim();
  
  // 查詢股價：輸入代碼
  if (/^\d{4,6}$/.test(msg)) {
    return await getStockInfoReply(msg);
  }
  
  // 指令列表
  const commands = {
    '持股': () => getPortfolioReply(userId),
    '監控': () => getWatchlistReply(userId),
    '指數': () => getIndicesReply(),
    '說明': () => getHelpReply(),
    'help': () => getHelpReply()
  };
  
  // 語音指令：語音 2330
  if (msg.startsWith('語音') || msg.startsWith('播報')) {
    const stockId = msg.replace(/^(語音|播報)\s*/, '').trim();
    if (/^\d{4,6}$/.test(stockId)) {
      return await sendVoiceReport(stockId, userId);
    }
    return { type: 'text', text: '請輸入：語音 股票代碼\n例如：語音 2330' };
  }
  
  for (const [cmd, handler] of Object.entries(commands)) {
    if (msg.includes(cmd)) {
      return await handler();
    }
  }
  
  // 找不到指令
  return {
    type: 'text',
    text: `🤔 不認識的指令\n\n輸入股票代碼查詢（如 2330）\n或輸入「說明」查看指令`
  };
}

/**
 * 取得股票資訊回覆
 */
async function getStockInfoReply(stockId) {
  const stockData = await stockService.getRealtimePrice(stockId);
  
  if (!stockData) {
    return { type: 'text', text: `❌ 找不到股票 ${stockId}` };
  }
  
  const indicators = await technicalService.getFullIndicators(stockId);
  const chip = await stockService.getInstitutionalData(stockId);
  
  let info = `📊 ${stockData.name}（${stockId}）\n`;
  info += `━━━━━━━━━━━━━━\n`;
  info += `💰 現價：${stockData.price}\n`;
  info += `📈 漲跌：${stockData.change > 0 ? '+' : ''}${stockData.change}（${stockData.changePercent}%）\n`;
  info += `📊 開：${stockData.open} 高：${stockData.high}\n`;
  info += `📊 低：${stockData.low} 昨：${stockData.yesterday}\n`;
  
  if (indicators) {
    info += `\n📈 技術指標\n`;
    info += `RSI(14)：${indicators.rsi || 'N/A'}\n`;
    if (indicators.kd) {
      info += `KD(9)：${indicators.kd.k}/${indicators.kd.d}\n`;
    }
  }
  
  if (chip) {
    info += `\n💰 三大法人\n`;
    info += `外資：${chip.foreign > 0 ? '+' : ''}${(chip.foreign/1000).toFixed(0)}張\n`;
    info += `投信：${chip.investment > 0 ? '+' : ''}${(chip.investment/1000).toFixed(0)}張\n`;
  }
  
  return { type: 'text', text: info };
}

/**
 * 取得持股回覆
 */
async function getPortfolioReply(userId) {
  const sql = `
    SELECT p.*, s.name as stock_name
    FROM portfolio p
    JOIN stocks s ON p.stock_id = s.id
    WHERE p.user_id = $1 AND p.shares > 0
    LIMIT 10
  `;
  
  const result = await pool.query(sql, [userId]);
  
  if (result.rows.length === 0) {
    return { type: 'text', text: '📭 目前沒有持股紀錄\n\n請在網頁版新增持股' };
  }
  
  let info = '💼 我的持股\n━━━━━━━━━━━━━━\n';
  
  for (const row of result.rows) {
    info += `${row.stock_name}：${row.shares}股 @ $${row.avg_cost}\n`;
  }
  
  return { type: 'text', text: info };
}

/**
 * 取得監控清單回覆
 */
async function getWatchlistReply(userId) {
  const sql = `
    SELECT w.*, s.name as stock_name
    FROM watchlist w
    JOIN stocks s ON w.stock_id = s.id
    WHERE w.user_id = $1 AND w.is_active = true
    LIMIT 10
  `;
  
  const result = await pool.query(sql, [userId]);
  
  if (result.rows.length === 0) {
    return { type: 'text', text: '📭 目前沒有監控股票\n\n請在網頁版新增監控' };
  }
  
  let info = '📋 監控清單\n━━━━━━━━━━━━━━\n';
  
  for (const row of result.rows) {
    info += `${row.stock_name}（${row.stock_id}）\n`;
  }
  
  return { type: 'text', text: info };
}

/**
 * 取得指數回覆
 */
async function getIndicesReply() {
  return {
    type: 'text',
    text: '🌍 國際指數\n━━━━━━━━━━━━━━\n請至網頁版查看即時指數資訊'
  };
}

/**
 * 🔊 發送語音播報
 */
async function sendVoiceReport(stockId, userId) {
  try {
    const voiceService = require('../services/voiceService');
    const stockData = await stockService.getRealtimePrice(stockId);
    
    if (!stockData) {
      return { type: 'text', text: `❌ 找不到股票 ${stockId}` };
    }
    
    // 檢查語音是否啟用
    const settings = await voiceService.getVoiceSettings();
    
    if (!settings.enabled) {
      // 語音未啟用，發送文字提示
      const isUp = stockData.change >= 0;
      return { 
        type: 'text', 
        text: `🔊 ${stockData.name}（${stockId}）\n` +
          `現價：${stockData.price} 元\n` +
          `漲跌：${isUp ? '+' : ''}${stockData.change}（${stockData.changePercent}%）\n\n` +
          `💡 語音播報未啟用，請至網頁設定開啟`
      };
    }
    
    // 發送語音
    const success = await lineService.sendStockVoiceAlert(userId, stockData, voiceService);
    
    if (success) {
      return null; // 語音發送成功，不需要額外回覆
    } else {
      return { 
        type: 'text', 
        text: `⚠️ 語音生成失敗\n\n` +
          `📊 ${stockData.name}：${stockData.price} 元（${stockData.changePercent}%）`
      };
    }
    
  } catch (error) {
    console.error('語音播報錯誤:', error);
    return { type: 'text', text: '⚠️ 語音播報服務暫時無法使用' };
  }
}

/**
 * 取得說明回覆
 */
function getHelpReply() {
  const help = `📱 股海秘書指令說明\n` +
    `━━━━━━━━━━━━━━\n` +
    `🔹 輸入股票代碼查詢\n` +
    `   例：2330、0050\n\n` +
    `🔊「語音 2330」語音播報\n` +
    `🔹「持股」查看持股\n` +
    `🔹「監控」查看監控清單\n` +
    `🔹「指數」查看國際指數\n` +
    `🔹「說明」顯示此訊息\n\n` +
    `💡 更多功能請使用網頁版`;

  return { type: 'text', text: help };
}

/**
 * 儲存 LINE User ID
 */
async function saveLineUserId(userId) {
  const sql = `
    INSERT INTO settings (key, value) 
    VALUES ('line_user_id', $1)
    ON CONFLICT (key) DO UPDATE SET value = $1
  `;
  
  try {
    await pool.query(sql, [userId]);
  } catch (error) {
    console.error('儲存 User ID 失敗:', error.message);
  }
}

/**
 * POST /api/line/push
 * 手動推播測試
 */
router.post('/push', async (req, res) => {
  try {
    const { message } = req.body;
    
    // 取得 User ID
    const result = await pool.query(
      "SELECT value FROM settings WHERE key = 'line_user_id'"
    );
    const userId = result.rows[0]?.value || process.env.LINE_USER_ID;
    
    if (!userId) {
      return res.status(400).json({ error: '尚未設定 LINE User ID' });
    }
    
    const success = await lineService.sendFlexMessage(userId, {
      type: 'text',
      text: message || '🎉 測試推播成功！'
    });
    
    res.json({ success });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
