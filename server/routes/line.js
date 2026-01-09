/**
 * 💬 LINE Bot 路由 - v3.0 全功能版
 */

const express = require('express');
const router = express.Router();
const stockService = require('../services/stockService');
const technicalService = require('../services/technicalService');
const lineService = require('../services/lineService');
const chartService = require('../services/chartService');
const aiService = require('../services/aiService');
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
        
        // 處理指令
        const response = await handleCommand(userMessage, userId);
        
        if (response) {
          // 根據回應類型發送
          if (response.type === 'flex') {
            await lineService.sendFlexMessage(userId, response);
          } else {
            await lineService.sendTextMessage(userId, response.text || '處理完成');
          }
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
    return await getStockInfoFlex(msg);
  }
  
  // 🆕 監控 2330 或 監控 2330 1000 900（帶目標價）
  const watchMatch = msg.match(/^監控\s*(\d{4,6})(?:\s+(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?))?$/);
  if (watchMatch) {
    const stockId = watchMatch[1];
    const highPrice = watchMatch[2] ? parseFloat(watchMatch[2]) : null;
    const lowPrice = watchMatch[3] ? parseFloat(watchMatch[3]) : null;
    return await addToWatchlistWithTargets(stockId, highPrice, lowPrice);
  }
  
  // 🆕 目標 2330 1000 900（設定目標價）
  const targetMatch = msg.match(/^目標\s*(\d{4,6})\s+(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)$/);
  if (targetMatch) {
    const stockId = targetMatch[1];
    const highPrice = parseFloat(targetMatch[2]);
    const lowPrice = parseFloat(targetMatch[3]);
    return await setTargetPrice(stockId, highPrice, lowPrice);
  }
  
  // 🆕 漲跌 2330 5（設定漲跌幅 ±5%）
  const percentMatch = msg.match(/^漲跌\s*(\d{4,6})\s+(\d+(?:\.\d+)?)$/);
  if (percentMatch) {
    const stockId = percentMatch[1];
    const percent = parseFloat(percentMatch[2]);
    return await setAlertPercent(stockId, percent);
  }
  
  // 加監控指令：+2330 或 加2330
  if (/^[+＋加]\s*\d{4,6}$/.test(msg)) {
    const stockId = msg.replace(/^[+＋加]\s*/, '').trim();
    return await addToWatchlistWithTargets(stockId, null, null);
  }
  
  // 移除監控：-2330 或 刪2330
  if (/^[-－刪移除]\s*\d{4,6}$/.test(msg)) {
    const stockId = msg.replace(/^[-－刪移除]\s*/, '').trim();
    return await removeFromWatchlist(stockId);
  }
  
  // 搜尋股票：查 台積電、找 鴻海
  if (/^[查找搜]\s*.+$/.test(msg)) {
    const keyword = msg.replace(/^[查找搜]\s*/, '').trim();
    return await searchStock(keyword);
  }
  
  // 🇺🇸 美股指令
  if (/^[美uU][股sS]?\s*.+$/i.test(msg)) {
    const symbol = msg.replace(/^[美uU][股sS]?\s*/i, '').trim().toUpperCase();
    if (symbol) {
      return await getUSStockFlex(symbol);
    }
  }
  
  // 📊 K線圖指令
  if (/^[kK線圖走勢]\s*\d{4,6}$/.test(msg) || /^\d{4,6}\s*[kK線圖走勢]$/.test(msg)) {
    const stockId = msg.match(/\d{4,6}/)[0];
    return await getKLineChartFlex(stockId);
  }
  
  // 📈 技術指標圖
  if (/^(技術|指標|RSI|KD)\s*\d{4,6}$/i.test(msg) || /^\d{4,6}\s*(技術|指標|RSI|KD)$/i.test(msg)) {
    const stockId = msg.match(/\d{4,6}/)[0];
    return await getIndicatorChartFlex(stockId);
  }
  
  // 📰 新聞指令
  if (/^(新聞|消息)\s*\d{4,6}$/.test(msg) || /^\d{4,6}\s*(新聞|消息)$/.test(msg)) {
    const stockId = msg.match(/\d{4,6}/)[0];
    return await getStockNewsFlex(stockId);
  }
  
  // 🤖 AI 選股
  if (/^(選股|推薦|AI選股)/.test(msg)) {
    const criteria = msg.replace(/^(選股|推薦|AI選股)\s*/, '').trim() || '適合長期投資的優質股';
    return await getAIRecommendationFlex(criteria);
  }
  
  // 🤖 AI 對話（問 開頭）
  if (/^[問]/.test(msg)) {
    const question = msg.replace(/^[問]\s*/, '').trim();
    return await getAIChatReply(question);
  }
  
  // 指令列表
  const commands = {
    '持股': () => getPortfolioFlex(),
    '監控': () => getWatchlistFlex(),
    '清單': () => getWatchlistFlex(),
    '熱門': () => getHotStocksFlex(),
    '大盤': () => getMarketReply(),
    '指數': () => getMarketReply(),
    '美股': () => getUSMarketFlex(),
    '美指': () => getUSMarketFlex(),
    '熱門美股': () => getHotUSStocksFlex(),
    'ADR': () => getTSMSpreadFlex(),
    'adr': () => getTSMSpreadFlex(),
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
  
  // 🇺🇸 直接輸入美股代碼（全英文大寫 1-5 字母）
  if (/^[A-Z]{1,5}$/.test(msg)) {
    const usStock = await stockService.getUSStockPrice(msg);
    if (usStock && usStock.price > 0) {
      return await getUSStockFlex(msg);
    }
  }
  
  // 🤖 其他問題交給 AI 回答
  if (msg.length >= 5 && /[？?]$/.test(msg)) {
    return await getAIChatReply(msg);
  }
  
  // 嘗試用名稱搜尋
  if (msg.length >= 2 && !/^\d+$/.test(msg)) {
    const searchResult = await searchStock(msg);
    if (searchResult.type === 'flex' || (searchResult.text && searchResult.text.includes('找到'))) {
      return searchResult;
    }
  }
  
  // 找不到指令
  return {
    type: 'text',
    text: `🤔 不認識「${msg}」\n\n` +
      `📍 台股：輸入代碼如 2330\n` +
      `🇺🇸 美股：輸入 AAPL 或「美 AAPL」\n` +
      `📊 K線：K 2330\n` +
      `🤖 AI：問 台積電前景如何？\n` +
      `📋 輸入「說明」看更多`
  };
}

/**
 * 🕐 取得台灣時間
 */
