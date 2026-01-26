/**
 * 💬 LINE Bot 路由
 */

const express = require('express');
const router = express.Router();
const axios = require('axios');
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
  
  // 🔔 警報設定指令
  // 格式：警報 2330 上1000 下900 漲5 跌3
  if (/^警報\s*\d{4,6}/.test(msg)) {
    return await setStockAlert(msg);
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
    '美股分析': () => getUSMarketDeepAnalysisFlex(),
    'US分析': () => getUSMarketDeepAnalysisFlex(),
    '台股影響': () => getUSMarketDeepAnalysisFlex(),
    '產業分析': () => getUSMarketDeepAnalysisFlex(),
    '綜合分析': () => getComprehensiveAnalysisFlex(),
    '全面分析': () => getComprehensiveAnalysisFlex(),
    '總分析': () => getComprehensiveAnalysisFlex(),
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
 * 📊 取得股票資訊 Flex Message（🔥 雙 AI 各自獨立卡片）
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
    indicators = await technicalService.getFullIndicators(stockId, stockData);
    chip = await stockService.getInstitutionalData(stockId);
  }
  
  const isUp = stockData.change >= 0;
  const isUS = stockData.market === 'US';
  const color = isUS 
    ? (isUp ? '#00C851' : '#ff4444')
    : (isUp ? '#ff4444' : '#00C851');
  const arrow = isUp ? '▲' : '▼';
  const emoji = isUp ? '📈' : '📉';
  
  const formatPrice = (p) => {
    if (p === null || p === undefined) return 'N/A';
    return isUS ? parseFloat(p).toFixed(2) : p;
  };

  // 🔥 呼叫雙 AI 分析
  const aiAnalysis = await getQuickAIAnalysis(stockData, indicators, chip);
  
  // 基本資訊內容
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
        { type: 'text', text: '🟢 Gemini 樂觀派', color: '#ffffff', size: 'lg', weight: 'bold' },
        { type: 'text', text: `${stockData.name} 多頭觀點`, color: '#ffffffcc', size: 'sm', margin: 'sm' }
      ],
      backgroundColor: '#2E7D32',
      paddingAll: '20px'
    },
    body: {
      type: 'box',
      layout: 'vertical',
      contents: [
        { type: 'text', text: aiAnalysis.bullish, size: 'md', wrap: true }
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

  // 🔴 卡片 3：GPT-4o 謹慎派（獨立完整卡片）
  const card3 = {
    type: 'bubble',
    size: 'mega',
    header: {
      type: 'box',
      layout: 'vertical',
      contents: [
        { type: 'text', text: `🔴 ${aiAnalysis.aiSource2} 謹慎派`, color: '#ffffff', size: 'lg', weight: 'bold' },
        { type: 'text', text: `${stockData.name} 風控觀點`, color: '#ffffffcc', size: 'sm', margin: 'sm' }
      ],
      backgroundColor: '#C62828',
      paddingAll: '20px'
    },
    body: {
      type: 'box',
      layout: 'vertical',
      contents: [
        { type: 'text', text: aiAnalysis.bearish, size: 'md', wrap: true }
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
        { type: 'text', text: `${stockData.name} 投資建議`, color: '#ffffffcc', size: 'sm', margin: 'sm' }
      ],
      backgroundColor: '#1565C0',
      paddingAll: '20px'
    },
    body: {
      type: 'box',
      layout: 'vertical',
      contents: [
        { type: 'text', text: aiAnalysis.summary, size: 'md', wrap: true }
      ],
      paddingAll: '20px'
    },
    footer: {
      type: 'box',
      layout: 'horizontal',
      contents: [
        { type: 'text', text: `⏰ ${getTaiwanTime()}`, size: 'xs', color: '#888888', align: 'center' }
      ],
      paddingAll: '10px'
    }
  };

  return {
    type: 'flex',
    altText: `${stockData.name}（${stockId}）${stockData.price} ${arrow}${stockData.changePercent}%`,
    contents: {
      type: 'carousel',
      contents: [card1, card2, card3, card4]
    }
  };
}

/**
 * 🔥 快速雙 AI 分析（用於個股查詢）
 */
async function getQuickAIAnalysis(stockData, indicators, chip) {
  const geminiKey = process.env.GEMINI_API_KEY;
  const openaiKey = process.env.OPENAI_API_KEY;

  console.log(`🤖 個股查詢雙 AI 分析: ${stockData.name}`);

  // 基本資訊
  let baseInfo = `
股票：${stockData.name}（${stockData.id}）
現價：${stockData.price} 元
漲跌：${stockData.change > 0 ? '+' : ''}${stockData.change} 元（${stockData.changePercent}%）
最高：${stockData.high} / 最低：${stockData.low}`;

  if (indicators) {
    baseInfo += `\nRSI: ${indicators.rsi || 'N/A'}, KD: ${indicators.kd?.k || 'N/A'}/${indicators.kd?.d || 'N/A'}`;
  }
  if (chip) {
    baseInfo += `\n外資: ${chip.foreign > 0 ? '+' : ''}${(chip.foreign/1000).toFixed(0)}張, 投信: ${chip.investment > 0 ? '+' : ''}${(chip.investment/1000).toFixed(0)}張`;
  }

  const bullishPrompt = `你是「多頭分析師」，用繁體中文台灣用語，從正面角度分析（約100字）：
${baseInfo}
分析重點：技術面利多、上漲催化劑、支撐價位、加碼理由`;

  const bearishPrompt = `你是「風控分析師」，用繁體中文台灣用語，從風險角度分析（約100字）：
${baseInfo}
分析重點：技術面警訊、下跌風險、壓力價位、停損建議`;

  const summaryPrompt = `你是「投資策略師」，用繁體中文台灣用語（約60字）：
${baseInfo}
給出：支撐/壓力價位、持有者建議、觀望者建議、一句話結論`;

  try {
    if (!geminiKey && !openaiKey) {
      return {
        bullish: '請設定 GEMINI_API_KEY 或 OPENAI_API_KEY',
        bearish: '請設定 GEMINI_API_KEY 或 OPENAI_API_KEY',
        summary: 'AI 分析未啟用',
        aiSource2: 'AI'
      };
    }

    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${geminiKey}`;
    const requests = [];

    // 樂觀派（Gemini）
    if (geminiKey) {
      requests.push(
        axios.post(geminiUrl, {
          contents: [{ parts: [{ text: bullishPrompt }] }],
          generationConfig: { temperature: 0.7, maxOutputTokens: 250 }
        }, { headers: { 'Content-Type': 'application/json' }, timeout: 15000 })
        .catch(() => null)
      );
    } else {
      requests.push(Promise.resolve(null));
    }

    // 謹慎派（優先 OpenAI）
    if (openaiKey) {
      requests.push(
        axios.post('https://api.openai.com/v1/chat/completions', {
          model: 'gpt-4o-mini',
          messages: [{ role: 'user', content: bearishPrompt }],
          max_tokens: 250,
          temperature: 0.7
        }, { 
          headers: { 
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${openaiKey}`
          }, 
          timeout: 15000 
        })
        .catch((err) => {
          console.error('OpenAI 錯誤:', err.response?.data?.error?.message || err.message);
          return null;
        })
      );
    } else if (geminiKey) {
      requests.push(
        axios.post(geminiUrl, {
          contents: [{ parts: [{ text: bearishPrompt }] }],
          generationConfig: { temperature: 0.7, maxOutputTokens: 250 }
        }, { headers: { 'Content-Type': 'application/json' }, timeout: 15000 })
        .catch(() => null)
      );
    } else {
      requests.push(Promise.resolve(null));
    }

    // 綜合建議（Gemini）
    if (geminiKey) {
      requests.push(
        axios.post(geminiUrl, {
          contents: [{ parts: [{ text: summaryPrompt }] }],
          generationConfig: { temperature: 0.6, maxOutputTokens: 150 }
        }, { headers: { 'Content-Type': 'application/json' }, timeout: 15000 })
        .catch(() => null)
      );
    } else {
      requests.push(Promise.resolve(null));
    }

    const [bullishRes, bearishRes, summaryRes] = await Promise.all(requests);

    let bullish = '分析中...';
    let bearish = '分析中...';
    let summary = '綜合多空觀點判斷';

    if (bullishRes?.data) {
      bullish = bullishRes.data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || bullish;
    }

    if (bearishRes?.data) {
      if (bearishRes.data?.choices) {
        bearish = bearishRes.data.choices[0]?.message?.content?.trim() || bearish;
      } else if (bearishRes.data?.candidates) {
        bearish = bearishRes.data.candidates[0]?.content?.parts?.[0]?.text?.trim() || bearish;
      }
    }

    if (summaryRes?.data) {
      summary = summaryRes.data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || summary;
    }

    // 限制長度
    const truncate = (text, max) => text.length > max ? text.substring(0, max - 3) + '...' : text;

    return {
      bullish: truncate(bullish, 400),
      bearish: truncate(bearish, 350),
      summary: truncate(summary, 280),
      aiSource2: openaiKey ? 'GPT-4o' : 'Gemini'
    };

  } catch (error) {
    console.error('個股 AI 分析錯誤:', error.message);
    return {
      bullish: 'AI 分析暫時無法使用',
      bearish: 'AI 分析暫時無法使用',
      summary: '請稍後再試',
      aiSource2: 'AI'
    };
  }
}

/**
 * 💼 取得持股 Flex Message（含手續費詳細資訊）
 */
