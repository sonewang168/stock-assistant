/**
 * 💬 LINE Bot 路由
 */

const express = require('express');
const router = express.Router();
const stockService = require('../services/stockService');
const technicalService = require('../services/technicalService');
const lineService = require('../services/lineService');
const { pool } = require('../db');


// 顏色輔助函數 - 根據設定決定漲跌顏色
let cachedColorMode = null;
async function getColors(isUp) {
  if (!cachedColorMode) {
    try {
      const result = await pool.query("SELECT value FROM settings WHERE key = 'color_mode'");
      cachedColorMode = result.rows[0]?.value || 'tw';
    } catch (e) { cachedColorMode = 'tw'; }
  }
  if (cachedColorMode === 'tw') {
    return isUp ? '#ff4444' : '#00C851'; // 台灣：紅漲綠跌
  } else {
    return isUp ? '#00C851' : '#ff4444'; // 美國：綠漲紅跌
  }
}
function getColorSync(isUp, mode = 'tw') {
  if (mode === 'tw') {
    return isUp ? '#ff4444' : '#00C851';
  } else {
    return isUp ? '#00C851' : '#ff4444';
  }
}

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
  
  // 搜尋股票：查 台積電、找 鴻海
  if (/^[查找搜]\s*.+$/.test(msg)) {
    const keyword = msg.replace(/^[查找搜]\s*/, '').trim();
    return await searchStock(keyword);
  }
  
  // 美股查詢：AAPL、TSLA 等（1-5個英文字母）
  if (/^[A-Za-z]{1,5}$/.test(msg)) {
    return await getStockInfoFlex(msg.toUpperCase());
  }
  
  // 指令列表（長的關鍵字放前面，避免誤匹配）
  const commands = {
    '外資買超': () => getInstitutionalRankingFlex('foreign', 'buy'),
    '外資賣超': () => getInstitutionalRankingFlex('foreign', 'sell'),
    '投信買超': () => getInstitutionalRankingFlex('trust', 'buy'),
    '投信賣超': () => getInstitutionalRankingFlex('trust', 'sell'),
    '熱門美股': () => getHotUSStocksFlex(),
    '美股指數': () => getUSMarketReply(),
    '持股分析': () => analyzeAllHoldingsFlex(),
    '持股績效': () => getPerformanceFlex(),
    '熱門': () => getHotStocksFlex(),
    '美股': () => getUSMarketReply(),
    '績效': () => getPerformanceFlex(),
    '持股': () => getPortfolioFlex(),
    '監控': () => getWatchlistFlex(),
    '大盤': () => getMarketReply(),
    '指數': () => getMarketReply(),
    '說明': () => getHelpReply(),
    'help': () => getHelpReply()
  };
  
  // 籌碼指令：籌碼 股票代碼
  if (msg.startsWith('籌碼') || msg.startsWith('法人')) {
    const stockId = msg.replace(/^(籌碼|法人)\s*/, '').trim().toUpperCase();
    if (/^\d{4,6}$/.test(stockId)) {
      return await getChipDataFlex(stockId);
    }
    return { type: 'text', text: '🏦 三大法人查詢\n\n請輸入：籌碼 股票代碼\n例如：籌碼 2330\n\n或輸入：\n「外資買超」「外資賣超」\n「投信買超」「投信賣超」' };
  }
  
  // AI 分析指令：分析 股票代碼
  if (msg.startsWith('分析') || msg.startsWith('AI分析') || msg.startsWith('ai分析')) {
    const stockId = msg.replace(/^(分析|AI分析|ai分析)\s*/, '').trim().toUpperCase();
    if (/^[0-9A-Z]{2,10}$/.test(stockId)) {
      return await getAIAnalysisFlex(stockId);
    }
    return { type: 'text', text: '📊 AI 買賣分析\n\n請輸入：分析 股票代碼\n例如：分析 2330\n\n💡 使用 Gemini + GPT 雙 AI 分析' };
  }
  
  // 語音聲音選擇
  if (msg === '語音設定' || msg === '聲音選擇' || msg === '語音選單') {
    return { type: 'text', text: '🎤 語音聲音選擇\n\n👨 男聲：\n1️⃣ Adam（沉穩）\n2️⃣ Josh（年輕）\n3️⃣ Arnold（渾厚）\n4️⃣ Sam（溫和）\n\n👩 女聲：\n5️⃣ Rachel（專業）\n6️⃣ Bella（甜美）\n7️⃣ Domi（活潑）\n8️⃣ Elli（溫柔）\n\n輸入「語音1」~「語音8」選擇聲音' };
  }
  if (/^語音[1-8]$/.test(msg)) {
    const voices = {
      '語音1': { id: 'pNInz6obpgDQGcFmaJgB', name: 'Adam（男-沉穩）' },
      '語音2': { id: 'TxGEqnHWrfWFTfGW9XjX', name: 'Josh（男-年輕）' },
      '語音3': { id: 'VR6AewLTigWG4xSOukaG', name: 'Arnold（男-渾厚）' },
      '語音4': { id: 'yoZ06aMxZJJ28mfd3POQ', name: 'Sam（男-溫和）' },
      '語音5': { id: '21m00Tcm4TlvDq8ikWAM', name: 'Rachel（女-專業）' },
      '語音6': { id: 'EXAVITQu4vr4xnSDxMaL', name: 'Bella（女-甜美）' },
      '語音7': { id: 'AZnzlk1XvdvUeBnXmlld', name: 'Domi（女-活潑）' },
      '語音8': { id: 'MF3mGyEYCl7XYWbV9V6O', name: 'Elli（女-溫柔）' }
    };
    const voice = voices[msg];
    await pool.query("INSERT INTO settings (key, value) VALUES ('voice_provider', 'elevenlabs') ON CONFLICT (key) DO UPDATE SET value = 'elevenlabs'");
    await pool.query("INSERT INTO settings (key, value) VALUES ('elevenlabs_voice_id', '" + voice.id + "') ON CONFLICT (key) DO UPDATE SET value = '" + voice.id + "'");
    return { type: 'text', text: '🎤 已切換為 ' + voice.name };
  }
  // 語音男女聲切換
  if (msg === '語音男' || msg === '男聲') {
    await pool.query("INSERT INTO settings (key, value) VALUES ('elevenlabs_voice_id', 'pNInz6obpgDQGcFmaJgB') ON CONFLICT (key) DO UPDATE SET value = 'pNInz6obpgDQGcFmaJgB'");
    await pool.query("INSERT INTO settings (key, value) VALUES ('voice_provider', 'elevenlabs') ON CONFLICT (key) DO UPDATE SET value = 'elevenlabs'"); await pool.query("INSERT INTO settings (key, value) VALUES ('elevenlabs_voice_id', 'pNInz6obpgDQGcFmaJgB') ON CONFLICT (key) DO UPDATE SET value = 'pNInz6obpgDQGcFmaJgB'");
  }
  if (msg === '語音女' || msg === '女聲') {
    await pool.query("INSERT INTO settings (key, value) VALUES ('elevenlabs_voice_id', '21m00Tcm4TlvDq8ikWAM') ON CONFLICT (key) DO UPDATE SET value = '21m00Tcm4TlvDq8ikWAM'");
    await pool.query("INSERT INTO settings (key, value) VALUES ('voice_provider', 'elevenlabs') ON CONFLICT (key) DO UPDATE SET value = 'elevenlabs'"); await pool.query("INSERT INTO settings (key, value) VALUES ('elevenlabs_voice_id', '21m00Tcm4TlvDq8ikWAM') ON CONFLICT (key) DO UPDATE SET value = '21m00Tcm4TlvDq8ikWAM'");
  }
  // 語音開關指令
  if (msg === '語音開' || msg === '開啟語音') {
    await pool.query("INSERT INTO settings (key, value) VALUES ('voice_enabled', 'true') ON CONFLICT (key) DO UPDATE SET value = 'true'");
    return { type: 'text', text: '🔊 語音播報已開啟！\n\n輸入「語音 2330」即可聽取報價' };
  }
  if (msg === '語音關' || msg === '關閉語音') {
    await pool.query("INSERT INTO settings (key, value) VALUES ('voice_enabled', 'false') ON CONFLICT (key) DO UPDATE SET value = 'false'");
    return { type: 'text', text: '🔇 語音播報已關閉' };
  }
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
      `📍 查股價：輸入代碼如 2330\n` +
      `🔍 搜股票：查 台積電\n` +
      `➕ 加監控：+2330\n` +
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
  
  // 台股才抓技術指標和籌碼
  let indicators = null;
  let chip = null;
  if (stockData.market !== 'US') {
    indicators = await technicalService.getFullIndicators(stockId);
    chip = await stockService.getInstitutionalData(stockId);
  }
  
  const isUp = stockData.change >= 0;
  // 根據市場決定顏色：台灣紅漲綠跌，美國綠漲紅跌
  const isUS = stockData.market === 'US';
  const color = isUS 
    ? (isUp ? '#00C851' : '#ff4444')  // 美股：綠漲紅跌
    : (isUp ? '#ff4444' : '#00C851'); // 台股：紅漲綠跌
  const arrow = isUp ? '▲' : '▼';
  const emoji = isUp ? '📈' : '📉';
  const marketFlag = isUS ? '🇺🇸' : '🇹🇼';
  const colorHint = isUS ? '綠漲紅跌' : '紅漲綠跌';
  
  // 格式化價格（美股保留2位小數）
  const formatPrice = (p) => {
    if (p === null || p === undefined) return 'N/A';
    return isUS ? parseFloat(p).toFixed(2) : p;
  };
  
  // 基本資訊
  const bodyContents = [
    {
      type: 'box',
      layout: 'horizontal',
      contents: [
        { type: 'text', text: `${isUS ? '$' : ''}${formatPrice(stockData.price)}`, size: isUS ? 'xxl' : '3xl', weight: 'bold', color: color },
        { type: 'text', text: `${arrow} ${stockData.changePercent}%`, size: 'lg', color: color, align: 'end', gravity: 'bottom' }
      ]
    },
    { type: 'separator', margin: 'lg' },
    {
      type: 'box',
      layout: 'horizontal',
      margin: 'lg',
      contents: [
        { type: 'text', text: '開盤', size: 'sm', color: '#888888', flex: 1 },
        { type: 'text', text: `${formatPrice(stockData.open)}`, size: 'sm', align: 'end', flex: 1 },
        { type: 'text', text: '最高', size: 'sm', color: '#888888', flex: 1 },
        { type: 'text', text: `${formatPrice(stockData.high)}`, size: 'sm', align: 'end', flex: 1 }
      ]
    },
    {
      type: 'box',
      layout: 'horizontal',
      margin: 'sm',
      contents: [
        { type: 'text', text: '昨收', size: 'sm', color: '#888888', flex: 1 },
        { type: 'text', text: `${formatPrice(stockData.yesterday)}`, size: 'sm', align: 'end', flex: 1 },
        { type: 'text', text: '最低', size: 'sm', color: '#888888', flex: 1 },
        { type: 'text', text: `${formatPrice(stockData.low)}`, size: 'sm', align: 'end', flex: 1 }
      ]
    }
  ];
  
  // 技術指標
  if (indicators) {
    bodyContents.push({ type: 'separator', margin: 'lg' });
    bodyContents.push({
      type: 'box',
      layout: 'vertical',
      margin: 'lg',
      contents: [
        { type: 'text', text: '📈 技術指標', size: 'sm', color: '#888888', weight: 'bold' },
        {
          type: 'box',
          layout: 'horizontal',
          margin: 'sm',
          contents: [
            { type: 'text', text: 'RSI(14)', size: 'sm', color: '#888888', flex: 1 },
            { type: 'text', text: `${indicators.rsi || 'N/A'}`, size: 'sm', align: 'end', flex: 1 },
            { type: 'text', text: 'KD(9)', size: 'sm', color: '#888888', flex: 1 },
            { type: 'text', text: indicators.kd ? `${indicators.kd.k}/${indicators.kd.d}` : 'N/A', size: 'sm', align: 'end', flex: 1 }
          ]
        }
      ]
    });
  }
  
  // 三大法人
  if (chip) {
    bodyContents.push({ type: 'separator', margin: 'lg' });
    bodyContents.push({
      type: 'box',
      layout: 'vertical',
      margin: 'lg',
      contents: [
        { type: 'text', text: '💰 三大法人', size: 'sm', color: '#888888', weight: 'bold' },
        {
          type: 'box',
          layout: 'horizontal',
          margin: 'sm',
          contents: [
            { type: 'text', text: '外資', size: 'sm', color: '#888888', flex: 1 },
            { 
              type: 'text', 
              text: `${chip.foreign > 0 ? '+' : ''}${(chip.foreign/1000).toFixed(0)}張`, 
              size: 'sm', 
              color: chip.foreign >= 0 ? '#ff4444' : '#00C851',
              align: 'end', 
              flex: 1 
            },
            { type: 'text', text: '投信', size: 'sm', color: '#888888', flex: 1 },
            { 
              type: 'text', 
              text: `${chip.investment > 0 ? '+' : ''}${(chip.investment/1000).toFixed(0)}張`, 
              size: 'sm', 
              color: chip.investment >= 0 ? '#ff4444' : '#00C851',
              align: 'end', 
              flex: 1 
            }
          ]
        }
      ]
    });
  }
  
  return {
    type: 'flex',
    altText: `${stockData.name}（${stockId}）${stockData.price} ${arrow}${stockData.changePercent}%`,
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
              { type: 'text', text: stockData.name, color: '#ffffff', size: 'xl', weight: 'bold', flex: 1 },
              { type: 'text', text: stockId, color: '#ffffffaa', size: 'sm', align: 'end' }
            ]
          },
          { type: 'text', text: `${emoji} ${isUp ? '上漲' : '下跌'} ${Math.abs(stockData.changePercent)}%`, color: '#ffffff', size: 'sm', margin: 'md' }
        ],
        backgroundColor: color,
        paddingAll: '20px'
      },
      body: {
        type: 'box',
        layout: 'vertical',
        contents: bodyContents,
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
 * 💼 取得持股 Flex Message
 */
async function getPortfolioFlex() {
  // 使用新的 holdings 資料表
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS holdings (
        id SERIAL PRIMARY KEY,
        user_id VARCHAR(100) DEFAULT 'default',
        stock_id VARCHAR(10) NOT NULL,
        stock_name VARCHAR(50),
        lots INTEGER DEFAULT 0,
        odd_shares INTEGER DEFAULT 0,
        shares INTEGER DEFAULT 0,
        bid_price DECIMAL(10,2),
        won_price DECIMAL(10,2),
        is_won BOOLEAN DEFAULT false,
        target_price_high DECIMAL(10,2),
        target_price_low DECIMAL(10,2),
        notify_enabled BOOLEAN DEFAULT true,
        notes TEXT,
        bid_date DATE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    // 嘗試新增欄位
    try {
      await pool.query(`ALTER TABLE holdings ADD COLUMN IF NOT EXISTS lots INTEGER DEFAULT 0`);
      await pool.query(`ALTER TABLE holdings ADD COLUMN IF NOT EXISTS odd_shares INTEGER DEFAULT 0`);
    } catch (e) {}
  } catch (e) {}
  
  const sql = `
    SELECT * FROM holdings
    WHERE user_id = 'default'
    ORDER BY created_at DESC
    LIMIT 10
  `;
  
  const result = await pool.query(sql);
  
  if (result.rows.length === 0) {
    return { 
      type: 'text', 
      text: '📭 目前沒有持股紀錄\n\n請在網頁版「持股管理」新增持股\n或輸入「持股新增 股票代碼」快速新增' 
    };
  }
  
  // 格式化張數零股顯示
  function formatLotsShares(totalShares) {
    const lots = Math.floor(totalShares / 1000);
    const odd = totalShares % 1000;
    if (lots > 0 && odd > 0) {
      return `${lots}張${odd}股`;
    } else if (lots > 0) {
      return `${lots}張`;
    } else {
      return `${odd}股`;
    }
  }
  
  // 取得即時價格計算損益
  const holdings = [];
  let totalValue = 0;
  let totalCost = 0;
  let totalLots = 0;
  let totalOddShares = 0;
  let wonCount = 0;
  
  for (const row of result.rows) {
    const stockData = await stockService.getRealtimePrice(row.stock_id);
    const currentPrice = stockData?.price || 0;
    const costPrice = parseFloat(row.won_price) || parseFloat(row.bid_price) || 0;
    
    // 計算張數和零股
    const lots = parseInt(row.lots) || Math.floor((parseInt(row.shares) || 0) / 1000);
    const oddShares = row.odd_shares !== undefined && row.odd_shares !== null 
      ? parseInt(row.odd_shares) 
      : ((parseInt(row.shares) || 0) % 1000);
    const totalShares = lots * 1000 + oddShares;
    
    let profit = 0;
    let profitPercent = 0;
    let paidTotal = 0;
    let currentValue = 0;
    
    if (costPrice > 0 && totalShares > 0) {
      paidTotal = costPrice * totalShares;
      currentValue = currentPrice * totalShares;
      
      if (row.is_won) {
        profit = currentValue - paidTotal;
        profitPercent = ((currentPrice - costPrice) / costPrice * 100).toFixed(2);
        
        totalCost += paidTotal;
        totalValue += currentValue;
        totalLots += lots;
        totalOddShares += oddShares;
        wonCount++;
      }
    }
    
    holdings.push({
      name: row.stock_name || row.stock_id,
      stockId: row.stock_id,
      lots,
      oddShares,
      totalShares,
      bidPrice: row.bid_price,
      wonPrice: row.won_price,
      isWon: row.is_won,
      currentPrice,
      paidTotal,
      currentValue,
      profit,
      profitPercent,
      notifyEnabled: row.notify_enabled,
      targetHigh: row.target_price_high,
      targetLow: row.target_price_low
    });
    
    await new Promise(r => setTimeout(r, 200));
  }
  
  const totalProfit = totalValue - totalCost;
  const totalProfitPercent = totalCost > 0 ? ((totalProfit / totalCost) * 100).toFixed(2) : 0;
  const isProfit = totalProfit >= 0;
  // 台灣習慣：紅漲綠跌
  const headerColor = isProfit ? '#D32F2F' : '#388E3C';
  
  // 建立持股列表
  const holdingRows = holdings.map(h => {
    const isUp = h.profit >= 0;
    const color = isUp ? '#ff4444' : '#00C851';
    const statusIcon = h.isWon ? '✅' : '⏳';
    const notifyIcon = h.notifyEnabled ? '🔔' : '🔕';
    const lotsDisplay = formatLotsShares(h.totalShares);
    
    return {
      type: 'box',
      layout: 'vertical',
      margin: 'md',
      paddingAll: '12px',
      backgroundColor: h.isWon ? '#FFF8E1' : '#F5F5F5',
      cornerRadius: '8px',
      contents: [
        // 股票名稱 + 現價
        {
          type: 'box',
          layout: 'horizontal',
          contents: [
            { type: 'text', text: `${statusIcon} ${h.name}`, size: 'sm', weight: 'bold', flex: 4, color: '#333333' },
            { type: 'text', text: `$${h.currentPrice || '-'}`, size: 'sm', align: 'end', flex: 2, color: '#333333', weight: 'bold' }
          ]
        },
        // 張數零股
        {
          type: 'box',
          layout: 'horizontal',
          margin: 'xs',
          contents: [
            { type: 'text', text: `📦 ${lotsDisplay}`, size: 'xs', color: '#666666', flex: 2 },
            { type: 'text', text: `${notifyIcon}`, size: 'xs', align: 'end', flex: 1 }
          ]
        },
        // 出標價 → 得標價
        {
          type: 'box',
          layout: 'horizontal',
          margin: 'xs',
          contents: [
            { type: 'text', text: `出標 $${h.bidPrice || '-'} → 得標 $${h.wonPrice || '-'}`, size: 'xs', color: '#888888', flex: 5 }
          ]
        },
        // 付出總價 + 目前市值
        {
          type: 'box',
          layout: 'horizontal',
          margin: 'xs',
          contents: [
            { type: 'text', text: `💰成本 $${h.paidTotal > 0 ? Math.round(h.paidTotal).toLocaleString() : '-'}`, size: 'xs', color: '#666666', flex: 3 },
            { type: 'text', text: `市值 $${h.currentValue > 0 ? Math.round(h.currentValue).toLocaleString() : '-'}`, size: 'xs', color: '#333333', align: 'end', flex: 2 }
          ]
        },
        // 損益
        {
          type: 'box',
          layout: 'horizontal',
          margin: 'xs',
          contents: [
            { 
              type: 'text', 
              text: h.isWon 
                ? `📊 損益 ${isUp ? '+' : ''}$${Math.round(h.profit).toLocaleString()} (${isUp ? '+' : ''}${h.profitPercent}%)` 
                : '⏳ 競標中', 
              size: 'xs', 
              color: h.isWon ? color : '#888888', 
              weight: h.isWon ? 'bold' : 'regular',
              flex: 5 
            }
          ]
        }
      ]
    };
  });
  
  // 總計張數零股顯示
  const totalLotsDisplay = totalLots > 0 || totalOddShares > 0 
    ? `${totalLots}張${totalOddShares > 0 ? totalOddShares + '股' : ''}`
    : '0張';
  
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
          { 
            type: 'text', 
            text: '💼 我的持股', 
            size: 'xl', 
            weight: 'bold', 
            color: '#ffffff' 
          },
          { 
            type: 'text', 
            text: `${wonCount}筆得標 ${totalLotsDisplay} | 報酬 ${isProfit ? '+' : ''}${totalProfitPercent}%`, 
            size: 'sm', 
            color: '#ffffffcc', 
            margin: 'sm' 
          }
        ],
        backgroundColor: headerColor,
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
              { type: 'text', text: '💰 付出總價', size: 'sm', color: '#888888' },
              { type: 'text', text: `$${Math.round(totalCost).toLocaleString()}`, size: 'md', weight: 'bold', align: 'end', color: '#333333' }
            ]
          },
          {
            type: 'box',
            layout: 'horizontal',
            margin: 'sm',
            contents: [
              { type: 'text', text: '📊 目前市值', size: 'sm', color: '#888888' },
              { type: 'text', text: `$${Math.round(totalValue).toLocaleString()}`, size: 'md', weight: 'bold', align: 'end', color: '#333333' }
            ]
          },
          {
            type: 'box',
            layout: 'horizontal',
            margin: 'sm',
            contents: [
              { type: 'text', text: '📈 總損益', size: 'sm', color: '#888888' },
              { type: 'text', text: `${isProfit ? '+' : ''}$${Math.round(totalProfit).toLocaleString()} (${isProfit ? '+' : ''}${totalProfitPercent}%)`, size: 'md', color: isProfit ? '#ff4444' : '#00C851', align: 'end', weight: 'bold' }
            ]
          },
          { type: 'separator', margin: 'lg' },
          ...holdingRows
        ],
        paddingAll: '20px'
      },
      footer: {
        type: 'box',
        layout: 'vertical',
        contents: [
          { 
            type: 'text', 
            text: '💡 網頁版可設定目標價通知', 
            size: 'xs', 
            color: '#888888',
            align: 'center'
          },
          { 
            type: 'text', 
            text: `⏰ ${getTaiwanTime()}`, 
            size: 'xs', 
            color: '#aaaaaa',
            align: 'center',
            margin: 'sm'
          }
        ],
        paddingAll: '15px'
      }
    }
  };
}