function getTaiwanTime() {
  return new Date().toLocaleTimeString('zh-TW', { 
    timeZone: 'Asia/Taipei',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
}

/**
 * 🕐 取得台灣日期
 */
function getTaiwanDate() {
  return new Date().toLocaleDateString('zh-TW', { 
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric'
  });
}

/**
 * 📊 取得股票資訊 Flex Message
 */
async function getStockInfoFlex(stockId) {
  const stockData = await stockService.getRealtimePrice(stockId);
  
  if (!stockData) {
    return { type: 'text', text: `❌ 找不到股票 ${stockId}` };
  }
  
  const indicators = await technicalService.getFullIndicators(stockId);
  const chip = await stockService.getInstitutionalData(stockId);
  
  const price = parseFloat(stockData.price) || 0;
  const open = parseFloat(stockData.open) || 0;
  const high = parseFloat(stockData.high) || 0;
  const low = parseFloat(stockData.low) || 0;
  const yesterday = parseFloat(stockData.yesterday) || 0;
  const change = parseFloat(stockData.change) || (price - yesterday);
  const changePercent = parseFloat(stockData.changePercent) || 0;
  
  const isUp = change >= 0;
  // 台灣股市：紅漲綠跌
  const color = isUp ? '#D32F2F' : '#388E3C';
  const bgColor = isUp ? '#FFEBEE' : '#E8F5E9';
  const arrow = isUp ? '▲' : '▼';
  const emoji = isUp ? '📈' : '📉';
  const changeSign = isUp ? '+' : '';
  
  // 基本資訊
  const bodyContents = [
    {
      type: 'box',
      layout: 'vertical',
      contents: [
        { type: 'text', text: price.toFixed(2), size: '3xl', weight: 'bold', color: color, align: 'center' },
        { 
          type: 'text', 
          text: `${arrow} ${changeSign}${change.toFixed(2)} (${changeSign}${changePercent}%)`, 
          size: 'lg', 
          color: color, 
          align: 'center',
          weight: 'bold',
          margin: 'sm'
        }
      ]
    },
    { type: 'separator', margin: 'xl', color: '#DDDDDD' },
    {
      type: 'box',
      layout: 'vertical',
      margin: 'lg',
      spacing: 'sm',
      contents: [
        {
          type: 'box',
          layout: 'horizontal',
          contents: [
            { type: 'text', text: '開盤', size: 'md', color: '#666666', flex: 1 },
            { type: 'text', text: open.toFixed(2), size: 'md', align: 'end', flex: 1, color: '#333333', weight: 'bold' }
          ]
        },
        {
          type: 'box',
          layout: 'horizontal',
          contents: [
            { type: 'text', text: '最高', size: 'md', color: '#666666', flex: 1 },
            { type: 'text', text: high.toFixed(2), size: 'md', align: 'end', flex: 1, color: '#D32F2F', weight: 'bold' }
          ]
        },
        {
          type: 'box',
          layout: 'horizontal',
          contents: [
            { type: 'text', text: '最低', size: 'md', color: '#666666', flex: 1 },
            { type: 'text', text: low.toFixed(2), size: 'md', align: 'end', flex: 1, color: '#388E3C', weight: 'bold' }
          ]
        },
        {
          type: 'box',
          layout: 'horizontal',
          contents: [
            { type: 'text', text: '昨收', size: 'md', color: '#666666', flex: 1 },
            { type: 'text', text: yesterday.toFixed(2), size: 'md', align: 'end', flex: 1, color: '#333333', weight: 'bold' }
          ]
        }
      ]
    }
  ];
  
  // 技術指標
  if (indicators) {
    bodyContents.push({ type: 'separator', margin: 'lg', color: '#DDDDDD' });
    bodyContents.push({
      type: 'box',
      layout: 'vertical',
      margin: 'lg',
      contents: [
        { type: 'text', text: '📈 技術指標', size: 'md', color: '#333333', weight: 'bold' },
        {
          type: 'box',
          layout: 'horizontal',
          margin: 'sm',
          contents: [
            { type: 'text', text: 'RSI(14)', size: 'sm', color: '#666666', flex: 1 },
            { type: 'text', text: `${indicators.rsi || 'N/A'}`, size: 'sm', align: 'end', flex: 1, weight: 'bold' },
            { type: 'text', text: 'KD(9)', size: 'sm', color: '#666666', flex: 1 },
            { type: 'text', text: indicators.kd ? `${indicators.kd.k}/${indicators.kd.d}` : 'N/A', size: 'sm', align: 'end', flex: 1, weight: 'bold' }
          ]
        }
      ]
    });
  }
  
  // 三大法人
  if (chip) {
    bodyContents.push({ type: 'separator', margin: 'lg', color: '#DDDDDD' });
    bodyContents.push({
      type: 'box',
      layout: 'vertical',
      margin: 'lg',
      contents: [
        { type: 'text', text: '💰 三大法人', size: 'md', color: '#333333', weight: 'bold' },
        {
          type: 'box',
          layout: 'horizontal',
          margin: 'sm',
          contents: [
            { type: 'text', text: '外資', size: 'sm', color: '#666666', flex: 1 },
            { 
              type: 'text', 
              text: `${chip.foreign > 0 ? '+' : ''}${(chip.foreign/1000).toFixed(0)}張`, 
              size: 'sm', 
              color: chip.foreign >= 0 ? '#D32F2F' : '#388E3C',
              align: 'end', 
              flex: 1,
              weight: 'bold'
            },
            { type: 'text', text: '投信', size: 'sm', color: '#666666', flex: 1 },
            { 
              type: 'text', 
              text: `${chip.investment > 0 ? '+' : ''}${(chip.investment/1000).toFixed(0)}張`, 
              size: 'sm', 
              color: chip.investment >= 0 ? '#D32F2F' : '#388E3C',
              align: 'end', 
              flex: 1,
              weight: 'bold'
            }
          ]
        }
      ]
    });
  }
  
  return {
    type: 'flex',
    altText: `${stockData.name}（${stockId}）${price.toFixed(2)} ${arrow}${changePercent}%`,
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
              { type: 'text', text: `${emoji} ${stockData.name}`, color: '#ffffff', size: 'xl', weight: 'bold', flex: 1 },
              { type: 'text', text: stockId, color: '#ffffffcc', size: 'md', align: 'end' }
            ]
          },
          { type: 'text', text: `${isUp ? '上漲' : '下跌'} ${Math.abs(changePercent)}%`, color: '#ffffff', size: 'md', margin: 'sm', weight: 'bold' }
        ],
        backgroundColor: color,
        paddingAll: '20px'
      },
      body: {
        type: 'box',
        layout: 'vertical',
        contents: bodyContents,
        paddingAll: '20px',
        backgroundColor: bgColor
      },
      footer: {
        type: 'box',
        layout: 'horizontal',
        contents: [
          { type: 'text', text: `⏰ ${getTaiwanTime()}`, size: 'sm', color: '#666666' },
          { type: 'text', text: stockData.market || 'TSE', size: 'sm', color: '#666666', align: 'end' }
        ],
        paddingAll: '15px',
        backgroundColor: '#F5F5F5'
      }
    }
  };
}

/**
 * 💼 取得持股 Flex Message
 */
async function getPortfolioFlex() {
  const sql = `
    SELECT p.stock_id, p.shares, p.avg_cost, s.name as stock_name
    FROM portfolio p
    LEFT JOIN stocks s ON p.stock_id = s.id
    WHERE p.user_id = 'default' AND p.shares > 0
    LIMIT 10
  `;
  
  const result = await pool.query(sql);
  
  if (result.rows.length === 0) {
    return { type: 'text', text: '📭 目前沒有持股紀錄\n\n請在網頁版新增持股' };
  }
  
  // 取得即時價格計算損益
  const holdings = [];
  let totalValue = 0;
  let totalCost = 0;
  
  for (const row of result.rows) {
    const stockData = await stockService.getRealtimePrice(row.stock_id);
    const currentPrice = stockData?.price || row.avg_cost;
    const value = currentPrice * row.shares;
    const cost = row.avg_cost * row.shares;
    const profit = value - cost;
    const profitPercent = ((currentPrice - row.avg_cost) / row.avg_cost * 100).toFixed(2);
    
    totalValue += value;
    totalCost += cost;
    
    holdings.push({
      name: row.stock_name || row.stock_id,
      stockId: row.stock_id,
      shares: row.shares,
      avgCost: row.avg_cost,
      currentPrice,
      profit,
      profitPercent
    });
  }
  
  const totalProfit = totalValue - totalCost;
  const totalProfitPercent = totalCost > 0 ? ((totalProfit / totalCost) * 100).toFixed(2) : 0;
  const isProfit = totalProfit >= 0;
  const color = isProfit ? '#00C851' : '#ff4444';
  
  const holdingRows = holdings.map(h => {
    const hColor = h.profit >= 0 ? '#00C851' : '#ff4444';
    return {
      type: 'box',
      layout: 'horizontal',
      contents: [
        { type: 'text', text: h.name, size: 'sm', flex: 3 },
        { type: 'text', text: `${h.currentPrice}`, size: 'sm', align: 'end', flex: 2 },
        { type: 'text', text: `${h.profit >= 0 ? '+' : ''}${h.profitPercent}%`, size: 'sm', color: hColor, align: 'end', flex: 2 }
      ],
      margin: 'sm'
    };
  });
  
  return {
    type: 'flex',
    altText: `💼 持股報告 ${isProfit ? '📈' : '📉'} ${totalProfitPercent}%`,
    contents: {
      type: 'bubble',
      size: 'mega',
      header: {
        type: 'box',
        layout: 'vertical',
        contents: [
          { type: 'text', text: '💼 我的持股', size: 'xl', weight: 'bold', color: '#ffffff' },
          { type: 'text', text: `總報酬 ${isProfit ? '+' : ''}${totalProfitPercent}%`, size: 'md', color: '#ffffff', margin: 'sm' }
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
              { type: 'text', text: `$${Math.round(totalValue).toLocaleString()}`, size: 'lg', weight: 'bold', align: 'end' }
            ]
          },
          {
            type: 'box',
            layout: 'horizontal',
            margin: 'md',
            contents: [
              { type: 'text', text: '總損益', size: 'sm', color: '#888888' },
              { type: 'text', text: `${isProfit ? '+' : ''}$${Math.round(totalProfit).toLocaleString()}`, size: 'sm', color: color, align: 'end' }
            ]
          },
          { type: 'separator', margin: 'lg' },
          {
            type: 'box',
            layout: 'horizontal',
            margin: 'md',
            contents: [
              { type: 'text', text: '股票', size: 'xs', color: '#888888', flex: 3 },
              { type: 'text', text: '現價', size: 'xs', color: '#888888', align: 'end', flex: 2 },
              { type: 'text', text: '報酬', size: 'xs', color: '#888888', align: 'end', flex: 2 }
            ]
          },
          ...holdingRows
        ],
        paddingAll: '20px'
      },
      footer: {
        type: 'box',
        layout: 'horizontal',
        contents: [
          { type: 'text', text: `⏰ ${getTaiwanTime()}`, size: 'xs', color: '#888888' }
        ],
        paddingAll: '15px'
      }
    }
  };
}

