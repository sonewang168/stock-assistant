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
 * 
 * 重要：必須在 1 秒內回覆 200，否則 LINE 會重試！
 */

// 防重機制：記錄已處理的訊息 ID（用 message.id 而非 webhookEventId）
const processedMessages = new Map();
const MESSAGE_COOLDOWN = 60000; // 60 秒內同一訊息不重複處理

function isProcessed(messageId) {
  const now = Date.now();
  
  // 清理過期記錄
  for (const [id, time] of processedMessages) {
    if (now - time > MESSAGE_COOLDOWN) {
      processedMessages.delete(id);
    }
  }
  
  if (processedMessages.has(messageId)) {
    console.log(`⏭️ 跳過重複訊息: ${messageId}`);
    return true;
  }
  
  processedMessages.set(messageId, now);
  return false;
}

router.post('/', (req, res) => {
  // ⚡ 立即回覆 200（避免 LINE 重試）
  res.status(200).send('OK');
  
  // 異步處理訊息（不阻塞回覆）
  setImmediate(async () => {
    try {
      // 解析 body
      const body = typeof req.body === 'string' 
        ? JSON.parse(req.body) 
        : req.body;
      
      if (!body.events || body.events.length === 0) {
        return;
      }
      
      const event = body.events[0];
      
      // 🛡️ 用 message.id 防重（這個 ID 不會因重試而改變）
      const messageId = event.message?.id;
      if (!messageId) {
        console.log('⚠️ 訊息沒有 ID，跳過');
        return;
      }
      
      if (isProcessed(messageId)) {
        return; // 已處理過，跳過
      }
      
      console.log(`📩 處理訊息 ID: ${messageId}`);
      
      // 處理訊息事件
      if (event.type === 'message' && event.message.type === 'text') {
        const userId = event.source.userId;
        const userMessage = event.message.text.trim();
        
        // 儲存 User ID
        await saveLineUserId(userId);
        
        // 處理指令（只用 push，不用 reply）
        const response = await handleCommand(userMessage, userId);
        
        if (response) {
          await lineService.sendTextMessage(userId, response.text || '處理完成');
        }
      }
      
      // Follow 事件
      if (event.type === 'follow') {
        const userId = event.source.userId;
        await saveLineUserId(userId);
        
        await lineService.sendTextMessage(userId, 
          '👋 歡迎使用股海秘書！\n\n輸入股票代碼（如 2330）查詢股價\n輸入「說明」查看所有指令'
        );
      }
      
    } catch (error) {
      console.error('Webhook 處理錯誤:', error);
    }
  });
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
  
  // 加監控指令：+2330 或 加2330 或 監控2330
  if (/^[+＋加監控]\s*\d{4,6}$/.test(msg)) {
    const stockId = msg.replace(/^[+＋加監控]\s*/, '').trim();
    return await addToWatchlist(stockId);
  }
  
  // 移除監控：-2330 或 刪2330
  if (/^[-－刪移除]\s*\d{4,6}$/.test(msg)) {
    const stockId = msg.replace(/^[-－刪移除]\s*/, '').trim();
    return await removeFromWatchlist(stockId);
  }
  
  // 指令列表
  const commands = {
    '持股': () => getPortfolioReply(),
    '監控': () => getWatchlistReply(),
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
    text: `🤔 不認識的指令\n\n輸入股票代碼查詢（如 2330）\n輸入「+2330」加入監控\n輸入「說明」查看指令`
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
async function getPortfolioReply() {
  const sql = `
    SELECT p.stock_id, p.shares, p.avg_cost, s.name as stock_name
    FROM portfolio p
    LEFT JOIN stocks s ON p.stock_id = s.id
    WHERE p.user_id = 'default' AND p.shares > 0
    LIMIT 20
  `;
  
  const result = await pool.query(sql);
  
  if (result.rows.length === 0) {
    return { type: 'text', text: '📭 目前沒有持股紀錄\n\n請在網頁版新增持股' };
  }
  
  let info = '💼 我的持股\n━━━━━━━━━━━━━━\n';
  
  for (const row of result.rows) {
    const name = row.stock_name || row.stock_id;
    info += `• ${name}：${row.shares}股 @ $${row.avg_cost}\n`;
  }
  
  return { type: 'text', text: info };
}

/**
 * 取得監控清單回覆（使用 default 用戶，與網頁版同步）
 */
async function getWatchlistReply() {
  const sql = `
    SELECT w.stock_id, s.name as stock_name
    FROM watchlist w
    LEFT JOIN stocks s ON w.stock_id = s.id
    WHERE w.user_id = 'default' AND w.is_active = true
    ORDER BY w.created_at DESC
    LIMIT 20
  `;
  
  const result = await pool.query(sql);
  
  if (result.rows.length === 0) {
    return { type: 'text', text: '📭 目前沒有監控股票\n\n輸入「+2330」加入監控' };
  }
  
  let info = '📋 監控清單\n━━━━━━━━━━━━━━\n';
  
  for (const row of result.rows) {
    const name = row.stock_name || row.stock_id;
    info += `• ${name}（${row.stock_id}）\n`;
  }
  
  info += `\n💡 輸入「+代碼」加入\n💡 輸入「-代碼」移除`;
  
  return { type: 'text', text: info };
}

/**
 * 加入監控清單
 */
async function addToWatchlist(stockId) {
  try {
    // 先確認股票存在
    const stockData = await stockService.getRealtimePrice(stockId);
    
    if (!stockData) {
      return { type: 'text', text: `❌ 找不到股票 ${stockId}` };
    }
    
    // 確保 stocks 表有這支股票
    await pool.query(`
      INSERT INTO stocks (id, name, market) 
      VALUES ($1, $2, $3)
      ON CONFLICT (id) DO UPDATE SET name = $2
    `, [stockId, stockData.name, stockData.market || 'TSE']);
    
    // 加入監控（使用 default 用戶）
    const sql = `
      INSERT INTO watchlist (stock_id, user_id)
      VALUES ($1, 'default')
      ON CONFLICT (stock_id, user_id) 
      DO UPDATE SET is_active = true
      RETURNING *
    `;
    
    await pool.query(sql, [stockId]);
    
    return { 
      type: 'text', 
      text: `✅ 已加入監控\n\n📊 ${stockData.name}（${stockId}）\n💰 現價：${stockData.price} 元\n\n💡 輸入「監控」查看清單` 
    };
    
  } catch (error) {
    console.error('加入監控錯誤:', error);
    return { type: 'text', text: '⚠️ 加入監控失敗，請稍後再試' };
  }
}

/**
 * 移除監控
 */
async function removeFromWatchlist(stockId) {
  try {
    const sql = `
      UPDATE watchlist 
      SET is_active = false 
      WHERE stock_id = $1 AND user_id = 'default'
      RETURNING *
    `;
    
    const result = await pool.query(sql, [stockId]);
    
    if (result.rows.length === 0) {
      return { type: 'text', text: `❌ ${stockId} 不在監控清單中` };
    }
    
    return { 
      type: 'text', 
      text: `✅ 已移除監控：${stockId}\n\n💡 輸入「監控」查看清單` 
    };
    
  } catch (error) {
    console.error('移除監控錯誤:', error);
    return { type: 'text', text: '⚠️ 移除監控失敗' };
  }
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
 * 🔊 發送語音播報（有防重機制）
 */
// 語音請求防重
const voiceRequests = new Map();
const VOICE_COOLDOWN = 60000; // 60 秒內不重複發送同一股票

async function sendVoiceReport(stockId, userId) {
  // 🛡️ 防重檢查
  const requestKey = `voice_${userId}_${stockId}`;
  const lastRequest = voiceRequests.get(requestKey);
  const now = Date.now();
  
  if (lastRequest && (now - lastRequest) < VOICE_COOLDOWN) {
    console.log(`⏭️ 語音冷卻中: ${stockId}`);
    return null; // 冷卻中，不回應
  }
  
  // 記錄請求時間
  voiceRequests.set(requestKey, now);
  
  // 清理過期的請求記錄
  for (const [key, time] of voiceRequests) {
    if (now - time > VOICE_COOLDOWN * 2) {
      voiceRequests.delete(key);
    }
  }

  try {
    const voiceService = require('../services/voiceService');
    const stockData = await stockService.getRealtimePrice(stockId);
    
    if (!stockData) {
      return { type: 'text', text: `❌ 找不到股票 ${stockId}` };
    }
    
    // 檢查語音是否啟用
    const settings = await voiceService.getVoiceSettings();
    
    if (!settings.enabled) {
      // 語音未啟用，發送文字
      const isUp = stockData.change >= 0;
      return { 
        type: 'text', 
        text: `🔊 ${stockData.name}（${stockId}）\n` +
          `現價：${stockData.price} 元\n` +
          `漲跌：${isUp ? '+' : ''}${stockData.change}（${stockData.changePercent}%）\n\n` +
          `💡 語音播報未啟用，請至網頁設定開啟`
      };
    }
    
    console.log(`🔊 發送語音: ${stockData.name}`);
    
    // 發送語音（同步等待）
    const success = await lineService.sendStockVoiceAlert(userId, stockData, voiceService);
    
    if (!success) {
      return { type: 'text', text: `⚠️ 語音生成失敗` };
    }
    
    // 語音已發送，不需要額外回應
    return null;
    
  } catch (error) {
    console.error('語音播報錯誤:', error);
    return { type: 'text', text: '⚠️ 語音播報失敗' };
  }
}

/**
 * 取得說明回覆
 */
function getHelpReply() {
  const help = `📱 股海秘書指令說明\n` +
    `━━━━━━━━━━━━━━\n` +
    `🔍 查詢股價\n` +
    `   輸入代碼，如：2330\n\n` +
    `➕ 加入監控\n` +
    `   +2330 或 加2330\n\n` +
    `➖ 移除監控\n` +
    `   -2330 或 刪2330\n\n` +
    `📋「監控」查看監控清單\n` +
    `💼「持股」查看持股\n` +
    `🔊「語音 2330」語音播報\n` +
    `❓「說明」顯示此訊息\n\n` +
    `💡 網頁版與 LINE 同步`;

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