/**
 * 🤖 取得 AI 買賣分析 Flex Message（單一股票）
 */
async function getAIAnalysisFlex(stockId) {
  const aiService = require('../services/aiService');
  const technicalService = require('../services/technicalService');
  
  try {
    // 取得即時股價
    const stockData = await stockService.getRealtimePrice(stockId);
    if (!stockData) {
      return { type: 'text', text: `❌ 找不到股票：${stockId}` };
    }

    // 取得技術指標
    let technicalData = null;
    try {
      technicalData = await technicalService.getFullIndicators(stockId);
    } catch (e) {}

    // 取得持股資訊
    let holdingData = null;
    try {
      const holdingResult = await pool.query(
        'SELECT * FROM holdings WHERE stock_id = $1 AND user_id = $2 AND is_won = true LIMIT 1',
        [stockId, 'default']
      );
      if (holdingResult.rows.length > 0) {
        holdingData = holdingResult.rows[0];
      }
    } catch (e) {}

    // 呼叫雙 AI 分析
    const analysis = await aiService.analyzeBuySellTiming(stockData, technicalData, holdingData);
    
    if (!analysis.combined) {
      return { type: 'text', text: '❌ AI 分析暫時無法使用，請確認 GEMINI_API_KEY 或 OPENAI_API_KEY 已設定' };
    }

    const combined = analysis.combined;
    const isUp = stockData.change >= 0;
    
    // 動作對應顏色
    const actionColors = {
      'strong_buy': '#D32F2F',
      'buy': '#FF5722',
      'hold': '#9E9E9E',
      'sell': '#4CAF50',
      'strong_sell': '#2E7D32'
    };
    const headerColor = actionColors[combined.action] || '#333333';

    // 信心度顏色
    const confidenceColor = combined.finalConfidence >= 70 ? '#4CAF50' 
      : combined.finalConfidence >= 50 ? '#FF9800' : '#F44336';

    // 技術指標摘要
    let techSummary = '無技術指標';
    if (technicalData) {
      const rsiStatus = technicalData.rsi >= 70 ? '超買⚠️' : technicalData.rsi <= 30 ? '超賣✅' : '中性';
      const kdStatus = technicalData.kd?.k > technicalData.kd?.d ? '黃金交叉✅' : '死亡交叉⚠️';
      techSummary = `RSI:${technicalData.rsi}(${rsiStatus}) | KD:${kdStatus}`;
    }

    // 建立 Flex Message
    const bodyContents = [
      // 股票資訊
      {
        type: 'box',
        layout: 'horizontal',
        contents: [
          { type: 'text', text: '📊 現價', size: 'sm', color: '#888888', flex: 2 },
          { type: 'text', text: `$${stockData.price}`, size: 'lg', weight: 'bold', align: 'end', flex: 3, color: '#333333' }
        ]
      },
      {
        type: 'box',
        layout: 'horizontal',
        margin: 'sm',
        contents: [
          { type: 'text', text: '📈 漲跌', size: 'sm', color: '#888888', flex: 2 },
          { type: 'text', text: `${stockData.change >= 0 ? '+' : ''}${stockData.change} (${stockData.changePercent}%)`, size: 'sm', align: 'end', flex: 3, color: isUp ? '#ff4444' : '#00C851' }
        ]
      },
      { type: 'separator', margin: 'lg' },
      
      // AI 建議
      {
        type: 'box',
        layout: 'vertical',
        margin: 'lg',
        contents: [
          { type: 'text', text: '🎯 AI 建議', size: 'sm', color: '#888888' },
          { type: 'text', text: combined.actionText, size: 'xl', weight: 'bold', color: headerColor, margin: 'sm' }
        ]
      },
      
      // 信心度
      {
        type: 'box',
        layout: 'horizontal',
        margin: 'md',
        contents: [
          { type: 'text', text: '🔥 信心度', size: 'sm', color: '#888888', flex: 2 },
          { type: 'text', text: `${combined.finalConfidence}%${combined.consensus ? ' (雙AI一致✅)' : ''}`, size: 'sm', weight: 'bold', align: 'end', flex: 3, color: confidenceColor }
        ]
      },
      
      // 價格建議
      {
        type: 'box',
        layout: 'horizontal',
        margin: 'sm',
        contents: [
          { type: 'text', text: '💰 建議買入價', size: 'xs', color: '#888888', flex: 3 },
          { type: 'text', text: combined.buyPrice ? `$${combined.buyPrice}` : '-', size: 'sm', align: 'end', flex: 2, color: '#4CAF50' }
        ]
      },
      {
        type: 'box',
        layout: 'horizontal',
        margin: 'xs',
        contents: [
          { type: 'text', text: '💵 建議賣出價', size: 'xs', color: '#888888', flex: 3 },
          { type: 'text', text: combined.sellPrice ? `$${combined.sellPrice}` : '-', size: 'sm', align: 'end', flex: 2, color: '#F44336' }
        ]
      },
      {
        type: 'box',
        layout: 'horizontal',
        margin: 'xs',
        contents: [
          { type: 'text', text: '🛑 停損價', size: 'xs', color: '#888888', flex: 3 },
          { type: 'text', text: combined.stopLoss ? `$${combined.stopLoss}` : '-', size: 'sm', align: 'end', flex: 2, color: '#9E9E9E' }
        ]
      },
      
      { type: 'separator', margin: 'lg' },
      
      // 技術指標
      {
        type: 'text',
        text: `📉 ${techSummary}`,
        size: 'xs',
        color: '#666666',
        margin: 'lg',
        wrap: true
      },
      
      // 風險等級
      {
        type: 'box',
        layout: 'horizontal',
        margin: 'sm',
        contents: [
          { type: 'text', text: `⚠️ 風險等級：${combined.riskLevel || '中'}`, size: 'xs', color: '#888888' }
        ]
      }
    ];

    // 加入 AI 分析理由
    if (combined.reasons && combined.reasons.length > 0) {
      bodyContents.push({ type: 'separator', margin: 'lg' });
      bodyContents.push({
        type: 'text',
        text: '💬 分析理由',
        size: 'sm',
        color: '#888888',
        margin: 'lg'
      });
      
      combined.reasons.forEach(reason => {
        bodyContents.push({
          type: 'text',
          text: reason,
          size: 'xs',
          color: '#333333',
          margin: 'sm',
          wrap: true
        });
      });
    }

    // 加入操作時機建議
    if (combined.timings && combined.timings.length > 0) {
      bodyContents.push({
        type: 'text',
        text: `⏰ ${combined.timings[0]}`,
        size: 'xs',
        color: '#FF9800',
        margin: 'md',
        wrap: true
      });
    }

    // 如果有持股，加入持股建議
    if (holdingData && combined.holdingAdvices && combined.holdingAdvices.length > 0) {
      bodyContents.push({ type: 'separator', margin: 'lg' });
      bodyContents.push({
        type: 'text',
        text: `💼 持股建議：${combined.holdingAdvices[0]}`,
        size: 'xs',
        color: '#2196F3',
        margin: 'lg',
        wrap: true
      });
    }

    return {
      type: 'flex',
      altText: `🤖 ${stockData.name} AI分析：${combined.actionText}`,
      contents: {
        type: 'bubble',
        size: 'mega',
        header: {
          type: 'box',
          layout: 'vertical',
          contents: [
            { type: 'text', text: `🤖 AI 買賣分析`, size: 'md', color: '#ffffff', weight: 'bold' },
            { type: 'text', text: `${stockData.name}（${stockId}）`, size: 'xl', color: '#ffffff', weight: 'bold', margin: 'sm' },
            { type: 'text', text: `Gemini + GPT 雙 AI 分析${combined.aiCount === 2 ? ' ✅' : ''}`, size: 'xs', color: '#ffffffaa', margin: 'sm' }
          ],
          backgroundColor: headerColor,
          paddingAll: '20px'
        },
        body: {
          type: 'box',
          layout: 'vertical',
          contents: bodyContents,
          paddingAll: '20px'
        },
        footer: {
          type: 'box',
          layout: 'vertical',
          contents: [
            { type: 'text', text: '⚠️ AI 建議僅供參考，投資有風險', size: 'xs', color: '#888888', align: 'center' },
            { type: 'text', text: `⏰ ${getTaiwanTime()}`, size: 'xs', color: '#aaaaaa', align: 'center', margin: 'sm' }
          ],
          paddingAll: '15px'
        }
      }
    };

  } catch (error) {
    console.error('AI 分析錯誤:', error);
    return { type: 'text', text: `❌ AI 分析失敗：${error.message}` };
  }
}