/**
 * 📋 取得監控清單 Flex Message
 */
async function getWatchlistFlex() {
  const sql = `
    SELECT w.stock_id, s.name as stock_name
    FROM watchlist w
    LEFT JOIN stocks s ON w.stock_id = s.id
    WHERE w.user_id = 'default' AND w.is_active = true
    ORDER BY w.created_at DESC
    LIMIT 10
  `;
  
  const result = await pool.query(sql);
  
  if (result.rows.length === 0) {
    return { type: 'text', text: '📭 目前沒有監控股票\n\n輸入「+2330」加入監控' };
  }
  
  // 取得即時價格
  const stockRows = [];
  for (const row of result.rows) {
    const stockData = await stockService.getRealtimePrice(row.stock_id);
    const isUp = stockData?.change >= 0;
    const color = isUp ? '#00C851' : '#ff4444';
    const arrow = isUp ? '▲' : '▼';
    
    stockRows.push({
      type: 'box',
      layout: 'horizontal',
      contents: [
        { type: 'text', text: row.stock_name || row.stock_id, size: 'sm', flex: 3 },
        { type: 'text', text: `${stockData?.price || 'N/A'}`, size: 'sm', align: 'end', flex: 2 },
        { type: 'text', text: stockData ? `${arrow}${stockData.changePercent}%` : 'N/A', size: 'sm', color: color, align: 'end', flex: 2 }
      ],
      margin: 'sm'
    });
  }
  
  return {
    type: 'flex',
    altText: `📋 監控清單（${result.rows.length}支）`,
    contents: {
      type: 'bubble',
      size: 'mega',
      header: {
        type: 'box',
        layout: 'vertical',
        contents: [
          { type: 'text', text: '📋 監控清單', size: 'xl', weight: 'bold', color: '#ffffff' },
          { type: 'text', text: `共 ${result.rows.length} 支股票`, size: 'sm', color: '#ffffffaa', margin: 'sm' }
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
              { type: 'text', text: '現價', size: 'xs', color: '#888888', align: 'end', flex: 2 },
              { type: 'text', text: '漲跌', size: 'xs', color: '#888888', align: 'end', flex: 2 }
            ]
          },
          { type: 'separator', margin: 'md' },
          ...stockRows,
          { type: 'separator', margin: 'lg' },
          {
            type: 'text',
            text: '💡 +代碼 加入｜-代碼 移除',
            size: 'xs',
            color: '#888888',
            margin: 'md',
            align: 'center'
          }
        ],
        paddingAll: '20px'
      },
      footer: {
        type: 'box',
        layout: 'horizontal',
        contents: [
          { type: 'text', text: `⏰ ${getTaiwanTime()}`, size: 'xs', color: '#888888' }
        ],
        paddingAll: '15px'
      }
    }
  };
}

/**
 * 🔥 取得熱門股票 Flex Message
 */
async function getHotStocksFlex() {
  try {
    const hotStocks = [
      { id: '2330', name: '台積電' },
      { id: '2317', name: '鴻海' },
      { id: '2454', name: '聯發科' },
      { id: '0050', name: '元大50' },
      { id: '0056', name: '元大高股息' },
      { id: '00878', name: '國泰永續高股息' }
    ];
    
    const stockRows = [];
    for (const stock of hotStocks) {
      const data = await stockService.getRealtimePrice(stock.id);
      if (data) {
        const isUp = data.change >= 0;
        const color = isUp ? '#00C851' : '#ff4444';
        const arrow = isUp ? '▲' : '▼';
        
        stockRows.push({
          type: 'box',
          layout: 'horizontal',
          contents: [
            { type: 'text', text: stock.name, size: 'sm', flex: 3 },
            { type: 'text', text: `${data.price}`, size: 'sm', align: 'end', flex: 2 },
            { type: 'text', text: `${arrow}${data.changePercent}%`, size: 'sm', color: color, align: 'end', flex: 2 }
          ],
          margin: 'sm'
        });
      }
    }
    
    return {
      type: 'flex',
      altText: '🔥 熱門股票',
      contents: {
        type: 'bubble',
        size: 'mega',
        header: {
          type: 'box',
          layout: 'vertical',
          contents: [
            { type: 'text', text: '🔥 熱門股票', size: 'xl', weight: 'bold', color: '#ffffff' },
            { type: 'text', text: getTaiwanDate(), size: 'sm', color: '#ffffffaa', margin: 'sm' }
          ],
          backgroundColor: '#E74C3C',
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
                { type: 'text', text: '現價', size: 'xs', color: '#888888', align: 'end', flex: 2 },
                { type: 'text', text: '漲跌', size: 'xs', color: '#888888', align: 'end', flex: 2 }
              ]
            },
            { type: 'separator', margin: 'md' },
            ...stockRows,
            { type: 'separator', margin: 'lg' },
            {
              type: 'text',
              text: '💡 輸入代碼查看詳情',
              size: 'xs',
              color: '#888888',
              margin: 'md',
              align: 'center'
            }
          ],
          paddingAll: '20px'
        },
        footer: {
          type: 'box',
          layout: 'horizontal',
          contents: [
            { type: 'text', text: `⏰ ${getTaiwanTime()}`, size: 'xs', color: '#888888' }
          ],
          paddingAll: '15px'
        }
      }
    };
    
  } catch (error) {
    console.error('取得熱門股票錯誤:', error);
    return { type: 'text', text: '⚠️ 取得熱門股票失敗' };
  }
}

/**
 * 🆕 加入監控清單（支援目標價）
 */