async function getPortfolioFlex() {
  // 手續費率常數
  const FEE_RATE = 0.001425;  // 0.1425%
  const TAX_RATE = 0.003;     // 0.3% 交易稅（賣出）

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

  // 格式化金額
  function formatMoney(amount) {
    return Math.round(amount).toLocaleString();
  }
  
  // 取得即時價格計算損益
  const holdings = [];
  let totalValue = 0;
  let totalCost = 0;
  let totalBuyFee = 0;
  let totalSellFee = 0;
  let totalTax = 0;
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
    let buyFee = 0;
    let sellFee = 0;
    let tax = 0;
    let netProfit = 0;
    
    if (costPrice > 0 && totalShares > 0) {
      paidTotal = costPrice * totalShares;
      currentValue = currentPrice * totalShares;
      
      // 計算手續費和交易稅
      buyFee = Math.round(paidTotal * FEE_RATE);
      sellFee = Math.round(currentValue * FEE_RATE);
      tax = Math.round(currentValue * TAX_RATE);
      
      if (row.is_won) {
        // 損益以股票現值計算（不含手續費）
        profit = currentValue - paidTotal;
        profitPercent = ((currentPrice - costPrice) / costPrice * 100).toFixed(2);
        
        // 淨損益（扣除所有費用）
        netProfit = profit - buyFee - sellFee - tax;
        
        totalCost += paidTotal;
        totalValue += currentValue;
        totalBuyFee += buyFee;
        totalSellFee += sellFee;
        totalTax += tax;
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
      buyFee,
      sellFee,
      tax,
      netProfit,
      notifyEnabled: row.notify_enabled,
      targetHigh: row.target_price_high,
      targetLow: row.target_price_low
    });
    
    await new Promise(r => setTimeout(r, 200));
  }
  
  const totalProfit = totalValue - totalCost;
  const totalProfitPercent = totalCost > 0 ? ((totalProfit / totalCost) * 100).toFixed(2) : 0;
  const totalNetProfit = totalProfit - totalBuyFee - totalSellFee - totalTax;
  const totalNetProfitPercent = totalCost > 0 ? ((totalNetProfit / totalCost) * 100).toFixed(2) : 0;
  const isProfit = totalProfit >= 0;
  const isNetProfit = totalNetProfit >= 0;
  const headerColor = isProfit ? '#D32F2F' : '#388E3C';
  
  // 總計張數零股顯示
  const totalLotsDisplay = totalLots > 0 || totalOddShares > 0 
    ? `${totalLots}張${totalOddShares > 0 ? totalOddShares + '股' : ''}`
    : '0張';

  // 📊 卡片 1：總覽
  const card1 = {
    type: 'bubble',
    size: 'mega',
    header: {
      type: 'box',
      layout: 'vertical',
      contents: [
        { type: 'text', text: '💼 我的持股', size: 'xl', weight: 'bold', color: '#ffffff' },
        { type: 'text', text: `${wonCount}筆得標 ${totalLotsDisplay}`, size: 'sm', color: '#ffffffcc', margin: 'sm' }
      ],
      backgroundColor: headerColor,
      paddingAll: '20px'
    },
    body: {
      type: 'box',
      layout: 'vertical',
      contents: [
        // 成本與市值
        { type: 'text', text: '📊 總覽', size: 'md', weight: 'bold', color: '#333333' },
        {
          type: 'box', layout: 'horizontal', margin: 'md',
          contents: [
            { type: 'text', text: '買入成本', size: 'sm', color: '#666666', flex: 2 },
            { type: 'text', text: `$${formatMoney(totalCost)}`, size: 'sm', align: 'end', flex: 3 }
          ]
        },
        {
          type: 'box', layout: 'horizontal', margin: 'sm',
          contents: [
            { type: 'text', text: '目前市值', size: 'sm', color: '#666666', flex: 2 },
            { type: 'text', text: `$${formatMoney(totalValue)}`, size: 'sm', align: 'end', flex: 3, weight: 'bold' }
          ]
        },
        { type: 'separator', margin: 'lg' },
        // 損益（股票現值）
        { type: 'text', text: '📈 損益（股票現值）', size: 'md', weight: 'bold', color: '#333333', margin: 'lg' },
        {
          type: 'box', layout: 'horizontal', margin: 'md',
          contents: [
            { type: 'text', text: '帳面損益', size: 'sm', color: '#666666', flex: 2 },
            { type: 'text', text: `${isProfit ? '+' : ''}$${formatMoney(totalProfit)} (${isProfit ? '+' : ''}${totalProfitPercent}%)`, size: 'sm', color: isProfit ? '#D32F2F' : '#388E3C', align: 'end', flex: 3, weight: 'bold' }
          ]
        },
        { type: 'separator', margin: 'lg' },
        // 手續費明細
        { type: 'text', text: '💰 交易成本', size: 'md', weight: 'bold', color: '#333333', margin: 'lg' },
        {
          type: 'box', layout: 'horizontal', margin: 'md',
          contents: [
            { type: 'text', text: '買入手續費 (0.1425%)', size: 'xs', color: '#888888', flex: 3 },
            { type: 'text', text: `$${formatMoney(totalBuyFee)}`, size: 'xs', color: '#888888', align: 'end', flex: 2 }
          ]
        },
        {
          type: 'box', layout: 'horizontal', margin: 'xs',
          contents: [
            { type: 'text', text: '賣出手續費 (0.1425%)', size: 'xs', color: '#888888', flex: 3 },
            { type: 'text', text: `$${formatMoney(totalSellFee)}`, size: 'xs', color: '#888888', align: 'end', flex: 2 }
          ]
        },
        {
          type: 'box', layout: 'horizontal', margin: 'xs',
          contents: [
            { type: 'text', text: '交易稅 (0.3%)', size: 'xs', color: '#888888', flex: 3 },
            { type: 'text', text: `$${formatMoney(totalTax)}`, size: 'xs', color: '#888888', align: 'end', flex: 2 }
          ]
        },
        {
          type: 'box', layout: 'horizontal', margin: 'sm',
          contents: [
            { type: 'text', text: '交易成本合計', size: 'sm', color: '#666666', flex: 3, weight: 'bold' },
            { type: 'text', text: `$${formatMoney(totalBuyFee + totalSellFee + totalTax)}`, size: 'sm', color: '#666666', align: 'end', flex: 2, weight: 'bold' }
          ]
        },
        { type: 'separator', margin: 'lg' },
        // 淨損益
        {
          type: 'box', layout: 'horizontal', margin: 'lg',
          contents: [
            { type: 'text', text: '💵 賣出後淨損益', size: 'sm', color: '#333333', flex: 3, weight: 'bold' },
            { type: 'text', text: `${isNetProfit ? '+' : ''}$${formatMoney(totalNetProfit)} (${isNetProfit ? '+' : ''}${totalNetProfitPercent}%)`, size: 'sm', color: isNetProfit ? '#D32F2F' : '#388E3C', align: 'end', flex: 3, weight: 'bold' }
          ]
        }
      ],
      paddingAll: '20px'
    },
    footer: {
      type: 'box', layout: 'horizontal',
      contents: [
        { type: 'text', text: '👉 滑動看個股明細', size: 'xs', color: '#888888', align: 'center' }
      ],
      paddingAll: '10px'
    }
  };

  // 📊 個股明細卡片
  const stockCards = holdings.filter(h => h.isWon).map(h => {
    const isUp = h.profit >= 0;
    const isNetUp = h.netProfit >= 0;
    const color = isUp ? '#D32F2F' : '#388E3C';
    const netColor = isNetUp ? '#D32F2F' : '#388E3C';

    return {
      type: 'bubble',
      size: 'mega',
      header: {
        type: 'box',
        layout: 'vertical',
        contents: [
          { type: 'text', text: `${h.name}`, color: '#ffffff', size: 'lg', weight: 'bold' },
          { type: 'text', text: `${h.stockId} | ${formatLotsShares(h.totalShares)}`, color: '#ffffffcc', size: 'sm', margin: 'sm' }
        ],
        backgroundColor: color,
        paddingAll: '20px'
      },
      body: {
        type: 'box',
        layout: 'vertical',
        contents: [
          // 價格資訊
          { type: 'text', text: '📊 價格資訊', size: 'sm', weight: 'bold', color: '#333333' },
          {
            type: 'box', layout: 'horizontal', margin: 'sm',
            contents: [
              { type: 'text', text: '得標價', size: 'xs', color: '#888888', flex: 2 },
              { type: 'text', text: `$${h.wonPrice}`, size: 'xs', align: 'end', flex: 2 }
            ]
          },
          {
            type: 'box', layout: 'horizontal', margin: 'xs',
            contents: [
              { type: 'text', text: '現價', size: 'xs', color: '#888888', flex: 2 },
              { type: 'text', text: `$${h.currentPrice}`, size: 'xs', align: 'end', flex: 2, weight: 'bold', color: color }
            ]
          },
          {
            type: 'box', layout: 'horizontal', margin: 'xs',
            contents: [
              { type: 'text', text: '價差', size: 'xs', color: '#888888', flex: 2 },
              { type: 'text', text: `${isUp ? '+' : ''}$${(h.currentPrice - h.wonPrice).toFixed(2)} (${isUp ? '+' : ''}${h.profitPercent}%)`, size: 'xs', align: 'end', flex: 2, color: color }
            ]
          },
          { type: 'separator', margin: 'md' },
          // 金額資訊
          { type: 'text', text: '💰 金額明細', size: 'sm', weight: 'bold', color: '#333333', margin: 'md' },
          {
            type: 'box', layout: 'horizontal', margin: 'sm',
            contents: [
              { type: 'text', text: '買入成本', size: 'xs', color: '#888888', flex: 2 },
              { type: 'text', text: `$${formatMoney(h.paidTotal)}`, size: 'xs', align: 'end', flex: 2 }
            ]
          },
          {
            type: 'box', layout: 'horizontal', margin: 'xs',
            contents: [
              { type: 'text', text: '目前市值', size: 'xs', color: '#888888', flex: 2 },
              { type: 'text', text: `$${formatMoney(h.currentValue)}`, size: 'xs', align: 'end', flex: 2, weight: 'bold' }
            ]
          },
          {
            type: 'box', layout: 'horizontal', margin: 'xs',
            contents: [
              { type: 'text', text: '帳面損益', size: 'xs', color: '#888888', flex: 2 },
              { type: 'text', text: `${isUp ? '+' : ''}$${formatMoney(h.profit)}`, size: 'xs', align: 'end', flex: 2, color: color, weight: 'bold' }
            ]
          },
          { type: 'separator', margin: 'md' },
          // 手續費
          { type: 'text', text: '🧾 交易成本', size: 'sm', weight: 'bold', color: '#333333', margin: 'md' },
          {
            type: 'box', layout: 'horizontal', margin: 'sm',
            contents: [
              { type: 'text', text: '買入手續費', size: 'xs', color: '#888888', flex: 2 },
              { type: 'text', text: `$${formatMoney(h.buyFee)}`, size: 'xs', align: 'end', flex: 2 }
            ]
          },
          {
            type: 'box', layout: 'horizontal', margin: 'xs',
            contents: [
              { type: 'text', text: '賣出手續費', size: 'xs', color: '#888888', flex: 2 },
              { type: 'text', text: `$${formatMoney(h.sellFee)}`, size: 'xs', align: 'end', flex: 2 }
            ]
          },
          {
            type: 'box', layout: 'horizontal', margin: 'xs',
            contents: [
              { type: 'text', text: '交易稅', size: 'xs', color: '#888888', flex: 2 },
              { type: 'text', text: `$${formatMoney(h.tax)}`, size: 'xs', align: 'end', flex: 2 }
            ]
          },
          {
            type: 'box', layout: 'horizontal', margin: 'xs',
            contents: [
              { type: 'text', text: '成本合計', size: 'xs', color: '#666666', flex: 2, weight: 'bold' },
              { type: 'text', text: `$${formatMoney(h.buyFee + h.sellFee + h.tax)}`, size: 'xs', align: 'end', flex: 2, weight: 'bold' }
            ]
          },
          { type: 'separator', margin: 'md' },
          // 淨損益
          {
            type: 'box', layout: 'horizontal', margin: 'md',
            contents: [
              { type: 'text', text: '💵 賣出後淨損益', size: 'sm', color: '#333333', flex: 3, weight: 'bold' },
              { type: 'text', text: `${isNetUp ? '+' : ''}$${formatMoney(h.netProfit)}`, size: 'sm', align: 'end', flex: 2, color: netColor, weight: 'bold' }
            ]
          }
        ],
        paddingAll: '15px'
      },
      footer: {
        type: 'box', layout: 'horizontal',
        contents: [
          { type: 'text', text: `⏰ ${getTaiwanTime()}`, size: 'xs', color: '#888888', align: 'center' }
        ],
        paddingAll: '10px'
      }
    };
  });

  // 組合所有卡片（最多 10 張）
  const allCards = [card1, ...stockCards].slice(0, 10);

  return {
    type: 'flex',
    altText: `💼 持股報告 ${isProfit ? '📈' : '📉'} ${totalProfitPercent}%`,
    contents: {
      type: 'carousel',
      contents: allCards
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

    // 取得技術指標（傳入即時價格）
    let technicalData = null;
    try {
      technicalData = await technicalService.getFullIndicators(stockId, stockData);
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
      return { type: 'text', text: '❌ AI 分析暫時無法使用，請確認 GEMINI_API_KEY 已設定' };
    }

    const combined = analysis.combined;
    const isUp = stockData.change >= 0;
    
    // 動作對應顏色
    const actionColors = {
      'strong_buy': '#D32F2F',
      'buy': '#FF5722',
      'hold': '#607D8B',
      'sell': '#4CAF50',
      'strong_sell': '#2E7D32'
    };
    const headerColor = actionColors[combined.action] || '#333333';

    // 技術指標摘要
    let techSummary = '';
    if (technicalData) {
      const rsiStatus = technicalData.rsi >= 70 ? '超買' : technicalData.rsi <= 30 ? '超賣' : '中性';
      techSummary = `RSI:${technicalData.rsi}(${rsiStatus})`;
    }

    // ====== 卡片 1：總覽 + 正面觀點 ======
    const card1 = {
      type: 'bubble',
      size: 'mega',
      header: {
        type: 'box',
        layout: 'vertical',
        contents: [
          { type: 'text', text: `🤖 ${stockData.name} AI 分析`, size: 'lg', color: '#ffffff', weight: 'bold' },
          { type: 'text', text: `${combined.actionText}`, size: 'xl', color: '#ffffff', weight: 'bold', margin: 'sm' }
        ],
        backgroundColor: headerColor,
        paddingAll: '15px'
      },
      body: {
        type: 'box',
        layout: 'vertical',
        contents: [
          // 股價資訊
          {
            type: 'box',
            layout: 'horizontal',
            contents: [
              { type: 'text', text: '現價', size: 'sm', color: '#888888', flex: 1 },
              { type: 'text', text: `$${stockData.price}`, size: 'lg', weight: 'bold', align: 'end', flex: 2 }
            ]
          },
          {
            type: 'box',
            layout: 'horizontal',
            margin: 'sm',
            contents: [
              { type: 'text', text: '漲跌', size: 'sm', color: '#888888', flex: 1 },
              { type: 'text', text: `${stockData.change >= 0 ? '+' : ''}${stockData.change} (${stockData.changePercent}%)`, size: 'sm', align: 'end', flex: 2, color: isUp ? '#D32F2F' : '#2E7D32' }
            ]
          },
          { type: 'separator', margin: 'lg' },
          
          // 價格建議
          {
            type: 'box',
            layout: 'horizontal',
            margin: 'lg',
            contents: [
              { type: 'text', text: '🎯 目標價', size: 'xs', color: '#888888', flex: 2 },
              { type: 'text', text: combined.targetPrice ? `$${combined.targetPrice}` : '-', size: 'sm', weight: 'bold', align: 'end', flex: 2, color: '#D32F2F' }
            ]
          },
          {
            type: 'box',
            layout: 'horizontal',
            margin: 'sm',
            contents: [
              { type: 'text', text: '💪 支撐價', size: 'xs', color: '#888888', flex: 2 },
              { type: 'text', text: combined.buyPrice ? `$${combined.buyPrice}` : '-', size: 'sm', align: 'end', flex: 2, color: '#4CAF50' }
            ]
          },
          {
            type: 'box',
            layout: 'horizontal',
            margin: 'sm',
            contents: [
              { type: 'text', text: '🛑 停損價', size: 'xs', color: '#888888', flex: 2 },
              { type: 'text', text: combined.stopLoss ? `$${combined.stopLoss}` : '-', size: 'sm', align: 'end', flex: 2, color: '#9E9E9E' }
            ]
          },
          { type: 'separator', margin: 'lg' },
          
          // 📈 正面觀點
          {
            type: 'text',
            text: '📈 正面觀點',
            size: 'md',
            weight: 'bold',
            color: '#D32F2F',
            margin: 'lg'
          },
          {
            type: 'text',
            text: combined.positive?.opportunity || '分析中...',
            size: 'sm',
            color: '#333333',
            margin: 'sm',
            wrap: true
          },
          combined.positive?.buyTiming ? {
            type: 'text',
            text: `⏰ ${combined.positive.buyTiming}`,
            size: 'xs',
            color: '#FF9800',
            margin: 'md',
            wrap: true
          } : { type: 'filler' }
        ],
        paddingAll: '15px'
      }
    };

    // ====== 卡片 2：風險觀點 ======
    const card2 = {
      type: 'bubble',
      size: 'mega',
      header: {
        type: 'box',
        layout: 'vertical',
        contents: [
          { type: 'text', text: `⚠️ ${stockData.name} 風險分析`, size: 'lg', color: '#ffffff', weight: 'bold' },
          { type: 'text', text: `風險等級：${combined.riskLevel}`, size: 'md', color: '#ffffffcc', margin: 'sm' }
        ],
        backgroundColor: '#455A64',
        paddingAll: '15px'
      },
      body: {
        type: 'box',
        layout: 'vertical',
        contents: [
          // ⚠️ 風險觀點
          {
            type: 'text',
            text: '⚠️ 風險因素',
            size: 'md',
            weight: 'bold',
            color: '#F57C00'
          },
          {
            type: 'text',
            text: combined.negative?.riskFactors || '分析中...',
            size: 'sm',
            color: '#333333',
            margin: 'sm',
            wrap: true
          },
          { type: 'separator', margin: 'lg' },
          
          // 壓力位
          {
            type: 'box',
            layout: 'horizontal',
            margin: 'lg',
            contents: [
              { type: 'text', text: '📊 壓力價', size: 'xs', color: '#888888', flex: 2 },
              { type: 'text', text: combined.sellPrice ? `$${combined.sellPrice}` : '-', size: 'sm', align: 'end', flex: 2, color: '#F44336' }
            ]
          },
          
          // 賣出時機
          combined.negative?.sellTiming ? {
            type: 'text',
            text: `⏰ ${combined.negative.sellTiming}`,
            size: 'xs',
            color: '#F57C00',
            margin: 'lg',
            wrap: true
          } : { type: 'filler' },
          
          // 警告
          combined.negative?.warning ? {
            type: 'box',
            layout: 'vertical',
            margin: 'lg',
            backgroundColor: '#FFF3E0',
            cornerRadius: 'md',
            paddingAll: '10px',
            contents: [
              {
                type: 'text',
                text: `💡 ${combined.negative.warning}`,
                size: 'xs',
                color: '#E65100',
                wrap: true
              }
            ]
          } : { type: 'filler' },
          
          { type: 'separator', margin: 'lg' },
          
          // 技術指標
          techSummary ? {
            type: 'text',
            text: `📉 技術：${techSummary}`,
            size: 'xs',
            color: '#666666',
            margin: 'lg'
          } : { type: 'filler' },
          
          // 信心度
          {
            type: 'text',
            text: `🎯 AI 信心度：${combined.confidence}%`,
            size: 'xs',
            color: '#888888',
            margin: 'sm'
          }
        ],
        paddingAll: '15px'
      },
      footer: {
        type: 'box',
        layout: 'horizontal',
        contents: [
          {
            type: 'button',
            action: { type: 'message', label: '📊 即時', text: stockId },
            style: 'secondary',
            height: 'sm',
            flex: 1
          },
          {
            type: 'button',
            action: { type: 'message', label: '📈 K線', text: `K ${stockId}` },
            style: 'secondary',
            height: 'sm',
            flex: 1,
            margin: 'sm'
          },
          {
            type: 'button',
            action: { type: 'message', label: '🏦 籌碼', text: `籌碼 ${stockId}` },
            style: 'primary',
            height: 'sm',
            flex: 1,
            margin: 'sm'
          }
        ],
        paddingAll: '10px'
      }
    };

    // 如果有持股資訊，加入持股建議到第一張卡片
    if (holdingData && combined.positive?.holdingAdvice) {
      card1.body.contents.push({
        type: 'box',
        layout: 'vertical',
        margin: 'lg',
        backgroundColor: '#E3F2FD',
        cornerRadius: 'md',
        paddingAll: '10px',
        contents: [
          {
            type: 'text',
            text: `💼 持股建議：${combined.positive.holdingAdvice}`,
            size: 'xs',
            color: '#1565C0',
            wrap: true
          }
        ]
      });
    }

    return {
      type: 'flex',
      altText: `🤖 ${stockData.name} AI分析：${combined.actionText}`,
      contents: {
        type: 'carousel',
        contents: [card1, card2]
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

    console.log(`🔍 開始分析 ${holdingsResult.rows.length} 檔持股...`);

    for (const holding of holdingsResult.rows) {
      try {
        // 1️⃣ 取得即時股價
        const stockData = await stockService.getRealtimePrice(holding.stock_id);
        if (!stockData) {
          console.log(`⚠️ 找不到 ${holding.stock_id} 的即時價格`);
          continue;
        }

        console.log(`📊 ${stockData.name} (${holding.stock_id}): $${stockData.price} (${stockData.changePercent}%)`);

        // 2️⃣ 儲存最新價格歷史（確保技術指標有最新資料）
        try {
          await stockService.savePriceHistory(stockData);
          console.log(`   ✅ 已更新價格歷史`);
        } catch (e) {
          console.log(`   ⚠️ 價格歷史更新失敗: ${e.message}`);
        }

        // 3️⃣ 取得技術指標（傳入即時價格確保同步）
        let technicalData = null;
        try {
          technicalData = await technicalService.getFullIndicators(holding.stock_id, stockData);
          if (technicalData) {
            console.log(`   📈 RSI: ${technicalData.rsi}, KD: ${technicalData.kd?.k}/${technicalData.kd?.d} (現價: $${technicalData.currentPrice})`);
          }
        } catch (e) {
          console.log(`   ⚠️ 技術指標取得失敗: ${e.message}`);
        }

        // 4️⃣ 呼叫 AI 分析
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
          
          console.log(`   🤖 AI 建議: ${analysis.combined.actionText} (信心: ${analysis.combined.finalConfidence}%)`);
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
 * 🔔 設定股票警報
 * 格式：警報 2330 上1000 下900 漲5 跌3
 */
async function setStockAlert(msg) {
  try {
    // 解析指令
    const stockMatch = msg.match(/警報\s*(\d{4,6})/);
    if (!stockMatch) {
      return { type: 'text', text: '⚠️ 請輸入股票代碼\n例如：警報 2330 上1000 下900' };
    }
    
    const stockId = stockMatch[1];
    
    // 取得股票資料
    const stockData = await stockService.getRealtimePrice(stockId);
    if (!stockData) {
      return { type: 'text', text: `⚠️ 找不到股票 ${stockId}` };
    }
    
    // 解析目標價和漲跌幅
    const highMatch = msg.match(/上\s*(\d+\.?\d*)/);
    const lowMatch = msg.match(/下\s*(\d+\.?\d*)/);
    const upMatch = msg.match(/漲\s*(\d+\.?\d*)/);
    const downMatch = msg.match(/跌\s*(\d+\.?\d*)/);
    
    const targetHigh = highMatch ? parseFloat(highMatch[1]) : null;
    const targetLow = lowMatch ? parseFloat(lowMatch[1]) : null;
    const alertUp = upMatch ? parseFloat(upMatch[1]) : null;
    const alertDown = downMatch ? parseFloat(downMatch[1]) : null;
    
    // 如果沒有任何參數，顯示目前設定
    if (!targetHigh && !targetLow && !alertUp && !alertDown) {
      const current = await pool.query(`
        SELECT * FROM watchlist 
        WHERE stock_id = $1 AND user_id = 'default' AND is_active = true
      `, [stockId]);
      
      if (current.rows.length === 0) {
        return { 
          type: 'text', 
          text: `📊 ${stockData.name}（${stockId}）\n` +
                `現價：$${stockData.price}\n\n` +
                `⚠️ 尚未加入監控\n` +
                `輸入「+${stockId}」加入監控\n\n` +
                `🔔 警報設定格式：\n` +
                `警報 ${stockId} 上${Math.round(stockData.price * 1.1)} 下${Math.round(stockData.price * 0.9)}\n` +
                `警報 ${stockId} 漲5 跌3`
        };
      }
      
      const w = current.rows[0];
      let alertInfo = `🔔 ${stockData.name}（${stockId}）警報設定\n`;
      alertInfo += `━━━━━━━━━━━━━━\n`;
      alertInfo += `📊 現價：$${stockData.price}\n\n`;
      alertInfo += `🎯 目標價警報：\n`;
      alertInfo += `   上限：${w.target_price_high ? '$' + w.target_price_high : '未設定'}\n`;
      alertInfo += `   下限：${w.target_price_low ? '$' + w.target_price_low : '未設定'}\n\n`;
      alertInfo += `📈 漲跌幅警報：\n`;
      alertInfo += `   漲幅：${w.alert_percent_up ? w.alert_percent_up + '%' : '未設定'}\n`;
      alertInfo += `   跌幅：${w.alert_percent_down ? w.alert_percent_down + '%' : '未設定'}\n\n`;
      alertInfo += `💡 修改範例：\n`;
      alertInfo += `警報 ${stockId} 上${Math.round(stockData.price * 1.1)} 下${Math.round(stockData.price * 0.9)}\n`;
      alertInfo += `警報 ${stockId} 漲5 跌3`;
      
      return { type: 'text', text: alertInfo };
    }
    
    // 確保股票在 stocks 資料表
    await pool.query(`
      INSERT INTO stocks (id, name, market) VALUES ($1, $2, $3)
      ON CONFLICT (id) DO UPDATE SET name = $2
    `, [stockId, stockData.name, stockData.market || 'TSE']);
    
    // 更新或新增監控設定
    await pool.query(`
      INSERT INTO watchlist (stock_id, user_id, target_price_high, target_price_low, alert_percent_up, alert_percent_down, is_active)
      VALUES ($1, 'default', $2, $3, $4, $5, true)
      ON CONFLICT (stock_id, user_id) DO UPDATE SET 
        target_price_high = COALESCE($2, watchlist.target_price_high),
        target_price_low = COALESCE($3, watchlist.target_price_low),
        alert_percent_up = COALESCE($4, watchlist.alert_percent_up),
        alert_percent_down = COALESCE($5, watchlist.alert_percent_down),
        is_active = true
    `, [stockId, targetHigh, targetLow, alertUp, alertDown]);
    
    // 組合回覆訊息
    let reply = `✅ ${stockData.name}（${stockId}）警報已設定\n`;
    reply += `━━━━━━━━━━━━━━\n`;
    reply += `📊 現價：$${stockData.price}\n\n`;
    
    if (targetHigh || targetLow) {
      reply += `🎯 目標價警報：\n`;
      if (targetHigh) reply += `   📈 突破 $${targetHigh} 時通知\n`;
      if (targetLow) reply += `   📉 跌破 $${targetLow} 時通知\n`;
      reply += '\n';
    }
    
    if (alertUp || alertDown) {
      reply += `📊 漲跌幅警報：\n`;
      if (alertUp) reply += `   📈 上漲 ${alertUp}% 時通知\n`;
      if (alertDown) reply += `   📉 下跌 ${alertDown}% 時通知\n`;
    }
    
    reply += `\n💡 輸入「警報 ${stockId}」查看設定`;
    
    return { type: 'text', text: reply };
    
  } catch (error) {
    console.error('設定警報錯誤:', error);
    return { type: 'text', text: '⚠️ 設定警報失敗：' + error.message };
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
    `📊 綜合分析（5張卡片）\n` +
    `   「綜合分析」一次看完\n` +
    `   AI類股+DRAM+台股+美股\n\n` +
    `🏦 三大法人\n` +
    `   籌碼 2330（個股法人）\n` +
    `   「外資買超」「投信買超」\n\n` +
    `🤖 AI 分析\n` +
    `   分析 2330（AI買賣建議）\n` +
    `   「持股分析」全部AI建議\n\n` +
    `💼 持股/績效\n` +
    `   「持股」「績效」\n\n` +
    `🔔 監控與警報\n` +
    `   +2330（加入監控）\n` +
    `   -2330（移除監控）\n` +
    `   警報 2330（查看設定）\n` +
    `   警報 2330 上1000 下900\n` +
    `   警報 2330 漲5 跌3`;

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
 * 📊 綜合分析 - 5張卡片 AI 雙分析
 * 1. 美股 AI 類股分析
 * 2. DRAM 類股分析（美股+台股）
 * 3. 台股 AI 族群分析
 * 4. 台股大盤分析
 * 5. 整體股市綜合建議
 */
async function getComprehensiveAnalysisFlex() {
  try {
    console.log('📊 開始綜合分析...');
    
    // 🎯 美股 AI 類股
    const usAiStocks = ['NVDA', 'AMD', 'MSFT', 'GOOGL', 'META', 'TSM'];
    // 🎯 美股 DRAM 類股
    const usDramStocks = ['MU', 'INTC'];
    // 🇹🇼 台股 AI 族群
    const twAiStocks = ['2330', '2454', '2382', '3231'];  // 台積電、聯發科、廣達、緯創
    // 🇹🇼 台股 DRAM 族群（主力）
    const twDramStocks = ['2344', '6770', '2408'];  // 華邦電、力積電、南亞科
    
    // 收集數據
    console.log('   📈 收集美股 AI 類股數據...');
    const usAiData = [];
    for (const symbol of usAiStocks) {
      const data = await stockService.getUSStockPrice(symbol);
      if (data) usAiData.push(data);
      await new Promise(r => setTimeout(r, 200));
    }
    
    console.log('   💾 收集美股 DRAM 類股數據...');
    const usDramData = [];
    for (const symbol of usDramStocks) {
      const data = await stockService.getUSStockPrice(symbol);
      if (data) usDramData.push(data);
      await new Promise(r => setTimeout(r, 200));
    }
    
    console.log('   🇹🇼 收集台股 AI 族群數據...');
    const twAiData = [];
    for (const stockId of twAiStocks) {
      const data = await stockService.getRealtimePrice(stockId);
      if (data) twAiData.push(data);
      await new Promise(r => setTimeout(r, 200));
    }
    
    console.log('   🇹🇼 收集台股 DRAM 族群數據...');
    const twDramData = [];
    for (const stockId of twDramStocks) {
      const data = await stockService.getRealtimePrice(stockId);
      if (data) twDramData.push(data);
      await new Promise(r => setTimeout(r, 200));
    }
    
    // 取得美股指數
    console.log('   📊 收集美股指數...');
    const usIndices = await stockService.getUSIndices();
    
    // 取得台股大盤
    console.log('   📊 收集台股大盤...');
    const twMarket = await stockService.getRealtimePrice('t00');
    
    // 組合數據供 AI 分析
    const analysisData = {
      usAiStocks: usAiData,
      usDramStocks: usDramData,
      twAiStocks: twAiData,
      twDramStocks: twDramData,
      usIndices: usIndices || [],
      twMarket: twMarket
    };
    
    // 🤖 呼叫雙 AI 分析
    console.log('   🤖 呼叫雙 AI 綜合分析...');
    const aiResults = await generateComprehensiveAIAnalysis(analysisData);
    
    // 📊 建立 5 張卡片
    
    // 卡片 1：美股 AI 類股分析
    const usAiRows = usAiData.map(s => {
      const isUp = s.change >= 0;
      const color = isUp ? '#00C851' : '#ff4444';
      const arrow = isUp ? '▲' : '▼';
      return {
        type: 'box', layout: 'horizontal', margin: 'sm',
        contents: [
          { type: 'text', text: s.name, size: 'xs', flex: 3 },
          { type: 'text', text: `$${s.price}`, size: 'xs', align: 'end', flex: 2 },
          { type: 'text', text: `${arrow}${s.changePercent}%`, size: 'xs', color, align: 'end', flex: 2, weight: 'bold' }
        ]
      };
    });
    
    const card1 = {
      type: 'bubble', size: 'mega',
      header: {
        type: 'box', layout: 'vertical',
        contents: [
          { type: 'text', text: '🤖 美股 AI 類股分析', color: '#ffffff', size: 'lg', weight: 'bold' },
          { type: 'text', text: 'NVDA、AMD、MSFT、TSM', color: '#ffffffcc', size: 'sm', margin: 'sm' }
        ],
        backgroundColor: '#7B1FA2', paddingAll: '15px'
      },
      body: {
        type: 'box', layout: 'vertical',
        contents: [
          ...usAiRows,
          { type: 'separator', margin: 'lg' },
          { type: 'text', text: '🟢 Gemini 觀點', size: 'sm', weight: 'bold', color: '#2E7D32', margin: 'md' },
          { type: 'text', text: aiResults.usAi?.bullish || '分析中...', size: 'xs', wrap: true, margin: 'sm' },
          { type: 'separator', margin: 'md' },
          { type: 'text', text: '🔴 GPT 觀點', size: 'sm', weight: 'bold', color: '#C62828', margin: 'md' },
          { type: 'text', text: aiResults.usAi?.bearish || '分析中...', size: 'xs', wrap: true, margin: 'sm' }
        ],
        paddingAll: '15px'
      }
    };
    
    // 卡片 2：DRAM 類股分析
    const dramRows = [...usDramData, ...twDramData].map(s => {
      const isUp = s.change >= 0;
      const isTw = twDramData.includes(s);
      const color = isTw ? (isUp ? '#D32F2F' : '#388E3C') : (isUp ? '#00C851' : '#ff4444');
      const arrow = isUp ? '▲' : '▼';
      return {
        type: 'box', layout: 'horizontal', margin: 'sm',
        contents: [
          { type: 'text', text: `${isTw ? '🇹🇼' : '🇺🇸'} ${s.name}`, size: 'xs', flex: 3 },
          { type: 'text', text: `$${s.price}`, size: 'xs', align: 'end', flex: 2 },
          { type: 'text', text: `${arrow}${s.changePercent}%`, size: 'xs', color, align: 'end', flex: 2, weight: 'bold' }
        ]
      };
    });
    
    const card2 = {
      type: 'bubble', size: 'mega',
      header: {
        type: 'box', layout: 'vertical',
        contents: [
          { type: 'text', text: '💾 DRAM 類股分析', color: '#ffffff', size: 'lg', weight: 'bold' },
          { type: 'text', text: '⭐ 主力：華邦電、力積電、南亞科', color: '#FFD700', size: 'sm', margin: 'sm', weight: 'bold' }
        ],
        backgroundColor: '#00796B', paddingAll: '15px'
      },
      body: {
        type: 'box', layout: 'vertical',
        contents: [
          ...dramRows,
          { type: 'separator', margin: 'lg' },
          { type: 'text', text: '🟢 Gemini 觀點', size: 'sm', weight: 'bold', color: '#2E7D32', margin: 'md' },
          { type: 'text', text: aiResults.dram?.bullish || '分析中...', size: 'xs', wrap: true, margin: 'sm' },
          { type: 'separator', margin: 'md' },
          { type: 'text', text: '🔴 GPT 觀點', size: 'sm', weight: 'bold', color: '#C62828', margin: 'md' },
          { type: 'text', text: aiResults.dram?.bearish || '分析中...', size: 'xs', wrap: true, margin: 'sm' }
        ],
        paddingAll: '15px'
      }
    };
    
    // 卡片 3：台股 AI 族群分析
    const twAiRows = twAiData.map(s => {
      const isUp = s.change >= 0;
      const color = isUp ? '#D32F2F' : '#388E3C';
      const arrow = isUp ? '▲' : '▼';
      return {
        type: 'box', layout: 'horizontal', margin: 'sm',
        contents: [
          { type: 'text', text: s.name, size: 'xs', flex: 3 },
          { type: 'text', text: `$${s.price}`, size: 'xs', align: 'end', flex: 2 },
          { type: 'text', text: `${arrow}${s.changePercent}%`, size: 'xs', color, align: 'end', flex: 2, weight: 'bold' }
        ]
      };
    });
    
    const card3 = {
      type: 'bubble', size: 'mega',
      header: {
        type: 'box', layout: 'vertical',
        contents: [
          { type: 'text', text: '🇹🇼 台股 AI 族群分析', color: '#ffffff', size: 'lg', weight: 'bold' },
          { type: 'text', text: '台積電、聯發科、廣達、緯創', color: '#ffffffcc', size: 'sm', margin: 'sm' }
        ],
        backgroundColor: '#C2185B', paddingAll: '15px'
      },
      body: {
        type: 'box', layout: 'vertical',
        contents: [
          ...twAiRows,
          { type: 'separator', margin: 'lg' },
          { type: 'text', text: '🟢 Gemini 觀點', size: 'sm', weight: 'bold', color: '#2E7D32', margin: 'md' },
          { type: 'text', text: aiResults.twAi?.bullish || '分析中...', size: 'xs', wrap: true, margin: 'sm' },
          { type: 'separator', margin: 'md' },
          { type: 'text', text: '🔴 GPT 觀點', size: 'sm', weight: 'bold', color: '#C62828', margin: 'md' },
          { type: 'text', text: aiResults.twAi?.bearish || '分析中...', size: 'xs', wrap: true, margin: 'sm' }
        ],
        paddingAll: '15px'
      }
    };
    
    // 卡片 4：台股大盤分析
    const twMarketInfo = twMarket ? `加權指數：${twMarket.price?.toLocaleString() || '-'} (${twMarket.changePercent > 0 ? '+' : ''}${twMarket.changePercent || 0}%)` : '資料取得中...';
    
    const card4 = {
      type: 'bubble', size: 'mega',
      header: {
        type: 'box', layout: 'vertical',
        contents: [
          { type: 'text', text: '📈 台股大盤分析', color: '#ffffff', size: 'lg', weight: 'bold' },
          { type: 'text', text: twMarketInfo, color: '#ffffffcc', size: 'sm', margin: 'sm' }
        ],
        backgroundColor: '#1565C0', paddingAll: '15px'
      },
      body: {
        type: 'box', layout: 'vertical',
        contents: [
          { type: 'text', text: '🟢 Gemini 觀點', size: 'sm', weight: 'bold', color: '#2E7D32', margin: 'md' },
          { type: 'text', text: aiResults.twMarket?.bullish || '分析中...', size: 'xs', wrap: true, margin: 'sm' },
          { type: 'separator', margin: 'md' },
          { type: 'text', text: '🔴 GPT 觀點', size: 'sm', weight: 'bold', color: '#C62828', margin: 'md' },
          { type: 'text', text: aiResults.twMarket?.bearish || '分析中...', size: 'xs', wrap: true, margin: 'sm' }
        ],
        paddingAll: '15px'
      }
    };
    
    // 卡片 5：綜合操作策略
    const card5 = {
      type: 'bubble', size: 'mega',
      header: {
        type: 'box', layout: 'vertical',
        contents: [
          { type: 'text', text: '🎯 綜合操作策略', color: '#ffffff', size: 'lg', weight: 'bold' },
          { type: 'text', text: '雙 AI 綜合建議', color: '#ffffffcc', size: 'sm', margin: 'sm' }
        ],
        backgroundColor: '#FF6F00', paddingAll: '15px'
      },
      body: {
        type: 'box', layout: 'vertical',
        contents: [
          { type: 'text', text: aiResults.strategy || '綜合分析中...', size: 'sm', wrap: true }
        ],
        paddingAll: '15px'
      },
      footer: {
        type: 'box', layout: 'horizontal',
        contents: [
          { type: 'text', text: `⏰ ${getTaiwanTime()}`, size: 'xs', color: '#888888', align: 'center' }
        ],
        paddingAll: '10px'
      }
    };
    
    console.log('   ✅ 綜合分析完成');
    
    return {
      type: 'flex',
      altText: '📊 綜合分析 - AI/DRAM/台股/美股',
      contents: {
        type: 'carousel',
        contents: [card1, card2, card3, card4, card5]
      }
    };
    
  } catch (error) {
    console.error('綜合分析錯誤:', error);
    return { type: 'text', text: `❌ 綜合分析失敗：${error.message}` };
  }
}

/**
 * 🤖 綜合分析的雙 AI 生成
 */
async function generateComprehensiveAIAnalysis(data) {
  const geminiKey = process.env.GEMINI_API_KEY;
  const openaiKey = process.env.OPENAI_API_KEY;
  
  if (!geminiKey) {
    return {
      usAi: { bullish: 'AI 服務未設定', bearish: 'AI 服務未設定' },
      dram: { bullish: 'AI 服務未設定', bearish: 'AI 服務未設定' },
      twAi: { bullish: 'AI 服務未設定', bearish: 'AI 服務未設定' },
      twMarket: { bullish: 'AI 服務未設定', bearish: 'AI 服務未設定' },
      strategy: '請設定 GEMINI_API_KEY'
    };
  }
  
  // 組合數據
  const usAiInfo = data.usAiStocks.map(s => `${s.name}: $${s.price} (${s.changePercent > 0 ? '+' : ''}${s.changePercent}%)`).join('、');
  const usDramInfo = data.usDramStocks.map(s => `${s.name}: $${s.price} (${s.changePercent > 0 ? '+' : ''}${s.changePercent}%)`).join('、');
  const twAiInfo = data.twAiStocks.map(s => `${s.name}(${s.id}): $${s.price} (${s.changePercent > 0 ? '+' : ''}${s.changePercent}%)`).join('、');
  const twDramInfo = data.twDramStocks.map(s => `${s.name}(${s.id}): $${s.price} (${s.changePercent > 0 ? '+' : ''}${s.changePercent}%)`).join('、');
  const twMarketInfo = data.twMarket ? `加權指數: ${data.twMarket.price} (${data.twMarket.changePercent}%)` : '無資料';
  
  const formatRule = `【格式規則】禁止 Markdown（不用 **粗體**），用純文字，參考真實現價給建議。`;
  
  // 五個分析提示詞
  const prompts = {
    usAiBullish: `${formatRule}\n美股AI類股：${usAiInfo}\n請用繁體中文，從【看多角度】分析美股AI類股對台股的帶動效應（80字內）`,
    usAiBearish: `${formatRule}\n美股AI類股：${usAiInfo}\n請用繁體中文，從【風險角度】分析美股AI類股若回檔對台股的影響（80字內）`,
    dramBullish: `${formatRule}\n美股DRAM：${usDramInfo}\n台股DRAM主力：${twDramInfo}\n請用繁體中文，從【看多角度】分析DRAM族群，特別針對華邦電、力積電、南亞科給出操作建議（100字內）`,
    dramBearish: `${formatRule}\n美股DRAM：${usDramInfo}\n台股DRAM主力：${twDramInfo}\n請用繁體中文，從【風險角度】分析DRAM族群風險，特別針對華邦電、力積電、南亞科給出停損建議（100字內）`,
    twAiBullish: `${formatRule}\n台股AI族群：${twAiInfo}\n請用繁體中文，從【看多角度】分析台積電、聯發科、廣達、緯創的多頭觀點（80字內）`,
    twAiBearish: `${formatRule}\n台股AI族群：${twAiInfo}\n請用繁體中文，從【風險角度】分析台積電、聯發科、廣達、緯創的風險（80字內）`,
    twMarketBullish: `${formatRule}\n${twMarketInfo}\n請用繁體中文，從【看多角度】分析台股大盤走勢（80字內）`,
    twMarketBearish: `${formatRule}\n${twMarketInfo}\n請用繁體中文，從【風險角度】分析台股大盤風險（80字內）`,
    strategy: `${formatRule}
美股AI：${usAiInfo}
美股DRAM：${usDramInfo}
台股AI：${twAiInfo}
台股DRAM主力：${twDramInfo}
${twMarketInfo}

請用繁體中文給出【綜合操作策略】（150字內）：
1. 整體建議：偏多/偏空/觀望
2. ⭐ 華邦電(2344)：加碼/持有/減碼
3. ⭐ 力積電(6770)：加碼/持有/減碼
4. ⭐ 南亞科(2408)：加碼/持有/減碼
5. 風險控制建議`
  };
  
  try {
    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${geminiKey}`;
    
    // Gemini 分析（樂觀派）
    const geminiRequests = [
      axios.post(geminiUrl, { contents: [{ parts: [{ text: prompts.usAiBullish }] }], generationConfig: { temperature: 0.7, maxOutputTokens: 200 } }, { timeout: 15000 }),
      axios.post(geminiUrl, { contents: [{ parts: [{ text: prompts.dramBullish }] }], generationConfig: { temperature: 0.7, maxOutputTokens: 250 } }, { timeout: 15000 }),
      axios.post(geminiUrl, { contents: [{ parts: [{ text: prompts.twAiBullish }] }], generationConfig: { temperature: 0.7, maxOutputTokens: 200 } }, { timeout: 15000 }),
      axios.post(geminiUrl, { contents: [{ parts: [{ text: prompts.twMarketBullish }] }], generationConfig: { temperature: 0.7, maxOutputTokens: 200 } }, { timeout: 15000 }),
      axios.post(geminiUrl, { contents: [{ parts: [{ text: prompts.strategy }] }], generationConfig: { temperature: 0.6, maxOutputTokens: 400 } }, { timeout: 20000 })
    ];
    
    // GPT/Gemini 分析（謹慎派）
    let bearishRequests;
    if (openaiKey) {
      bearishRequests = [
        axios.post('https://api.openai.com/v1/chat/completions', { model: 'gpt-4o-mini', messages: [{ role: 'user', content: prompts.usAiBearish }], max_tokens: 200 }, { headers: { 'Authorization': `Bearer ${openaiKey}` }, timeout: 15000 }),
        axios.post('https://api.openai.com/v1/chat/completions', { model: 'gpt-4o-mini', messages: [{ role: 'user', content: prompts.dramBearish }], max_tokens: 250 }, { headers: { 'Authorization': `Bearer ${openaiKey}` }, timeout: 15000 }),
        axios.post('https://api.openai.com/v1/chat/completions', { model: 'gpt-4o-mini', messages: [{ role: 'user', content: prompts.twAiBearish }], max_tokens: 200 }, { headers: { 'Authorization': `Bearer ${openaiKey}` }, timeout: 15000 }),
        axios.post('https://api.openai.com/v1/chat/completions', { model: 'gpt-4o-mini', messages: [{ role: 'user', content: prompts.twMarketBearish }], max_tokens: 200 }, { headers: { 'Authorization': `Bearer ${openaiKey}` }, timeout: 15000 })
      ];
    } else {
      bearishRequests = [
        axios.post(geminiUrl, { contents: [{ parts: [{ text: prompts.usAiBearish }] }], generationConfig: { temperature: 0.6, maxOutputTokens: 200 } }, { timeout: 15000 }),
        axios.post(geminiUrl, { contents: [{ parts: [{ text: prompts.dramBearish }] }], generationConfig: { temperature: 0.6, maxOutputTokens: 250 } }, { timeout: 15000 }),
        axios.post(geminiUrl, { contents: [{ parts: [{ text: prompts.twAiBearish }] }], generationConfig: { temperature: 0.6, maxOutputTokens: 200 } }, { timeout: 15000 }),
        axios.post(geminiUrl, { contents: [{ parts: [{ text: prompts.twMarketBearish }] }], generationConfig: { temperature: 0.6, maxOutputTokens: 200 } }, { timeout: 15000 })
      ];
    }
    
    const [geminiResults, bearishResults] = await Promise.all([
      Promise.allSettled(geminiRequests),
      Promise.allSettled(bearishRequests)
    ]);
    
    // 解析結果
    const getGeminiText = (r) => r.status === 'fulfilled' ? r.value.data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() : '分析暫無';
    const getGptText = (r) => r.status === 'fulfilled' ? (openaiKey ? r.value.data?.choices?.[0]?.message?.content?.trim() : r.value.data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim()) : '分析暫無';
    
    return {
      usAi: { bullish: getGeminiText(geminiResults[0]), bearish: getGptText(bearishResults[0]) },
      dram: { bullish: getGeminiText(geminiResults[1]), bearish: getGptText(bearishResults[1]) },
      twAi: { bullish: getGeminiText(geminiResults[2]), bearish: getGptText(bearishResults[2]) },
      twMarket: { bullish: getGeminiText(geminiResults[3]), bearish: getGptText(bearishResults[3]) },
      strategy: getGeminiText(geminiResults[4])
    };
    
  } catch (error) {
    console.error('綜合 AI 分析錯誤:', error.message);
    return {
      usAi: { bullish: '分析暫無', bearish: '分析暫無' },
      dram: { bullish: '分析暫無', bearish: '分析暫無' },
      twAi: { bullish: '分析暫無', bearish: '分析暫無' },
      twMarket: { bullish: '分析暫無', bearish: '分析暫無' },
      strategy: '分析暫時無法取得'
    };
  }
}

/**
 * 🇺🇸 美股深度分析 - AI/DRAM 產業對台股影響
 */
async function getUSMarketDeepAnalysisFlex() {
  const aiService = require('../services/aiService');
  
  try {
    console.log('🇺🇸 開始美股深度分析...');
    
    // 🎯 關鍵美股分類
    const aiStocks = ['NVDA', 'AMD', 'MSFT', 'GOOGL', 'META', 'AAPL', 'TSM'];
    const dramStocks = ['MU', 'INTC', 'WDC', 'STX'];
    const indexSymbols = ['%5EDJI', '%5EGSPC', '%5EIXIC', 'SOX'];
    
    // 🇹🇼 台股 DRAM 族群
    const twDramStocks = ['2344', '6770', '2408', '2337'];  // 華邦電、力積電、南亞科、旺宏（主力：華邦電+力積電+南亞科）
    
    // 🇹🇼 台股 AI 族群
    const twAiStocks = ['2330', '2454', '2382', '3231', '6669', '3443'];  // 台積電、聯發科、廣達、緯創、緯穎、創意
    
    // 取得美股指數
    console.log('   📊 取得美股指數...');
    const indices = [];
    for (const symbol of indexSymbols) {
      try {
        const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d`;
        const response = await axios.get(url, {
          headers: { 'User-Agent': 'Mozilla/5.0' },
          timeout: 10000
        });
        
        const result = response.data?.chart?.result?.[0];
        if (result) {
          const meta = result.meta;
          const price = meta.regularMarketPrice;
          const prevClose = meta.previousClose || meta.chartPreviousClose;
          const change = price - prevClose;
          const changePercent = ((change / prevClose) * 100).toFixed(2);
          
          const names = {
            '%5EDJI': '道瓊工業',
            '%5EGSPC': 'S&P 500',
            '%5EIXIC': '那斯達克',
            'SOX': '費城半導體'
          };
          
          indices.push({
            name: names[symbol] || symbol,
            price: price.toFixed(2),
            change: change.toFixed(2),
            changePercent
          });
        }
      } catch (e) {
        console.log(`   ⚠️ ${symbol} 取得失敗`);
      }
      await new Promise(r => setTimeout(r, 200));
    }
    
    // 取得 AI 類股
    console.log('   🤖 取得 AI 類股...');
    const aiStockData = [];
    for (const symbol of aiStocks) {
      const data = await stockService.getUSStockPrice(symbol);
      if (data) {
        aiStockData.push(data);
        console.log(`   ✅ ${symbol}: $${data.price} (${data.changePercent}%)`);
      }
      await new Promise(r => setTimeout(r, 300));
    }
    
    // 取得美股 DRAM 類股
    console.log('   💾 取得美股 DRAM/記憶體類股...');
    const dramStockData = [];
    for (const symbol of dramStocks) {
      const data = await stockService.getUSStockPrice(symbol);
      if (data) {
        dramStockData.push(data);
        console.log(`   ✅ ${symbol}: $${data.price} (${data.changePercent}%)`);
      }
      await new Promise(r => setTimeout(r, 300));
    }
    
    // 🇹🇼 取得台股 DRAM 族群
    console.log('   🇹🇼 取得台股 DRAM 族群...');
    const twDramStockData = [];
    for (const stockId of twDramStocks) {
      const data = await stockService.getRealtimePrice(stockId);
      if (data) {
        twDramStockData.push(data);
        console.log(`   ✅ ${data.name}(${stockId}): $${data.price} (${data.changePercent}%)`);
      }
      await new Promise(r => setTimeout(r, 300));
    }
    
    // 🇹🇼 取得台股 AI 族群
    console.log('   🇹🇼 取得台股 AI 族群...');
    const twAiStockData = [];
    for (const stockId of twAiStocks) {
      const data = await stockService.getRealtimePrice(stockId);
      if (data) {
        twAiStockData.push(data);
        console.log(`   ✅ ${data.name}(${stockId}): $${data.price} (${data.changePercent}%)`);
      }
      await new Promise(r => setTimeout(r, 300));
    }
    
    // 組合分析資料
    const analysisData = {
      indices,
      aiStocks: aiStockData,
      dramStocks: dramStockData,
      twDramStocks: twDramStockData,
      twAiStocks: twAiStockData,
      timestamp: getTaiwanTime()
    };
    
    // 🤖 呼叫雙 AI 深度分析
    console.log('   🤖 呼叫雙 AI 深度分析...');
    const aiAnalysis = await generateUSMarketAIAnalysis(analysisData);
    
    // 📊 建立卡片
    
    // 卡片 1：美股指數總覽
    const indexRows = indices.map(idx => {
      const isUp = parseFloat(idx.change) >= 0;
      const color = isUp ? '#00C851' : '#ff4444';
      const arrow = isUp ? '▲' : '▼';
      return {
        type: 'box',
        layout: 'horizontal',
        margin: 'sm',
        contents: [
          { type: 'text', text: idx.name, size: 'sm', flex: 3 },
          { type: 'text', text: `${arrow} ${idx.changePercent}%`, size: 'sm', color: color, align: 'end', flex: 2, weight: 'bold' }
        ]
      };
    });
    
    const card1 = {
      type: 'bubble',
      size: 'mega',
      header: {
        type: 'box',
        layout: 'vertical',
        contents: [
          { type: 'text', text: '🇺🇸 美股深度分析', color: '#ffffff', size: 'xl', weight: 'bold' },
          { type: 'text', text: '對台股明日影響評估', color: '#ffffffcc', size: 'sm', margin: 'sm' }
        ],
        backgroundColor: '#1976D2',
        paddingAll: '20px'
      },
      body: {
        type: 'box',
        layout: 'vertical',
        contents: [
          { type: 'text', text: '📊 四大指數', size: 'md', weight: 'bold', color: '#333333' },
          ...indexRows,
          { type: 'separator', margin: 'lg' },
          { type: 'text', text: '📈 重點觀察', size: 'sm', weight: 'bold', color: '#333333', margin: 'lg' },
          { type: 'text', text: aiAnalysis.marketSummary || '美股走勢將影響台股開盤', size: 'xs', color: '#666666', wrap: true, margin: 'sm' }
        ],
        paddingAll: '20px'
      },
      footer: {
        type: 'box',
        layout: 'horizontal',
        contents: [
          { type: 'text', text: '👉 滑動看 AI 類股', size: 'xs', color: '#888888', align: 'center' }
        ],
        paddingAll: '10px'
      }
    };
    
    // 卡片 2：AI 類股表現
    const aiRows = aiStockData.map(stock => {
      const isUp = stock.change >= 0;
      const color = isUp ? '#00C851' : '#ff4444';
      const arrow = isUp ? '▲' : '▼';
      return {
        type: 'box',
        layout: 'horizontal',
        margin: 'sm',
        contents: [
          { type: 'text', text: `${stock.name}`, size: 'xs', flex: 2 },
          { type: 'text', text: `$${stock.price}`, size: 'xs', align: 'end', flex: 2 },
          { type: 'text', text: `${arrow}${stock.changePercent}%`, size: 'xs', color: color, align: 'end', flex: 2, weight: 'bold' }
        ]
      };
    });
    
    // AI 類股對應台股
    const aiTwMapping = `
🔗 台股連動：
• NVDA/AMD → 台積電(2330)、聯發科(2454)
• TSM → 台積電ADR連動
• MSFT/GOOGL → 雲端、AI伺服器供應鏈
• META → 元宇宙、AR/VR 概念股`;
    
    const card2 = {
      type: 'bubble',
      size: 'mega',
      header: {
        type: 'box',
        layout: 'vertical',
        contents: [
          { type: 'text', text: '🤖 美股 AI 類股', color: '#ffffff', size: 'lg', weight: 'bold' },
          { type: 'text', text: '輝達、超微、台積電ADR', color: '#ffffffcc', size: 'sm', margin: 'sm' }
        ],
        backgroundColor: '#7B1FA2',
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
              { type: 'text', text: '股票', size: 'xs', color: '#888888', flex: 2 },
              { type: 'text', text: '價格', size: 'xs', color: '#888888', align: 'end', flex: 2 },
              { type: 'text', text: '漲跌', size: 'xs', color: '#888888', align: 'end', flex: 2 }
            ]
          },
          { type: 'separator', margin: 'sm' },
          ...aiRows,
          { type: 'separator', margin: 'lg' },
          { type: 'text', text: aiTwMapping, size: 'xs', color: '#666666', wrap: true, margin: 'md' }
        ],
        paddingAll: '15px'
      },
      footer: {
        type: 'box',
        layout: 'horizontal',
        contents: [
          { type: 'text', text: '👉 滑動看台股 AI 族群', size: 'xs', color: '#888888', align: 'center' }
        ],
        paddingAll: '10px'
      }
    };
    
    // 🇹🇼 卡片 2b：台股 AI 族群
    const twAiRows = analysisData.twAiStocks.map(stock => {
      const isUp = stock.change >= 0;
      // 台股：紅漲綠跌
      const color = isUp ? '#D32F2F' : '#388E3C';
      const arrow = isUp ? '▲' : '▼';
      return {
        type: 'box',
        layout: 'horizontal',
        margin: 'sm',
        contents: [
          { type: 'text', text: `${stock.name}`, size: 'xs', flex: 2 },
          { type: 'text', text: `$${stock.price}`, size: 'xs', align: 'end', flex: 2 },
          { type: 'text', text: `${arrow}${stock.changePercent}%`, size: 'xs', color: color, align: 'end', flex: 2, weight: 'bold' }
        ]
      };
    });
    
    const card2b = {
      type: 'bubble',
      size: 'mega',
      header: {
        type: 'box',
        layout: 'vertical',
        contents: [
          { type: 'text', text: '🇹🇼 台股 AI 族群', color: '#ffffff', size: 'lg', weight: 'bold' },
          { type: 'text', text: '台積電、聯發科、廣達、緯創...', color: '#ffffffcc', size: 'sm', margin: 'sm' }
        ],
        backgroundColor: '#C2185B',
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
              { type: 'text', text: '股票', size: 'xs', color: '#888888', flex: 2 },
              { type: 'text', text: '收盤價', size: 'xs', color: '#888888', align: 'end', flex: 2 },
              { type: 'text', text: '漲跌', size: 'xs', color: '#888888', align: 'end', flex: 2 }
            ]
          },
          { type: 'separator', margin: 'sm' },
          ...twAiRows,
          { type: 'separator', margin: 'lg' },
          { type: 'text', text: `
📊 AI 產業觀察重點：
• NVDA/AMD 走勢帶動台積電
• AI 伺服器需求影響廣達、緯創
• CoWoS 先進封裝產能`, size: 'xs', color: '#666666', wrap: true, margin: 'md' }
        ],
        paddingAll: '15px'
      },
      footer: {
        type: 'box',
        layout: 'horizontal',
        contents: [
          { type: 'text', text: '👉 滑動看美股 DRAM 類股', size: 'xs', color: '#888888', align: 'center' }
        ],
        paddingAll: '10px'
      }
    };
    
    // 卡片 3：DRAM 類股表現
    const dramRows = dramStockData.map(stock => {
      const isUp = stock.change >= 0;
      const color = isUp ? '#00C851' : '#ff4444';
      const arrow = isUp ? '▲' : '▼';
      return {
        type: 'box',
        layout: 'horizontal',
        margin: 'sm',
        contents: [
          { type: 'text', text: `${stock.name}`, size: 'xs', flex: 2 },
          { type: 'text', text: `$${stock.price}`, size: 'xs', align: 'end', flex: 2 },
          { type: 'text', text: `${arrow}${stock.changePercent}%`, size: 'xs', color: color, align: 'end', flex: 2, weight: 'bold' }
        ]
      };
    });
    
    const card3 = {
      type: 'bubble',
      size: 'mega',
      header: {
        type: 'box',
        layout: 'vertical',
        contents: [
          { type: 'text', text: '💾 美股 DRAM/記憶體', color: '#ffffff', size: 'lg', weight: 'bold' },
          { type: 'text', text: '美光、Intel、威騰、希捷', color: '#ffffffcc', size: 'sm', margin: 'sm' }
        ],
        backgroundColor: '#00796B',
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
              { type: 'text', text: '股票', size: 'xs', color: '#888888', flex: 2 },
              { type: 'text', text: '價格', size: 'xs', color: '#888888', align: 'end', flex: 2 },
              { type: 'text', text: '漲跌', size: 'xs', color: '#888888', align: 'end', flex: 2 }
            ]
          },
          { type: 'separator', margin: 'sm' },
          ...dramRows,
          { type: 'separator', margin: 'lg' },
          { type: 'text', text: '🔗 美光(MU)走勢直接影響台股 DRAM 族群開盤方向', size: 'xs', color: '#666666', wrap: true, margin: 'md' }
        ],
        paddingAll: '15px'
      },
      footer: {
        type: 'box',
        layout: 'horizontal',
        contents: [
          { type: 'text', text: '👉 滑動看台股 DRAM 族群', size: 'xs', color: '#888888', align: 'center' }
        ],
        paddingAll: '10px'
      }
    };
    
    // 🇹🇼 卡片 3b：台股 DRAM 族群
    const twDramRows = analysisData.twDramStocks.map(stock => {
      const isUp = stock.change >= 0;
      // 台股：紅漲綠跌
      const color = isUp ? '#D32F2F' : '#388E3C';
      const arrow = isUp ? '▲' : '▼';
      return {
        type: 'box',
        layout: 'horizontal',
        margin: 'sm',
        contents: [
          { type: 'text', text: `${stock.name}`, size: 'xs', flex: 2 },
          { type: 'text', text: `$${stock.price}`, size: 'xs', align: 'end', flex: 2 },
          { type: 'text', text: `${arrow}${stock.changePercent}%`, size: 'xs', color: color, align: 'end', flex: 2, weight: 'bold' }
        ]
      };
    });
    
    const card3b = {
      type: 'bubble',
      size: 'mega',
      header: {
        type: 'box',
        layout: 'vertical',
        contents: [
          { type: 'text', text: '⭐ 台股 DRAM 族群', color: '#ffffff', size: 'lg', weight: 'bold' },
          { type: 'text', text: '主力：華邦電、力積電、南亞科', color: '#FFD700', size: 'sm', margin: 'sm', weight: 'bold' }
        ],
        backgroundColor: '#E65100',
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
              { type: 'text', text: '股票', size: 'xs', color: '#888888', flex: 2 },
              { type: 'text', text: '收盤價', size: 'xs', color: '#888888', align: 'end', flex: 2 },
              { type: 'text', text: '漲跌', size: 'xs', color: '#888888', align: 'end', flex: 2 }
            ]
          },
          { type: 'separator', margin: 'sm' },
          ...twDramRows,
          { type: 'separator', margin: 'lg' },
          { type: 'text', text: `
⭐ 主力持股觀察：
• 華邦電(2344)：DRAM + Flash 雙引擎
• 力積電(6770)：晶圓代工 + 記憶體
• 南亞科(2408)：純 DRAM 龍頭
• 美光(MU)走勢是重要參考指標`, size: 'xs', color: '#666666', wrap: true, margin: 'md' }
        ],
        paddingAll: '15px'
      },
      footer: {
        type: 'box',
        layout: 'horizontal',
        contents: [
          { type: 'text', text: '👉 滑動看 AI 深度分析', size: 'xs', color: '#888888', align: 'center' }
        ],
        paddingAll: '10px'
      }
    };
    
    // 卡片 4：Gemini 樂觀派分析
    const card4 = {
      type: 'bubble',
      size: 'mega',
      header: {
        type: 'box',
        layout: 'vertical',
        contents: [
          { type: 'text', text: '🟢 Gemini 樂觀派', color: '#ffffff', size: 'lg', weight: 'bold' },
          { type: 'text', text: '台股明日多頭觀點', color: '#ffffffcc', size: 'sm', margin: 'sm' }
        ],
        backgroundColor: '#2E7D32',
        paddingAll: '20px'
      },
      body: {
        type: 'box',
        layout: 'vertical',
        contents: [
          { type: 'text', text: aiAnalysis.bullish || '分析產生中...', size: 'md', wrap: true }
        ],
        paddingAll: '20px'
      },
      footer: {
        type: 'box',
        layout: 'horizontal',
        contents: [
          { type: 'text', text: '👉 滑動看風險評估', size: 'xs', color: '#888888', align: 'center' }
        ],
        paddingAll: '10px'
      }
    };
    
    // 卡片 5：GPT-4o 謹慎派分析
    const card5 = {
      type: 'bubble',
      size: 'mega',
      header: {
        type: 'box',
        layout: 'vertical',
        contents: [
          { type: 'text', text: `🔴 ${aiAnalysis.aiSource2 || 'GPT-4o'} 謹慎派`, color: '#ffffff', size: 'lg', weight: 'bold' },
          { type: 'text', text: '台股明日風險評估', color: '#ffffffcc', size: 'sm', margin: 'sm' }
        ],
        backgroundColor: '#C62828',
        paddingAll: '20px'
      },
      body: {
        type: 'box',
        layout: 'vertical',
        contents: [
          { type: 'text', text: aiAnalysis.bearish || '分析產生中...', size: 'md', wrap: true }
        ],
        paddingAll: '20px'
      },
      footer: {
        type: 'box',
        layout: 'horizontal',
        contents: [
          { type: 'text', text: '👉 滑動看操作策略', size: 'xs', color: '#888888', align: 'center' }
        ],
        paddingAll: '10px'
      }
    };
    
    // 卡片 6：台股操作策略
    const card6 = {
      type: 'bubble',
      size: 'mega',
      header: {
        type: 'box',
        layout: 'vertical',
        contents: [
          { type: 'text', text: '📊 台股明日操作策略', color: '#ffffff', size: 'lg', weight: 'bold' },
          { type: 'text', text: 'AI/DRAM 族群建議', color: '#ffffffcc', size: 'sm', margin: 'sm' }
        ],
        backgroundColor: '#1565C0',
        paddingAll: '20px'
      },
      body: {
        type: 'box',
        layout: 'vertical',
        contents: [
          { type: 'text', text: aiAnalysis.strategy || '綜合多空觀點，審慎操作', size: 'md', wrap: true }
        ],
        paddingAll: '20px'
      },
      footer: {
        type: 'box',
        layout: 'horizontal',
        contents: [
          { type: 'text', text: `⏰ ${getTaiwanTime()}`, size: 'xs', color: '#888888', align: 'center' }
        ],
        paddingAll: '10px'
      }
    };
    
    console.log('   ✅ 美股深度分析完成');
    
    return {
      type: 'flex',
      altText: '🇺🇸 美股深度分析 - AI/DRAM 對台股影響',
      contents: {
        type: 'carousel',
        contents: [card1, card2, card2b, card3, card3b, card4, card5, card6]
      }
    };
    
  } catch (error) {
    console.error('美股深度分析錯誤:', error);
    return { type: 'text', text: `❌ 美股深度分析失敗：${error.message}` };
  }
}