/**
 * 🤖 分析所有持股的 AI 建議
 */
async function analyzeAllHoldingsFlex() {
  const aiService = require('../services/aiService');
  const technicalService = require('../services/technicalService');
  
  try {
    // 取得所有已得標持股
    const holdingsResult = await pool.query(
      'SELECT * FROM holdings WHERE user_id = $1 AND is_won = true ORDER BY created_at DESC LIMIT 5',
      ['default']
    );

    if (holdingsResult.rows.length === 0) {
      return { type: 'text', text: '📭 目前沒有持股可分析\n\n請先在網頁版新增持股' };
    }

    const analyses = [];
    let buyCount = 0, sellCount = 0, holdCount = 0;

    for (const holding of holdingsResult.rows) {
      try {
        const stockData = await stockService.getRealtimePrice(holding.stock_id);
        if (!stockData) continue;

        let technicalData = null;
        try {
          technicalData = await technicalService.getFullIndicators(holding.stock_id);
        } catch (e) {}

        const analysis = await aiService.analyzeBuySellTiming(stockData, technicalData, holding);
        
        if (analysis.combined) {
          const action = analysis.combined.action;
          if (action.includes('buy')) buyCount++;
          else if (action.includes('sell')) sellCount++;
          else holdCount++;

          analyses.push({
            holding,
            stockData,
            combined: analysis.combined
          });
        }

        await new Promise(r => setTimeout(r, 500));
      } catch (e) {
        console.log(`分析 ${holding.stock_id} 失敗:`, e.message);
      }
    }

    if (analyses.length === 0) {
      return { type: 'text', text: '❌ AI 分析暫時無法使用' };
    }

    // 建立持股分析卡片列表
    const holdingCards = analyses.map(a => {
      const h = a.holding;
      const s = a.stockData;
      const c = a.combined;
      
      const costPrice = parseFloat(h.won_price) || parseFloat(h.bid_price) || 0;
      const profitPercent = costPrice > 0 
        ? (((s.price - costPrice) / costPrice) * 100).toFixed(1)
        : 0;
      const isProfit = profitPercent >= 0;

      const actionColors = {
        'strong_buy': '#D32F2F',
        'buy': '#FF5722',
        'hold': '#9E9E9E',
        'sell': '#4CAF50',
        'strong_sell': '#2E7D32'
      };

      return {
        type: 'box',
        layout: 'vertical',
        margin: 'md',
        paddingAll: '12px',
        backgroundColor: '#f5f5f5',
        cornerRadius: '8px',
        contents: [
          {
            type: 'box',
            layout: 'horizontal',
            contents: [
              { type: 'text', text: `${s.name}`, size: 'sm', weight: 'bold', flex: 3, color: '#333333' },
              { type: 'text', text: c.actionText, size: 'xs', align: 'end', flex: 2, color: actionColors[c.action] || '#333', weight: 'bold' }
            ]
          },
          {
            type: 'box',
            layout: 'horizontal',
            margin: 'xs',
            contents: [
              { type: 'text', text: `$${s.price} | ${isProfit ? '+' : ''}${profitPercent}%`, size: 'xs', color: isProfit ? '#ff4444' : '#00C851', flex: 3 },
              { type: 'text', text: `信心 ${c.finalConfidence}%`, size: 'xs', align: 'end', flex: 2, color: '#888888' }
            ]
          }
        ]
      };
    });

    // 整體建議
    let overallAdvice = '持有觀望';
    if (sellCount > buyCount && sellCount > holdCount) overallAdvice = '建議減碼';
    else if (buyCount > sellCount && buyCount > holdCount) overallAdvice = '建議加碼';

    return {
      type: 'flex',
      altText: `🤖 持股 AI 分析：${analyses.length} 檔`,
      contents: {
        type: 'bubble',
        size: 'mega',
        header: {
          type: 'box',
          layout: 'vertical',
          contents: [
            { type: 'text', text: '🤖 持股 AI 分析', size: 'xl', weight: 'bold', color: '#ffffff' },
            { type: 'text', text: `📊 ${analyses.length} 檔持股 | 買${buyCount} 賣${sellCount} 持${holdCount}`, size: 'sm', color: '#ffffffcc', margin: 'sm' }
          ],
          backgroundColor: '#1976D2',
          paddingAll: '20px'
        },
        body: {
          type: 'box',
          layout: 'vertical',
          contents: [
            {
              type: 'text',
              text: `💡 整體建議：${overallAdvice}`,
              size: 'md',
              weight: 'bold',
              color: '#333333'
            },
            { type: 'separator', margin: 'lg' },
            ...holdingCards
          ],
          paddingAll: '20px'
        },
        footer: {
          type: 'box',
          layout: 'vertical',
          contents: [
            { type: 'text', text: '輸入「分析 股票代碼」看詳細分析', size: 'xs', color: '#888888', align: 'center' },
            { type: 'text', text: `⏰ ${getTaiwanTime()}`, size: 'xs', color: '#aaaaaa', align: 'center', margin: 'sm' }
          ],
          paddingAll: '15px'
        }
      }
    };

  } catch (error) {
    console.error('持股分析錯誤:', error);
    return { type: 'text', text: `❌ 持股分析失敗：${error.message}` };
  }
}