async function addToWatchlistWithTargets(stockId, highPrice, lowPrice) {
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
      INSERT INTO watchlist (stock_id, user_id, target_price_high, target_price_low, alert_percent_up, alert_percent_down, is_active)
      VALUES ($1, 'default', $2, $3, 3.0, 3.0, true)
      ON CONFLICT (stock_id, user_id) DO UPDATE SET 
        target_price_high = COALESCE($2, watchlist.target_price_high),
        target_price_low = COALESCE($3, watchlist.target_price_low),
        is_active = true
    `;
    
    await pool.query(sql, [stockId, highPrice, lowPrice]);
    
    let responseText = `✅ 已加入監控：${stockData.name}（${stockId}）\n`;
    responseText += `📊 現價：${stockData.price} 元\n`;
    responseText += `⚡ 漲跌幅提醒：±3%\n`;
    
    if (highPrice || lowPrice) {
      responseText += `🎯 目標價：`;
      if (highPrice) responseText += `上 ${highPrice}`;
      if (highPrice && lowPrice) responseText += ` / `;
      if (lowPrice) responseText += `下 ${lowPrice}`;
      responseText += `\n`;
    }
    
    responseText += `\n輸入「清單」查看監控`;
    
    return { type: 'text', text: responseText };
    
  } catch (error) {
    console.error('加入監控錯誤:', error);
    return { type: 'text', text: '⚠️ 加入監控失敗' };
  }
}

/**
 * 🆕 設定目標價
 */
async function setTargetPrice(stockId, highPrice, lowPrice) {
  try {
    const sql = `
      UPDATE watchlist 
      SET target_price_high = $2, target_price_low = $3
      WHERE stock_id = $1 AND user_id = 'default'
    `;
    
    const result = await pool.query(sql, [stockId, highPrice, lowPrice]);
    
    if (result.rowCount === 0) {
      return { type: 'text', text: `❌ 監控清單中沒有 ${stockId}\n請先輸入「監控 ${stockId}」` };
    }
    
    return { 
      type: 'text', 
      text: `✅ 已設定 ${stockId} 目標價\n🔺 上漲目標：${highPrice}\n🔻 下跌目標：${lowPrice}` 
    };
    
  } catch (error) {
    console.error('設定目標價錯誤:', error);
    return { type: 'text', text: '⚠️ 設定目標價失敗' };
  }
}

/**
 * 🆕 設定漲跌幅提醒百分比
 */
async function setAlertPercent(stockId, percent) {
  try {
    const sql = `
      UPDATE watchlist 
      SET alert_percent_up = $2, alert_percent_down = $2
      WHERE stock_id = $1 AND user_id = 'default'
    `;
    
    const result = await pool.query(sql, [stockId, percent]);
    
    if (result.rowCount === 0) {
      return { type: 'text', text: `❌ 監控清單中沒有 ${stockId}\n請先輸入「監控 ${stockId}」` };
    }
    
    return { 
      type: 'text', 
      text: `✅ 已設定 ${stockId} 漲跌幅提醒\n⚡ 觸發條件：±${percent}%` 
    };
    
  } catch (error) {
    console.error('設定漲跌幅錯誤:', error);
    return { type: 'text', text: '⚠️ 設定漲跌幅失敗' };
  }
}

/**
 * 加入監控清單（舊版相容）
 */
async function addToWatchlist(stockId) {
  return await addToWatchlistWithTargets(stockId, null, null);
}

/**
 * 移除監控清單
 */
async function removeFromWatchlist(stockId) {
  try {
    const sql = `
      UPDATE watchlist 
      SET is_active = false 
      WHERE stock_id = $1 AND user_id = 'default'
    `;
    
    const result = await pool.query(sql, [stockId]);
    
    if (result.rowCount === 0) {
      return { type: 'text', text: `❌ 監控清單中沒有 ${stockId}` };
    }
    
    return { type: 'text', text: `✅ 已移除監控：${stockId}` };
    
  } catch (error) {
    console.error('移除監控錯誤:', error);
    return { type: 'text', text: '⚠️ 移除監控失敗' };
  }
}

/**
 * 取得大盤資訊 - Flex Message 紅漲綠跌
 */
async function getMarketReply() {
  try {
    const taiex = await stockService.getRealtimePrice('t00');
    
    if (!taiex || !taiex.price) {
      return { type: 'text', text: '⚠️ 無法取得大盤資訊，可能休市中' };
    }
    
    const price = parseFloat(taiex.price) || 0;
    const open = parseFloat(taiex.open) || 0;
    const high = parseFloat(taiex.high) || 0;
    const low = parseFloat(taiex.low) || 0;
    const yesterday = parseFloat(taiex.yesterday) || 0;
    const change = parseFloat(taiex.change) || (price - yesterday);
    const changePercent = parseFloat(taiex.changePercent) || (yesterday > 0 ? ((change / yesterday) * 100) : 0);
    
    const isUp = change >= 0;
    // 台灣股市：紅漲綠跌
    const color = isUp ? '#D32F2F' : '#388E3C';
    const bgColor = isUp ? '#FFEBEE' : '#E8F5E9';
    const arrow = isUp ? '▲' : '▼';
    const emoji = isUp ? '📈' : '📉';
    const changeSign = isUp ? '+' : '';
    
    return {
      type: 'flex',
      altText: `📊 加權指數 ${price.toFixed(2)} ${arrow}${changePercent.toFixed(2)}%`,
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
                { type: 'text', text: '📊', size: 'xxl' },
                { type: 'text', text: '加權指數', size: 'xl', weight: 'bold', color: '#ffffff', margin: 'md', gravity: 'center' }
              ]
            },
            { 
              type: 'text', 
              text: `${emoji} ${isUp ? '上漲' : '下跌'} ${Math.abs(changePercent).toFixed(2)}%`, 
              color: '#ffffff', 
              size: 'md', 
              margin: 'md', 
              weight: 'bold' 
            }
          ],
          backgroundColor: color,
          paddingAll: '20px'
        },
        body: {
          type: 'box',
          layout: 'vertical',
          backgroundColor: bgColor,
          contents: [
            // 主要價格
            {
              type: 'box',
              layout: 'vertical',
              contents: [
                { 
                  type: 'text', 
                  text: price.toFixed(2), 
                  size: '3xl', 
                  weight: 'bold', 
                  color: color,
                  align: 'center'
                },
                { 
                  type: 'text', 
                  text: `${arrow} ${changeSign}${change.toFixed(2)} (${changeSign}${changePercent.toFixed(2)}%)`, 
                  size: 'lg', 
                  color: color, 
                  align: 'center',
                  weight: 'bold',
                  margin: 'sm'
                }
              ]
            },
            { type: 'separator', margin: 'xl', color: '#DDDDDD' },
            // 詳細數據
            {
              type: 'box',
              layout: 'vertical',
              margin: 'lg',
              spacing: 'sm',
              contents: [
                {
                  type: 'box',
                  layout: 'horizontal',
                  contents: [
                    { type: 'text', text: '開盤', size: 'md', color: '#666666', flex: 1 },
                    { type: 'text', text: open.toFixed(2), size: 'md', align: 'end', flex: 1, color: '#333333', weight: 'bold' }
                  ]
                },
                {
                  type: 'box',
                  layout: 'horizontal',
                  contents: [
                    { type: 'text', text: '最高', size: 'md', color: '#666666', flex: 1 },
                    { type: 'text', text: high.toFixed(2), size: 'md', align: 'end', flex: 1, color: '#D32F2F', weight: 'bold' }
                  ]
                },
                {
                  type: 'box',
                  layout: 'horizontal',
                  contents: [
                    { type: 'text', text: '最低', size: 'md', color: '#666666', flex: 1 },
                    { type: 'text', text: low.toFixed(2), size: 'md', align: 'end', flex: 1, color: '#388E3C', weight: 'bold' }
                  ]
                },
                {
                  type: 'box',
                  layout: 'horizontal',
                  contents: [
                    { type: 'text', text: '昨收', size: 'md', color: '#666666', flex: 1 },
                    { type: 'text', text: yesterday.toFixed(2), size: 'md', align: 'end', flex: 1, color: '#333333', weight: 'bold' }
                  ]
                }
              ]
            }
          ],
          paddingAll: '20px'
        },
        footer: {
          type: 'box',
          layout: 'horizontal',
          contents: [
            { type: 'text', text: `⏰ ${getTaiwanTime()}`, size: 'sm', color: '#666666' },
            { type: 'text', text: '台股大盤', size: 'sm', color: '#666666', align: 'end' }
          ],
          paddingAll: '15px',
          backgroundColor: '#F5F5F5'
        }
      }
    };
    
  } catch (error) {
    console.error('取得大盤錯誤:', error);
    return { type: 'text', text: '⚠️ 取得大盤資訊失敗' };
  }
}

/**
 * 搜尋股票
 */
async function searchStock(keyword) {
  try {
    // 股票名稱對照表
    const stockMap = {
      // 半導體
      '台積電': '2330', '聯發科': '2454', '聯電': '2303', '日月光': '3711',
      '矽力': '6415', '世芯': '3661', '創意': '3443', '瑞昱': '2379',
      '力積電': '6770', '南亞科': '2408', '華邦電': '2344', '旺宏': '2337',
      '群聯': '8299', '慧榮': '5765', '穩懋': '3105', '環球晶': '6488',
      
      // 電子代工
      '鴻海': '2317', '廣達': '2382', '仁寶': '2324', '緯創': '3231',
      '和碩': '4938', '英業達': '2356', '緯穎': '6669', '可成': '2474',
      
      // 面板
      '友達': '2409', '群創': '3481', '彩晶': '6116',
      
      // 金融
      '國泰金': '2882', '富邦金': '2881', '中信金': '2891', '台新金': '2887',
      '玉山金': '2884', '元大金': '2885', '第一金': '2892', '華南金': '2880',
      '兆豐金': '2886', '合庫金': '5880', '永豐金': '2890', '新光金': '2888',
      '國票金': '2889', '開發金': '2883', '日盛金': '5820',
      
      // 傳產
      '台塑': '1301', '南亞': '1303', '台化': '1326', '台塑化': '6505',
      '中鋼': '2002', '長榮': '2603', '陽明': '2609', '萬海': '2615',
      '統一': '1216', '統一超': '2912', '大立光': '3008',
      
      // 電信
      '中華電': '2412', '台灣大': '3045', '遠傳': '4904',
      
      // ETF
      '0050': '0050', '元大50': '0050', '台灣50': '0050',
      '0056': '0056', '元大高股息': '0056', '高股息': '0056',
      '00878': '00878', '國泰永續高股息': '00878',
      '00929': '00929', '復華台灣科技優息': '00929',
      '00940': '00940', '元大台灣價值高息': '00940',
      '00919': '00919', '群益台灣精選高息': '00919'
    };
    
    // 嘗試匹配
    for (const [name, id] of Object.entries(stockMap)) {
      if (name.includes(keyword) || keyword.includes(name)) {
        return await getStockInfoFlex(id);
      }
    }
    
    return { 
      type: 'text', 
      text: `🔍 找不到「${keyword}」\n\n💡 請輸入股票代碼\n如：2330、0050` 
    };
    
  } catch (error) {
    console.error('搜尋股票錯誤:', error);
    return { type: 'text', text: '⚠️ 搜尋失敗，請稍後再試' };
  }
}

/**
 * 🔊 發送語音播報（有防重機制）
 */
const voiceRequests = new Map();
const VOICE_COOLDOWN = 60000;

async function sendVoiceReport(stockId, userId) {
  const requestKey = `voice_${userId}_${stockId}`;
  const lastRequest = voiceRequests.get(requestKey);
  const now = Date.now();
  
  if (lastRequest && (now - lastRequest) < VOICE_COOLDOWN) {
    console.log(`⏭️ 語音冷卻中: ${stockId}`);
    return null;
  }
  
  voiceRequests.set(requestKey, now);
  
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
    
    const settings = await voiceService.getVoiceSettings();
    
    if (!settings.enabled) {
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
    
    const success = await lineService.sendStockVoiceAlert(userId, stockData, voiceService);
    
    if (!success) {
      return { type: 'text', text: `⚠️ 語音生成失敗` };
    }
    
    return null;
    
  } catch (error) {
    console.error('語音播報錯誤:', error);
    return { type: 'text', text: '⚠️ 語音播報失敗' };
  }
}

// ==================== 🇺🇸 美股功能 ====================

/**
 * 🇺🇸 美股單檔 Flex Message（綠漲紅跌）
 */
async function getUSStockFlex(symbol) {
  try {
    const stock = await stockService.getUSStockPrice(symbol);
    
    if (!stock || !stock.price) {
      return { type: 'text', text: `❌ 找不到美股 ${symbol}` };
    }
    
    const price = parseFloat(stock.price) || 0;
    const change = parseFloat(stock.change) || 0;
    const changePercent = parseFloat(stock.changePercent) || 0;
    const open = parseFloat(stock.open) || 0;
    const high = parseFloat(stock.high) || 0;
    const low = parseFloat(stock.low) || 0;
    const yesterday = parseFloat(stock.yesterday) || 0;
    
    const isUp = change >= 0;
    // 🇺🇸 美股：綠漲紅跌（跟台股相反）
    const color = isUp ? '#388E3C' : '#D32F2F';
    const bgColor = isUp ? '#E8F5E9' : '#FFEBEE';
    const arrow = isUp ? '▲' : '▼';
    const emoji = isUp ? '📈' : '📉';
    const changeSign = isUp ? '+' : '';
    
    // 市場狀態
    const stateMap = {
      'PRE': '🌅 盤前',
      'REGULAR': '🔔 盤中',
      'POST': '🌙 盤後',
      'CLOSED': '💤 休市'
    };
    const marketState = stateMap[stock.marketState] || '💤 休市';
    
    // 盤前盤後價格
    const extraPrices = [];
    if (stock.preMarketPrice) {
      extraPrices.push({
        type: 'box',
        layout: 'horizontal',
        contents: [
          { type: 'text', text: '盤前', size: 'sm', color: '#666666', flex: 1 },
          { type: 'text', text: `$${stock.preMarketPrice.toFixed(2)}`, size: 'sm', align: 'end', flex: 1, color: '#FF9800', weight: 'bold' }
        ]
      });
    }
    if (stock.postMarketPrice) {
      extraPrices.push({
        type: 'box',
        layout: 'horizontal',
        contents: [
          { type: 'text', text: '盤後', size: 'sm', color: '#666666', flex: 1 },
          { type: 'text', text: `$${stock.postMarketPrice.toFixed(2)}`, size: 'sm', align: 'end', flex: 1, color: '#9C27B0', weight: 'bold' }
        ]
      });
    }
    
    return {
      type: 'flex',
      altText: `🇺🇸 ${stock.name} $${price.toFixed(2)} ${arrow}${changePercent}%`,
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
                { type: 'text', text: `🇺🇸 ${stock.name}`, color: '#ffffff', size: 'lg', weight: 'bold', flex: 1, wrap: true },
                { type: 'text', text: symbol, color: '#ffffffcc', size: 'md', align: 'end' }
              ]
            },
            { 
              type: 'text', 
              text: `${emoji} ${isUp ? '上漲' : '下跌'} ${Math.abs(changePercent).toFixed(2)}%`, 
              color: '#ffffff', 
              size: 'md', 
              margin: 'sm',
              weight: 'bold'
            }
          ],
          backgroundColor: color,
          paddingAll: '20px'
        },
        body: {
          type: 'box',
          layout: 'vertical',
          backgroundColor: bgColor,
          contents: [
            {
              type: 'box',
              layout: 'vertical',
              contents: [
                { 
                  type: 'text', 
                  text: `$${price.toFixed(2)}`, 
                  size: '3xl', 
                  weight: 'bold', 
                  color: color,
                  align: 'center'
                },
                { 
                  type: 'text', 
                  text: `${arrow} ${changeSign}$${Math.abs(change).toFixed(2)} (${changeSign}${changePercent.toFixed(2)}%)`, 
                  size: 'lg', 
                  color: color, 
                  align: 'center',
                  weight: 'bold',
                  margin: 'sm'
                }
              ]
            },
            { type: 'separator', margin: 'xl', color: '#DDDDDD' },
            {
              type: 'box',
              layout: 'vertical',
              margin: 'lg',
              spacing: 'sm',
              contents: [
                {
                  type: 'box',
                  layout: 'horizontal',
                  contents: [
                    { type: 'text', text: '開盤', size: 'md', color: '#666666', flex: 1 },
                    { type: 'text', text: `$${open.toFixed(2)}`, size: 'md', align: 'end', flex: 1, color: '#333333', weight: 'bold' }
                  ]
                },
                {
                  type: 'box',
                  layout: 'horizontal',
                  contents: [
                    { type: 'text', text: '最高', size: 'md', color: '#666666', flex: 1 },
                    { type: 'text', text: `$${high.toFixed(2)}`, size: 'md', align: 'end', flex: 1, color: '#388E3C', weight: 'bold' }
                  ]
                },
                {
                  type: 'box',
                  layout: 'horizontal',
                  contents: [
                    { type: 'text', text: '最低', size: 'md', color: '#666666', flex: 1 },
                    { type: 'text', text: `$${low.toFixed(2)}`, size: 'md', align: 'end', flex: 1, color: '#D32F2F', weight: 'bold' }
                  ]
                },
                {
                  type: 'box',
                  layout: 'horizontal',
                  contents: [
                    { type: 'text', text: '昨收', size: 'md', color: '#666666', flex: 1 },
                    { type: 'text', text: `$${yesterday.toFixed(2)}`, size: 'md', align: 'end', flex: 1, color: '#333333', weight: 'bold' }
                  ]
                },
                ...extraPrices
              ]
            }
          ],
          paddingAll: '20px'
        },
        footer: {
          type: 'box',
          layout: 'horizontal',
          contents: [
            { type: 'text', text: marketState, size: 'sm', color: '#666666' },
            { type: 'text', text: stock.exchange || 'NASDAQ', size: 'sm', color: '#666666', align: 'end' }
          ],
          paddingAll: '15px',
          backgroundColor: '#F5F5F5'
        }
      }
    };
    
  } catch (error) {
    console.error('美股查詢錯誤:', error);
    return { type: 'text', text: `⚠️ 查詢美股 ${symbol} 失敗` };
  }
}

/**
 * 🇺🇸 美股三大指數 Flex Message
 */
async function getUSMarketFlex() {
  try {
    const indices = await stockService.getUSIndices();
    
    if (!indices || indices.length === 0) {
      return { type: 'text', text: '⚠️ 無法取得美股指數' };
    }
    
    const createIndexRow = (index) => {
      const isUp = index.change >= 0;
      // 🇺🇸 美股：綠漲紅跌
      const color = isUp ? '#388E3C' : '#D32F2F';
      const arrow = isUp ? '▲' : '▼';
      const changeSign = isUp ? '+' : '';
      
      return {
        type: 'box',
        layout: 'vertical',
        backgroundColor: isUp ? '#E8F5E9' : '#FFEBEE',
        cornerRadius: '10px',
        paddingAll: '15px',
        margin: 'md',
        contents: [
          {
            type: 'box',
            layout: 'horizontal',
            contents: [
              { type: 'text', text: index.name, size: 'md', weight: 'bold', color: '#333333', flex: 1 },
              { type: 'text', text: index.symbol.replace('^', ''), size: 'xs', color: '#888888', align: 'end' }
            ]
          },
          {
            type: 'box',
            layout: 'horizontal',
            margin: 'sm',
            contents: [
              { type: 'text', text: index.price.toFixed(2), size: 'xl', weight: 'bold', color: color, flex: 1 },
              { 
                type: 'text', 
                text: `${arrow} ${changeSign}${index.changePercent.toFixed(2)}%`, 
                size: 'md', 
                color: color,
                weight: 'bold',
                align: 'end',
                gravity: 'center'
              }
            ]
          }
        ]
      };
    };
    
    return {
      type: 'flex',
      altText: '🇺🇸 美股三大指數',
      contents: {
        type: 'bubble',
        size: 'mega',
        header: {
          type: 'box',
          layout: 'vertical',
          backgroundColor: '#1565C0',
          paddingAll: '20px',
          contents: [
            {
              type: 'box',
              layout: 'horizontal',
              contents: [
                { type: 'text', text: '🇺🇸', size: 'xxl' },
                { type: 'text', text: '美股三大指數', size: 'xl', weight: 'bold', color: '#FFFFFF', margin: 'md', gravity: 'center' }
              ]
            },
            { type: 'text', text: '綠漲紅跌', size: 'sm', color: '#BBDEFB', margin: 'sm' }
          ]
        },
        body: {
          type: 'box',
          layout: 'vertical',
          paddingAll: '15px',
          contents: indices.map(createIndexRow)
        },
        footer: {
          type: 'box',
          layout: 'horizontal',
          contents: [
            { type: 'text', text: `⏰ ${getUSTime()}`, size: 'sm', color: '#666666' },
            { type: 'text', text: '美東時間', size: 'sm', color: '#666666', align: 'end' }
          ],
          paddingAll: '15px',
          backgroundColor: '#F5F5F5'
        }
      }
    };
    
  } catch (error) {
    console.error('美股指數錯誤:', error);
    return { type: 'text', text: '⚠️ 取得美股指數失敗' };
  }
}

/**
 * 🇺🇸 熱門美股 Flex Message
 */
async function getHotUSStocksFlex() {
  try {
    const stocks = await stockService.getHotUSStocks();
    
    if (!stocks || stocks.length === 0) {
      return { type: 'text', text: '⚠️ 無法取得熱門美股' };
    }
    
    const createStockRow = (stock) => {
      const isUp = stock.change >= 0;
      // 🇺🇸 美股：綠漲紅跌
      const color = isUp ? '#388E3C' : '#D32F2F';
      const arrow = isUp ? '▲' : '▼';
      
      return {
        type: 'box',
        layout: 'horizontal',
        margin: 'md',
        contents: [
          { type: 'text', text: stock.symbol, size: 'sm', color: '#333333', weight: 'bold', flex: 2 },
          { type: 'text', text: `$${stock.price.toFixed(2)}`, size: 'sm', color: '#333333', flex: 2, align: 'end' },
          { 
            type: 'text', 
            text: `${arrow}${stock.changePercent.toFixed(2)}%`, 
            size: 'sm', 
            color: color,
            weight: 'bold',
            flex: 2, 
            align: 'end' 
          }
        ]
      };
    };
    
    return {
      type: 'flex',
      altText: '🔥 熱門美股',
      contents: {
        type: 'bubble',
        size: 'mega',
        header: {
          type: 'box',
          layout: 'vertical',
          backgroundColor: '#FF5722',
          paddingAll: '20px',
          contents: [
            {
              type: 'box',
              layout: 'horizontal',
              contents: [
                { type: 'text', text: '🔥', size: 'xxl' },
                { type: 'text', text: '熱門美股', size: 'xl', weight: 'bold', color: '#FFFFFF', margin: 'md', gravity: 'center' }
              ]
            },
            { type: 'text', text: '🇺🇸 綠漲紅跌', size: 'sm', color: '#FFCCBC', margin: 'sm' }
          ]
        },
        body: {
          type: 'box',
          layout: 'vertical',
          paddingAll: '15px',
          contents: [
            {
              type: 'box',
              layout: 'horizontal',
              contents: [
                { type: 'text', text: '代碼', size: 'xs', color: '#888888', flex: 2 },
                { type: 'text', text: '股價', size: 'xs', color: '#888888', flex: 2, align: 'end' },
                { type: 'text', text: '漲跌', size: 'xs', color: '#888888', flex: 2, align: 'end' }
              ]
            },
            { type: 'separator', margin: 'sm', color: '#EEEEEE' },
            ...stocks.slice(0, 10).map(createStockRow)
          ]
        },
        footer: {
          type: 'box',
          layout: 'horizontal',
          contents: [
            { type: 'text', text: `⏰ ${getUSTime()}`, size: 'sm', color: '#666666' }
          ],
          paddingAll: '15px',
          backgroundColor: '#F5F5F5'
        }
      }
    };
    
  } catch (error) {
    console.error('熱門美股錯誤:', error);
    return { type: 'text', text: '⚠️ 取得熱門美股失敗' };
  }
}

/**
 * 🇹🇼🇺🇸 台積電 ADR 價差
 */
async function getTSMSpreadFlex() {
  try {
    const spread = await stockService.getTSMSpread();
    
    if (!spread) {
      return { type: 'text', text: '⚠️ 無法取得 TSM ADR 價差' };
    }
    
    const isPremium = spread.spread >= 0;
    const spreadColor = isPremium ? '#D32F2F' : '#388E3C';
    
    return {
      type: 'flex',
      altText: `🔄 台積電 ADR 價差 ${spread.spreadText}`,
      contents: {
        type: 'bubble',
        size: 'mega',
        header: {
          type: 'box',
          layout: 'vertical',
          backgroundColor: '#6A1B9A',
          paddingAll: '20px',
          contents: [
            {
              type: 'box',
              layout: 'horizontal',
              contents: [
                { type: 'text', text: '🔄', size: 'xxl' },
                { type: 'text', text: '台積電 ADR 價差', size: 'lg', weight: 'bold', color: '#FFFFFF', margin: 'md', gravity: 'center' }
              ]
            }
          ]
        },
        body: {
          type: 'box',
          layout: 'vertical',
          paddingAll: '20px',
          contents: [
            // 台股
            {
              type: 'box',
              layout: 'horizontal',
              backgroundColor: '#FFEBEE',
              cornerRadius: '10px',
              paddingAll: '15px',
              contents: [
                { type: 'text', text: '🇹🇼 台股 2330', size: 'md', weight: 'bold', color: '#333333', flex: 1 },
                { type: 'text', text: `NT$${spread.tw.price}`, size: 'lg', weight: 'bold', color: '#D32F2F', align: 'end' }
              ]
            },
            // 美股 ADR
            {
              type: 'box',
              layout: 'horizontal',
              backgroundColor: '#E8F5E9',
              cornerRadius: '10px',
              paddingAll: '15px',
              margin: 'md',
              contents: [
                { type: 'text', text: '🇺🇸 美股 TSM', size: 'md', weight: 'bold', color: '#333333', flex: 1 },
                { type: 'text', text: `$${spread.us.price.toFixed(2)}`, size: 'lg', weight: 'bold', color: '#388E3C', align: 'end' }
              ]
            },
            { type: 'separator', margin: 'lg', color: '#DDDDDD' },
            // 換算
            {
              type: 'box',
              layout: 'vertical',
              margin: 'lg',
              spacing: 'sm',
              contents: [
                {
                  type: 'box',
                  layout: 'horizontal',
                  contents: [
                    { type: 'text', text: '匯率', size: 'sm', color: '#666666', flex: 1 },
                    { type: 'text', text: `1 USD = ${spread.usdTwd} TWD`, size: 'sm', align: 'end', flex: 2, color: '#333333' }
                  ]
                },
                {
                  type: 'box',
                  layout: 'horizontal',
                  contents: [
                    { type: 'text', text: 'ADR換算', size: 'sm', color: '#666666', flex: 1 },
                    { type: 'text', text: `NT$${spread.adrInTwd} (1 ADR=5股)`, size: 'sm', align: 'end', flex: 2, color: '#333333' }
                  ]
                }
              ]
            },
            // 價差結果
            {
              type: 'box',
              layout: 'vertical',
              backgroundColor: isPremium ? '#FFEBEE' : '#E8F5E9',
              cornerRadius: '10px',
              paddingAll: '15px',
              margin: 'lg',
              contents: [
                { 
                  type: 'text', 
                  text: spread.spreadText, 
                  size: 'xl', 
                  weight: 'bold', 
                  color: spreadColor,
                  align: 'center'
                }
              ]
            }
          ]
        },
        footer: {
          type: 'box',
          layout: 'horizontal',
          contents: [
            { type: 'text', text: `⏰ ${getTaiwanTime()}`, size: 'sm', color: '#666666' }
          ],
          paddingAll: '15px',
          backgroundColor: '#F5F5F5'
        }
      }
    };
    
  } catch (error) {
    console.error('ADR 價差錯誤:', error);
    return { type: 'text', text: '⚠️ 取得 ADR 價差失敗' };
  }
}

/**
 * 取得美東時間
 */
function getUSTime() {
  return new Date().toLocaleString('en-US', { 
    timeZone: 'America/New_York',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true
  });
}

// ==================== 📊 圖表功能 ====================

/**
 * 📊 K 線圖 Flex Message
 */
async function getKLineChartFlex(stockId) {
  try {
    const stock = await stockService.getRealtimePrice(stockId);
    if (!stock) {
      return { type: 'text', text: `❌ 找不到股票 ${stockId}` };
    }
    
    const chartUrl = await chartService.generateKLineChart(stockId, 30);
    
    if (!chartUrl) {
      return { type: 'text', text: `⚠️ 無法產生 ${stockId} K線圖（可能缺少歷史資料）` };
    }
    
    return {
      type: 'flex',
      altText: `📊 ${stock.name} K線圖`,
      contents: {
        type: 'bubble',
        size: 'mega',
        header: {
          type: 'box',
          layout: 'horizontal',
          backgroundColor: '#1565C0',
          paddingAll: '15px',
          contents: [
            { type: 'text', text: `📊 ${stock.name}`, size: 'lg', weight: 'bold', color: '#FFFFFF', flex: 1 },
            { type: 'text', text: stockId, size: 'sm', color: '#BBDEFB', align: 'end' }
          ]
        },
        hero: {
          type: 'image',
          url: chartUrl,
          size: 'full',
          aspectRatio: '16:9',
          aspectMode: 'cover'
        },
        footer: {
          type: 'box',
          layout: 'horizontal',
          paddingAll: '10px',
          backgroundColor: '#F5F5F5',
          contents: [
            { type: 'text', text: '30日K線 + MA5/MA20', size: 'xs', color: '#888888' }
          ]
        }
      }
    };
    
  } catch (error) {
    console.error('K線圖錯誤:', error);
    return { type: 'text', text: '⚠️ K線圖產生失敗' };
  }
}

/**
 * 📈 技術指標圖 Flex Message
 */
async function getIndicatorChartFlex(stockId) {
  try {
    const stock = await stockService.getRealtimePrice(stockId);
    if (!stock) {
      return { type: 'text', text: `❌ 找不到股票 ${stockId}` };
    }
    
    const chartUrl = await chartService.generateIndicatorChart(stockId, 30);
    
    if (!chartUrl) {
      return { type: 'text', text: `⚠️ 無法產生 ${stockId} 技術指標圖` };
    }
    
    return {
      type: 'flex',
      altText: `📈 ${stock.name} 技術指標`,
      contents: {
        type: 'bubble',
        size: 'mega',
        header: {
          type: 'box',
          layout: 'horizontal',
          backgroundColor: '#7B1FA2',
          paddingAll: '15px',
          contents: [
            { type: 'text', text: `📈 ${stock.name}`, size: 'lg', weight: 'bold', color: '#FFFFFF', flex: 1 },
            { type: 'text', text: stockId, size: 'sm', color: '#E1BEE7', align: 'end' }
          ]
        },
        hero: {
          type: 'image',
          url: chartUrl,
          size: 'full',
          aspectRatio: '16:9',
          aspectMode: 'cover'
        },
        footer: {
          type: 'box',
          layout: 'horizontal',
          paddingAll: '10px',
          backgroundColor: '#F5F5F5',
          contents: [
            { type: 'text', text: 'RSI(14) + KD(9)', size: 'xs', color: '#888888' }
          ]
        }
      }
    };
    
  } catch (error) {
    console.error('技術指標圖錯誤:', error);
    return { type: 'text', text: '⚠️ 技術指標圖產生失敗' };
  }
}

// ==================== 🤖 AI 功能 ====================

/**
 * 🤖 AI 對話回覆
 */
async function getAIChatReply(question) {
  try {
    const answer = await aiService.chat(question);
    
    return {
      type: 'flex',
      altText: '🤖 AI 回覆',
      contents: {
        type: 'bubble',
        size: 'mega',
        header: {
          type: 'box',
          layout: 'horizontal',
          backgroundColor: '#00897B',
          paddingAll: '15px',
          contents: [
            { type: 'text', text: '🤖', size: 'xl' },
            { type: 'text', text: 'AI 股海秘書', size: 'lg', weight: 'bold', color: '#FFFFFF', margin: 'md' }
          ]
        },
        body: {
          type: 'box',
          layout: 'vertical',
          paddingAll: '20px',
          contents: [
            { type: 'text', text: `Q: ${question}`, size: 'sm', color: '#666666', wrap: true },
            { type: 'separator', margin: 'lg' },
            { type: 'text', text: answer, size: 'md', color: '#333333', wrap: true, margin: 'lg' }
          ]
        },
        footer: {
          type: 'box',
          layout: 'horizontal',
          paddingAll: '10px',
          backgroundColor: '#F5F5F5',
          contents: [
            { type: 'text', text: '⚠️ AI 建議僅供參考', size: 'xs', color: '#888888' }
          ]
        }
      }
    };
    
  } catch (error) {
    console.error('AI 對話錯誤:', error);
    return { type: 'text', text: '⚠️ AI 回覆失敗，請稍後再試' };
  }
}

/**
 * 🤖 AI 選股推薦
 */
async function getAIRecommendationFlex(criteria) {
  try {
    const recommendations = await aiService.getStockRecommendation(criteria);
    
    if (!recommendations || recommendations.length === 0) {
      return { type: 'text', text: '⚠️ AI 選股失敗，請稍後再試' };
    }
    
    const createRow = (stock) => ({
      type: 'box',
      layout: 'horizontal',
      margin: 'md',
      contents: [
        { type: 'text', text: stock.code, size: 'sm', color: '#1565C0', weight: 'bold', flex: 1 },
        { type: 'text', text: stock.name, size: 'sm', color: '#333333', flex: 2 },
        { type: 'text', text: stock.reason, size: 'xs', color: '#666666', flex: 3, wrap: true }
      ]
    });
    
    return {
      type: 'flex',
      altText: '🤖 AI 選股推薦',
      contents: {
        type: 'bubble',
        size: 'mega',
        header: {
          type: 'box',
          layout: 'vertical',
          backgroundColor: '#FF5722',
          paddingAll: '15px',
          contents: [
            { type: 'text', text: '🤖 AI 選股推薦', size: 'lg', weight: 'bold', color: '#FFFFFF' },
            { type: 'text', text: `條件：${criteria}`, size: 'xs', color: '#FFCCBC', margin: 'sm', wrap: true }
          ]
        },
        body: {
          type: 'box',
          layout: 'vertical',
          paddingAll: '15px',
          contents: [
            {
              type: 'box',
              layout: 'horizontal',
              contents: [
                { type: 'text', text: '代碼', size: 'xs', color: '#888888', flex: 1 },
                { type: 'text', text: '名稱', size: 'xs', color: '#888888', flex: 2 },
                { type: 'text', text: '理由', size: 'xs', color: '#888888', flex: 3 }
              ]
            },
            { type: 'separator', margin: 'sm' },
            ...recommendations.map(createRow)
          ]
        },
        footer: {
          type: 'box',
          layout: 'horizontal',
          paddingAll: '10px',
          backgroundColor: '#F5F5F5',
          contents: [
            { type: 'text', text: '⚠️ AI 建議僅供參考，請自行研究', size: 'xs', color: '#888888' }
          ]
        }
      }
    };
    
  } catch (error) {
    console.error('AI 選股錯誤:', error);
    return { type: 'text', text: '⚠️ AI 選股失敗' };
  }
}

/**
 * 📰 股票新聞 Flex
 */
async function getStockNewsFlex(stockId) {
  try {
    const stock = await stockService.getRealtimePrice(stockId);
    if (!stock) {
      return { type: 'text', text: `❌ 找不到股票 ${stockId}` };
    }
    
    const news = await aiService.searchStockNews(stock.name, stockId);
    
    return {
      type: 'flex',
      altText: `📰 ${stock.name} 新聞`,
      contents: {
        type: 'bubble',
        size: 'mega',
        header: {
          type: 'box',
          layout: 'horizontal',
          backgroundColor: '#37474F',
          paddingAll: '15px',
          contents: [
            { type: 'text', text: `📰 ${stock.name}`, size: 'lg', weight: 'bold', color: '#FFFFFF', flex: 1 },
            { type: 'text', text: '新聞', size: 'sm', color: '#B0BEC5', align: 'end' }
          ]
        },
        body: {
          type: 'box',
          layout: 'vertical',
          paddingAll: '15px',
          contents: [
            { type: 'text', text: news, size: 'sm', color: '#333333', wrap: true }
          ]
        },
        footer: {
          type: 'box',
          layout: 'horizontal',
          paddingAll: '10px',
          backgroundColor: '#F5F5F5',
          contents: [
            { type: 'text', text: '📰 AI 整理', size: 'xs', color: '#888888' }
          ]
        }
      }
    };
    
  } catch (error) {
    console.error('新聞查詢錯誤:', error);
    return { type: 'text', text: '⚠️ 新聞查詢失敗' };
  }
}

/**
 * 📊 財報摘要 Flex
 */
async function getEarningsFlex(stockId) {
  try {
    const stock = await stockService.getRealtimePrice(stockId);
    if (!stock) {
      return { type: 'text', text: `❌ 找不到股票 ${stockId}` };
    }
    
    const earnings = await aiService.summarizeEarnings(stock.name, stockId);
    
    return {
      type: 'flex',
      altText: `📊 ${stock.name} 財報`,
      contents: {
        type: 'bubble',
        size: 'kilo',
        header: {
          type: 'box',
          layout: 'horizontal',
          backgroundColor: '#4CAF50',
          paddingAll: '15px',
          contents: [
            { type: 'text', text: `📊 ${stock.name}`, size: 'lg', weight: 'bold', color: '#FFFFFF', flex: 1 },
            { type: 'text', text: '財報', size: 'sm', color: '#C8E6C9', align: 'end' }
          ]
        },
        body: {
          type: 'box',
          layout: 'vertical',
          paddingAll: '15px',
          contents: [
            { type: 'text', text: earnings, size: 'sm', color: '#333333', wrap: true }
          ]
        }
      }
    };
    
  } catch (error) {
    console.error('財報查詢錯誤:', error);
    return { type: 'text', text: '⚠️ 財報查詢失敗' };
  }
}

/**
 * 💬 PTT 討論熱度 Flex
 */
async function getPTTSentimentFlex(stockId) {
  try {
    const stock = await stockService.getRealtimePrice(stockId);
    if (!stock) {
      return { type: 'text', text: `❌ 找不到股票 ${stockId}` };
    }
    
    const sentiment = await aiService.analyzePTTSentiment(stock.name);
    
    const heatColor = sentiment.heat >= 7 ? '#D32F2F' : sentiment.heat >= 4 ? '#FF9800' : '#9E9E9E';
    const sentimentColor = sentiment.sentiment >= 6 ? '#D32F2F' : sentiment.sentiment <= 4 ? '#388E3C' : '#9E9E9E';
    
    return {
      type: 'flex',
      altText: `💬 ${stock.name} PTT討論`,
      contents: {
        type: 'bubble',
        size: 'kilo',
        header: {
          type: 'box',
          layout: 'horizontal',
          backgroundColor: '#3F51B5',
          paddingAll: '15px',
          contents: [
            { type: 'text', text: `💬 ${stock.name}`, size: 'lg', weight: 'bold', color: '#FFFFFF', flex: 1 },
            { type: 'text', text: 'PTT', size: 'sm', color: '#C5CAE9', align: 'end' }
          ]
        },
        body: {
          type: 'box',
          layout: 'vertical',
          paddingAll: '15px',
          contents: [
            {
              type: 'box',
              layout: 'horizontal',
              contents: [
                { type: 'text', text: '🔥 討論熱度', size: 'sm', color: '#666666', flex: 1 },
                { type: 'text', text: `${sentiment.heat}/10`, size: 'lg', weight: 'bold', color: heatColor, align: 'end' }
              ]
            },
            {
              type: 'box',
              layout: 'horizontal',
              margin: 'md',
              contents: [
                { type: 'text', text: '📊 多空情緒', size: 'sm', color: '#666666', flex: 1 },
                { type: 'text', text: `${sentiment.sentiment}/10`, size: 'lg', weight: 'bold', color: sentimentColor, align: 'end' }
              ]
            },
            { type: 'separator', margin: 'lg' },
            { type: 'text', text: sentiment.summary, size: 'sm', color: '#333333', wrap: true, margin: 'lg' }
          ]
        }
      }
    };
    
  } catch (error) {
    console.error('PTT 分析錯誤:', error);
    return { type: 'text', text: '⚠️ PTT 分析失敗' };
  }
}

/**
 * 取得說明回覆 - Flex Message 卡片（含美股）
 */
function getHelpReply() {
  return {
    type: 'flex',
    altText: '📱 股海秘書使用說明',
    contents: {
      type: 'bubble',
      size: 'mega',
      header: {
        type: 'box',
        layout: 'vertical',
        backgroundColor: '#1565C0',
        paddingAll: '20px',
        contents: [
          {
            type: 'box',
            layout: 'horizontal',
            contents: [
              { type: 'text', text: '📱', size: 'xxl' },
              { 
                type: 'text', 
                text: '股海秘書 v3.0', 
                size: 'xl', 
                weight: 'bold', 
                color: '#FFFFFF',
                margin: 'md',
                gravity: 'center'
              }
            ]
          },
          { 
            type: 'text', 
            text: '🇹🇼 台股 + 🇺🇸 美股', 
            size: 'sm', 
            color: '#BBDEFB',
            margin: 'sm'
          }
        ]
      },
      body: {
        type: 'box',
        layout: 'vertical',
        paddingAll: '15px',
        spacing: 'sm',
        contents: [
          // 台股
          {
            type: 'box',
            layout: 'horizontal',
            contents: [
              { type: 'text', text: '🇹🇼', size: 'lg' },
              {
                type: 'box',
                layout: 'vertical',
                margin: 'md',
                contents: [
                  { type: 'text', text: '台股（紅漲綠跌）', weight: 'bold', size: 'sm', color: '#D32F2F' },
                  { type: 'text', text: '2330 查股價 | 大盤 看指數', size: 'xs', color: '#666666' },
                  { type: 'text', text: '監控 2330 1000 900', size: 'xs', color: '#666666' }
                ]
              }
            ]
          },
          { type: 'separator', color: '#EEEEEE' },
          // 美股
          {
            type: 'box',
            layout: 'horizontal',
            contents: [
              { type: 'text', text: '🇺🇸', size: 'lg' },
              {
                type: 'box',
                layout: 'vertical',
                margin: 'md',
                contents: [
                  { type: 'text', text: '美股（綠漲紅跌）', weight: 'bold', size: 'sm', color: '#388E3C' },
                  { type: 'text', text: 'AAPL 或 美 AAPL 查美股', size: 'xs', color: '#666666' },
                  { type: 'text', text: '美股 看三大指數 | 熱門美股', size: 'xs', color: '#666666' },
                  { type: 'text', text: 'ADR 看台積電價差', size: 'xs', color: '#666666' }
                ]
              }
            ]
          },
          { type: 'separator', color: '#EEEEEE' },
          // 監控
          {
            type: 'box',
            layout: 'horizontal',
            contents: [
              { type: 'text', text: '📋', size: 'lg' },
              {
                type: 'box',
                layout: 'vertical',
                margin: 'md',
                contents: [
                  { type: 'text', text: '監控管理', weight: 'bold', size: 'sm', color: '#333333' },
                  { type: 'text', text: '+2330 加入 | -2330 移除', size: 'xs', color: '#666666' },
                  { type: 'text', text: '漲跌 2330 5 設定±5%提醒', size: 'xs', color: '#666666' }
                ]
              }
            ]
          },
          { type: 'separator', color: '#EEEEEE' },
          // 其他
          {
            type: 'box',
            layout: 'horizontal',
            contents: [
              { type: 'text', text: '💼', size: 'lg' },
              {
                type: 'box',
                layout: 'vertical',
                margin: 'md',
                contents: [
                  { type: 'text', text: '其他功能', weight: 'bold', size: 'sm', color: '#333333' },
                  { type: 'text', text: '持股 | 熱門 | 語音 2330', size: 'xs', color: '#666666' }
                ]
              }
            ]
          }
        ]
      },
      footer: {
        type: 'box',
        layout: 'vertical',
        backgroundColor: '#F5F5F5',
        paddingAll: '10px',
        contents: [
          { 
            type: 'text', 
            text: '🇹🇼紅漲綠跌 🇺🇸綠漲紅跌', 
            size: 'xs', 
            color: '#888888',
            align: 'center'
          }
        ]
      }
    }
  };
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