/**
 * 🤖 產生美股對台股影響的雙 AI 分析
 */
async function generateUSMarketAIAnalysis(data) {
  const geminiKey = process.env.GEMINI_API_KEY;
  const openaiKey = process.env.OPENAI_API_KEY;
  
  if (!geminiKey) {
    return {
      marketSummary: '美股走勢將影響台股開盤',
      bullish: 'AI 服務未設定，請設定 GEMINI_API_KEY',
      bearish: 'AI 服務未設定',
      strategy: '建議觀察美股收盤後再決定操作策略'
    };
  }
  
  // 組合分析資料
  const indicesInfo = data.indices.map(i => 
    `${i.name}: ${i.changePercent > 0 ? '+' : ''}${i.changePercent}%`
  ).join('、');
  
  const aiStocksInfo = data.aiStocks.map(s => 
    `${s.name}(${s.id}): $${s.price} (${s.changePercent > 0 ? '+' : ''}${s.changePercent}%)`
  ).join('\n');
  
  const dramStocksInfo = data.dramStocks.map(s => 
    `${s.name}(${s.id}): $${s.price} (${s.changePercent > 0 ? '+' : ''}${s.changePercent}%)`
  ).join('\n');
  
  // 🇹🇼 台股 DRAM 族群即時報價
  const twDramStocksInfo = data.twDramStocks?.map(s => 
    `${s.name}(${s.id}): $${s.price} (${s.changePercent > 0 ? '+' : ''}${s.changePercent}%)`
  ).join('\n') || '無資料';
  
  // 🇹🇼 台股 AI 族群即時報價
  const twAiStocksInfo = data.twAiStocks?.map(s => 
    `${s.name}(${s.id}): $${s.price} (${s.changePercent > 0 ? '+' : ''}${s.changePercent}%)`
  ).join('\n') || '無資料';
  
  const baseInfo = `
【美股指數】
${indicesInfo}

【美股 AI 類股】
${aiStocksInfo}

【美股 DRAM/記憶體類股】
${dramStocksInfo}

【🇹🇼 台股 AI 族群 - 今日收盤價】
${twAiStocksInfo}

【🇹🇼 台股 DRAM 族群 - 今日收盤價】
${twDramStocksInfo}

【台股連動關係】
• NVDA/AMD 影響：台積電(2330)、聯發科(2454)、創意(3443)
• TSM(台積電ADR) 直接影響台積電開盤
• MU(美光) 影響：南亞科(2408)、華邦電(2344)、旺宏(2337)、力積電(6770)
• HBM/DRAM 題材：華邦電、南亞科、旺宏、力積電
• AI 伺服器：廣達(2382)、緯創(3231)、緯穎(6669)

【⭐ 用戶主力持股】
• 華邦電(2344) - DRAM/Flash 記憶體大廠
• 力積電(6770) - 晶圓代工/記憶體
• 南亞科(2408) - 台灣 DRAM 龍頭
請特別針對這三檔給出詳細分析！`;

  // 格式規則（所有提示詞共用）
  const formatRule = `

【重要格式規則】
1. 禁止使用 Markdown 格式（不要用 **粗體**、*斜體*、# 標題）
2. 直接用純文字，用「」或→強調重點
3. 分析時請參考上面的「今日收盤價」，不要自己猜測價位
4. 給出的價位建議要基於真實現價
5. 請特別針對「華邦電」、「力積電」、「南亞科」給出具體操作建議`;

  // 🟢 樂觀派提示詞
  const bullishPrompt = `你是「多頭分析師」，專門從正面角度解讀美股對台股的影響。請用繁體中文台灣用語分析。
${baseInfo}
${formatRule}

請從【看多角度】分析（約 200 字）：
1. 美股走勢對台股的正面影響
2. AI 類股對台股 AI 概念股的帶動效應
3. DRAM 類股對台股記憶體族群的利多
4. ⭐ 華邦電(2344)：基於今日收盤價的多頭觀點與目標價
5. ⭐ 力積電(6770)：基於今日收盤價的多頭觀點與目標價
6. ⭐ 南亞科(2408)：基於今日收盤價的多頭觀點與目標價

語氣積極但專業，給出具體標的。`;

  // 🔴 謹慎派提示詞
  const bearishPrompt = `你是「風控分析師」，專門從風險角度評估美股對台股的影響。請用繁體中文台灣用語分析。
${baseInfo}
${formatRule}

請從【風險角度】分析（約 200 字）：
1. 美股走勢對台股的潛在風險
2. AI 類股若回檔對台股的影響
3. DRAM 類股的風險因素
4. ⭐ 華邦電(2344)：基於今日收盤價的風險評估與停損建議
5. ⭐ 力積電(6770)：基於今日收盤價的風險評估與停損建議
6. ⭐ 南亞科(2408)：基於今日收盤價的風險評估與停損建議

語氣謹慎但客觀，提供風控建議。`;

  // 📊 策略提示詞
  const strategyPrompt = `你是「投資策略師」，綜合多空觀點給出台股操作建議。請用繁體中文台灣用語。
${baseInfo}
${formatRule}

請給出【明日台股操作策略】（約 250 字）：
1. 整體建議：偏多/偏空/觀望
2. ⭐ 華邦電(2344) 操作策略：
   - 基於今日收盤價，明日建議操作（加碼/持有/減碼）
   - 支撐價位與壓力價位
3. ⭐ 力積電(6770) 操作策略：
   - 基於今日收盤價，明日建議操作（加碼/持有/減碼）
   - 支撐價位與壓力價位
4. ⭐ 南亞科(2408) 操作策略：
   - 基於今日收盤價，明日建議操作（加碼/持有/減碼）
   - 支撐價位與壓力價位
5. 風險控制建議`;

  // 市場摘要提示詞
  const summaryPrompt = `請用一句話（30字內）總結今日美股對明日台股的影響：
${indicesInfo}
AI 代表股輝達: ${data.aiStocks.find(s => s.id === 'NVDA')?.changePercent || 0}%
DRAM 代表股美光: ${data.dramStocks.find(s => s.id === 'MU')?.changePercent || 0}%`;

  try {
    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${geminiKey}`;
    
    // 並行呼叫
    const requests = [
      // 市場摘要
      axios.post(geminiUrl, {
        contents: [{ parts: [{ text: summaryPrompt }] }],
        generationConfig: { temperature: 0.5, maxOutputTokens: 100 }
      }, { timeout: 15000 }),
      
      // 樂觀派 (Gemini)
      axios.post(geminiUrl, {
        contents: [{ parts: [{ text: bullishPrompt }] }],
        generationConfig: { temperature: 0.7, maxOutputTokens: 600 }
      }, { timeout: 20000 }),
      
      // 策略 (Gemini)
      axios.post(geminiUrl, {
        contents: [{ parts: [{ text: strategyPrompt }] }],
        generationConfig: { temperature: 0.6, maxOutputTokens: 500 }
      }, { timeout: 20000 })
    ];
    
    // 謹慎派 (GPT-4o 或 Gemini)
    let bearishRequest;
    let aiSource2 = 'GPT-4o';
    
    if (openaiKey) {
      bearishRequest = axios.post('https://api.openai.com/v1/chat/completions', {
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: bearishPrompt }],
        max_tokens: 600,
        temperature: 0.6
      }, {
        headers: { 'Authorization': `Bearer ${openaiKey}`, 'Content-Type': 'application/json' },
        timeout: 20000
      });
    } else {
      aiSource2 = 'Gemini';
      bearishRequest = axios.post(geminiUrl, {
        contents: [{ parts: [{ text: bearishPrompt }] }],
        generationConfig: { temperature: 0.6, maxOutputTokens: 600 }
      }, { timeout: 20000 });
    }
    
    requests.push(bearishRequest);
    
    const results = await Promise.allSettled(requests);
    
    // 解析結果
    const marketSummary = results[0].status === 'fulfilled' 
      ? results[0].value.data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim()
      : '美股走勢將影響台股開盤';
    
    const bullish = results[1].status === 'fulfilled'
      ? results[1].value.data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim()
      : '分析暫時無法取得';
    
    const strategy = results[2].status === 'fulfilled'
      ? results[2].value.data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim()
      : '建議觀察美股收盤後再決定操作策略';
    
    let bearish = '分析暫時無法取得';
    if (results[3].status === 'fulfilled') {
      if (openaiKey) {
        bearish = results[3].value.data?.choices?.[0]?.message?.content?.trim() || bearish;
      } else {
        bearish = results[3].value.data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || bearish;
      }
    }
    
    console.log('   ✅ 雙 AI 分析完成');
    
    return {
      marketSummary,
      bullish,
      bearish,
      strategy,
      aiSource2
    };
    
  } catch (error) {
    console.error('AI 分析錯誤:', error.message);
    return {
      marketSummary: '美股走勢將影響台股開盤',
      bullish: `分析暫時無法取得：${error.message}`,
      bearish: '分析暫時無法取得',
      strategy: '建議觀察美股收盤後再決定操作策略'
    };
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