/**
 * 📋 取得監控清單 Flex Message
 */
async function getWatchlistFlex() {
  // 取得監控清單
  const watchlistSql = `
    SELECT w.stock_id, s.name as stock_name
    FROM watchlist w
    LEFT JOIN stocks s ON w.stock_id = s.id
    WHERE w.user_id = 'default' AND w.is_active = true
    ORDER BY w.created_at DESC
    LIMIT 10
  `;
  
  // 取得持股清單（用於標記）
  let holdingIds = [];
  try {
    const holdingsSql = `SELECT stock_id FROM holdings WHERE user_id = 'default' AND is_won = true`;
    const holdingsResult = await pool.query(holdingsSql);
    holdingIds = holdingsResult.rows.map(r => r.stock_id);
  } catch (e) {}
  
  const result = await pool.query(watchlistSql);
  
  if (result.rows.length === 0) {
    return { type: 'text', text: '📭 目前沒有監控股票\n\n輸入「+2330」加入監控' };
  }
  
  // 取得即時價格
  const stockRows = [];
  for (const row of result.rows) {
    const stockData = await stockService.getRealtimePrice(row.stock_id);
    const isUp = stockData?.change >= 0;
    const color = isUp ? '#ff4444' : '#00C851'; // 台灣：紅漲綠跌
    const arrow = isUp ? '▲' : '▼';
    
    // 檢查是否為持股
    const isHolding = holdingIds.includes(row.stock_id);
    const holdingIcon = isHolding ? '💼' : '';
    
    stockRows.push({
      type: 'box',
      layout: 'horizontal',
      contents: [
        { 
          type: 'text', 
          text: `${holdingIcon}${row.stock_name || row.stock_id}`, 
          size: 'sm', 
          flex: 3,
          color: isHolding ? '#D4AF37' : '#333333',
          weight: isHolding ? 'bold' : 'regular'
        },
        { type: 'text', text: `${stockData?.price || 'N/A'}`, size: 'sm', align: 'end', flex: 2, color: '#333333' },
        { type: 'text', text: stockData ? `${arrow}${stockData.changePercent}%` : 'N/A', size: 'sm', color: color, align: 'end', flex: 2 }
      ],
      margin: 'sm',
      paddingAll: '8px',
      backgroundColor: isHolding ? '#FFFDE7' : '#ffffff',
      cornerRadius: '4px'
    });
    
    await new Promise(r => setTimeout(r, 200));
  }
  
  // 計算持股數量
  const holdingCount = result.rows.filter(r => holdingIds.includes(r.stock_id)).length;
  
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
          { 
            type: 'text', 
            text: `共 ${result.rows.length} 支股票${holdingCount > 0 ? ` | 💼 ${holdingCount} 支持股中` : ''}`, 
            size: 'sm', 
            color: '#ffffffaa', 
            margin: 'sm' 
          }
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
            type: 'box',
            layout: 'vertical',
            margin: 'md',
            contents: [
              { 
                type: 'text', 
                text: '💡 +代碼 加入｜-代碼 移除', 
                size: 'xs', 
                color: '#888888',
                align: 'center'
              },
              { 
                type: 'text', 
                text: '💼 = 持股中的股票', 
                size: 'xs', 
                color: '#D4AF37',
                align: 'center',
                margin: 'xs'
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
        const color = isUp ? '#ff4444' : '#00C851'; // 台灣：紅漲綠跌
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
      INSERT INTO watchlist (stock_id, stock_name, user_id, is_active)
      VALUES ($1, $2, 'default', true)
      ON CONFLICT (stock_id, user_id) DO UPDATE SET is_active = true
    `;
    
    await pool.query(sql, [stockId, stockData.name]);
    
    return { 
      type: 'text', 
      text: `✅ 已加入監控：${stockData.name}（${stockId}）\n\n輸入「監控」查看清單` 
    };
    
  } catch (error) {
    console.error('加入監控錯誤:', error);
    return { type: 'text', text: '⚠️ 加入監控失敗' };
  }
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
 * 取得大盤資訊
 */
async function getMarketReply() {
  try {
    const taiex = await stockService.getRealtimePrice('t00');
    
    if (!taiex) {
      return { type: 'text', text: '⚠️ 無法取得大盤資訊' };
    }
    
    const isUp = taiex.change >= 0;
    const color = isUp ? '#ff4444' : '#00C851'; // 台灣：紅漲綠跌
    const arrow = isUp ? '▲' : '▼';
    const emoji = isUp ? '📈' : '📉';
    
    return {
      type: 'flex',
      altText: `📊 加權指數 ${taiex.price} ${arrow}${taiex.changePercent}%`,
      contents: {
        type: 'bubble',
        size: 'mega',
        header: {
          type: 'box',
          layout: 'vertical',
          contents: [
            { type: 'text', text: '📊 加權指數', size: 'xl', weight: 'bold', color: '#ffffff' },
            { type: 'text', text: `${emoji} ${isUp ? '上漲' : '下跌'} ${Math.abs(taiex.changePercent)}%`, color: '#ffffff', size: 'sm', margin: 'md' }
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
                { type: 'text', text: `${Math.round(taiex.price).toLocaleString()}`, size: '3xl', weight: 'bold', color: color },
                { type: 'text', text: `${arrow} ${Math.round(taiex.change)}`, size: 'xl', color: color, align: 'end', gravity: 'bottom' }
              ]
            },
            { type: 'separator', margin: 'lg' },
            {
              type: 'box',
              layout: 'horizontal',
              margin: 'lg',
              contents: [
                { type: 'text', text: '開盤', size: 'sm', color: '#888888', flex: 1 },
                { type: 'text', text: `${Math.round(taiex.open).toLocaleString()}`, size: 'sm', align: 'end', flex: 1 },
                { type: 'text', text: '最高', size: 'sm', color: '#888888', flex: 1 },
                { type: 'text', text: `${Math.round(taiex.high).toLocaleString()}`, size: 'sm', align: 'end', flex: 1 }
              ]
            },
            {
              type: 'box',
              layout: 'horizontal',
              margin: 'sm',
              contents: [
                { type: 'text', text: '昨收', size: 'sm', color: '#888888', flex: 1 },
                { type: 'text', text: `${Math.round(taiex.yesterday).toLocaleString()}`, size: 'sm', align: 'end', flex: 1 },
                { type: 'text', text: '最低', size: 'sm', color: '#888888', flex: 1 },
                { type: 'text', text: `${Math.round(taiex.low).toLocaleString()}`, size: 'sm', align: 'end', flex: 1 }
              ]
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

/**
 * 🏦 取得三大法人買賣超 Flex Message
 */
async function getChipDataFlex(stockId) {
  const chipService = require('../services/chipService');
  
  try {
    const chipData = await chipService.getInstitutionalTrading(stockId, 5);
    
    if (!chipData) {
      return { type: 'text', text: `❌ 無法取得 ${stockId} 的三大法人資料\n\n可能原因：\n1. 非上市股票\n2. 今日尚未更新\n3. 網路問題` };
    }

    const stockData = await stockService.getRealtimePrice(stockId);
    const stockName = stockData?.name || stockId;
    
    const latest = chipData.latest;
    const formatNet = (net) => {
      const n = parseInt(net) || 0;
      const sign = n >= 0 ? '+' : '';
      if (Math.abs(n) >= 1000000) {
        return sign + (n / 1000000).toFixed(2) + '百萬';
      }
      return sign + Math.round(n / 1000) + '張';
    };

    // 顏色判斷
    const foreignColor = latest.foreign.net >= 0 ? '#D32F2F' : '#388E3C';
    const trustColor = latest.trust.net >= 0 ? '#D32F2F' : '#388E3C';
    const dealerColor = latest.dealer.net >= 0 ? '#D32F2F' : '#388E3C';
    const totalColor = latest.totalNet >= 0 ? '#D32F2F' : '#388E3C';

    // 總淨買超判斷標頭顏色
    const headerColor = latest.totalNet >= 0 ? '#D32F2F' : '#388E3C';

    return {
      type: 'flex',
      altText: `🏦 ${stockName} 三大法人`,
      contents: {
        type: 'bubble',
        size: 'mega',
        header: {
          type: 'box',
          layout: 'vertical',
          contents: [
            { type: 'text', text: '🏦 三大法人買賣超', size: 'md', color: '#ffffff', weight: 'bold' },
            { type: 'text', text: `${stockName}（${stockId}）`, size: 'xl', color: '#ffffff', weight: 'bold', margin: 'sm' }
          ],
          backgroundColor: headerColor,
          paddingAll: '20px'
        },
        body: {
          type: 'box',
          layout: 'vertical',
          contents: [
            // 外資
            {
              type: 'box',
              layout: 'horizontal',
              contents: [
                { type: 'text', text: '🌍 外資', size: 'md', flex: 2 },
                { type: 'text', text: formatNet(latest.foreign.net), size: 'md', weight: 'bold', align: 'end', flex: 2, color: foreignColor },
                { type: 'text', text: latest.foreign.streakText, size: 'xs', align: 'end', flex: 2, color: '#888888' }
              ]
            },
            // 投信
            {
              type: 'box',
              layout: 'horizontal',
              margin: 'md',
              contents: [
                { type: 'text', text: '🏛️ 投信', size: 'md', flex: 2 },
                { type: 'text', text: formatNet(latest.trust.net), size: 'md', weight: 'bold', align: 'end', flex: 2, color: trustColor },
                { type: 'text', text: latest.trust.streakText, size: 'xs', align: 'end', flex: 2, color: '#888888' }
              ]
            },
            // 自營商
            {
              type: 'box',
              layout: 'horizontal',
              margin: 'md',
              contents: [
                { type: 'text', text: '🏢 自營', size: 'md', flex: 2 },
                { type: 'text', text: formatNet(latest.dealer.net), size: 'md', weight: 'bold', align: 'end', flex: 2, color: dealerColor },
                { type: 'text', text: latest.dealer.streakText, size: 'xs', align: 'end', flex: 2, color: '#888888' }
              ]
            },
            { type: 'separator', margin: 'lg' },
            // 合計
            {
              type: 'box',
              layout: 'horizontal',
              margin: 'lg',
              contents: [
                { type: 'text', text: '📊 合計', size: 'md', weight: 'bold', flex: 2 },
                { type: 'text', text: formatNet(latest.totalNet), size: 'lg', weight: 'bold', align: 'end', flex: 4, color: totalColor }
              ]
            },
            // 5 日累計
            chipData.sum5Days ? {
              type: 'box',
              layout: 'vertical',
              margin: 'lg',
              contents: [
                { type: 'text', text: '📅 近 5 日累計', size: 'xs', color: '#888888' },
                {
                  type: 'box',
                  layout: 'horizontal',
                  margin: 'sm',
                  contents: [
                    { type: 'text', text: `外資 ${formatNet(chipData.sum5Days.foreign)}`, size: 'xs', flex: 1 },
                    { type: 'text', text: `投信 ${formatNet(chipData.sum5Days.trust)}`, size: 'xs', flex: 1 },
                    { type: 'text', text: `自營 ${formatNet(chipData.sum5Days.dealer)}`, size: 'xs', flex: 1 }
                  ]
                }
              ]
            } : { type: 'filler' }
          ],
          paddingAll: '20px'
        },
        footer: {
          type: 'box',
          layout: 'vertical',
          contents: [
            { type: 'text', text: `⏰ ${getTaiwanTime()}`, size: 'xs', color: '#aaaaaa', align: 'center' }
          ],
          paddingAll: '15px'
        }
      }
    };

  } catch (error) {
    console.error('取得三大法人資料錯誤:', error);
    return { type: 'text', text: `❌ 取得三大法人資料失敗：${error.message}` };
  }
}

/**
 * 🏦 三大法人買賣超排行 Flex Message
 */
async function getInstitutionalRankingFlex(type, direction) {
  const chipService = require('../services/chipService');
  
  try {
    const ranking = await chipService.getTopInstitutionalRanking(type, direction, 10);
    
    if (!ranking || !ranking.ranking || ranking.ranking.length === 0) {
      return { type: 'text', text: '❌ 無法取得三大法人排行資料\n\n可能原因：今日尚未更新或非交易日' };
    }

    const typeName = { foreign: '外資', trust: '投信', dealer: '自營商' }[type] || type;
    const directionName = direction === 'buy' ? '買超' : '賣超';
    const headerColor = direction === 'buy' ? '#D32F2F' : '#388E3C';

    const formatNet = (n) => {
      if (Math.abs(n) >= 1000000) {
        return (n / 1000000).toFixed(1) + '百萬';
      }
      return Math.round(n / 1000) + '張';
    };

    const rankingRows = ranking.ranking.map((item, index) => ({
      type: 'box',
      layout: 'horizontal',
      margin: index === 0 ? 'none' : 'sm',
      contents: [
        { type: 'text', text: `${index + 1}`, size: 'sm', color: '#888888', flex: 1 },
        { type: 'text', text: item.stockName, size: 'sm', flex: 4 },
        { type: 'text', text: formatNet(item.net), size: 'sm', weight: 'bold', align: 'end', flex: 3, color: headerColor }
      ]
    }));

    return {
      type: 'flex',
      altText: `🏦 ${typeName}${directionName}排行`,
      contents: {
        type: 'bubble',
        size: 'mega',
        header: {
          type: 'box',
          layout: 'vertical',
          contents: [
            { type: 'text', text: `🏦 ${typeName}${directionName}排行`, size: 'xl', color: '#ffffff', weight: 'bold' },
            { type: 'text', text: ranking.date, size: 'sm', color: '#ffffffaa', margin: 'sm' }
          ],
          backgroundColor: headerColor,
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
                { type: 'text', text: '#', size: 'xs', color: '#888888', flex: 1 },
                { type: 'text', text: '股票', size: 'xs', color: '#888888', flex: 4 },
                { type: 'text', text: `${directionName}張數`, size: 'xs', color: '#888888', align: 'end', flex: 3 }
              ]
            },
            { type: 'separator', margin: 'sm' },
            ...rankingRows
          ],
          paddingAll: '20px'
        },
        footer: {
          type: 'box',
          layout: 'vertical',
          contents: [
            { type: 'text', text: '💡 輸入「籌碼 股票代碼」看詳細', size: 'xs', color: '#888888', align: 'center' }
          ],
          paddingAll: '15px'
        }
      }
    };

  } catch (error) {
    console.error('取得三大法人排行錯誤:', error);
    return { type: 'text', text: `❌ 取得排行資料失敗：${error.message}` };
  }
}

/**
 * 📈 取得績效報告 Flex Message
 */
async function getPerformanceFlex() {
  const performanceService = require('../services/performanceService');
  
  try {
    const perf = await performanceService.calculatePerformance('default');
    
    if (!perf.success) {
      return { type: 'text', text: '📭 目前沒有持股紀錄\n\n請先在網頁版「持股管理」新增已得標持股' };
    }

    const isProfit = perf.summary.isProfit;
    const headerColor = isProfit ? '#D32F2F' : '#388E3C';

    // 個股明細（最多5檔）
    const stockDetails = perf.details.slice(0, 5).map(d => ({
      type: 'box',
      layout: 'horizontal',
      contents: [
        { type: 'text', text: d.stockName, size: 'sm', flex: 3 },
        { type: 'text', text: `$${d.currentPrice}`, size: 'sm', align: 'end', flex: 2 },
        { 
          type: 'text', 
          text: `${parseFloat(d.profitPercent) >= 0 ? '+' : ''}${d.profitPercent}%`, 
          size: 'sm', 
          align: 'end', 
          flex: 2,
          color: parseFloat(d.profitPercent) >= 0 ? '#D32F2F' : '#388E3C'
        }
      ],
      margin: 'sm'
    }));

    return {
      type: 'flex',
      altText: `📈 持股績效：${isProfit ? '獲利' : '虧損'} ${perf.summary.totalProfitPercent}%`,
      contents: {
        type: 'bubble',
        size: 'mega',
        header: {
          type: 'box',
          layout: 'vertical',
          contents: [
            { type: 'text', text: '📈 持股績效報告', size: 'lg', color: '#ffffff', weight: 'bold' },
            { type: 'text', text: perf.date, size: 'sm', color: '#ffffffaa', margin: 'sm' }
          ],
          backgroundColor: headerColor,
          paddingAll: '20px'
        },
        body: {
          type: 'box',
          layout: 'vertical',
          contents: [
            // 總損益
            {
              type: 'box',
              layout: 'vertical',
              contents: [
                {
                  type: 'text',
                  text: `${isProfit ? '+' : ''}$${perf.summary.totalProfit.toLocaleString()}`,
                  size: 'xxl',
                  weight: 'bold',
                  color: headerColor,
                  align: 'center'
                },
                {
                  type: 'text',
                  text: `報酬率 ${isProfit ? '+' : ''}${perf.summary.totalProfitPercent}%`,
                  size: 'md',
                  align: 'center',
                  color: '#666666',
                  margin: 'sm'
                }
              ]
            },
            { type: 'separator', margin: 'lg' },
            // 統計
            {
              type: 'box',
              layout: 'vertical',
              margin: 'lg',
              contents: [
                {
                  type: 'box',
                  layout: 'horizontal',
                  contents: [
                    { type: 'text', text: '持股數', size: 'sm', color: '#888888' },
                    { type: 'text', text: `${perf.summary.holdingsCount} 檔`, size: 'sm', align: 'end' }
                  ]
                },
                {
                  type: 'box',
                  layout: 'horizontal',
                  margin: 'sm',
                  contents: [
                    { type: 'text', text: '總成本', size: 'sm', color: '#888888' },
                    { type: 'text', text: `$${perf.summary.totalCost.toLocaleString()}`, size: 'sm', align: 'end' }
                  ]
                },
                {
                  type: 'box',
                  layout: 'horizontal',
                  margin: 'sm',
                  contents: [
                    { type: 'text', text: '總市值', size: 'sm', color: '#888888' },
                    { type: 'text', text: `$${perf.summary.totalValue.toLocaleString()}`, size: 'sm', align: 'end', weight: 'bold' }
                  ]
                }
              ]
            },
            { type: 'separator', margin: 'lg' },
            // 個股明細
            {
              type: 'box',
              layout: 'vertical',
              margin: 'lg',
              contents: [
                { type: 'text', text: '📋 持股明細', size: 'sm', color: '#888888', margin: 'sm' },
                ...stockDetails
              ]
            },
            // 最佳/最差
            perf.topGainer && perf.topLoser ? {
              type: 'box',
              layout: 'horizontal',
              margin: 'lg',
              contents: [
                { type: 'text', text: `🏆 ${perf.topGainer.stockName} +${perf.topGainer.profitPercent}%`, size: 'xs', color: '#D32F2F', flex: 1 },
                { type: 'text', text: `📉 ${perf.topLoser.stockName} ${perf.topLoser.profitPercent}%`, size: 'xs', color: '#388E3C', flex: 1, align: 'end' }
              ]
            } : { type: 'filler' }
          ],
          paddingAll: '20px'
        },
        footer: {
          type: 'box',
          layout: 'vertical',
          contents: [
            { type: 'text', text: `⏰ ${getTaiwanTime()}`, size: 'xs', color: '#aaaaaa', align: 'center' }
          ],
          paddingAll: '15px'
        }
      }
    };

  } catch (error) {
    console.error('取得績效報告錯誤:', error);
    return { type: 'text', text: `❌ 取得績效報告失敗：${error.message}` };
  }
}

/**
 * 取得說明回覆
 */
function getHelpReply() {
  const help = `📱 股海秘書指令說明\n` +
    `━━━━━━━━━━━━━━\n` +
    `🔍 查詢股價\n` +
    `   2330（台股代碼）\n` +
    `   AAPL（美股代碼）\n` +
    `   查 台積電（搜名稱）\n\n` +
    `📈 大盤/熱門\n` +
    `   「大盤」看台股指數\n` +
    `   「美股」看美股指數\n` +
    `   「熱門」看熱門台股\n\n` +
    `🏦 三大法人\n` +
    `   籌碼 2330（個股法人）\n` +
    `   「外資買超」「投信買超」\n\n` +
    `🤖 AI 分析\n` +
    `   分析 2330（AI買賣建議）\n` +
    `   「持股分析」全部AI建議\n\n` +
    `💼 持股/績效\n` +
    `   「持股」看持股\n` +
    `   「績效」看損益報告\n\n` +
    `➕ 監控：+2330 / -2330\n` +
    `❓「說明」顯示此訊息`;

  return { type: 'text', text: help };
}

/**
 * 🇺🇸 取得美股指數
 */
async function getUSMarketReply() {
  try {
    const indices = await stockService.getUSIndices();
    
    if (!indices || indices.length === 0) {
      return { type: 'text', text: '⚠️ 無法取得美股指數，請稍後再試' };
    }

    const indexRows = indices.map(idx => {
      const isUp = idx.change >= 0;
      // 美股：綠漲紅跌
      const color = isUp ? '#00C851' : '#ff4444';
      const arrow = isUp ? '▲' : '▼';
      
      return {
        type: 'box',
        layout: 'horizontal',
        contents: [
          { type: 'text', text: idx.name, size: 'sm', flex: 3 },
          { type: 'text', text: `${idx.price.toLocaleString()}`, size: 'sm', align: 'end', flex: 2 },
          { type: 'text', text: `${arrow}${idx.changePercent}%`, size: 'sm', color: color, align: 'end', flex: 2 }
        ],
        margin: 'sm'
      };
    });

    return {
      type: 'flex',
      altText: '🇺🇸 美股指數',
      contents: {
        type: 'bubble',
        size: 'mega',
        header: {
          type: 'box',
          layout: 'vertical',
          contents: [
            { type: 'text', text: '🇺🇸 美股指數', size: 'xl', weight: 'bold', color: '#ffffff' },
            { type: 'text', text: '綠漲紅跌', size: 'xs', color: '#ffffffaa', margin: 'sm' }
          ],
          backgroundColor: '#1a1a2e',
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
                { type: 'text', text: '指數', size: 'xs', color: '#888888', flex: 3 },
                { type: 'text', text: '點數', size: 'xs', color: '#888888', align: 'end', flex: 2 },
                { type: 'text', text: '漲跌', size: 'xs', color: '#888888', align: 'end', flex: 2 }
              ]
            },
            { type: 'separator', margin: 'md' },
            ...indexRows
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
    console.error('取得美股指數錯誤:', error);
    return { type: 'text', text: '⚠️ 取得美股指數失敗' };
  }
}

/**
 * 🇺🇸 取得熱門美股
 */
async function getHotUSStocksFlex() {
  try {
    const hotUS = ['AAPL', 'TSLA', 'NVDA', 'MSFT', 'GOOGL', 'AMZN', 'META', 'AMD', 'TSM'];
    const stocks = [];
    
    for (const symbol of hotUS) {
      const data = await stockService.getUSStockPrice(symbol);
      if (data) {
        stocks.push(data);
      }
      await new Promise(r => setTimeout(r, 200));
    }

    if (stocks.length === 0) {
      return { type: 'text', text: '⚠️ 無法取得美股資料' };
    }

    const stockRows = stocks.map(stock => {
      const isUp = stock.change >= 0;
      // 美股：綠漲紅跌
      const color = isUp ? '#00C851' : '#ff4444';
      const arrow = isUp ? '▲' : '▼';
      
      return {
        type: 'box',
        layout: 'horizontal',
        contents: [
          { type: 'text', text: `${stock.name}`, size: 'sm', flex: 3 },
          { type: 'text', text: `$${stock.price}`, size: 'sm', align: 'end', flex: 2 },
          { type: 'text', text: `${arrow}${stock.changePercent}%`, size: 'sm', color: color, align: 'end', flex: 2 }
        ],
        margin: 'sm'
      };
    });

    return {
      type: 'flex',
      altText: '🔥 熱門美股',
      contents: {
        type: 'bubble',
        size: 'mega',
        header: {
          type: 'box',
          layout: 'vertical',
          contents: [
            { type: 'text', text: '🔥 熱門美股', size: 'xl', weight: 'bold', color: '#ffffff' },
            { type: 'text', text: '🇺🇸 綠漲紅跌', size: 'xs', color: '#ffffffaa', margin: 'sm' }
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
                { type: 'text', text: '股價', size: 'xs', color: '#888888', align: 'end', flex: 2 },
                { type: 'text', text: '漲跌', size: 'xs', color: '#888888', align: 'end', flex: 2 }
              ]
            },
            { type: 'separator', margin: 'md' },
            ...stockRows
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
    console.error('取得熱門美股錯誤:', error);
    return { type: 'text', text: '⚠️ 取得熱門美股失敗' };
  }
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




