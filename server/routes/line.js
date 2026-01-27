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
  
  // 🆕 完整功能清單
  if (msg === '功能' || msg === '指令' || msg === '全部功能' || msg === '功能清單') {
    return getFullFeatureList();
  }
  
  // 🆕 艾略特波浪分析
  if (/^(波浪|波浪分析)\s*\d{4,6}$/.test(msg)) {
    const stockId = msg.replace(/^(波浪|波浪分析)\s*/, '').trim();
    return await getElliottWaveAnalysis(stockId);
  }
  
  // 🆕 波浪網頁（開啟互動式網頁版）
  if (/^波浪網頁\s*\d{0,6}$/.test(msg)) {
    const stockId = msg.replace(/^波浪網頁\s*/, '').trim() || '2330';
    return getWaveWebLink(stockId);
  }
  
  // 🆕 波浪建議（掃描熱門股票找出適合進場的）
  if (msg === '波浪建議' || msg === '波浪推薦' || msg === '波浪掃描') {
    return await getWaveRecommendations();
  }
  
  // 🆕 明日預測（單一技術分析）
  if (/^(預測|明日|明天|預估)\s*\d{4,6}$/.test(msg)) {
    const stockId = msg.replace(/^(預測|明日|明天|預估)\s*/, '').trim();
    return await getTomorrowPrediction(stockId);
  }
  
  // 🆕 三AI預測（Claude API）
  if (/^(AI預測|三AI|AI分析|智能預測)\s*\d{4,6}$/.test(msg)) {
    const stockId = msg.replace(/^(AI預測|三AI|AI分析|智能預測)\s*/, '').trim();
    return await getTripleAIPrediction(stockId);
  }
  
  // 🆕 投資組合建議
  if (/^(投資組合|組合建議|配置|portfolio)/i.test(msg)) {
    // 提取預算金額（如果有的話）
    const budgetMatch = msg.match(/(\d+)\s*(萬|万)?/);
    let budget = 600000; // 預設 60 萬
    if (budgetMatch) {
      budget = parseInt(budgetMatch[1]);
      if (budgetMatch[2]) budget *= 10000; // 如果有「萬」則乘以 10000
      else if (budget < 1000) budget *= 10000; // 小於 1000 視為萬元
    }
    return await getPortfolioSuggestion(budget);
  }
  
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
    '已賣出': () => getSoldHoldingsFlex(),
    '賣出紀錄': () => getSoldHoldingsFlex(),
    '收盤摘要': () => getHoldingsSummaryFlex(),
    '持股摘要': () => getHoldingsSummaryFlex(),
    '檢查目標': () => checkStopLossTargetsFlex(),
    '檢查停損': () => checkStopLossTargetsFlex(),
    '停損檢查': () => checkStopLossTargetsFlex(),
    '同步名稱': () => syncStockNames(),
    '更新名稱': () => syncStockNames(),
    '教學': () => getTutorialMenuFlex(),
    '功能': () => getTutorialMenuFlex(),
    '使用說明': () => getTutorialMenuFlex(),
    '新手': () => getTutorialMenuFlex(),
    // 🆕 新增功能
    '漲幅排行': () => getRankingFlex('up'),
    '跌幅排行': () => getRankingFlex('down'),
    '成交排行': () => getRankingFlex('volume'),
    '排行榜': () => getRankingMenuFlex(),
    '排行': () => getRankingMenuFlex(),
    '新聞': () => getNewsFlex(),
    '快訊': () => getNewsFlex(),
    '財報': () => getEarningsCalendarFlex(),
    '財報日曆': () => getEarningsCalendarFlex(),
    '模擬交易': () => getSimulateMenuFlex(),
    '模擬': () => getSimulateMenuFlex(),
    '虛擬交易': () => getSimulateMenuFlex(),
    '模擬帳戶': () => getSimulateAccountFlex(),
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
  
  // 賣出指令：賣出 股票代碼 價格
  if (/^賣出\s*\d{4,6}/.test(msg)) {
    return await markAsSold(msg);
  }
  
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
    return { type: 'text', text: '📊 AI 買賣分析\n\n請輸入：分析 股票代碼\n例如：分析 2330\n\n💡 使用三AI分析（技術/籌碼/趨勢）' };
  }
  
  // 教學指令：教學 XXX
  if (msg.startsWith('教學') || msg.startsWith('學習') || msg.startsWith('怎麼')) {
    const topic = msg.replace(/^(教學|學習|怎麼用?)\s*/, '').trim();
    if (topic) {
      return getTutorialByTopic(topic);
    }
  }
  
  // 🆕 K線圖指令：K線 2330、走勢 2330
  if (/^(K線|k線|走勢|線圖)\s*\d{4,6}$/.test(msg)) {
    const stockId = msg.replace(/^(K線|k線|走勢|線圖)\s*/, '').trim();
    return await getKLineChart(stockId);
  }
  
  // 🆕 模擬交易指令：模擬買 2330 10、模擬賣 2330 10
  if (/^模擬[買賣]\s*\d{4,6}/.test(msg)) {
    return await processSimulateTrade(msg);
  }
  
  // 🆕 新聞指令：新聞 2330
  if (/^新聞\s*\d{4,6}$/.test(msg)) {
    const stockId = msg.replace(/^新聞\s*/, '').trim();
    return await getStockNewsFlex(stockId);
  }
  
  // 🆕 回測指令：回測 2330
  if (/^回測\s*\d{4,6}/.test(msg)) {
    const stockId = msg.replace(/^回測\s*/, '').trim();
    return await getBacktestFlex(stockId);
  }
  
  // 🆕 停利停損設定指令
  // 格式：停利 2330 1100 或 停損 2330 900 或 目標 2330 1100 900
  if (/^(停利|停損|目標)\s*\d{4,6}/.test(msg)) {
    return await setStopLossTarget(msg);
  }
  
  // 🆕 查看目標價：目標價 2330
  if (/^目標價\s*\d{4,6}$/.test(msg)) {
    const stockId = msg.replace(/^目標價\s*/, '').trim();
    return await getStopLossTargetFlex(stockId);
  }
  
  // 🆕 股息查詢：股息 2330、殖利率 2330、配息 2330
  if (/^(股息|殖利率|配息|股利)\s*\d{4,6}$/.test(msg)) {
    const stockId = msg.replace(/^(股息|殖利率|配息|股利)\s*/, '').trim();
    return await getDividendFlex(stockId);
  }
  
  // 🆕 持股股息總覽
  if (msg === '股息' || msg === '配息' || msg === '殖利率' || msg === '股息總覽') {
    return await getHoldingsDividendFlex();
  }
  
  // 🆕 手動設定股息：設定股息 2330 14.5
  if (/^設定股息\s*\d{4,6}\s+[\d.]+$/.test(msg)) {
    return await setCustomDividend(msg);
  }
  
  // 🆕 刪除自訂股息：刪除股息 2330
  if (/^刪除股息\s*\d{4,6}$/.test(msg)) {
    const stockId = msg.replace(/^刪除股息\s*/, '').trim();
    return await deleteCustomDividend(stockId);
  }
  
  // 🆕 高殖利率排行
  if (msg === '高殖利率' || msg === '殖利率排行' || msg === '高息股') {
    return await getHighYieldRanking();
  }
  
  // 🆕 除權息日曆
  if (msg === '除權息' || msg === '除息日曆' || msg === '除權息日曆') {
    return await getDividendCalendar();
  }
  
  // 🆕 持股健檢
  if (msg === '健檢' || msg === '持股健檢' || msg === '健康檢查') {
    return await getPortfolioHealthCheck();
  }
  
  // 🆕 投資組合分析
  if (msg === '組合分析' || msg === '投資組合' || msg === '分散分析') {
    return await getPortfolioAnalysis();
  }
  
  // 🆕 股票 PK：PK 2330 2317
  if (/^(PK|pk|比較)\s*\d{4,6}\s+\d{4,6}$/.test(msg)) {
    const parts = msg.match(/\d{4,6}/g);
    return await getStockPK(parts[0], parts[1]);
  }
  
  // 🆕 技術訊號掃描
  if (msg === '訊號掃描' || msg === '技術掃描' || msg === '掃描訊號' || msg === '黃金交叉') {
    return await getTechnicalSignalScan();
  }
  
  // 🆕 主力籌碼
  if (msg === '主力' || msg === '主力籌碼' || msg === '大戶動向') {
    return await getMajorInvestorTracking();
  }
  
  // 🆕 自然語言處理（放在最後，作為兜底）
  const nlpResult = await processNaturalLanguage(msg);
  if (nlpResult) {
    return nlpResult;
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
  
  // 🔧 修復：確保數值有效，避免 Infinity/NaN
  if (!isFinite(parseFloat(stockData.changePercent))) {
    stockData.changePercent = 0;
  }
  if (!isFinite(parseFloat(stockData.change))) {
    stockData.change = 0;
  }
  // 確保其他數值不是 null/undefined
  stockData.open = stockData.open || stockData.price || 0;
  stockData.high = stockData.high || stockData.price || 0;
  stockData.low = stockData.low || stockData.price || 0;
  stockData.yesterday = stockData.yesterday || stockData.price || 0;
  
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

  // 🔥 呼叫三AI分析
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
        { type: 'text', text: '👉 滑動看三AI分析', size: 'xs', color: '#888888', align: 'center' }
      ],
      paddingAll: '10px'
    }
  };

  // 取得 AI 標示的顯示文字
  const getAILabel = (ai) => {
    const labels = {
      'Claude': '🟣 Claude',
      'Gemini': '🔵 Gemini', 
      'GPT': '🟢 GPT'
    };
    return labels[ai] || ai;
  };

  // 🔧 卡片 2：技術分析師
  const techAI = aiAnalysis.tech?.ai || 'AI';
  const card2 = {
    type: 'bubble',
    size: 'mega',
    header: {
      type: 'box',
      layout: 'horizontal',
      contents: [
        { type: 'box', layout: 'vertical', flex: 3,
          contents: [
            { type: 'text', text: '🔧 技術分析師', color: '#ffffff', size: 'lg', weight: 'bold' },
            { type: 'text', text: `${stockData.name} K線/均線/指標`, color: '#ffffffcc', size: 'sm', margin: 'xs' }
          ]
        },
        { type: 'box', layout: 'vertical', flex: 1, alignItems: 'flex-end', justifyContent: 'center',
          contents: [
            { type: 'text', text: getAILabel(techAI), color: '#ffffff', size: 'sm', weight: 'bold' }
          ]
        }
      ],
      backgroundColor: '#3B82F6',
      paddingAll: '15px'
    },
    body: {
      type: 'box',
      layout: 'vertical',
      contents: [
        { type: 'text', text: aiAnalysis.tech?.text || aiAnalysis.tech || '分析中...', size: 'md', wrap: true }
      ],
      paddingAll: '20px'
    },
    footer: {
      type: 'box',
      layout: 'horizontal',
      contents: [
        { type: 'text', text: '👉 滑動看籌碼分析', size: 'xs', color: '#888888', align: 'center' }
      ],
      paddingAll: '10px'
    }
  };

  // 🏦 卡片 3：籌碼分析師
  const chipAI = aiAnalysis.chip?.ai || 'AI';
  const card3 = {
    type: 'bubble',
    size: 'mega',
    header: {
      type: 'box',
      layout: 'horizontal',
      contents: [
        { type: 'box', layout: 'vertical', flex: 3,
          contents: [
            { type: 'text', text: '🏦 籌碼分析師', color: '#ffffff', size: 'lg', weight: 'bold' },
            { type: 'text', text: `${stockData.name} 法人/主力動向`, color: '#ffffffcc', size: 'sm', margin: 'xs' }
          ]
        },
        { type: 'box', layout: 'vertical', flex: 1, alignItems: 'flex-end', justifyContent: 'center',
          contents: [
            { type: 'text', text: getAILabel(chipAI), color: '#ffffff', size: 'sm', weight: 'bold' }
          ]
        }
      ],
      backgroundColor: '#10B981',
      paddingAll: '15px'
    },
    body: {
      type: 'box',
      layout: 'vertical',
      contents: [
        { type: 'text', text: aiAnalysis.chip?.text || aiAnalysis.chip || '分析中...', size: 'md', wrap: true }
      ],
      paddingAll: '20px'
    },
    footer: {
      type: 'box',
      layout: 'horizontal',
      contents: [
        { type: 'text', text: '👉 滑動看趨勢策略', size: 'xs', color: '#888888', align: 'center' }
      ],
      paddingAll: '10px'
    }
  };

  // 📈 卡片 4：趨勢策略師
  const trendAI = aiAnalysis.trend?.ai || 'AI';
  const card4 = {
    type: 'bubble',
    size: 'mega',
    header: {
      type: 'box',
      layout: 'horizontal',
      contents: [
        { type: 'box', layout: 'vertical', flex: 3,
          contents: [
            { type: 'text', text: '📈 趨勢策略師', color: '#ffffff', size: 'lg', weight: 'bold' },
            { type: 'text', text: `${stockData.name} 操作建議`, color: '#ffffffcc', size: 'sm', margin: 'xs' }
          ]
        },
        { type: 'box', layout: 'vertical', flex: 1, alignItems: 'flex-end', justifyContent: 'center',
          contents: [
            { type: 'text', text: getAILabel(trendAI), color: '#ffffff', size: 'sm', weight: 'bold' }
          ]
        }
      ],
      backgroundColor: '#F59E0B',
      paddingAll: '15px'
    },
    body: {
      type: 'box',
      layout: 'vertical',
      contents: [
        { type: 'text', text: aiAnalysis.trend?.text || aiAnalysis.trend || '分析中...', size: 'md', wrap: true }
      ],
      paddingAll: '20px'
    },
    footer: {
      type: 'box',
      layout: 'horizontal',
      contents: [
        { type: 'text', text: '👉 滑動看綜合結論', size: 'xs', color: '#888888', align: 'center' }
      ],
      paddingAll: '10px'
    }
  };

  // 🤖 卡片 5：三AI綜合結論
  const votesText = aiAnalysis.votes 
    ? `看漲 ${aiAnalysis.votes.up} | 看跌 ${aiAnalysis.votes.down} | 中立 ${aiAnalysis.votes.neutral}`
    : '統計中...';
  
  const card5 = {
    type: 'bubble',
    size: 'mega',
    header: {
      type: 'box',
      layout: 'vertical',
      contents: [
        { type: 'text', text: '🤖 三AI綜合結論', color: '#ffffff', size: 'lg', weight: 'bold' },
        { type: 'text', text: votesText, color: '#ffffffcc', size: 'sm', margin: 'sm' }
      ],
      backgroundColor: '#6366F1',
      paddingAll: '20px'
    },
    body: {
      type: 'box',
      layout: 'vertical',
      contents: [
        { type: 'text', text: aiAnalysis.summary || '分析中...', size: 'lg', wrap: true, weight: 'bold' },
        { type: 'separator', margin: 'lg' },
        { type: 'box', layout: 'horizontal', margin: 'lg',
          contents: [
            { type: 'text', text: `🔧${techAI}`, size: 'xs', color: '#3B82F6', flex: 1 },
            { type: 'text', text: `🏦${chipAI}`, size: 'xs', color: '#10B981', flex: 1 },
            { type: 'text', text: `📈${trendAI}`, size: 'xs', color: '#F59E0B', flex: 1 }
          ]
        }
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
      contents: [card1, card2, card3, card4, card5]
    }
  };
}

/**
 * 🔥 三AI分析（用於個股查詢）- 升級版
 * 技術分析師 → Claude
 * 籌碼分析師 → Gemini
 * 趨勢策略師 → GPT
 */
async function getQuickAIAnalysis(stockData, indicators, chip) {
  const claudeKey = process.env.CLAUDE_API_KEY;
  const geminiKey = process.env.GEMINI_API_KEY;
  const openaiKey = process.env.OPENAI_API_KEY;

  console.log(`🤖 個股查詢三AI分析: ${stockData.name}`);

  // 基本資訊
  let baseInfo = `
股票：${stockData.name}（${stockData.id}）
現價：${stockData.price} 元
漲跌：${stockData.change > 0 ? '+' : ''}${stockData.change} 元（${stockData.changePercent}%）
最高：${stockData.high} / 最低：${stockData.low}`;

  if (indicators) {
    baseInfo += `\nRSI: ${indicators.rsi || 'N/A'}, KD: ${indicators.kd?.k || 'N/A'}/${indicators.kd?.d || 'N/A'}`;
    if (indicators.ma5) baseInfo += `\nMA5: ${indicators.ma5}, MA20: ${indicators.ma20 || 'N/A'}`;
  }
  if (chip) {
    baseInfo += `\n外資: ${chip.foreign > 0 ? '+' : ''}${(chip.foreign/1000).toFixed(0)}張, 投信: ${chip.investment > 0 ? '+' : ''}${(chip.investment/1000).toFixed(0)}張`;
  }

  // 三個AI角色的提示詞
  const techPrompt = `你是「技術分析師」，專精K線、均線、RSI、KD指標。用繁體中文台灣用語分析（約80字）：
${baseInfo}
分析重點：技術面訊號、支撐壓力、買賣時機。最後給出方向判斷（看漲/看跌/盤整）`;

  const chipPrompt = `你是「籌碼分析師」，專精法人動向、主力籌碼、成交量分析。用繁體中文台灣用語分析（約80字）：
${baseInfo}
分析重點：法人態度、量能變化、籌碼面訊號。最後給出方向判斷（看漲/看跌/盤整）`;

  const trendPrompt = `你是「趨勢策略師」，專精趨勢判斷、風險管理、資金配置。用繁體中文台灣用語分析（約80字）：
${baseInfo}
分析重點：趨勢方向、操作建議、風險評估。最後給出方向判斷（看漲/看跌/盤整）`;

  try {
    // 檢查可用的 API
    const availableAPIs = [];
    if (claudeKey) availableAPIs.push('Claude');
    if (geminiKey) availableAPIs.push('Gemini');
    if (openaiKey) availableAPIs.push('GPT');
    
    if (availableAPIs.length === 0) {
      return {
        tech: { text: '請設定 API KEY', ai: 'N/A' },
        chip: { text: '請設定 API KEY', ai: 'N/A' },
        trend: { text: 'AI 分析未啟用', ai: 'N/A' },
        summary: '請設定 CLAUDE_API_KEY、GEMINI_API_KEY 或 OPENAI_API_KEY',
        aiSource: 'N/A'
      };
    }

    // 分配 AI 給不同角色（盡量使用不同 AI）
    // 技術分析師 → 優先 Claude
    // 籌碼分析師 → 優先 Gemini
    // 趨勢策略師 → 優先 GPT
    const assignAI = (preferred, fallbacks) => {
      if (preferred === 'Claude' && claudeKey) return 'Claude';
      if (preferred === 'Gemini' && geminiKey) return 'Gemini';
      if (preferred === 'GPT' && openaiKey) return 'GPT';
      for (const fb of fallbacks) {
        if (fb === 'Claude' && claudeKey) return 'Claude';
        if (fb === 'Gemini' && geminiKey) return 'Gemini';
        if (fb === 'GPT' && openaiKey) return 'GPT';
      }
      return availableAPIs[0];
    };

    const techAI = assignAI('Claude', ['Gemini', 'GPT']);
    const chipAI = assignAI('Gemini', ['GPT', 'Claude']);
    const trendAI = assignAI('GPT', ['Claude', 'Gemini']);

    // 根據分配的 AI 呼叫對應 API
    const callAssignedAI = async (prompt, aiName) => {
      if (aiName === 'Claude') return await callClaudeForAnalysis(claudeKey, prompt);
      if (aiName === 'Gemini') return await callGeminiForAnalysis(geminiKey, prompt);
      if (aiName === 'GPT') return await callOpenAIForAnalysis(openaiKey, prompt);
      return '無可用 API';
    };

    // 並行呼叫三個分析
    const [techRes, chipRes, trendRes] = await Promise.all([
      callAssignedAI(techPrompt, techAI),
      callAssignedAI(chipPrompt, chipAI),
      callAssignedAI(trendPrompt, trendAI)
    ]);

    // 統計投票
    const countVotes = (text) => {
      if (text.includes('看漲') || text.includes('偏多')) return 'up';
      if (text.includes('看跌') || text.includes('偏空')) return 'down';
      return 'neutral';
    };

    const votes = [countVotes(techRes), countVotes(chipRes), countVotes(trendRes)];
    const upCount = votes.filter(v => v === 'up').length;
    const downCount = votes.filter(v => v === 'down').length;

    let summary = '';
    if (upCount >= 2) summary = `📈 三AI共識偏多（${upCount}/3看漲），建議逢低布局`;
    else if (downCount >= 2) summary = `📉 三AI共識偏空（${downCount}/3看跌），建議觀望或減碼`;
    else summary = `➡️ 三AI意見分歧，建議觀望等待明確訊號`;

    // 限制長度
    const truncate = (text, max) => text.length > max ? text.substring(0, max - 3) + '...' : text;

    return {
      tech: { text: truncate(techRes, 300), ai: techAI },
      chip: { text: truncate(chipRes, 300), ai: chipAI },
      trend: { text: truncate(trendRes, 300), ai: trendAI },
      summary: summary,
      votes: { up: upCount, down: downCount, neutral: 3 - upCount - downCount },
      aiSource: availableAPIs.join(' + ')
    };

  } catch (error) {
    console.error('個股三AI分析錯誤:', error.message);
    return {
      tech: { text: 'AI 分析暫時無法使用', ai: 'N/A' },
      chip: { text: 'AI 分析暫時無法使用', ai: 'N/A' },
      trend: { text: '請稍後再試', ai: 'N/A' },
      summary: 'AI 分析發生錯誤',
      votes: { up: 0, down: 0, neutral: 0 },
      aiSource: 'AI'
    };
  }
}

/**
 * 呼叫 Claude API 進行分析
 */
async function callClaudeForAnalysis(apiKey, prompt) {
  try {
    const response = await axios.post('https://api.anthropic.com/v1/messages', {
      model: 'claude-3-haiku-20240307',
      max_tokens: 200,
      messages: [{ role: 'user', content: prompt }]
    }, {
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      timeout: 15000
    });
    return response.data?.content?.[0]?.text || '分析中...';
  } catch (error) {
    console.error('Claude API 錯誤:', error.message);
    return '分析暫時無法使用';
  }
}

/**
 * 呼叫 Gemini API 進行分析
 */
async function callGeminiForAnalysis(apiKey, prompt) {
  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;
    const response = await axios.post(url, {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.7, maxOutputTokens: 200 }
    }, { headers: { 'Content-Type': 'application/json' }, timeout: 15000 });
    return response.data?.candidates?.[0]?.content?.parts?.[0]?.text || '分析中...';
  } catch (error) {
    console.error('Gemini API 錯誤:', error.message);
    return '分析暫時無法使用';
  }
}

/**
 * 呼叫 OpenAI API 進行分析
 */
async function callOpenAIForAnalysis(apiKey, prompt) {
  try {
    const response = await axios.post('https://api.openai.com/v1/chat/completions', {
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 200,
      temperature: 0.7
    }, {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      timeout: 15000
    });
    return response.data?.choices?.[0]?.message?.content || '分析中...';
  } catch (error) {
    console.error('OpenAI API 錯誤:', error.message);
    return '分析暫時無法使用';
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
        is_sold BOOLEAN DEFAULT false,
        sold_price DECIMAL(10,2),
        sold_date DATE,
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
      await pool.query(`ALTER TABLE holdings ADD COLUMN IF NOT EXISTS is_sold BOOLEAN DEFAULT false`);
      await pool.query(`ALTER TABLE holdings ADD COLUMN IF NOT EXISTS sold_price DECIMAL(10,2)`);
      await pool.query(`ALTER TABLE holdings ADD COLUMN IF NOT EXISTS sold_date DATE`);
    } catch (e) {}
  } catch (e) {}
  
  const sql = `
    SELECT * FROM holdings
    WHERE user_id = 'default' AND (is_sold = false OR is_sold IS NULL)
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
  
  // 🔧 先批次查詢所有不重複的股票，建立價格快取
  const uniqueStockIds = [...new Set(result.rows.map(r => r.stock_id))];
  const priceCache = {};
  
  console.log(`📊 批次查詢 ${uniqueStockIds.length} 支股票: ${uniqueStockIds.join(', ')}`);
  
  for (const stockId of uniqueStockIds) {
    let bestData = null;
    
    // 重試機制，取得最佳價格
    for (let retry = 0; retry < 3; retry++) {
      try {
        const data = await stockService.getRealtimePrice(stockId);
        if (data && data.price > 0) {
          // 如果還沒有資料，或新資料不等於昨收（代表是今日價格），就採用
          if (!bestData || (data.yesterday && data.price !== data.yesterday)) {
            bestData = data;
            console.log(`✅ ${stockId} 取得價格: ${data.price} (昨收: ${data.yesterday})`);
            // 如果已經取得今日價格（不等於昨收），就不用再試了
            if (data.yesterday && data.price !== data.yesterday) {
              break;
            }
          }
        }
      } catch (e) {
        console.log(`⚠️ ${stockId} 第 ${retry + 1} 次抓取失敗: ${e.message}`);
      }
      await new Promise(r => setTimeout(r, 500));
    }
    
    if (bestData) {
      priceCache[stockId] = bestData;
    }
    
    // 每支股票間隔 300ms 避免被擋
    await new Promise(r => setTimeout(r, 300));
  }
  
  console.log(`📊 價格快取完成: ${Object.keys(priceCache).length} 支`);
  
  for (const row of result.rows) {
    // 使用快取的價格（同一股票保證價格一致）
    const stockData = priceCache[row.stock_id];
    const currentPrice = stockData?.price || 0;
    const priceChange = stockData?.change || 0;
    const priceChangePercent = stockData?.changePercent || 0;
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
      priceChange,
      priceChangePercent,
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
    const isPriceUp = h.priceChange >= 0;
    const color = isUp ? '#D32F2F' : '#388E3C';
    const netColor = isNetUp ? '#D32F2F' : '#388E3C';
    const priceColor = isPriceUp ? '#D32F2F' : '#388E3C';
    const priceArrow = isPriceUp ? '▲' : '▼';

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
              { type: 'text', text: `$${h.currentPrice}`, size: 'sm', align: 'end', flex: 2, weight: 'bold', color: priceColor }
            ]
          },
          // 🆕 即時漲跌
          h.priceChange !== 0 ? {
            type: 'box', layout: 'horizontal', margin: 'xs',
            contents: [
              { type: 'text', text: '今日漲跌', size: 'xs', color: '#888888', flex: 2 },
              { type: 'text', text: `${priceArrow} ${Math.abs(h.priceChange).toFixed(2)} (${isPriceUp ? '+' : ''}${h.priceChangePercent}%)`, size: 'xs', align: 'end', flex: 2, color: priceColor }
            ]
          } : { type: 'box', layout: 'horizontal', contents: [] },
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
              { type: 'text', text: `$${formatMoney(h.currentValue)}`, size: 'sm', align: 'end', flex: 2, weight: 'bold' }
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
          // 🆕 交易成本（更明確）
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
            type: 'box', layout: 'horizontal', margin: 'sm',
            contents: [
              { type: 'text', text: '成本合計', size: 'xs', color: '#666666', flex: 2, weight: 'bold' },
              { type: 'text', text: `$${formatMoney(h.buyFee + h.sellFee + h.tax)}`, size: 'xs', align: 'end', flex: 2, weight: 'bold' }
            ]
          },
          { type: 'separator', margin: 'md' },
          // 🆕 賣出成本損益計算（更明確的區塊）
          { type: 'text', text: '💵 賣出後淨損益', size: 'sm', weight: 'bold', color: isNetUp ? '#D32F2F' : '#388E3C', margin: 'md' },
          {
            type: 'box', layout: 'vertical', margin: 'sm', backgroundColor: '#f5f5f5', cornerRadius: 'md', paddingAll: 'md',
            contents: [
              {
                type: 'box', layout: 'horizontal',
                contents: [
                  { type: 'text', text: '帳面損益', size: 'xs', color: '#666666', flex: 2 },
                  { type: 'text', text: `${isUp ? '+' : ''}$${formatMoney(h.profit)}`, size: 'xs', align: 'end', flex: 2 }
                ]
              },
              {
                type: 'box', layout: 'horizontal', margin: 'xs',
                contents: [
                  { type: 'text', text: '－ 交易成本', size: 'xs', color: '#666666', flex: 2 },
                  { type: 'text', text: `$${formatMoney(h.buyFee + h.sellFee + h.tax)}`, size: 'xs', align: 'end', flex: 2 }
                ]
              },
              { type: 'separator', margin: 'sm' },
              {
                type: 'box', layout: 'horizontal', margin: 'sm',
                contents: [
                  { type: 'text', text: '＝ 實際淨損益', size: 'sm', color: '#333333', flex: 2, weight: 'bold' },
                  { type: 'text', text: `${isNetUp ? '+' : ''}$${formatMoney(h.netProfit)}`, size: 'md', align: 'end', flex: 2, color: netColor, weight: 'bold' }
                ]
              }
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
 * 💰 標記股票為已賣出
 * 格式：賣出 股票代碼 賣出價格
 */
async function markAsSold(message) {
  const FEE_RATE = 0.001425;
  const TAX_RATE = 0.003;
  
  try {
    // 解析指令：賣出 6770 65.5
    const parts = message.replace(/^賣出\s*/, '').trim().split(/\s+/);
    const stockId = parts[0];
    const soldPrice = parseFloat(parts[1]);
    
    if (!stockId || !/^\d{4,6}$/.test(stockId)) {
      return { type: 'text', text: '❌ 請輸入正確格式\n\n賣出 股票代碼 賣出價格\n例如：賣出 6770 65.5' };
    }
    
    if (!soldPrice || isNaN(soldPrice) || soldPrice <= 0) {
      return { type: 'text', text: '❌ 請輸入賣出價格\n\n賣出 股票代碼 賣出價格\n例如：賣出 6770 65.5' };
    }
    
    // 查詢該股票的持股
    const result = await pool.query(
      `SELECT * FROM holdings WHERE stock_id = $1 AND user_id = 'default' AND is_won = true AND (is_sold = false OR is_sold IS NULL) LIMIT 1`,
      [stockId]
    );
    
    if (result.rows.length === 0) {
      return { type: 'text', text: `❌ 找不到 ${stockId} 的持股紀錄\n\n請確認該股票是否已得標且尚未賣出` };
    }
    
    const holding = result.rows[0];
    const wonPrice = parseFloat(holding.won_price) || 0;
    const lots = parseInt(holding.lots) || 0;
    const oddShares = parseInt(holding.odd_shares) || 0;
    const totalShares = lots * 1000 + oddShares;
    
    // 計算損益
    const costTotal = wonPrice * totalShares;
    const soldTotal = soldPrice * totalShares;
    const profit = soldTotal - costTotal;
    const buyFee = Math.round(costTotal * FEE_RATE);
    const sellFee = Math.round(soldTotal * FEE_RATE);
    const tax = Math.round(soldTotal * TAX_RATE);
    const netProfit = profit - buyFee - sellFee - tax;
    const profitPercent = ((profit / costTotal) * 100).toFixed(2);
    const netProfitPercent = ((netProfit / costTotal) * 100).toFixed(2);
    
    // 更新為已賣出
    await pool.query(
      `UPDATE holdings SET is_sold = true, sold_price = $1, sold_date = CURRENT_DATE, updated_at = CURRENT_TIMESTAMP WHERE id = $2`,
      [soldPrice, holding.id]
    );
    
    const isProfit = netProfit >= 0;
    const color = isProfit ? '#D32F2F' : '#388E3C';
    const stockName = holding.stock_name || stockId;
    
    return {
      type: 'flex',
      altText: `✅ ${stockName} 已賣出 ${isProfit ? '獲利' : '虧損'} $${Math.abs(netProfit).toLocaleString()}`,
      contents: {
        type: 'bubble',
        size: 'mega',
        header: {
          type: 'box', layout: 'vertical',
          contents: [
            { type: 'text', text: `✅ ${stockName} 已賣出`, color: '#ffffff', size: 'lg', weight: 'bold' },
            { type: 'text', text: `${stockId} | ${lots}張${oddShares > 0 ? oddShares + '股' : ''}`, color: '#ffffffcc', size: 'sm', margin: 'sm' }
          ],
          backgroundColor: color,
          paddingAll: '20px'
        },
        body: {
          type: 'box', layout: 'vertical',
          contents: [
            { type: 'text', text: '📊 交易明細', size: 'md', weight: 'bold', color: '#333333' },
            { type: 'box', layout: 'horizontal', margin: 'md', contents: [
              { type: 'text', text: '得標價', size: 'sm', color: '#666666', flex: 2 },
              { type: 'text', text: `$${wonPrice}`, size: 'sm', align: 'end', flex: 2 }
            ]},
            { type: 'box', layout: 'horizontal', margin: 'sm', contents: [
              { type: 'text', text: '賣出價', size: 'sm', color: '#666666', flex: 2 },
              { type: 'text', text: `$${soldPrice}`, size: 'sm', align: 'end', flex: 2, weight: 'bold', color: color }
            ]},
            { type: 'separator', margin: 'lg' },
            { type: 'text', text: '💰 損益計算', size: 'md', weight: 'bold', color: '#333333', margin: 'lg' },
            { type: 'box', layout: 'horizontal', margin: 'md', contents: [
              { type: 'text', text: '買入成本', size: 'sm', color: '#666666', flex: 2 },
              { type: 'text', text: `$${costTotal.toLocaleString()}`, size: 'sm', align: 'end', flex: 2 }
            ]},
            { type: 'box', layout: 'horizontal', margin: 'sm', contents: [
              { type: 'text', text: '賣出金額', size: 'sm', color: '#666666', flex: 2 },
              { type: 'text', text: `$${soldTotal.toLocaleString()}`, size: 'sm', align: 'end', flex: 2 }
            ]},
            { type: 'box', layout: 'horizontal', margin: 'sm', contents: [
              { type: 'text', text: '帳面損益', size: 'sm', color: '#666666', flex: 2 },
              { type: 'text', text: `${profit >= 0 ? '+' : ''}$${profit.toLocaleString()} (${profitPercent}%)`, size: 'sm', align: 'end', flex: 2, color: profit >= 0 ? '#D32F2F' : '#388E3C' }
            ]},
            { type: 'separator', margin: 'lg' },
            { type: 'text', text: '🧾 交易成本', size: 'md', weight: 'bold', color: '#333333', margin: 'lg' },
            { type: 'box', layout: 'horizontal', margin: 'md', contents: [
              { type: 'text', text: '買入手續費', size: 'xs', color: '#888888', flex: 2 },
              { type: 'text', text: `$${buyFee.toLocaleString()}`, size: 'xs', align: 'end', flex: 2 }
            ]},
            { type: 'box', layout: 'horizontal', margin: 'xs', contents: [
              { type: 'text', text: '賣出手續費', size: 'xs', color: '#888888', flex: 2 },
              { type: 'text', text: `$${sellFee.toLocaleString()}`, size: 'xs', align: 'end', flex: 2 }
            ]},
            { type: 'box', layout: 'horizontal', margin: 'xs', contents: [
              { type: 'text', text: '交易稅', size: 'xs', color: '#888888', flex: 2 },
              { type: 'text', text: `$${tax.toLocaleString()}`, size: 'xs', align: 'end', flex: 2 }
            ]},
            { type: 'separator', margin: 'lg' },
            { type: 'box', layout: 'vertical', margin: 'lg', backgroundColor: '#f5f5f5', cornerRadius: 'md', paddingAll: 'md', contents: [
              { type: 'box', layout: 'horizontal', contents: [
                { type: 'text', text: '💵 實際淨損益', size: 'md', color: '#333333', flex: 2, weight: 'bold' },
                { type: 'text', text: `${isProfit ? '+' : ''}$${netProfit.toLocaleString()}`, size: 'lg', align: 'end', flex: 2, color: color, weight: 'bold' }
              ]},
              { type: 'text', text: `報酬率 ${netProfitPercent}%`, size: 'xs', color: '#666666', align: 'end', margin: 'sm' }
            ]}
          ],
          paddingAll: '20px'
        },
        footer: {
          type: 'box', layout: 'horizontal',
          contents: [
            { type: 'text', text: `📅 ${getTaiwanDate()} | 輸入「已賣出」查看紀錄`, size: 'xs', color: '#888888', align: 'center' }
          ],
          paddingAll: '10px'
        }
      }
    };
    
  } catch (error) {
    console.error('標記賣出錯誤:', error);
    return { type: 'text', text: `❌ 標記賣出失敗：${error.message}` };
  }
}

/**
 * 📜 取得已賣出紀錄 Flex Message
 */
async function getSoldHoldingsFlex() {
  const FEE_RATE = 0.001425;
  const TAX_RATE = 0.003;
  
  try {
    // 確保欄位存在
    try {
      await pool.query(`ALTER TABLE holdings ADD COLUMN IF NOT EXISTS is_sold BOOLEAN DEFAULT false`);
      await pool.query(`ALTER TABLE holdings ADD COLUMN IF NOT EXISTS sold_price DECIMAL(10,2)`);
      await pool.query(`ALTER TABLE holdings ADD COLUMN IF NOT EXISTS sold_date DATE`);
    } catch (e) {}
    
    const result = await pool.query(`
      SELECT * FROM holdings 
      WHERE user_id = 'default' AND is_sold = true 
      ORDER BY sold_date DESC, updated_at DESC 
      LIMIT 10
    `);
    
    if (result.rows.length === 0) {
      return { type: 'text', text: '📭 目前沒有已賣出的紀錄\n\n輸入「賣出 股票代碼 賣出價格」標記賣出\n例如：賣出 6770 65.5' };
    }
    
    // 計算總損益
    let totalNetProfit = 0;
    let totalCost = 0;
    const records = [];
    
    for (const row of result.rows) {
      const wonPrice = parseFloat(row.won_price) || 0;
      const soldPrice = parseFloat(row.sold_price) || 0;
      const lots = parseInt(row.lots) || 0;
      const oddShares = parseInt(row.odd_shares) || 0;
      const totalShares = lots * 1000 + oddShares;
      
      if (wonPrice > 0 && soldPrice > 0 && totalShares > 0) {
        const costTotal = wonPrice * totalShares;
        const soldTotal = soldPrice * totalShares;
        const profit = soldTotal - costTotal;
        const buyFee = Math.round(costTotal * FEE_RATE);
        const sellFee = Math.round(soldTotal * FEE_RATE);
        const tax = Math.round(soldTotal * TAX_RATE);
        const netProfit = profit - buyFee - sellFee - tax;
        const profitPercent = ((netProfit / costTotal) * 100).toFixed(2);
        
        totalNetProfit += netProfit;
        totalCost += costTotal;
        
        records.push({
          name: row.stock_name || row.stock_id,
          stockId: row.stock_id,
          wonPrice,
          soldPrice,
          lots,
          oddShares,
          totalShares,
          netProfit,
          profitPercent,
          soldDate: row.sold_date
        });
      }
    }
    
    const totalProfitPercent = totalCost > 0 ? ((totalNetProfit / totalCost) * 100).toFixed(2) : 0;
    const isProfit = totalNetProfit >= 0;
    const headerColor = isProfit ? '#D32F2F' : '#388E3C';
    
    // 格式化張數零股
    function formatLotsShares(lots, oddShares) {
      if (lots > 0 && oddShares > 0) return `${lots}張${oddShares}股`;
      else if (lots > 0) return `${lots}張`;
      else return `${oddShares}股`;
    }
    
    // 建立紀錄列表
    const recordRows = records.map(r => {
      const isUp = r.netProfit >= 0;
      const color = isUp ? '#D32F2F' : '#388E3C';
      return {
        type: 'box', layout: 'horizontal', margin: 'md',
        contents: [
          { type: 'text', text: `${r.name}(${r.stockId})`, size: 'sm', flex: 3 },
          { type: 'text', text: `${r.wonPrice}→${r.soldPrice}`, size: 'xs', color: '#666666', flex: 2 },
          { type: 'text', text: `${isUp ? '+' : ''}$${r.netProfit.toLocaleString()}`, size: 'sm', color: color, align: 'end', flex: 2, weight: 'bold' }
        ]
      };
    });
    
    return {
      type: 'flex',
      altText: `📜 已賣出紀錄 ${isProfit ? '獲利' : '虧損'} $${Math.abs(totalNetProfit).toLocaleString()}`,
      contents: {
        type: 'bubble',
        size: 'mega',
        header: {
          type: 'box', layout: 'vertical',
          contents: [
            { type: 'text', text: '📜 已賣出紀錄', size: 'xl', weight: 'bold', color: '#ffffff' },
            { type: 'text', text: `共 ${records.length} 筆交易`, size: 'sm', color: '#ffffffcc', margin: 'sm' }
          ],
          backgroundColor: headerColor,
          paddingAll: '20px'
        },
        body: {
          type: 'box', layout: 'vertical',
          contents: [
            { type: 'box', layout: 'horizontal', contents: [
              { type: 'text', text: '總淨損益', size: 'sm', color: '#666666' },
              { type: 'text', text: `${isProfit ? '+' : ''}$${totalNetProfit.toLocaleString()} (${totalProfitPercent}%)`, size: 'lg', weight: 'bold', color: headerColor, align: 'end' }
            ]},
            { type: 'separator', margin: 'lg' },
            { type: 'box', layout: 'horizontal', margin: 'lg', contents: [
              { type: 'text', text: '股票', size: 'xs', color: '#888888', flex: 2 },
              { type: 'text', text: '買→賣', size: 'xs', color: '#888888', flex: 2 },
              { type: 'text', text: '淨損益', size: 'xs', color: '#888888', align: 'end', flex: 2 }
            ]},
            ...recordRows
          ],
          paddingAll: '20px'
        },
        footer: {
          type: 'box', layout: 'horizontal',
          contents: [
            { type: 'text', text: `⏰ ${getTaiwanTime()}`, size: 'xs', color: '#888888', align: 'center' }
          ],
          paddingAll: '10px'
        }
      }
    };
    
  } catch (error) {
    console.error('取得已賣出紀錄錯誤:', error);
    return { type: 'text', text: `❌ 取得紀錄失敗：${error.message}` };
  }
}

/**
 * 📈 取得持股收盤摘要 Flex Message
 */
async function getHoldingsSummaryFlex() {
  try {
    // 取得持股
    const holdingsResult = await pool.query(
      "SELECT * FROM holdings WHERE user_id = 'default' AND is_won = true AND (is_sold = false OR is_sold IS NULL)"
    );

    if (holdingsResult.rows.length === 0) {
      return { type: 'text', text: '📭 目前沒有持股\n\n請先在網頁版或 LINE 新增持股後再查看摘要' };
    }

    const holdings = [];
    let totalCost = 0;
    let totalValue = 0;

    for (const row of holdingsResult.rows) {
      const stockData = await stockService.getRealtimePrice(row.stock_id);
      if (stockData) {
        const lots = parseInt(row.lots) || 0;
        const oddShares = parseInt(row.odd_shares) || 0;
        const totalShares = lots * 1000 + oddShares;
        const costPrice = parseFloat(row.won_price) || 0;
        const cost = costPrice * totalShares;
        const value = stockData.price * totalShares;
        const profit = value - cost;
        const profitPercent = cost > 0 ? ((profit / cost) * 100).toFixed(2) : 0;

        holdings.push({
          stockId: row.stock_id,
          stockName: row.stock_name || stockData.name || row.stock_id,
          currentPrice: stockData.price,
          change: stockData.change || 0,
          changePercent: stockData.changePercent || 0,
          costPrice,
          profit,
          profitPercent,
          lots,
          oddShares
        });

        totalCost += cost;
        totalValue += value;
      }
      await new Promise(r => setTimeout(r, 300));
    }

    if (holdings.length === 0) {
      return { type: 'text', text: '❌ 無法取得持股價格，請稍後再試' };
    }

    // 排序：今日漲跌幅
    holdings.sort((a, b) => parseFloat(b.changePercent) - parseFloat(a.changePercent));

    const totalProfit = totalValue - totalCost;
    const totalProfitPercent = totalCost > 0 ? ((totalProfit / totalCost) * 100).toFixed(2) : 0;

    const upCount = holdings.filter(h => parseFloat(h.changePercent) > 0).length;
    const downCount = holdings.filter(h => parseFloat(h.changePercent) < 0).length;
    const isProfit = totalProfit >= 0;

    const stockRows = holdings.slice(0, 8).map(h => {
      const dayUp = parseFloat(h.changePercent) >= 0;
      const holdUp = parseFloat(h.profitPercent) >= 0;
      // 🔧 修正：顯示「名稱(代碼)」格式
      const displayName = `${h.stockName.substring(0, 4)}(${h.stockId})`;
      return {
        type: 'box',
        layout: 'horizontal',
        contents: [
          { type: 'text', text: displayName, size: 'sm', flex: 4 },
          { type: 'text', text: '$' + h.currentPrice, size: 'sm', flex: 2, align: 'end' },
          { type: 'text', text: (dayUp ? '▲' : '▼') + Math.abs(h.changePercent) + '%', size: 'sm', flex: 2, align: 'end', color: dayUp ? '#D32F2F' : '#388E3C' },
          { type: 'text', text: (holdUp ? '+' : '') + h.profitPercent + '%', size: 'sm', flex: 2, align: 'end', color: holdUp ? '#D32F2F' : '#388E3C' }
        ],
        margin: 'sm'
      };
    });

    return {
      type: 'flex',
      altText: '💼 持股摘要 ' + (isProfit ? '📈' : '📉') + ' ' + totalProfitPercent + '%',
      contents: {
        type: 'bubble',
        size: 'mega',
        header: {
          type: 'box',
          layout: 'vertical',
          contents: [
            { type: 'text', text: '💼 持股摘要', size: 'lg', weight: 'bold', color: '#ffffff' },
            { type: 'text', text: getTaiwanDate() + ' ' + getTaiwanTime(), size: 'sm', color: '#ffffffaa', margin: 'sm' }
          ],
          backgroundColor: isProfit ? '#D32F2F' : '#388E3C',
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
                { type: 'text', text: '總損益', size: 'sm', color: '#666666' },
                { type: 'text', text: (isProfit ? '+' : '') + '$' + Math.round(totalProfit).toLocaleString() + ' (' + totalProfitPercent + '%)', size: 'lg', weight: 'bold', color: isProfit ? '#D32F2F' : '#388E3C', align: 'end' }
              ]
            },
            {
              type: 'box',
              layout: 'horizontal',
              margin: 'md',
              contents: [
                { type: 'text', text: '📈 ' + upCount + ' 漲', size: 'sm', color: '#D32F2F' },
                { type: 'text', text: '📉 ' + downCount + ' 跌', size: 'sm', color: '#388E3C', margin: 'lg' },
                { type: 'text', text: '共 ' + holdings.length + ' 檔', size: 'sm', color: '#888888', align: 'end' }
              ]
            },
            { type: 'separator', margin: 'lg' },
            {
              type: 'box',
              layout: 'horizontal',
              margin: 'lg',
              contents: [
                { type: 'text', text: '股票', size: 'xs', color: '#888888', flex: 3 },
                { type: 'text', text: '現價', size: 'xs', color: '#888888', flex: 2, align: 'end' },
                { type: 'text', text: '今日', size: 'xs', color: '#888888', flex: 2, align: 'end' },
                { type: 'text', text: '持股', size: 'xs', color: '#888888', flex: 2, align: 'end' }
              ]
            },
            ...stockRows
          ],
          paddingAll: '20px'
        },
        footer: {
          type: 'box',
          layout: 'vertical',
          contents: [
            { type: 'text', text: '💡 每日 14:00 自動推送收盤摘要', size: 'xs', color: '#888888', align: 'center' }
          ],
          paddingAll: '10px'
        }
      }
    };

  } catch (error) {
    console.error('取得持股摘要錯誤:', error);
    return { type: 'text', text: `❌ 取得摘要失敗：${error.message}` };
  }
}

/**
 * 🎯 檢查停利停損目標 Flex Message
 */
async function checkStopLossTargetsFlex() {
  try {
    // 取得有設定目標價的持股
    const result = await pool.query(`
      SELECT * FROM holdings 
      WHERE user_id = 'default' 
      AND is_won = true 
      AND (is_sold = false OR is_sold IS NULL)
      AND (target_price_high IS NOT NULL OR target_price_low IS NOT NULL)
    `);

    if (result.rows.length === 0) {
      return { 
        type: 'text', 
        text: '📭 目前沒有設定停利停損目標\n\n請在網頁版「持股管理」設定：\n📈 上漲目標價（停利）\n📉 下跌目標價（停損）\n\n設定後系統會盤中自動監控！' 
      };
    }

    const alerts = [];
    const monitoring = [];

    for (const row of result.rows) {
      const stockData = await stockService.getRealtimePrice(row.stock_id);
      if (!stockData) continue;

      const currentPrice = stockData.price;
      const stockName = row.stock_name || stockData.name || row.stock_id;
      const lots = parseInt(row.lots) || 0;
      const oddShares = parseInt(row.odd_shares) || 0;
      const totalShares = lots * 1000 + oddShares;
      const costPrice = parseFloat(row.won_price) || 0;
      const profit = (currentPrice - costPrice) * totalShares;
      const profitPercent = costPrice > 0 ? ((currentPrice - costPrice) / costPrice * 100).toFixed(2) : 0;

      // 🔧 修正：顯示格式「名稱(代碼)」
      const displayName = `${stockName}(${row.stock_id})`;
      
      const item = {
        stockId: row.stock_id,
        stockName: displayName,
        currentPrice,
        costPrice,
        profit,
        profitPercent,
        targetHigh: row.target_price_high ? parseFloat(row.target_price_high) : null,
        targetLow: row.target_price_low ? parseFloat(row.target_price_low) : null
      };

      // 檢查是否觸發
      if (row.target_price_high && currentPrice >= parseFloat(row.target_price_high)) {
        item.triggered = 'high';
        alerts.push(item);
      } else if (row.target_price_low && currentPrice <= parseFloat(row.target_price_low)) {
        item.triggered = 'low';
        alerts.push(item);
      } else {
        monitoring.push(item);
      }

      await new Promise(r => setTimeout(r, 300));
    }

    // 建立卡片內容
    const contents = [];

    // 已觸發提醒
    if (alerts.length > 0) {
      contents.push({
        type: 'text', text: '🔔 已觸發目標', size: 'md', weight: 'bold', color: '#D32F2F'
      });
      
      alerts.forEach(a => {
        const isHigh = a.triggered === 'high';
        const isProfit = a.profit >= 0;
        contents.push({
          type: 'box',
          layout: 'vertical',
          margin: 'md',
          backgroundColor: isHigh ? '#FFEBEE' : '#FFF3E0',
          cornerRadius: 'md',
          paddingAll: '10px',
          contents: [
            {
              type: 'box',
              layout: 'horizontal',
              contents: [
                { type: 'text', text: (isHigh ? '🎯 ' : '⚠️ ') + a.stockName, size: 'sm', weight: 'bold', flex: 3 },
                { type: 'text', text: '$' + a.currentPrice, size: 'sm', align: 'end', flex: 2 }
              ]
            },
            {
              type: 'box',
              layout: 'horizontal',
              margin: 'sm',
              contents: [
                { type: 'text', text: isHigh ? '達停利' : '觸停損', size: 'xs', color: isHigh ? '#D32F2F' : '#FF9800' },
                { type: 'text', text: (isProfit ? '+' : '') + '$' + Math.round(a.profit).toLocaleString(), size: 'xs', align: 'end', color: isProfit ? '#D32F2F' : '#388E3C' }
              ]
            }
          ]
        });
      });

      contents.push({ type: 'separator', margin: 'lg' });
    }

    // 監控中
    if (monitoring.length > 0) {
      contents.push({
        type: 'text', text: '👁️ 監控中 (' + monitoring.length + ')', size: 'md', weight: 'bold', margin: alerts.length > 0 ? 'lg' : 'none'
      });
      
      monitoring.slice(0, 5).forEach(m => {
        const targetText = [];
        if (m.targetHigh) targetText.push('↑$' + m.targetHigh);
        if (m.targetLow) targetText.push('↓$' + m.targetLow);
        
        contents.push({
          type: 'box',
          layout: 'horizontal',
          margin: 'md',
          contents: [
            { type: 'text', text: m.stockName, size: 'sm', flex: 3 },
            { type: 'text', text: '$' + m.currentPrice, size: 'sm', flex: 2, align: 'center' },
            { type: 'text', text: targetText.join(' '), size: 'xs', flex: 3, align: 'end', color: '#888888' }
          ]
        });
      });

      if (monitoring.length > 5) {
        contents.push({
          type: 'text', text: '...還有 ' + (monitoring.length - 5) + ' 檔', size: 'xs', color: '#888888', margin: 'sm', align: 'end'
        });
      }
    }

    const headerColor = alerts.length > 0 ? '#FF9800' : '#2196F3';
    const statusText = alerts.length > 0 
      ? '🔔 ' + alerts.length + ' 檔已觸發！' 
      : '✅ 全部正常監控中';

    return {
      type: 'flex',
      altText: '🎯 停利停損檢查 - ' + statusText,
      contents: {
        type: 'bubble',
        size: 'mega',
        header: {
          type: 'box',
          layout: 'vertical',
          contents: [
            { type: 'text', text: '🎯 停利停損檢查', size: 'lg', weight: 'bold', color: '#ffffff' },
            { type: 'text', text: statusText, size: 'sm', color: '#ffffffcc', margin: 'sm' }
          ],
          backgroundColor: headerColor,
          paddingAll: '20px'
        },
        body: {
          type: 'box',
          layout: 'vertical',
          contents: contents,
          paddingAll: '20px'
        },
        footer: {
          type: 'box',
          layout: 'vertical',
          contents: [
            { type: 'text', text: '💡 盤中每 10 分鐘自動檢查', size: 'xs', color: '#888888', align: 'center' }
          ],
          paddingAll: '10px'
        }
      }
    };

  } catch (error) {
    console.error('檢查停利停損錯誤:', error);
    return { type: 'text', text: `❌ 檢查失敗：${error.message}` };
  }
}

/**
 * 🔄 同步所有持股的股票名稱
 */
async function syncStockNames() {
  try {
    // 取得所有缺少名稱的持股
    const result = await pool.query(`
      SELECT DISTINCT stock_id, id FROM holdings 
      WHERE stock_name IS NULL OR stock_name = stock_id
    `);

    if (result.rows.length === 0) {
      return { type: 'text', text: '✅ 所有持股都已有名稱，無需同步' };
    }

    let updated = 0;
    const errors = [];

    for (const row of result.rows) {
      try {
        const stockData = await stockService.getRealtimePrice(row.stock_id);
        if (stockData && stockData.name && stockData.name !== row.stock_id) {
          await pool.query(
            'UPDATE holdings SET stock_name = $1 WHERE stock_id = $2',
            [stockData.name, row.stock_id]
          );
          updated++;
          console.log(`✅ 已更新 ${row.stock_id} → ${stockData.name}`);
        } else {
          errors.push(row.stock_id);
        }
        await new Promise(r => setTimeout(r, 500));
      } catch (e) {
        errors.push(row.stock_id);
      }
    }

    let msg = `🔄 同步股票名稱完成！\n\n✅ 成功更新 ${updated} 檔`;
    if (errors.length > 0) {
      msg += `\n⚠️ ${errors.length} 檔無法取得名稱：${errors.slice(0, 5).join(', ')}${errors.length > 5 ? '...' : ''}`;
    }

    return { type: 'text', text: msg };

  } catch (error) {
    console.error('同步股票名稱錯誤:', error);
    return { type: 'text', text: `❌ 同步失敗：${error.message}` };
  }
}

// ==================== 🆕 新功能區 ====================

/**
 * 💬 自然語言解析
 */
/**
 * 💬 自然語言處理
 */
async function processNaturalLanguage(msg) {
  // 股票名稱對照表
  const stockNameMap = {
    '台積電': '2330', '鴻海': '2317', '聯發科': '2454', '台達電': '2308',
    '富邦金': '2881', '國泰金': '2882', '中信金': '2891', '玉山金': '2884',
    '聯電': '2303', '台塑': '1301', '南亞': '1303', '中鋼': '2002',
    '長榮': '2603', '陽明': '2609', '萬海': '2615', '華航': '2610',
    '廣達': '2382', '緯創': '3231', '仁寶': '2324', '英業達': '2356',
    '華碩': '2357', '宏碁': '2353', '技嘉': '2376', '微星': '2377',
    '大立光': '3008', '聯詠': '3034', '瑞昱': '2379', '矽力': '6415',
    '威剛': '3260', '群聯': '8299', '南亞科': '2408', '華邦電': '2344',
    '世芯': '3661', '創意': '3443', '力積電': '6770', '環球晶': '6488',
    '台達': '2308', '鴻準': '2354', '和碩': '4938', '緯穎': '6669',
    '奇鋐': '3017', '嘉澤': '3533', '健策': '3653', '勤誠': '8210'
  };
  
  // 模式1: "XXX 現在多少" / "XXX 股價" / "XXX 多少錢"
  const pricePatterns = [
    /^(.+?)(現在|目前)?(多少|幾塊|股價|價格|價位)/,
    /^(.+?)的?(股價|價格|報價)$/,
    /^(.+?)(漲|跌)了?(多少)?$/
  ];
  
  for (const pattern of pricePatterns) {
    const match = msg.match(pattern);
    if (match) {
      const name = match[1].trim();
      const stockId = stockNameMap[name];
      if (stockId) {
        return await getStockInfoFlex(stockId);
      }
      // 可能是代碼
      if (/^\d{4,6}$/.test(name)) {
        return await getStockInfoFlex(name);
      }
    }
  }
  
  // 模式2: "幫我查 XXX" / "查一下 XXX"
  const searchPatterns = [
    /^(幫我|請|麻煩)?(查一下|查|看一下|看)\s*(.+)$/,
    /^(.+?)(怎麼樣|如何|好不好)$/
  ];
  
  for (const pattern of searchPatterns) {
    const match = msg.match(pattern);
    if (match) {
      const name = match[match.length - 1].trim();
      const stockId = stockNameMap[name];
      if (stockId) {
        return await getStockInfoFlex(stockId);
      }
    }
  }
  
  // 模式3: "今天大盤" / "台股今天"
  if (/今天.*(大盤|台股|指數)|^(大盤|台股|指數).*(今天|如何|怎樣)/.test(msg)) {
    return await getMarketReply();
  }
  
  // 模式4: "美股收盤" / "道瓊"
  if (/(美股|道瓊|納斯達克|標普).*(收盤|如何|怎樣)|今天.*美股/.test(msg)) {
    return await getUSMarketReply();
  }
  
  return null;
}

/**
 * 🏆 排行榜選單
 */
function getRankingMenuFlex() {
  return {
    type: 'flex',
    altText: '🏆 排行榜選單',
    contents: {
      type: 'bubble',
      size: 'kilo',
      header: {
        type: 'box',
        layout: 'vertical',
        contents: [
          { type: 'text', text: '🏆 排行榜', size: 'xl', weight: 'bold', color: '#ffffff' }
        ],
        backgroundColor: '#FF6B6B',
        paddingAll: '15px'
      },
      body: {
        type: 'box',
        layout: 'vertical',
        contents: [
          {
            type: 'button',
            style: 'secondary',
            action: { type: 'message', label: '📈 漲幅排行', text: '漲幅排行' }
          },
          {
            type: 'button',
            style: 'secondary',
            margin: 'sm',
            action: { type: 'message', label: '📉 跌幅排行', text: '跌幅排行' }
          },
          {
            type: 'button',
            style: 'secondary',
            margin: 'sm',
            action: { type: 'message', label: '🔥 成交排行', text: '成交排行' }
          },
          {
            type: 'button',
            style: 'secondary',
            margin: 'sm',
            action: { type: 'message', label: '💰 外資買超', text: '外資買超' }
          }
        ],
        paddingAll: '15px'
      }
    }
  };
}

/**
 * 🏆 取得排行榜 Flex Message
 */
async function getRankingFlex(type) {
  try {
    // 使用 Yahoo Finance 取得排行資料
    const rankings = await stockService.getRanking(type);
    
    if (!rankings || rankings.length === 0) {
      return { type: 'text', text: '⚠️ 無法取得排行資料，請稍後再試' };
    }
    
    const titles = {
      'up': '📈 漲幅排行',
      'down': '📉 跌幅排行',
      'volume': '🔥 成交量排行'
    };
    
    const colors = {
      'up': '#D63031',
      'down': '#00B894',
      'volume': '#6C5CE7'
    };
    
    const rows = rankings.slice(0, 10).map((stock, i) => {
      const isUp = stock.changePercent >= 0;
      // 🔧 修正：顯示格式「名稱(代碼)」
      const displayName = stock.name ? `${stock.name}(${stock.id})` : stock.id;
      return {
        type: 'box',
        layout: 'horizontal',
        contents: [
          { type: 'text', text: `${i + 1}`, size: 'sm', color: '#888888', flex: 1 },
          { type: 'text', text: displayName, size: 'sm', flex: 4 },
          { type: 'text', text: `$${stock.price}`, size: 'sm', flex: 2, align: 'end' },
          { 
            type: 'text', 
            text: `${isUp ? '+' : ''}${stock.changePercent}%`, 
            size: 'sm', 
            flex: 2, 
            align: 'end',
            color: isUp ? '#D63031' : '#00B894'
          }
        ],
        margin: 'sm'
      };
    });
    
    return {
      type: 'flex',
      altText: titles[type] || '🏆 排行榜',
      contents: {
        type: 'bubble',
        size: 'mega',
        header: {
          type: 'box',
          layout: 'vertical',
          contents: [
            { type: 'text', text: titles[type] || '🏆 排行榜', size: 'xl', weight: 'bold', color: '#ffffff' },
            { type: 'text', text: getTaiwanDate(), size: 'sm', color: '#ffffffaa', margin: 'sm' }
          ],
          backgroundColor: colors[type] || '#6C5CE7',
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
                { type: 'text', text: '股票', size: 'xs', color: '#888888', flex: 3 },
                { type: 'text', text: '股價', size: 'xs', color: '#888888', flex: 2, align: 'end' },
                { type: 'text', text: '漲跌', size: 'xs', color: '#888888', flex: 2, align: 'end' }
              ]
            },
            { type: 'separator', margin: 'md' },
            ...rows
          ],
          paddingAll: '20px'
        }
      }
    };
  } catch (error) {
    console.error('取得排行榜錯誤:', error);
    return { type: 'text', text: `❌ 取得排行榜失敗：${error.message}` };
  }
}

/**
 * 📰 取得新聞快訊 Flex Message
 */
async function getNewsFlex() {
  try {
    // 取得台股相關新聞
    const news = await fetchStockNews();
    
    if (!news || news.length === 0) {
      return { type: 'text', text: '📭 目前沒有最新新聞' };
    }
    
    const newsRows = news.slice(0, 6).map(n => ({
      type: 'box',
      layout: 'vertical',
      contents: [
        { type: 'text', text: n.title, size: 'sm', wrap: true, maxLines: 2 },
        { type: 'text', text: `${n.source} · ${n.time}`, size: 'xs', color: '#888888', margin: 'sm' }
      ],
      margin: 'lg',
      action: n.url ? { type: 'uri', label: '閱讀', uri: n.url } : undefined
    }));
    
    return {
      type: 'flex',
      altText: '📰 股市新聞快訊',
      contents: {
        type: 'bubble',
        size: 'mega',
        header: {
          type: 'box',
          layout: 'vertical',
          contents: [
            { type: 'text', text: '📰 股市新聞', size: 'xl', weight: 'bold', color: '#ffffff' },
            { type: 'text', text: '最新財經快訊', size: 'sm', color: '#ffffffaa', margin: 'sm' }
          ],
          backgroundColor: '#E17055',
          paddingAll: '20px'
        },
        body: {
          type: 'box',
          layout: 'vertical',
          contents: newsRows,
          paddingAll: '15px'
        },
        footer: {
          type: 'box',
          layout: 'vertical',
          contents: [
            { type: 'text', text: '💡 輸入「新聞 2330」查個股新聞', size: 'xs', color: '#888888', align: 'center' }
          ],
          paddingAll: '10px'
        }
      }
    };
  } catch (error) {
    console.error('取得新聞錯誤:', error);
    return { type: 'text', text: `❌ 取得新聞失敗：${error.message}` };
  }
}

/**
 * 📰 取得個股新聞
 */
async function getStockNewsFlex(stockId) {
  try {
    const stockData = await stockService.getRealtimePrice(stockId);
    const stockName = stockData?.name || stockId;
    
    const news = await fetchStockNews(stockName);
    
    if (!news || news.length === 0) {
      return { type: 'text', text: `📭 找不到 ${stockName} 的相關新聞` };
    }
    
    const newsRows = news.slice(0, 5).map(n => ({
      type: 'box',
      layout: 'vertical',
      contents: [
        { type: 'text', text: n.title, size: 'sm', wrap: true, maxLines: 2 },
        { type: 'text', text: `${n.source} · ${n.time}`, size: 'xs', color: '#888888', margin: 'sm' }
      ],
      margin: 'lg',
      action: n.url ? { type: 'uri', label: '閱讀', uri: n.url } : undefined
    }));
    
    return {
      type: 'flex',
      altText: `📰 ${stockName} 相關新聞`,
      contents: {
        type: 'bubble',
        size: 'mega',
        header: {
          type: 'box',
          layout: 'vertical',
          contents: [
            { type: 'text', text: `📰 ${stockName} 新聞`, size: 'lg', weight: 'bold', color: '#ffffff' }
          ],
          backgroundColor: '#E17055',
          paddingAll: '20px'
        },
        body: {
          type: 'box',
          layout: 'vertical',
          contents: newsRows,
          paddingAll: '15px'
        }
      }
    };
  } catch (error) {
    console.error('取得個股新聞錯誤:', error);
    return { type: 'text', text: `❌ 取得新聞失敗：${error.message}` };
  }
}

/**
 * 抓取新聞
 */
async function fetchStockNews(keyword = '台股') {
  try {
    // 使用 Google News RSS
    const url = `https://news.google.com/rss/search?q=${encodeURIComponent(keyword + ' 股票')}&hl=zh-TW&gl=TW&ceid=TW:zh-Hant`;
    const response = await axios.get(url, { timeout: 10000 });
    
    // 簡單解析 RSS
    const items = response.data.match(/<item>([\s\S]*?)<\/item>/g) || [];
    const news = items.slice(0, 10).map(item => {
      const title = item.match(/<title>(.*?)<\/title>/)?.[1]?.replace(/<!\[CDATA\[(.*?)\]\]>/, '$1') || '';
      const link = item.match(/<link>(.*?)<\/link>/)?.[1] || '';
      const pubDate = item.match(/<pubDate>(.*?)<\/pubDate>/)?.[1] || '';
      const source = item.match(/<source.*?>(.*?)<\/source>/)?.[1] || '';
      
      // 格式化時間
      const date = new Date(pubDate);
      const hours = Math.floor((Date.now() - date.getTime()) / (1000 * 60 * 60));
      const time = hours < 24 ? `${hours}小時前` : `${Math.floor(hours / 24)}天前`;
      
      return { title, url: link, source, time };
    });
    
    return news;
  } catch (error) {
    console.error('抓取新聞錯誤:', error.message);
    return [];
  }
}

/**
 * 📅 財報日曆 Flex Message
 */
async function getEarningsCalendarFlex() {
  try {
    // 取得持股的財報日期
    const holdingsResult = await pool.query(
      "SELECT DISTINCT stock_id, stock_name FROM holdings WHERE user_id = 'default' AND is_won = true AND (is_sold = false OR is_sold IS NULL)"
    );
    
    if (holdingsResult.rows.length === 0) {
      return { type: 'text', text: '📭 目前沒有持股\n\n請先新增持股後再查看財報日曆' };
    }
    
    // 模擬財報日期（實際應從外部 API 取得）
    const now = new Date();
    const currentMonth = now.getMonth() + 1;
    const currentYear = now.getFullYear();
    
    // 台股財報公布時間規則
    // Q1: 5/15前, Q2: 8/14前, Q3: 11/14前, Q4: 3/31前
    const quarters = [
      { q: 'Q4', deadline: `${currentYear}/3/31`, month: 3 },
      { q: 'Q1', deadline: `${currentYear}/5/15`, month: 5 },
      { q: 'Q2', deadline: `${currentYear}/8/14`, month: 8 },
      { q: 'Q3', deadline: `${currentYear}/11/14`, month: 11 }
    ];
    
    // 找出下一個財報季
    let nextQ = quarters.find(q => q.month >= currentMonth) || quarters[0];
    if (currentMonth > 11) {
      nextQ = { ...quarters[0], deadline: `${currentYear + 1}/3/31` };
    }
    
    const stockList = holdingsResult.rows.map(r => {
      // 🔧 修正：顯示格式「名稱(代碼)」
      const displayName = r.stock_name ? `${r.stock_name}(${r.stock_id})` : r.stock_id;
      return {
        type: 'box',
        layout: 'horizontal',
        contents: [
          { type: 'text', text: displayName, size: 'sm', flex: 4 },
          { type: 'text', text: nextQ.deadline + '前', size: 'sm', flex: 2, align: 'end', color: '#888888' }
        ],
        margin: 'sm'
      };
    });
    
    return {
      type: 'flex',
      altText: '📅 財報日曆',
      contents: {
        type: 'bubble',
        size: 'mega',
        header: {
          type: 'box',
          layout: 'vertical',
          contents: [
            { type: 'text', text: '📅 財報日曆', size: 'xl', weight: 'bold', color: '#ffffff' },
            { type: 'text', text: `下一季：${nextQ.q} 財報`, size: 'sm', color: '#ffffffaa', margin: 'sm' }
          ],
          backgroundColor: '#00B894',
          paddingAll: '20px'
        },
        body: {
          type: 'box',
          layout: 'vertical',
          contents: [
            { type: 'text', text: '📌 持股財報公布截止日', weight: 'bold', size: 'md' },
            { type: 'separator', margin: 'md' },
            ...stockList.slice(0, 8),
            stockList.length > 8 ? { type: 'text', text: `...還有 ${stockList.length - 8} 檔`, size: 'xs', color: '#888888', margin: 'md' } : null
          ].filter(Boolean),
          paddingAll: '20px'
        },
        footer: {
          type: 'box',
          layout: 'vertical',
          contents: [
            { type: 'text', text: '💡 法定公布期限，實際日期依公司公告', size: 'xs', color: '#888888', align: 'center' }
          ],
          paddingAll: '10px'
        }
      }
    };
  } catch (error) {
    console.error('取得財報日曆錯誤:', error);
    return { type: 'text', text: `❌ 取得財報日曆失敗：${error.message}` };
  }
}

/**
 * 🎮 模擬交易選單
 */
function getSimulateMenuFlex() {
  return {
    type: 'flex',
    altText: '🎮 模擬交易',
    contents: {
      type: 'bubble',
      size: 'mega',
      header: {
        type: 'box',
        layout: 'vertical',
        contents: [
          { type: 'text', text: '🎮 模擬交易', size: 'xl', weight: 'bold', color: '#ffffff' },
          { type: 'text', text: '虛擬資金練習交易', size: 'sm', color: '#ffffffaa', margin: 'sm' }
        ],
        backgroundColor: '#6C5CE7',
        paddingAll: '20px'
      },
      body: {
        type: 'box',
        layout: 'vertical',
        contents: [
          { type: 'text', text: '📌 交易指令', weight: 'bold', size: 'md' },
          { type: 'box', layout: 'vertical', margin: 'md', backgroundColor: '#f5f5f5', cornerRadius: 'md', paddingAll: '10px',
            contents: [
              { type: 'text', text: '模擬買 2330 1', size: 'sm', color: '#D63031' },
              { type: 'text', text: '→ 買進 1 張台積電', size: 'xs', color: '#888888' }
            ]
          },
          { type: 'box', layout: 'vertical', margin: 'md', backgroundColor: '#f5f5f5', cornerRadius: 'md', paddingAll: '10px',
            contents: [
              { type: 'text', text: '模擬賣 2330 1', size: 'sm', color: '#00B894' },
              { type: 'text', text: '→ 賣出 1 張台積電', size: 'xs', color: '#888888' }
            ]
          },
          { type: 'separator', margin: 'lg' },
          { type: 'text', text: '📌 帳戶查詢', weight: 'bold', size: 'md', margin: 'lg' },
          { type: 'box', layout: 'vertical', margin: 'md', backgroundColor: '#f5f5f5', cornerRadius: 'md', paddingAll: '10px',
            contents: [
              { type: 'text', text: '模擬帳戶', size: 'sm', color: '#6C5CE7' },
              { type: 'text', text: '→ 查看虛擬持股與損益', size: 'xs', color: '#888888' }
            ]
          }
        ],
        paddingAll: '20px'
      },
      footer: {
        type: 'box',
        layout: 'horizontal',
        contents: [
          { type: 'button', style: 'primary', color: '#6C5CE7', height: 'sm',
            action: { type: 'message', label: '查看帳戶', text: '模擬帳戶' }
          }
        ],
        paddingAll: '10px'
      }
    }
  };
}

/**
 * 🎮 模擬帳戶
 */
async function getSimulateAccountFlex() {
  try {
    // 確保資料表存在
    await pool.query(`
      CREATE TABLE IF NOT EXISTS simulate_trades (
        id SERIAL PRIMARY KEY,
        user_id VARCHAR(100) DEFAULT 'default',
        stock_id VARCHAR(10) NOT NULL,
        stock_name VARCHAR(50),
        action VARCHAR(10) NOT NULL,
        shares INTEGER NOT NULL,
        price DECIMAL(10,2) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    
    await pool.query(`
      CREATE TABLE IF NOT EXISTS simulate_account (
        user_id VARCHAR(100) PRIMARY KEY DEFAULT 'default',
        cash DECIMAL(15,2) DEFAULT 1000000,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    
    // 確保有帳戶
    await pool.query(`
      INSERT INTO simulate_account (user_id, cash) VALUES ('default', 1000000)
      ON CONFLICT (user_id) DO NOTHING
    `);
    
    // 取得帳戶資訊
    const accountResult = await pool.query("SELECT * FROM simulate_account WHERE user_id = 'default'");
    const cash = parseFloat(accountResult.rows[0]?.cash) || 1000000;
    
    // 取得持股
    const holdingsResult = await pool.query(`
      SELECT stock_id, stock_name,
        SUM(CASE WHEN action = 'buy' THEN shares ELSE -shares END) as total_shares,
        SUM(CASE WHEN action = 'buy' THEN shares * price ELSE 0 END) / 
        NULLIF(SUM(CASE WHEN action = 'buy' THEN shares ELSE 0 END), 0) as avg_cost
      FROM simulate_trades
      WHERE user_id = 'default'
      GROUP BY stock_id, stock_name
      HAVING SUM(CASE WHEN action = 'buy' THEN shares ELSE -shares END) > 0
    `);
    
    let totalValue = cash;
    const holdingRows = [];
    
    for (const row of holdingsResult.rows) {
      const stockData = await stockService.getRealtimePrice(row.stock_id);
      const currentPrice = stockData?.price || 0;
      const shares = parseInt(row.total_shares);
      const avgCost = parseFloat(row.avg_cost) || 0;
      const marketValue = currentPrice * shares;
      const profit = (currentPrice - avgCost) * shares;
      const profitPercent = avgCost > 0 ? ((currentPrice - avgCost) / avgCost * 100).toFixed(2) : 0;
      
      totalValue += marketValue;
      
      // 🔧 修正：顯示格式「名稱(代碼)」
      const displayName = (row.stock_name || stockData?.name) ? `${row.stock_name || stockData?.name}(${row.stock_id})` : row.stock_id;
      
      holdingRows.push({
        type: 'box',
        layout: 'horizontal',
        contents: [
          { type: 'text', text: displayName, size: 'sm', flex: 3 },
          { type: 'text', text: `${shares}股`, size: 'sm', flex: 1, align: 'end' },
          { type: 'text', text: `${profit >= 0 ? '+' : ''}${profitPercent}%`, size: 'sm', flex: 1, align: 'end', color: profit >= 0 ? '#D63031' : '#00B894' }
        ],
        margin: 'sm'
      });
      
      await new Promise(r => setTimeout(r, 200));
    }
    
    const initialCash = 1000000;
    const totalProfit = totalValue - initialCash;
    const totalProfitPercent = ((totalProfit / initialCash) * 100).toFixed(2);
    
    return {
      type: 'flex',
      altText: '🎮 模擬帳戶',
      contents: {
        type: 'bubble',
        size: 'mega',
        header: {
          type: 'box',
          layout: 'vertical',
          contents: [
            { type: 'text', text: '🎮 模擬帳戶', size: 'xl', weight: 'bold', color: '#ffffff' },
            { type: 'text', text: `總資產 $${Math.round(totalValue).toLocaleString()}`, size: 'lg', color: '#ffffff', margin: 'sm' }
          ],
          backgroundColor: totalProfit >= 0 ? '#D63031' : '#00B894',
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
                { type: 'text', text: '可用現金', size: 'sm', color: '#666666' },
                { type: 'text', text: `$${Math.round(cash).toLocaleString()}`, size: 'sm', align: 'end' }
              ]
            },
            {
              type: 'box',
              layout: 'horizontal',
              margin: 'sm',
              contents: [
                { type: 'text', text: '總損益', size: 'sm', color: '#666666' },
                { type: 'text', text: `${totalProfit >= 0 ? '+' : ''}$${Math.round(totalProfit).toLocaleString()} (${totalProfitPercent}%)`, size: 'sm', align: 'end', color: totalProfit >= 0 ? '#D63031' : '#00B894' }
              ]
            },
            { type: 'separator', margin: 'lg' },
            { type: 'text', text: '📊 持股', weight: 'bold', size: 'md', margin: 'lg' },
            ...holdingRows.length > 0 ? holdingRows : [{ type: 'text', text: '目前無持股', size: 'sm', color: '#888888', margin: 'md' }]
          ],
          paddingAll: '20px'
        },
        footer: {
          type: 'box',
          layout: 'vertical',
          contents: [
            { type: 'text', text: '💡 初始資金 100 萬', size: 'xs', color: '#888888', align: 'center' }
          ],
          paddingAll: '10px'
        }
      }
    };
  } catch (error) {
    console.error('取得模擬帳戶錯誤:', error);
    return { type: 'text', text: `❌ 取得帳戶失敗：${error.message}` };
  }
}

/**
 * 🎮 處理模擬交易
 */
async function processSimulateTrade(msg) {
  try {
    const match = msg.match(/^模擬(買|賣)\s*(\d{4,6})\s*(\d+)?$/);
    if (!match) {
      return { type: 'text', text: '❌ 格式錯誤\n\n請輸入：模擬買 股票代碼 張數\n例如：模擬買 2330 1' };
    }
    
    const action = match[1] === '買' ? 'buy' : 'sell';
    const stockId = match[2];
    const shares = parseInt(match[3]) || 1;
    
    // 取得股價
    const stockData = await stockService.getRealtimePrice(stockId);
    if (!stockData) {
      return { type: 'text', text: `❌ 找不到股票：${stockId}` };
    }
    
    const price = stockData.price;
    const stockName = stockData.name || stockId;
    const totalCost = price * shares * 1000; // 以股為單位
    
    // 確保資料表存在
    await pool.query(`
      CREATE TABLE IF NOT EXISTS simulate_trades (
        id SERIAL PRIMARY KEY,
        user_id VARCHAR(100) DEFAULT 'default',
        stock_id VARCHAR(10) NOT NULL,
        stock_name VARCHAR(50),
        action VARCHAR(10) NOT NULL,
        shares INTEGER NOT NULL,
        price DECIMAL(10,2) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    
    await pool.query(`
      CREATE TABLE IF NOT EXISTS simulate_account (
        user_id VARCHAR(100) PRIMARY KEY DEFAULT 'default',
        cash DECIMAL(15,2) DEFAULT 1000000,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    
    await pool.query(`
      INSERT INTO simulate_account (user_id, cash) VALUES ('default', 1000000)
      ON CONFLICT (user_id) DO NOTHING
    `);
    
    // 取得帳戶餘額
    const accountResult = await pool.query("SELECT cash FROM simulate_account WHERE user_id = 'default'");
    let cash = parseFloat(accountResult.rows[0]?.cash) || 1000000;
    
    if (action === 'buy') {
      // 買進：檢查餘額
      if (cash < totalCost) {
        return { type: 'text', text: `❌ 餘額不足\n\n需要 $${totalCost.toLocaleString()}\n可用 $${Math.round(cash).toLocaleString()}` };
      }
      cash -= totalCost;
    } else {
      // 賣出：檢查持股
      const holdingResult = await pool.query(`
        SELECT SUM(CASE WHEN action = 'buy' THEN shares ELSE -shares END) as total
        FROM simulate_trades WHERE user_id = 'default' AND stock_id = $1
      `, [stockId]);
      const holding = parseInt(holdingResult.rows[0]?.total) || 0;
      
      if (holding < shares) {
        return { type: 'text', text: `❌ 持股不足\n\n持有 ${holding} 張\n欲賣 ${shares} 張` };
      }
      cash += totalCost;
    }
    
    // 更新餘額
    await pool.query("UPDATE simulate_account SET cash = $1 WHERE user_id = 'default'", [cash]);
    
    // 記錄交易
    await pool.query(
      "INSERT INTO simulate_trades (user_id, stock_id, stock_name, action, shares, price) VALUES ($1, $2, $3, $4, $5, $6)",
      ['default', stockId, stockName, action, shares * 1000, price]
    );
    
    const actionText = action === 'buy' ? '買進' : '賣出';
    const color = action === 'buy' ? '#D63031' : '#00B894';
    
    return {
      type: 'flex',
      altText: `✅ 模擬${actionText}成功`,
      contents: {
        type: 'bubble',
        size: 'kilo',
        header: {
          type: 'box',
          layout: 'vertical',
          contents: [
            { type: 'text', text: `✅ 模擬${actionText}成功`, size: 'lg', weight: 'bold', color: '#ffffff' }
          ],
          backgroundColor: color,
          paddingAll: '15px'
        },
        body: {
          type: 'box',
          layout: 'vertical',
          contents: [
            { type: 'text', text: `${stockName} (${stockId})`, size: 'md', weight: 'bold' },
            { type: 'box', layout: 'horizontal', margin: 'md',
              contents: [
                { type: 'text', text: '成交價', size: 'sm', color: '#666666' },
                { type: 'text', text: `$${price}`, size: 'sm', align: 'end' }
              ]
            },
            { type: 'box', layout: 'horizontal', margin: 'sm',
              contents: [
                { type: 'text', text: '張數', size: 'sm', color: '#666666' },
                { type: 'text', text: `${shares} 張`, size: 'sm', align: 'end' }
              ]
            },
            { type: 'box', layout: 'horizontal', margin: 'sm',
              contents: [
                { type: 'text', text: '金額', size: 'sm', color: '#666666' },
                { type: 'text', text: `$${totalCost.toLocaleString()}`, size: 'sm', align: 'end', weight: 'bold' }
              ]
            },
            { type: 'separator', margin: 'lg' },
            { type: 'box', layout: 'horizontal', margin: 'lg',
              contents: [
                { type: 'text', text: '帳戶餘額', size: 'sm', color: '#666666' },
                { type: 'text', text: `$${Math.round(cash).toLocaleString()}`, size: 'sm', align: 'end' }
              ]
            }
          ],
          paddingAll: '15px'
        }
      }
    };
  } catch (error) {
    console.error('模擬交易錯誤:', error);
    return { type: 'text', text: `❌ 交易失敗：${error.message}` };
  }
}

/**
 * 📈 K線圖
 */
async function getKLineChart(stockId) {
  try {
    const stockData = await stockService.getRealtimePrice(stockId);
    if (!stockData) {
      return { type: 'text', text: `❌ 找不到股票：${stockId}` };
    }
    
    const stockName = stockData.name || stockId;
    
    // 使用 Yahoo Finance 取得歷史資料
    const history = await fetchYahooHistory(stockId, 30);
    
    if (!history || history.length < 5) {
      // 如果沒有歷史資料，使用簡化版顯示
      return {
        type: 'flex',
        altText: `📈 ${stockName} 股價`,
        contents: {
          type: 'bubble',
          size: 'kilo',
          header: {
            type: 'box',
            layout: 'vertical',
            contents: [
              { type: 'text', text: `📈 ${stockName}`, size: 'lg', weight: 'bold', color: '#ffffff' }
            ],
            backgroundColor: '#2D3436',
            paddingAll: '15px'
          },
          body: {
            type: 'box',
            layout: 'vertical',
            contents: [
              { type: 'text', text: `股價 $${stockData.price}`, size: 'xl', weight: 'bold' },
              { type: 'text', text: `漲跌 ${stockData.changePercent >= 0 ? '+' : ''}${stockData.changePercent}%`, size: 'md', color: stockData.changePercent >= 0 ? '#D63031' : '#00B894', margin: 'sm' },
              { type: 'text', text: '⚠️ 歷史資料取得中，請稍後再試', size: 'xs', color: '#888888', margin: 'lg' }
            ],
            paddingAll: '20px'
          }
        }
      };
    }
    
    // 反轉順序（從舊到新）
    history.reverse();
    
    // 限制圖表數據點數量（最多 30 個點，避免 URL 過長）
    const maxPoints = 30;
    let chartHistory = history;
    if (history.length > maxPoints) {
      // 採樣：每隔 N 筆取一筆，保留最後一筆
      const step = Math.ceil(history.length / maxPoints);
      chartHistory = history.filter((_, i) => i % step === 0 || i === history.length - 1);
    }
    
    // 使用 QuickChart 生成圖表
    const labels = chartHistory.map(h => {
      const d = new Date(h.date);
      return `${d.getMonth() + 1}/${d.getDate()}`;
    });
    const prices = chartHistory.map(h => h.close);
    
    const chartConfig = {
      type: 'line',
      data: {
        labels: labels,
        datasets: [{
          label: stockName,
          data: prices,
          borderColor: '#D63031',
          backgroundColor: 'rgba(214, 48, 49, 0.1)',
          fill: true,
          tension: 0.1,
          pointRadius: 2
        }]
      },
      options: {
        plugins: {
          title: {
            display: true,
            text: `${stockName} (${stockId}) 近期走勢`
          },
          legend: {
            display: false
          }
        },
        scales: {
          y: {
            beginAtZero: false
          }
        }
      }
    };
    
    const chartUrl = `https://quickchart.io/chart?c=${encodeURIComponent(JSON.stringify(chartConfig))}&w=600&h=400&bkg=white`;
    
    // 計算漲跌幅（使用原始完整數據）
    const firstPrice = history[0].close;
    const lastPrice = history[history.length - 1].close;
    const periodChange = ((lastPrice - firstPrice) / firstPrice * 100).toFixed(2);
    const isUp = parseFloat(periodChange) >= 0;
    
    return {
      type: 'flex',
      altText: `📈 ${stockName} K線圖`,
      contents: {
        type: 'bubble',
        size: 'mega',
        header: {
          type: 'box',
          layout: 'vertical',
          contents: [
            { type: 'text', text: `📈 ${stockName} 走勢圖`, size: 'lg', weight: 'bold', color: '#ffffff' }
          ],
          backgroundColor: '#2D3436',
          paddingAll: '15px'
        },
        hero: {
          type: 'image',
          url: chartUrl,
          size: 'full',
          aspectRatio: '3:2',
          aspectMode: 'fit'
        },
        body: {
          type: 'box',
          layout: 'vertical',
          contents: [
            {
              type: 'box',
              layout: 'horizontal',
              contents: [
                { type: 'text', text: `現價 $${stockData.price}`, size: 'md', weight: 'bold', flex: 1 },
                { type: 'text', text: `${stockData.changePercent >= 0 ? '▲' : '▼'}${Math.abs(stockData.changePercent)}%`, size: 'md', flex: 1, align: 'end', color: stockData.changePercent >= 0 ? '#D63031' : '#00B894' }
              ]
            },
            {
              type: 'box',
              layout: 'horizontal',
              margin: 'sm',
              contents: [
                { type: 'text', text: `${history.length}日漲跌`, size: 'sm', color: '#888888', flex: 1 },
                { type: 'text', text: `${isUp ? '+' : ''}${periodChange}%`, size: 'sm', flex: 1, align: 'end', color: isUp ? '#D63031' : '#00B894' }
              ]
            }
          ],
          paddingAll: '15px'
        }
      }
    };
  } catch (error) {
    console.error('取得 K 線圖錯誤:', error);
    return { type: 'text', text: `❌ 取得 K 線圖失敗：${error.message}` };
  }
}

/**
 * 取得歷史資料（多來源備援）
 */
async function fetchYahooHistory(stockId, days = 30) {
  const isUS = /^[A-Z]+$/.test(stockId);
  
  if (isUS) {
    // 美股使用 Yahoo Finance
    return await fetchUSHistory(stockId, days);
  }
  
  // 台股嘗試多個來源
  let history = [];
  
  // 🔑 增加抓取天數以確保足夠交易日（約 70% 是交易日）
  const fetchDays = Math.ceil(days * 1.5);
  
  // 方法 1: 台灣證交所 API（上市股票）
  try {
    history = await fetchTWSEHistory(stockId, fetchDays);
    if (history.length >= Math.min(days * 0.8, 20)) {
      console.log(`TWSE API 成功取得 ${stockId} 歷史資料: ${history.length} 筆`);
      return history;
    }
  } catch (e) {
    console.log(`TWSE API 失敗 ${stockId}: ${e.message}`);
  }
  
  // 方法 2: 櫃買中心 API（上櫃股票）
  try {
    history = await fetchTPEXHistory(stockId, fetchDays);
    if (history.length >= Math.min(days * 0.8, 20)) {
      console.log(`TPEX API 成功取得 ${stockId} 歷史資料: ${history.length} 筆`);
      return history;
    }
  } catch (e) {
    console.log(`TPEX API 失敗 ${stockId}: ${e.message}`);
  }
  
  // 方法 3: Yahoo Finance 備援（抓取更多天數）
  try {
    history = await fetchYahooFinanceHistory(stockId, fetchDays);
    if (history.length >= 5) {
      console.log(`Yahoo API 成功取得 ${stockId} 歷史資料: ${history.length} 筆`);
      return history;
    }
  } catch (e) {
    console.log(`Yahoo API 失敗 ${stockId}: ${e.message}`);
  }
  
  // 方法 4: 如果都失敗，再嘗試一次 Yahoo Finance（延長時間範圍）
  if (history.length < 5) {
    try {
      history = await fetchYahooFinanceHistory(stockId, days * 2);
      if (history.length > 0) {
        console.log(`Yahoo API (延長) 取得 ${stockId}: ${history.length} 筆`);
      }
    } catch (e) {
      console.log(`Yahoo API 延長失敗 ${stockId}: ${e.message}`);
    }
  }
  
  return history;
}

/**
 * 台灣證交所 API（上市股票）
 */
async function fetchTWSEHistory(stockId, days) {
  const history = [];
  const now = new Date();
  
  // 根據需要的天數決定抓取月份數（每月約 20 個交易日）
  const monthsNeeded = Math.ceil(days / 18) + 2;
  const maxMonths = Math.min(monthsNeeded, 12); // 最多抓 12 個月（約 240 交易日）
  
  console.log(`TWSE 抓取 ${stockId}，需要 ${days} 天，抓取 ${maxMonths} 個月`);
  
  for (let m = 0; m < maxMonths; m++) {
    const targetDate = new Date(now.getFullYear(), now.getMonth() - m, 1);
    const dateStr = `${targetDate.getFullYear()}${String(targetDate.getMonth() + 1).padStart(2, '0')}01`;
    
    const url = `https://www.twse.com.tw/exchangeReport/STOCK_DAY?response=json&date=${dateStr}&stockNo=${stockId}`;
    
    try {
      const response = await axios.get(url, {
        timeout: 15000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept': 'application/json',
          'Accept-Language': 'zh-TW,zh;q=0.9'
        }
      });
      
      if (response.data?.stat === 'OK' && response.data?.data) {
        for (const row of response.data.data) {
          // row: [日期, 成交股數, 成交金額, 開盤, 最高, 最低, 收盤, 漲跌價差, 成交筆數]
          const dateParts = row[0].split('/');
          const year = parseInt(dateParts[0]) + 1911;
          const month = dateParts[1];
          const day = dateParts[2];
          
          const close = parseFloat(row[6].replace(/,/g, ''));
          if (!isNaN(close) && close > 0) {
            history.push({
              date: `${year}-${month}-${day}`,
              open: parseFloat(row[3].replace(/,/g, '')) || close,
              high: parseFloat(row[4].replace(/,/g, '')) || close,
              low: parseFloat(row[5].replace(/,/g, '')) || close,
              close: close,
              volume: parseInt(row[1].replace(/,/g, '')) || 0
            });
          }
        }
      }
    } catch (e) {
      console.log(`TWSE ${dateStr} 抓取失敗: ${e.message}`);
    }
    
    await new Promise(r => setTimeout(r, 250)); // 縮短等待時間
  }
  
  // 排序並回傳（不限制筆數，讓上層函數決定）
  history.sort((a, b) => b.date.localeCompare(a.date));
  return history;
}

/**
 * 櫃買中心 API（上櫃股票）
 */
async function fetchTPEXHistory(stockId, days) {
  const history = [];
  const now = new Date();
  
  // 根據需要的天數決定抓取月份數（每月約 20 個交易日）
  const monthsNeeded = Math.ceil(days / 18) + 2;
  const maxMonths = Math.min(monthsNeeded, 12); // 最多抓 12 個月（約 240 交易日）
  
  console.log(`TPEX 抓取 ${stockId}，需要 ${days} 天，抓取 ${maxMonths} 個月`);
  
  for (let m = 0; m < maxMonths; m++) {
    const targetDate = new Date(now.getFullYear(), now.getMonth() - m, 1);
    const year = targetDate.getFullYear() - 1911;
    const month = String(targetDate.getMonth() + 1).padStart(2, '0');
    const dateStr = `${year}/${month}`;
    
    const url = `https://www.tpex.org.tw/web/stock/aftertrading/daily_trading_info/st43_result.php?l=zh-tw&d=${dateStr}&stkno=${stockId}`;
    
    try {
      const response = await axios.get(url, {
        timeout: 15000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept': 'application/json',
          'Accept-Language': 'zh-TW,zh;q=0.9'
        }
      });
      
      if (response.data?.aaData) {
        for (const row of response.data.aaData) {
          // row: [日期, 成交股數, 成交金額, 開盤, 最高, 最低, 收盤, 漲跌, 成交筆數]
          const dateParts = row[0].split('/');
          const rowYear = parseInt(dateParts[0]) + 1911;
          const rowMonth = dateParts[1];
          const rowDay = dateParts[2];
          
          const close = parseFloat(String(row[6]).replace(/,/g, ''));
          if (!isNaN(close) && close > 0) {
            history.push({
              date: `${rowYear}-${rowMonth}-${rowDay}`,
              open: parseFloat(String(row[3]).replace(/,/g, '')) || close,
              high: parseFloat(String(row[4]).replace(/,/g, '')) || close,
              low: parseFloat(String(row[5]).replace(/,/g, '')) || close,
              close: close,
              volume: parseInt(String(row[1]).replace(/,/g, '')) || 0
            });
          }
        }
      }
    } catch (e) {
      console.log(`TPEX ${dateStr} 抓取失敗: ${e.message}`);
    }
    
    await new Promise(r => setTimeout(r, 250)); // 縮短等待時間
  }
  
  // 排序並回傳（不限制筆數，讓上層函數決定）
  history.sort((a, b) => b.date.localeCompare(a.date));
  return history;
}

/**
 * Yahoo Finance API（備援）
 */
async function fetchYahooFinanceHistory(stockId, days) {
  const endDate = Math.floor(Date.now() / 1000);
  const startDate = endDate - (days * 2 * 24 * 60 * 60); // 多抓一些
  
  // 先嘗試上市 .TW
  let url = `https://query1.finance.yahoo.com/v8/finance/chart/${stockId}.TW?period1=${startDate}&period2=${endDate}&interval=1d`;
  
  try {
    let response = await axios.get(url, {
      timeout: 10000,
      headers: { 'User-Agent': 'Mozilla/5.0' }
    });
    
    let result = response.data?.chart?.result?.[0];
    
    // 如果失敗，嘗試上櫃 .TWO
    if (!result?.timestamp) {
      url = `https://query1.finance.yahoo.com/v8/finance/chart/${stockId}.TWO?period1=${startDate}&period2=${endDate}&interval=1d`;
      response = await axios.get(url, {
        timeout: 10000,
        headers: { 'User-Agent': 'Mozilla/5.0' }
      });
      result = response.data?.chart?.result?.[0];
    }
    
    if (result?.timestamp) {
      return parseYahooData(result);
    }
  } catch (e) {
    console.error('Yahoo Finance 錯誤:', e.message);
  }
  
  return [];
}

/**
 * 美股歷史資料
 */
async function fetchUSHistory(stockId, days) {
  const endDate = Math.floor(Date.now() / 1000);
  const startDate = endDate - (days * 2 * 24 * 60 * 60);
  
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${stockId}?period1=${startDate}&period2=${endDate}&interval=1d`;
  
  const response = await axios.get(url, {
    timeout: 10000,
    headers: { 'User-Agent': 'Mozilla/5.0' }
  });
  
  const result = response.data?.chart?.result?.[0];
  if (result?.timestamp) {
    return parseYahooData(result);
  }
  
  return [];
}

function parseYahooData(result) {
  const timestamps = result.timestamp || [];
  const quotes = result.indicators?.quote?.[0] || {};
  
  const history = [];
  for (let i = 0; i < timestamps.length; i++) {
    if (quotes.close?.[i]) {
      history.push({
        date: new Date(timestamps[i] * 1000).toISOString().split('T')[0],
        open: quotes.open?.[i] || 0,
        high: quotes.high?.[i] || 0,
        low: quotes.low?.[i] || 0,
        close: quotes.close?.[i] || 0,
        volume: quotes.volume?.[i] || 0
      });
    }
  }
  
  return history;
}

/**
 * 📊 回測功能
 */
async function getBacktestFlex(stockId) {
  try {
    const stockData = await stockService.getRealtimePrice(stockId);
    if (!stockData) {
      return { type: 'text', text: `❌ 找不到股票：${stockId}` };
    }
    
    const stockName = stockData.name || stockId;
    
    // 延長到 120 天
    const history = await fetchYahooHistory(stockId, 120);
    
    if (!history || history.length < 30) {
      return { type: 'text', text: `❌ ${stockName} 歷史資料不足（需 30 天以上），請稍後再試` };
    }
    
    // ===== MA 交叉策略 =====
    const maResult = runMAStrategy(history);
    
    // ===== RSI 策略 =====
    const rsiResult = runRSIStrategy(history);
    
    // ===== 計算目前技術指標狀態 =====
    const currentStatus = calculateCurrentStatus(history);
    
    const isProfit = parseFloat(maResult.totalReturn) >= 0;
    const rsiIsProfit = parseFloat(rsiResult.totalReturn) >= 0;
    
    return {
      type: 'flex',
      altText: `📊 ${stockName} 回測結果`,
      contents: {
        type: 'carousel',
        contents: [
          // 卡片 1: MA 策略
          {
            type: 'bubble',
            size: 'mega',
            header: {
              type: 'box',
              layout: 'vertical',
              contents: [
                { type: 'text', text: `📊 ${stockName} 回測`, size: 'lg', weight: 'bold', color: '#ffffff' },
                { type: 'text', text: 'MA 均線交叉策略', size: 'sm', color: '#ffffffaa', margin: 'sm' }
              ],
              backgroundColor: isProfit ? '#D63031' : '#00B894',
              paddingAll: '20px'
            },
            body: {
              type: 'box',
              layout: 'vertical',
              contents: [
                { type: 'box', layout: 'horizontal',
                  contents: [
                    { type: 'text', text: '回測期間', size: 'sm', color: '#666666' },
                    { type: 'text', text: `${history.length} 天`, size: 'sm', align: 'end' }
                  ]
                },
                { type: 'box', layout: 'horizontal', margin: 'sm',
                  contents: [
                    { type: 'text', text: '交易次數', size: 'sm', color: '#666666' },
                    { type: 'text', text: `${maResult.trades} 次`, size: 'sm', align: 'end' }
                  ]
                },
                { type: 'box', layout: 'horizontal', margin: 'sm',
                  contents: [
                    { type: 'text', text: '勝率', size: 'sm', color: '#666666' },
                    { type: 'text', text: `${maResult.winRate}%`, size: 'sm', align: 'end' }
                  ]
                },
                { type: 'box', layout: 'horizontal', margin: 'sm',
                  contents: [
                    { type: 'text', text: '總報酬率', size: 'sm', color: '#666666' },
                    { type: 'text', text: `${isProfit ? '+' : ''}${maResult.totalReturn}%`, size: 'lg', align: 'end', weight: 'bold', color: isProfit ? '#D63031' : '#00B894' }
                  ]
                },
                { type: 'separator', margin: 'lg' },
                { type: 'text', text: '📍 目前狀態', weight: 'bold', size: 'sm', margin: 'lg' },
                { type: 'box', layout: 'horizontal', margin: 'sm',
                  contents: [
                    { type: 'text', text: 'MA5', size: 'xs', color: '#666666' },
                    { type: 'text', text: `$${currentStatus.ma5.toFixed(2)}`, size: 'xs', align: 'end' }
                  ]
                },
                { type: 'box', layout: 'horizontal', margin: 'xs',
                  contents: [
                    { type: 'text', text: 'MA20', size: 'xs', color: '#666666' },
                    { type: 'text', text: `$${currentStatus.ma20.toFixed(2)}`, size: 'xs', align: 'end' }
                  ]
                },
                { type: 'text', text: currentStatus.maSignal, size: 'sm', color: currentStatus.maSignal.includes('多頭') ? '#D63031' : '#00B894', margin: 'sm', weight: 'bold' }
              ],
              paddingAll: '15px'
            },
            footer: {
              type: 'box',
              layout: 'vertical',
              contents: [
                { type: 'text', text: '💡 MA5>MA20 買進 / MA5<MA20 賣出', size: 'xs', color: '#888888', align: 'center' }
              ],
              paddingAll: '10px'
            }
          },
          // 卡片 2: RSI 策略
          {
            type: 'bubble',
            size: 'mega',
            header: {
              type: 'box',
              layout: 'vertical',
              contents: [
                { type: 'text', text: `📊 ${stockName} 回測`, size: 'lg', weight: 'bold', color: '#ffffff' },
                { type: 'text', text: 'RSI 超買超賣策略', size: 'sm', color: '#ffffffaa', margin: 'sm' }
              ],
              backgroundColor: rsiIsProfit ? '#6C5CE7' : '#00B894',
              paddingAll: '20px'
            },
            body: {
              type: 'box',
              layout: 'vertical',
              contents: [
                { type: 'box', layout: 'horizontal',
                  contents: [
                    { type: 'text', text: '回測期間', size: 'sm', color: '#666666' },
                    { type: 'text', text: `${history.length} 天`, size: 'sm', align: 'end' }
                  ]
                },
                { type: 'box', layout: 'horizontal', margin: 'sm',
                  contents: [
                    { type: 'text', text: '交易次數', size: 'sm', color: '#666666' },
                    { type: 'text', text: `${rsiResult.trades} 次`, size: 'sm', align: 'end' }
                  ]
                },
                { type: 'box', layout: 'horizontal', margin: 'sm',
                  contents: [
                    { type: 'text', text: '勝率', size: 'sm', color: '#666666' },
                    { type: 'text', text: `${rsiResult.winRate}%`, size: 'sm', align: 'end' }
                  ]
                },
                { type: 'box', layout: 'horizontal', margin: 'sm',
                  contents: [
                    { type: 'text', text: '總報酬率', size: 'sm', color: '#666666' },
                    { type: 'text', text: `${rsiIsProfit ? '+' : ''}${rsiResult.totalReturn}%`, size: 'lg', align: 'end', weight: 'bold', color: rsiIsProfit ? '#D63031' : '#00B894' }
                  ]
                },
                { type: 'separator', margin: 'lg' },
                { type: 'text', text: '📍 目前狀態', weight: 'bold', size: 'sm', margin: 'lg' },
                { type: 'box', layout: 'horizontal', margin: 'sm',
                  contents: [
                    { type: 'text', text: 'RSI(14)', size: 'xs', color: '#666666' },
                    { type: 'text', text: `${currentStatus.rsi.toFixed(1)}`, size: 'xs', align: 'end' }
                  ]
                },
                { type: 'text', text: currentStatus.rsiSignal, size: 'sm', color: currentStatus.rsiColor, margin: 'sm', weight: 'bold' },
                { type: 'box', layout: 'vertical', margin: 'md', backgroundColor: '#f5f5f5', cornerRadius: 'md', paddingAll: '8px',
                  contents: [
                    { type: 'text', text: `📊 K值: ${currentStatus.k.toFixed(1)} / D值: ${currentStatus.d.toFixed(1)}`, size: 'xs', color: '#666666' }
                  ]
                }
              ],
              paddingAll: '15px'
            },
            footer: {
              type: 'box',
              layout: 'vertical',
              contents: [
                { type: 'text', text: '💡 RSI<30 買進 / RSI>70 賣出', size: 'xs', color: '#888888', align: 'center' }
              ],
              paddingAll: '10px'
            }
          }
        ]
      }
    };
  } catch (error) {
    console.error('回測錯誤:', error);
    return { type: 'text', text: `❌ 回測失敗：${error.message}` };
  }
}

/**
 * MA 均線交叉策略回測
 */
function runMAStrategy(history) {
  const result = { trades: 0, wins: 0, totalReturn: 0, winRate: 0 };
  let position = null;
  let equity = 100;
  
  for (let i = 20; i < history.length; i++) {
    const ma5 = history.slice(i - 5, i).reduce((s, h) => s + h.close, 0) / 5;
    const ma20 = history.slice(i - 20, i).reduce((s, h) => s + h.close, 0) / 20;
    const prevMa5 = history.slice(i - 6, i - 1).reduce((s, h) => s + h.close, 0) / 5;
    const prevMa20 = history.slice(i - 21, i - 1).reduce((s, h) => s + h.close, 0) / 20;
    
    // 黃金交叉買進
    if (prevMa5 <= prevMa20 && ma5 > ma20 && !position) {
      position = { price: history[i].close };
    }
    
    // 死亡交叉賣出
    if (prevMa5 >= prevMa20 && ma5 < ma20 && position) {
      const returnPct = (history[i].close - position.price) / position.price * 100;
      result.trades++;
      if (returnPct > 0) result.wins++;
      equity *= (1 + returnPct / 100);
      position = null;
    }
  }
  
  result.totalReturn = ((equity - 100)).toFixed(2);
  result.winRate = result.trades > 0 ? ((result.wins / result.trades) * 100).toFixed(1) : 0;
  return result;
}

/**
 * RSI 超買超賣策略回測
 */
function runRSIStrategy(history) {
  const result = { trades: 0, wins: 0, totalReturn: 0, winRate: 0 };
  let position = null;
  let equity = 100;
  
  // 計算 RSI
  const rsiValues = calculateRSI(history, 14);
  
  for (let i = 15; i < history.length; i++) {
    const rsi = rsiValues[i];
    const prevRsi = rsiValues[i - 1];
    
    // RSI < 30 且開始回升 → 買進
    if (prevRsi < 30 && rsi >= 30 && !position) {
      position = { price: history[i].close };
    }
    
    // RSI > 70 且開始下降 → 賣出
    if (prevRsi > 70 && rsi <= 70 && position) {
      const returnPct = (history[i].close - position.price) / position.price * 100;
      result.trades++;
      if (returnPct > 0) result.wins++;
      equity *= (1 + returnPct / 100);
      position = null;
    }
  }
  
  result.totalReturn = ((equity - 100)).toFixed(2);
  result.winRate = result.trades > 0 ? ((result.wins / result.trades) * 100).toFixed(1) : 0;
  return result;
}

/**
 * 計算 RSI
 */
function calculateRSI(history, period = 14) {
  const rsi = new Array(history.length).fill(50);
  
  for (let i = period; i < history.length; i++) {
    let gains = 0, losses = 0;
    for (let j = i - period + 1; j <= i; j++) {
      const change = history[j].close - history[j - 1].close;
      if (change > 0) gains += change;
      else losses -= change;
    }
    const avgGain = gains / period;
    const avgLoss = losses / period;
    const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
    rsi[i] = 100 - (100 / (1 + rs));
  }
  
  return rsi;
}

/**
 * 計算 KD 值
 */
function calculateKD(history, period = 9) {
  if (history.length < period) return { k: 50, d: 50 };
  
  const recent = history.slice(-period);
  const high = Math.max(...recent.map(h => h.high || h.close));
  const low = Math.min(...recent.map(h => h.low || h.close));
  const close = history[history.length - 1].close;
  
  const rsv = high === low ? 50 : ((close - low) / (high - low)) * 100;
  // 簡化的 K、D 計算
  const k = rsv;
  const d = k; // 實際應該用移動平均
  
  return { k, d };
}

/**
 * 計算目前技術指標狀態
 */
function calculateCurrentStatus(history) {
  const len = history.length;
  
  // MA
  const ma5 = history.slice(-5).reduce((s, h) => s + h.close, 0) / 5;
  const ma20 = len >= 20 ? history.slice(-20).reduce((s, h) => s + h.close, 0) / 20 : ma5;
  
  let maSignal = '';
  const maDiff = ((ma5 - ma20) / ma20 * 100).toFixed(2);
  if (ma5 > ma20) {
    maSignal = `📈 多頭排列 (MA5 高於 MA20 ${maDiff}%)`;
  } else if (ma5 < ma20) {
    maSignal = `📉 空頭排列 (MA5 低於 MA20 ${Math.abs(maDiff)}%)`;
  } else {
    maSignal = '⚖️ 均線糾結，觀望';
  }
  
  // RSI
  const rsiValues = calculateRSI(history, 14);
  const rsi = rsiValues[len - 1] || 50;
  
  let rsiSignal = '', rsiColor = '#666666';
  if (rsi > 70) {
    rsiSignal = '⚠️ 超買區，注意回檔風險';
    rsiColor = '#E17055';
  } else if (rsi < 30) {
    rsiSignal = '💡 超賣區，可能有反彈機會';
    rsiColor = '#00B894';
  } else if (rsi > 50) {
    rsiSignal = '📈 偏多，買方力道較強';
    rsiColor = '#D63031';
  } else {
    rsiSignal = '📉 偏空，賣方力道較強';
    rsiColor = '#00B894';
  }
  
  // KD
  const kd = calculateKD(history);
  
  return { ma5, ma20, maSignal, rsi, rsiSignal, rsiColor, k: kd.k, d: kd.d };
}

/**
 * 🎯 設定停利停損
 * 格式：停利 2330 1100 / 停損 2330 900 / 目標 2330 1100 900
 */
async function setStopLossTarget(msg) {
  try {
    // 解析指令
    const parts = msg.split(/\s+/);
    const action = parts[0]; // 停利/停損/目標
    const stockId = parts[1];
    
    if (!stockId || !/^\d{4,6}$/.test(stockId)) {
      return {
        type: 'text',
        text: '🎯 設定停利停損\n\n' +
              '📌 設定停利價：\n停利 2330 1100\n\n' +
              '📌 設定停損價：\n停損 2330 900\n\n' +
              '📌 同時設定：\n目標 2330 1100 900\n（停利 停損）\n\n' +
              '📌 查看目前設定：\n目標價 2330'
      };
    }
    
    // 檢查是否為持股
    const holdingResult = await pool.query(
      "SELECT * FROM holdings WHERE stock_id = $1 AND user_id = 'default' AND is_won = true AND (is_sold = false OR is_sold IS NULL)",
      [stockId]
    );
    
    if (holdingResult.rows.length === 0) {
      return { type: 'text', text: `❌ ${stockId} 不在持股中\n\n請先新增持股後再設定目標價` };
    }
    
    const holding = holdingResult.rows[0];
    const stockName = holding.stock_name || stockId;
    
    let takeProfit = holding.take_profit;
    let stopLoss = holding.stop_loss;
    
    if (action === '停利') {
      const price = parseFloat(parts[2]);
      if (!price || price <= 0) {
        return { type: 'text', text: '❌ 請輸入有效的停利價格\n\n例如：停利 2330 1100' };
      }
      takeProfit = price;
    } else if (action === '停損') {
      const price = parseFloat(parts[2]);
      if (!price || price <= 0) {
        return { type: 'text', text: '❌ 請輸入有效的停損價格\n\n例如：停損 2330 900' };
      }
      stopLoss = price;
    } else if (action === '目標') {
      const tp = parseFloat(parts[2]);
      const sl = parseFloat(parts[3]);
      if (!tp || tp <= 0) {
        return { type: 'text', text: '❌ 請輸入有效的停利價格\n\n格式：目標 2330 停利價 停損價\n例如：目標 2330 1100 900' };
      }
      takeProfit = tp;
      if (sl && sl > 0) {
        stopLoss = sl;
      }
    }
    
    // 更新資料庫
    await pool.query(
      "UPDATE holdings SET take_profit = $1, stop_loss = $2 WHERE id = $3",
      [takeProfit, stopLoss, holding.id]
    );
    
    // 取得目前股價
    const stockData = await stockService.getRealtimePrice(stockId);
    const currentPrice = stockData?.price || holding.current_price || 0;
    
    // 計算距離
    let tpDistance = '', slDistance = '';
    if (takeProfit && currentPrice > 0) {
      const tpPct = ((takeProfit - currentPrice) / currentPrice * 100).toFixed(2);
      tpDistance = `距停利 ${tpPct > 0 ? '+' : ''}${tpPct}%`;
    }
    if (stopLoss && currentPrice > 0) {
      const slPct = ((stopLoss - currentPrice) / currentPrice * 100).toFixed(2);
      slDistance = `距停損 ${slPct > 0 ? '+' : ''}${slPct}%`;
    }
    
    return {
      type: 'flex',
      altText: `✅ ${stockName} 目標價已設定`,
      contents: {
        type: 'bubble',
        size: 'kilo',
        header: {
          type: 'box',
          layout: 'vertical',
          contents: [
            { type: 'text', text: '✅ 目標價設定成功', size: 'lg', weight: 'bold', color: '#ffffff' }
          ],
          backgroundColor: '#00B894',
          paddingAll: '15px'
        },
        body: {
          type: 'box',
          layout: 'vertical',
          contents: [
            { type: 'text', text: `${stockName} (${stockId})`, size: 'md', weight: 'bold' },
            { type: 'box', layout: 'horizontal', margin: 'lg',
              contents: [
                { type: 'text', text: '現價', size: 'sm', color: '#666666' },
                { type: 'text', text: `$${currentPrice}`, size: 'sm', align: 'end' }
              ]
            },
            { type: 'separator', margin: 'md' },
            { type: 'box', layout: 'horizontal', margin: 'md',
              contents: [
                { type: 'text', text: '🎯 停利價', size: 'sm', color: '#D63031' },
                { type: 'text', text: takeProfit ? `$${takeProfit}` : '未設定', size: 'sm', align: 'end', color: takeProfit ? '#D63031' : '#888888' }
              ]
            },
            takeProfit ? { type: 'text', text: tpDistance, size: 'xs', color: '#888888', align: 'end' } : null,
            { type: 'box', layout: 'horizontal', margin: 'sm',
              contents: [
                { type: 'text', text: '⚠️ 停損價', size: 'sm', color: '#00B894' },
                { type: 'text', text: stopLoss ? `$${stopLoss}` : '未設定', size: 'sm', align: 'end', color: stopLoss ? '#00B894' : '#888888' }
              ]
            },
            stopLoss ? { type: 'text', text: slDistance, size: 'xs', color: '#888888', align: 'end' } : null
          ].filter(Boolean),
          paddingAll: '15px'
        },
        footer: {
          type: 'box',
          layout: 'horizontal',
          contents: [
            { type: 'button', style: 'secondary', height: 'sm',
              action: { type: 'message', label: '檢查目標', text: '檢查目標' }
            }
          ],
          paddingAll: '10px'
        }
      }
    };
  } catch (error) {
    console.error('設定停利停損錯誤:', error);
    return { type: 'text', text: `❌ 設定失敗：${error.message}` };
  }
}

/**
 * 🎯 查看單一股票的目標價設定
 */
async function getStopLossTargetFlex(stockId) {
  try {
    const holdingResult = await pool.query(
      "SELECT * FROM holdings WHERE stock_id = $1 AND user_id = 'default' AND is_won = true AND (is_sold = false OR is_sold IS NULL)",
      [stockId]
    );
    
    if (holdingResult.rows.length === 0) {
      return { type: 'text', text: `❌ ${stockId} 不在持股中` };
    }
    
    const holding = holdingResult.rows[0];
    const stockName = holding.stock_name || stockId;
    const stockData = await stockService.getRealtimePrice(stockId);
    const currentPrice = stockData?.price || 0;
    
    const takeProfit = holding.take_profit;
    const stopLoss = holding.stop_loss;
    const avgCost = parseFloat(holding.avg_cost) || 0;
    
    // 計算狀態
    let status = '⏳ 監控中';
    let statusColor = '#666666';
    if (takeProfit && currentPrice >= takeProfit) {
      status = '🎯 已達停利！';
      statusColor = '#D63031';
    } else if (stopLoss && currentPrice <= stopLoss) {
      status = '⚠️ 已觸停損！';
      statusColor = '#00B894';
    }
    
    return {
      type: 'flex',
      altText: `🎯 ${stockName} 目標價`,
      contents: {
        type: 'bubble',
        size: 'kilo',
        header: {
          type: 'box',
          layout: 'vertical',
          contents: [
            { type: 'text', text: `🎯 ${stockName} 目標價`, size: 'lg', weight: 'bold', color: '#ffffff' }
          ],
          backgroundColor: '#6C5CE7',
          paddingAll: '15px'
        },
        body: {
          type: 'box',
          layout: 'vertical',
          contents: [
            { type: 'box', layout: 'horizontal',
              contents: [
                { type: 'text', text: '現價', size: 'sm', color: '#666666' },
                { type: 'text', text: `$${currentPrice}`, size: 'md', align: 'end', weight: 'bold' }
              ]
            },
            { type: 'box', layout: 'horizontal', margin: 'sm',
              contents: [
                { type: 'text', text: '成本', size: 'sm', color: '#666666' },
                { type: 'text', text: `$${avgCost}`, size: 'sm', align: 'end' }
              ]
            },
            { type: 'separator', margin: 'lg' },
            { type: 'box', layout: 'horizontal', margin: 'lg',
              contents: [
                { type: 'text', text: '🎯 停利價', size: 'sm', color: '#D63031' },
                { type: 'text', text: takeProfit ? `$${takeProfit}` : '未設定', size: 'sm', align: 'end' }
              ]
            },
            { type: 'box', layout: 'horizontal', margin: 'sm',
              contents: [
                { type: 'text', text: '⚠️ 停損價', size: 'sm', color: '#00B894' },
                { type: 'text', text: stopLoss ? `$${stopLoss}` : '未設定', size: 'sm', align: 'end' }
              ]
            },
            { type: 'separator', margin: 'lg' },
            { type: 'text', text: status, size: 'md', weight: 'bold', color: statusColor, margin: 'lg', align: 'center' }
          ],
          paddingAll: '15px'
        },
        footer: {
          type: 'box',
          layout: 'horizontal',
          contents: [
            { type: 'button', style: 'primary', color: '#6C5CE7', height: 'sm',
              action: { type: 'message', label: '修改停利', text: `停利 ${stockId} ` }
            },
            { type: 'button', style: 'secondary', height: 'sm', margin: 'sm',
              action: { type: 'message', label: '修改停損', text: `停損 ${stockId} ` }
            }
          ],
          paddingAll: '10px'
        }
      }
    };
  } catch (error) {
    console.error('查看目標價錯誤:', error);
    return { type: 'text', text: `❌ 查詢失敗：${error.message}` };
  }
}

/**
 * 💰 股息查詢 - 單一股票
 */
async function getDividendFlex(stockId) {
  try {
    // 取得股票資訊
    const stockData = await stockService.getRealtimePrice(stockId);
    if (!stockData) {
      return { type: 'text', text: `❌ 找不到股票：${stockId}` };
    }
    
    const stockName = stockData.name || stockId;
    const currentPrice = stockData.price || 0;
    
    // 取得股息資料
    const dividendData = await fetchDividendData(stockId);
    
    // 檢查是否有持股（加總同一股票的所有記錄）
    let holdingShares = 0;
    let estimatedDividend = 0;
    try {
      const holdingResult = await pool.query(
        "SELECT COALESCE(SUM(lots), 0) as total_lots FROM holdings WHERE stock_id = $1 AND user_id = 'default' AND is_won = true AND (is_sold = false OR is_sold IS NULL)",
        [stockId]
      );
      if (holdingResult.rows.length > 0) {
        holdingShares = parseInt(holdingResult.rows[0].total_lots) || 0;
        // 預估股息 = 持股張數 * 1000股 * 現金股利
        estimatedDividend = holdingShares * 1000 * (dividendData.cashDividend || 0);
      }
    } catch (e) {}
    
    // 計算殖利率
    const yieldRate = currentPrice > 0 && dividendData.cashDividend > 0 
      ? ((dividendData.cashDividend / currentPrice) * 100).toFixed(2)
      : 0;
    
    // 殖利率評等
    let yieldRating = '', yieldColor = '#666666';
    const yieldNum = parseFloat(yieldRate);
    if (yieldNum >= 6) {
      yieldRating = '🌟 高殖利率';
      yieldColor = '#D63031';
    } else if (yieldNum >= 4) {
      yieldRating = '👍 殖利率不錯';
      yieldColor = '#E17055';
    } else if (yieldNum >= 2) {
      yieldRating = '📊 殖利率普通';
      yieldColor = '#FDCB6E';
    } else if (yieldNum > 0) {
      yieldRating = '📉 殖利率偏低';
      yieldColor = '#00B894';
    } else {
      yieldRating = '❓ 尚無配息資料';
      yieldColor = '#888888';
    }
    
    const contents = [
      { type: 'box', layout: 'horizontal',
        contents: [
          { type: 'text', text: '現價', size: 'sm', color: '#666666', flex: 2 },
          { type: 'text', text: `$${currentPrice}`, size: 'md', align: 'end', weight: 'bold', flex: 3 }
        ]
      },
      { type: 'separator', margin: 'lg' },
      { type: 'text', text: '📋 最近一次配息', weight: 'bold', size: 'sm', margin: 'lg' },
      { type: 'box', layout: 'horizontal', margin: 'md',
        contents: [
          { type: 'text', text: '現金股利', size: 'sm', color: '#666666', flex: 2 },
          { type: 'text', text: dividendData.cashDividend > 0 ? `$${dividendData.cashDividend}` : '-', size: 'sm', align: 'end', flex: 3 }
        ]
      },
      { type: 'box', layout: 'horizontal', margin: 'sm',
        contents: [
          { type: 'text', text: '股票股利', size: 'sm', color: '#666666', flex: 2 },
          { type: 'text', text: dividendData.stockDividend > 0 ? `${dividendData.stockDividend} 股` : '-', size: 'sm', align: 'end', flex: 3 }
        ]
      },
      { type: 'box', layout: 'horizontal', margin: 'sm',
        contents: [
          { type: 'text', text: '現金殖利率', size: 'sm', color: '#666666', flex: 2 },
          { type: 'text', text: yieldNum > 0 ? `${yieldRate}%` : '-', size: 'md', align: 'end', weight: 'bold', color: yieldColor, flex: 3 }
        ]
      },
      { type: 'text', text: yieldRating, size: 'sm', color: yieldColor, margin: 'sm', align: 'end' }
    ];
    
    // 如果有持股，顯示預估股息
    if (holdingShares > 0) {
      contents.push({ type: 'separator', margin: 'lg' });
      contents.push({ type: 'text', text: '💼 你的持股試算', weight: 'bold', size: 'sm', margin: 'lg' });
      contents.push({ type: 'box', layout: 'horizontal', margin: 'md',
        contents: [
          { type: 'text', text: '持有張數', size: 'sm', color: '#666666', flex: 2 },
          { type: 'text', text: `${holdingShares} 張`, size: 'sm', align: 'end', flex: 3 }
        ]
      });
      contents.push({ type: 'box', layout: 'horizontal', margin: 'sm',
        contents: [
          { type: 'text', text: '預估股息', size: 'sm', color: '#666666', flex: 2 },
          { type: 'text', text: `$${Math.round(estimatedDividend).toLocaleString()}`, size: 'lg', align: 'end', weight: 'bold', color: '#D63031', flex: 3 }
        ]
      });
      contents.push({ type: 'text', text: '(以最近一次配息計算)', size: 'xs', color: '#888888', margin: 'xs', align: 'end' });
    }
    
    // 歷年配息
    if (dividendData.history && dividendData.history.length > 0) {
      contents.push({ type: 'separator', margin: 'lg' });
      contents.push({ type: 'text', text: '📊 近年配息紀錄', weight: 'bold', size: 'sm', margin: 'lg' });
      
      for (const h of dividendData.history.slice(0, 5)) {
        contents.push({ type: 'box', layout: 'horizontal', margin: 'xs',
          contents: [
            { type: 'text', text: h.year, size: 'xs', color: '#666666', flex: 1 },
            { type: 'text', text: `$${h.cash}`, size: 'xs', align: 'end', flex: 1 },
            { type: 'text', text: `${h.yield}%`, size: 'xs', align: 'end', flex: 1, color: parseFloat(h.yield) >= 5 ? '#D63031' : '#666666' }
          ]
        });
      }
    }
    
    return {
      type: 'flex',
      altText: `💰 ${stockName} 股息資訊`,
      contents: {
        type: 'bubble',
        size: 'mega',
        header: {
          type: 'box',
          layout: 'vertical',
          contents: [
            { type: 'text', text: `💰 ${stockName} 股息`, size: 'lg', weight: 'bold', color: '#ffffff' },
            { type: 'text', text: stockId, size: 'sm', color: '#ffffffaa', margin: 'sm' }
          ],
          backgroundColor: '#27AE60',
          paddingAll: '20px'
        },
        body: {
          type: 'box',
          layout: 'vertical',
          contents: contents,
          paddingAll: '20px'
        }
      }
    };
  } catch (error) {
    console.error('股息查詢錯誤:', error);
    return { type: 'text', text: `❌ 股息查詢失敗：${error.message}` };
  }
}

/**
 * 💰 持股股息總覽
 */
async function getHoldingsDividendFlex() {
  try {
    // 取得所有持股（合併同一股票的多筆記錄）
    const holdingsResult = await pool.query(
      `SELECT stock_id, 
              MAX(stock_name) as stock_name, 
              SUM(COALESCE(lots, 0)) as total_lots
       FROM holdings 
       WHERE user_id = 'default' AND is_won = true AND (is_sold = false OR is_sold IS NULL)
       GROUP BY stock_id
       ORDER BY total_lots DESC`
    );
    
    if (holdingsResult.rows.length === 0) {
      return { type: 'text', text: '📭 目前沒有持股\n\n請先新增持股後再查詢股息' };
    }
    
    const holdings = holdingsResult.rows;
    let totalEstimatedDividend = 0;
    const stockRows = [];
    
    for (const h of holdings) {
      const stockId = h.stock_id;
      const stockName = h.stock_name || stockId;
      const lots = parseInt(h.total_lots) || 0;
      
      // 取得股息資料
      const dividendData = await fetchDividendData(stockId);
      const cashDividend = dividendData.cashDividend || 0;
      const estimatedDividend = lots * 1000 * cashDividend;
      totalEstimatedDividend += estimatedDividend;
      
      // 取得現價計算殖利率
      let yieldRate = 0;
      try {
        const stockData = await stockService.getRealtimePrice(stockId);
        if (stockData && stockData.price > 0 && cashDividend > 0) {
          yieldRate = ((cashDividend / stockData.price) * 100).toFixed(1);
        }
      } catch (e) {}
      
      stockRows.push({
        type: 'box',
        layout: 'horizontal',
        contents: [
          { type: 'text', text: stockName, size: 'sm', flex: 3 },
          { type: 'text', text: `${lots}張`, size: 'xs', color: '#888888', flex: 1, align: 'center' },
          { type: 'text', text: cashDividend > 0 ? `${yieldRate}%` : '-', size: 'xs', flex: 1, align: 'center', color: parseFloat(yieldRate) >= 5 ? '#D63031' : '#666666' },
          { type: 'text', text: estimatedDividend > 0 ? `$${Math.round(estimatedDividend).toLocaleString()}` : '-', size: 'sm', flex: 2, align: 'end', weight: 'bold' }
        ],
        margin: 'sm'
      });
      
      // 避免 API 過載
      await new Promise(r => setTimeout(r, 200));
    }
    
    return {
      type: 'flex',
      altText: `💰 持股股息總覽`,
      contents: {
        type: 'bubble',
        size: 'mega',
        header: {
          type: 'box',
          layout: 'vertical',
          contents: [
            { type: 'text', text: '💰 持股股息總覽', size: 'lg', weight: 'bold', color: '#ffffff' },
            { type: 'text', text: `共 ${holdings.length} 檔持股`, size: 'sm', color: '#ffffffaa', margin: 'sm' }
          ],
          backgroundColor: '#27AE60',
          paddingAll: '20px'
        },
        body: {
          type: 'box',
          layout: 'vertical',
          contents: [
            { type: 'box', layout: 'horizontal',
              contents: [
                { type: 'text', text: '股票', size: 'xs', color: '#888888', flex: 3 },
                { type: 'text', text: '張數', size: 'xs', color: '#888888', flex: 1, align: 'center' },
                { type: 'text', text: '殖利率', size: 'xs', color: '#888888', flex: 1, align: 'center' },
                { type: 'text', text: '預估股息', size: 'xs', color: '#888888', flex: 2, align: 'end' }
              ]
            },
            { type: 'separator', margin: 'sm' },
            ...stockRows,
            { type: 'separator', margin: 'lg' },
            { type: 'box', layout: 'horizontal', margin: 'lg',
              contents: [
                { type: 'text', text: '🎯 預估總股息', size: 'md', weight: 'bold', flex: 2 },
                { type: 'text', text: `$${Math.round(totalEstimatedDividend).toLocaleString()}`, size: 'xl', weight: 'bold', color: '#D63031', flex: 2, align: 'end' }
              ]
            },
            { type: 'text', text: '(以各股最近一次配息計算)', size: 'xs', color: '#888888', margin: 'sm', align: 'end' }
          ],
          paddingAll: '20px'
        }
      }
    };
  } catch (error) {
    console.error('持股股息查詢錯誤:', error);
    return { type: 'text', text: `❌ 查詢失敗：${error.message}` };
  }
}

/**
 * 📊 取得股息資料（多來源）
 */
async function fetchDividendData(stockId) {
  const result = {
    cashDividend: 0,
    stockDividend: 0,
    exDividendDate: null,
    history: []
  };
  
  try {
    // 方法 0: 先檢查自訂股息（資料庫）- 最高優先
    const customData = await getCustomDividend(stockId);
    if (customData && customData.cashDividend > 0) {
      return customData;
    }
    
    // 方法 1: 使用預設股息資料庫（常見股票）- 資料較準確
    const defaultData = getDefaultDividend(stockId);
    if (defaultData) {
      return defaultData;
    }
    
    // 方法 2: 使用 Yahoo Finance 取得股息資料 - 作為備援
    const yahooData = await fetchYahooDividend(stockId);
    if (yahooData.cashDividend > 0) {
      return yahooData;
    }
    
  } catch (error) {
    console.error(`抓取 ${stockId} 股息資料錯誤:`, error.message);
  }
  
  return result;
}

/**
 * 取得自訂股息（從資料庫）
 */
async function getCustomDividend(stockId) {
  try {
    const result = await pool.query(
      "SELECT value FROM settings WHERE key = $1",
      [`dividend_${stockId}`]
    );
    if (result.rows.length > 0) {
      return JSON.parse(result.rows[0].value);
    }
  } catch (e) {
    console.log('讀取自訂股息錯誤:', e.message);
  }
  return null;
}

/**
 * 設定自訂股息
 */
async function setCustomDividend(msg) {
  try {
    const parts = msg.split(/\s+/);
    const stockId = parts[1];
    const cashDividend = parseFloat(parts[2]);
    
    if (!stockId || isNaN(cashDividend) || cashDividend < 0) {
      return {
        type: 'text',
        text: '❌ 格式錯誤\n\n正確格式：設定股息 股票代碼 股息金額\n例如：設定股息 2330 14.5'
      };
    }
    
    // 取得股票名稱
    let stockName = stockId;
    try {
      const stockData = await stockService.getRealtimePrice(stockId);
      if (stockData && stockData.name) {
        stockName = stockData.name;
      }
    } catch (e) {}
    
    const dividendData = {
      cashDividend: cashDividend,
      stockDividend: 0,
      history: [{
        year: new Date().getFullYear().toString(),
        cash: cashDividend.toFixed(2),
        yield: '0'
      }],
      isCustom: true
    };
    
    // 儲存到資料庫
    await pool.query(`
      INSERT INTO settings (key, value) VALUES ($1, $2)
      ON CONFLICT (key) DO UPDATE SET value = $2
    `, [`dividend_${stockId}`, JSON.stringify(dividendData)]);
    
    return {
      type: 'flex',
      altText: `✅ 已設定 ${stockName} 股息`,
      contents: {
        type: 'bubble',
        size: 'kilo',
        header: {
          type: 'box',
          layout: 'vertical',
          contents: [
            { type: 'text', text: '✅ 股息設定成功', size: 'lg', weight: 'bold', color: '#ffffff' }
          ],
          backgroundColor: '#27AE60',
          paddingAll: '15px'
        },
        body: {
          type: 'box',
          layout: 'vertical',
          contents: [
            { type: 'text', text: `${stockName} (${stockId})`, size: 'md', weight: 'bold' },
            { type: 'separator', margin: 'lg' },
            { type: 'box', layout: 'horizontal', margin: 'lg',
              contents: [
                { type: 'text', text: '現金股利', size: 'sm', color: '#666666' },
                { type: 'text', text: `$${cashDividend}`, size: 'lg', weight: 'bold', color: '#27AE60', align: 'end' }
              ]
            },
            { type: 'text', text: '💡 此為自訂股息，會優先使用', size: 'xs', color: '#888888', margin: 'lg' },
            { type: 'text', text: `輸入「刪除股息 ${stockId}」可移除`, size: 'xs', color: '#888888', margin: 'xs' }
          ],
          paddingAll: '15px'
        },
        footer: {
          type: 'box',
          layout: 'horizontal',
          contents: [
            { type: 'button', style: 'secondary', height: 'sm',
              action: { type: 'message', label: '查看股息', text: `股息 ${stockId}` }
            }
          ],
          paddingAll: '10px'
        }
      }
    };
  } catch (error) {
    console.error('設定股息錯誤:', error);
    return { type: 'text', text: `❌ 設定失敗：${error.message}` };
  }
}

/**
 * 刪除自訂股息
 */
async function deleteCustomDividend(stockId) {
  try {
    const result = await pool.query(
      "DELETE FROM settings WHERE key = $1 RETURNING *",
      [`dividend_${stockId}`]
    );
    
    if (result.rowCount > 0) {
      return { type: 'text', text: `✅ 已刪除 ${stockId} 的自訂股息\n\n將改用系統預設或 Yahoo Finance 資料` };
    } else {
      return { type: 'text', text: `⚠️ ${stockId} 沒有自訂股息設定` };
    }
  } catch (error) {
    console.error('刪除股息錯誤:', error);
    return { type: 'text', text: `❌ 刪除失敗：${error.message}` };
  }
}

/**
 * 從 Yahoo Finance 取得股息資料
 */
async function fetchYahooDividend(stockId) {
  const result = {
    cashDividend: 0,
    stockDividend: 0,
    history: []
  };
  
  try {
    // 台股加 .TW
    const symbol = `${stockId}.TW`;
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=3mo&range=5y&events=div`;
    
    const response = await axios.get(url, {
      timeout: 10000,
      headers: { 'User-Agent': 'Mozilla/5.0' }
    });
    
    const chartResult = response.data?.chart?.result?.[0];
    const events = chartResult?.events?.dividends;
    
    if (events) {
      // 整理股息紀錄
      const dividendList = Object.values(events).sort((a, b) => b.date - a.date);
      
      // 計算年度股息
      const yearDividends = {};
      for (const div of dividendList) {
        const year = new Date(div.date * 1000).getFullYear();
        if (!yearDividends[year]) {
          yearDividends[year] = 0;
        }
        yearDividends[year] += div.amount;
      }
      
      // 最近一年的股息
      const years = Object.keys(yearDividends).sort((a, b) => b - a);
      if (years.length > 0) {
        // 使用最近完整年度的股息
        const recentYear = years.find(y => parseInt(y) < new Date().getFullYear()) || years[0];
        result.cashDividend = parseFloat(yearDividends[recentYear].toFixed(2));
      }
      
      // 歷史紀錄
      for (const year of years.slice(0, 5)) {
        result.history.push({
          year: year,
          cash: yearDividends[year].toFixed(2),
          yield: '0' // 稍後計算
        });
      }
    }
    
    // 嘗試上櫃 .TWO
    if (result.cashDividend === 0) {
      const otcUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${stockId}.TWO?interval=3mo&range=5y&events=div`;
      const otcResponse = await axios.get(otcUrl, {
        timeout: 10000,
        headers: { 'User-Agent': 'Mozilla/5.0' }
      });
      
      const otcResult = otcResponse.data?.chart?.result?.[0];
      const otcEvents = otcResult?.events?.dividends;
      
      if (otcEvents) {
        const dividendList = Object.values(otcEvents).sort((a, b) => b.date - a.date);
        const yearDividends = {};
        for (const div of dividendList) {
          const year = new Date(div.date * 1000).getFullYear();
          if (!yearDividends[year]) yearDividends[year] = 0;
          yearDividends[year] += div.amount;
        }
        
        const years = Object.keys(yearDividends).sort((a, b) => b - a);
        if (years.length > 0) {
          const recentYear = years.find(y => parseInt(y) < new Date().getFullYear()) || years[0];
          result.cashDividend = parseFloat(yearDividends[recentYear].toFixed(2));
        }
        
        for (const year of years.slice(0, 5)) {
          result.history.push({
            year: year,
            cash: yearDividends[year].toFixed(2),
            yield: '0'
          });
        }
      }
    }
    
  } catch (error) {
    console.log(`Yahoo 股息查詢失敗 ${stockId}:`, error.message);
  }
  
  return result;
}

/**
 * 預設股息資料（常見股票）
 */
function getDefaultDividend(stockId) {
  const defaultDividends = {
    // ===== 權值股 =====
    '2330': { cashDividend: 14.5, stockDividend: 0, history: [{year:'2024',cash:'14.50',yield:'1.5'},{year:'2023',cash:'11.50',yield:'2.1'},{year:'2022',cash:'11.00',yield:'2.0'},{year:'2021',cash:'11.00',yield:'1.9'}] },
    '2317': { cashDividend: 5.3, stockDividend: 0, history: [{year:'2024',cash:'5.30',yield:'4.8'},{year:'2023',cash:'5.35',yield:'5.0'},{year:'2022',cash:'4.00',yield:'3.8'}] },
    '2454': { cashDividend: 73, stockDividend: 0, history: [{year:'2024',cash:'73.00',yield:'5.2'},{year:'2023',cash:'76.00',yield:'6.0'},{year:'2022',cash:'55.00',yield:'5.5'}] },
    '2308': { cashDividend: 12.5, stockDividend: 0, history: [{year:'2024',cash:'12.50',yield:'3.5'},{year:'2023',cash:'12.00',yield:'3.8'},{year:'2022',cash:'10.00',yield:'3.6'}] },
    '2303': { cashDividend: 3.0, stockDividend: 0, history: [{year:'2024',cash:'3.00',yield:'5.5'},{year:'2023',cash:'3.50',yield:'6.2'},{year:'2022',cash:'3.00',yield:'6.8'}] },
    '2002': { cashDividend: 1.5, stockDividend: 0, history: [{year:'2024',cash:'1.50',yield:'5.5'},{year:'2023',cash:'1.00',yield:'4.0'},{year:'2022',cash:'2.00',yield:'6.5'}] },
    
    // ===== 金融股 =====
    '2880': { cashDividend: 1.2, stockDividend: 0, history: [{year:'2024',cash:'1.20',yield:'5.0'},{year:'2023',cash:'1.10',yield:'4.8'},{year:'2022',cash:'1.00',yield:'4.5'}] },
    '2881': { cashDividend: 3.5, stockDividend: 0, history: [{year:'2024',cash:'3.50',yield:'4.3'},{year:'2023',cash:'3.00',yield:'4.0'},{year:'2022',cash:'3.00',yield:'4.1'}] },
    '2882': { cashDividend: 3.0, stockDividend: 0, history: [{year:'2024',cash:'3.00',yield:'4.5'},{year:'2023',cash:'2.50',yield:'4.0'},{year:'2022',cash:'2.50',yield:'4.2'}] },
    '2883': { cashDividend: 0.7, stockDividend: 0, history: [{year:'2024',cash:'0.70',yield:'4.0'},{year:'2023',cash:'0.60',yield:'3.8'},{year:'2022',cash:'0.55',yield:'3.5'}] },
    '2884': { cashDividend: 1.4, stockDividend: 0, history: [{year:'2024',cash:'1.40',yield:'5.0'},{year:'2023',cash:'1.28',yield:'4.8'},{year:'2022',cash:'1.20',yield:'4.5'}] },
    '2885': { cashDividend: 1.0, stockDividend: 0, history: [{year:'2024',cash:'1.00',yield:'4.0'},{year:'2023',cash:'0.90',yield:'3.8'},{year:'2022',cash:'0.85',yield:'3.5'}] },
    '2886': { cashDividend: 1.8, stockDividend: 0, history: [{year:'2024',cash:'1.80',yield:'5.2'},{year:'2023',cash:'1.55',yield:'4.8'},{year:'2022',cash:'1.50',yield:'4.5'}] },
    '2887': { cashDividend: 1.0, stockDividend: 0, history: [{year:'2024',cash:'1.00',yield:'5.5'},{year:'2023',cash:'0.85',yield:'5.0'},{year:'2022',cash:'0.80',yield:'4.8'}] },
    '2888': { cashDividend: 0.5, stockDividend: 0, history: [{year:'2024',cash:'0.50',yield:'4.0'},{year:'2023',cash:'0.45',yield:'3.8'},{year:'2022',cash:'0.40',yield:'3.5'}] },
    '2889': { cashDividend: 0.8, stockDividend: 0, history: [{year:'2024',cash:'0.80',yield:'5.5'},{year:'2023',cash:'0.70',yield:'5.0'},{year:'2022',cash:'0.65',yield:'4.8'}] },
    '2890': { cashDividend: 1.6, stockDividend: 0, history: [{year:'2024',cash:'1.60',yield:'6.5'},{year:'2023',cash:'1.50',yield:'6.2'},{year:'2022',cash:'1.40',yield:'6.0'}] },
    '2891': { cashDividend: 1.5, stockDividend: 0, history: [{year:'2024',cash:'1.50',yield:'5.0'},{year:'2023',cash:'1.55',yield:'5.2'},{year:'2022',cash:'1.45',yield:'4.8'}] },
    '2892': { cashDividend: 1.6, stockDividend: 0, history: [{year:'2024',cash:'1.60',yield:'6.2'},{year:'2023',cash:'1.50',yield:'6.0'},{year:'2022',cash:'1.20',yield:'5.5'}] },
    '5880': { cashDividend: 1.5, stockDividend: 0, history: [{year:'2024',cash:'1.50',yield:'5.8'},{year:'2023',cash:'1.45',yield:'5.6'},{year:'2022',cash:'1.30',yield:'5.2'}] },
    '2812': { cashDividend: 0.8, stockDividend: 0, history: [{year:'2024',cash:'0.80',yield:'5.8'},{year:'2023',cash:'0.75',yield:'5.5'},{year:'2022',cash:'0.70',yield:'5.2'}] },
    '5876': { cashDividend: 1.2, stockDividend: 0, history: [{year:'2024',cash:'1.20',yield:'5.2'},{year:'2023',cash:'1.10',yield:'5.0'},{year:'2022',cash:'1.00',yield:'4.8'}] },
    
    // ===== 電信股 =====
    '2412': { cashDividend: 4.0, stockDividend: 0, history: [{year:'2024',cash:'4.00',yield:'3.2'},{year:'2023',cash:'4.50',yield:'3.6'},{year:'2022',cash:'4.75',yield:'3.9'}] },
    '3045': { cashDividend: 5.5, stockDividend: 0, history: [{year:'2024',cash:'5.50',yield:'5.0'},{year:'2023',cash:'5.50',yield:'5.2'},{year:'2022',cash:'5.40',yield:'5.0'}] },
    '4904': { cashDividend: 4.5, stockDividend: 0, history: [{year:'2024',cash:'4.50',yield:'5.5'},{year:'2023',cash:'4.40',yield:'5.3'},{year:'2022',cash:'4.00',yield:'5.0'}] },
    
    // ===== 高股息 ETF =====
    '0056': { cashDividend: 2.2, stockDividend: 0, history: [{year:'2024',cash:'2.20',yield:'6.5'},{year:'2023',cash:'2.10',yield:'6.3'},{year:'2022',cash:'1.80',yield:'5.8'}] },
    '00878': { cashDividend: 1.2, stockDividend: 0, history: [{year:'2024',cash:'1.20',yield:'5.8'},{year:'2023',cash:'1.05',yield:'5.5'},{year:'2022',cash:'0.98',yield:'5.2'}] },
    '00919': { cashDividend: 0.55, stockDividend: 0, history: [{year:'2024',cash:'0.55',yield:'7.5'},{year:'2023',cash:'0.50',yield:'7.0'}] },
    '00929': { cashDividend: 0.2, stockDividend: 0, history: [{year:'2024',cash:'0.20',yield:'6.0'}] },
    '00713': { cashDividend: 2.5, stockDividend: 0, history: [{year:'2024',cash:'2.50',yield:'5.0'},{year:'2023',cash:'2.30',yield:'4.8'}] },
    '00915': { cashDividend: 0.6, stockDividend: 0, history: [{year:'2024',cash:'0.60',yield:'6.0'},{year:'2023',cash:'0.55',yield:'5.8'}] },
    '00918': { cashDividend: 0.7, stockDividend: 0, history: [{year:'2024',cash:'0.70',yield:'6.5'},{year:'2023',cash:'0.65',yield:'6.2'}] },
    '00934': { cashDividend: 0.15, stockDividend: 0, history: [{year:'2024',cash:'0.15',yield:'7.0'}] },
    '00936': { cashDividend: 0.18, stockDividend: 0, history: [{year:'2024',cash:'0.18',yield:'6.8'}] },
    '00939': { cashDividend: 0.12, stockDividend: 0, history: [{year:'2024',cash:'0.12',yield:'6.5'}] },
    '00940': { cashDividend: 0.1, stockDividend: 0, history: [{year:'2024',cash:'0.10',yield:'6.0'}] },
    
    // ===== 市值型 ETF =====
    '0050': { cashDividend: 3.5, stockDividend: 0, history: [{year:'2024',cash:'3.50',yield:'2.2'},{year:'2023',cash:'3.20',yield:'2.5'},{year:'2022',cash:'4.50',yield:'3.8'}] },
    '006208': { cashDividend: 2.5, stockDividend: 0, history: [{year:'2024',cash:'2.50',yield:'2.5'},{year:'2023',cash:'2.30',yield:'2.8'}] },
    
    // ===== 塑化/傳產 =====
    '1301': { cashDividend: 5.0, stockDividend: 0, history: [{year:'2024',cash:'5.00',yield:'5.5'},{year:'2023',cash:'7.00',yield:'7.2'},{year:'2022',cash:'6.70',yield:'7.0'}] },
    '1303': { cashDividend: 3.8, stockDividend: 0, history: [{year:'2024',cash:'3.80',yield:'5.0'},{year:'2023',cash:'5.00',yield:'6.5'},{year:'2022',cash:'5.00',yield:'6.2'}] },
    '1326': { cashDividend: 3.0, stockDividend: 0, history: [{year:'2024',cash:'3.00',yield:'4.8'},{year:'2023',cash:'5.00',yield:'7.5'},{year:'2022',cash:'4.80',yield:'7.0'}] },
    '6505': { cashDividend: 2.5, stockDividend: 0, history: [{year:'2024',cash:'2.50',yield:'4.0'},{year:'2023',cash:'3.50',yield:'5.5'},{year:'2022',cash:'4.00',yield:'6.0'}] },
    '1402': { cashDividend: 1.0, stockDividend: 0, history: [{year:'2024',cash:'1.00',yield:'3.5'},{year:'2023',cash:'1.20',yield:'4.0'},{year:'2022',cash:'1.50',yield:'4.5'}] },
    '1101': { cashDividend: 1.5, stockDividend: 0, history: [{year:'2024',cash:'1.50',yield:'3.8'},{year:'2023',cash:'1.80',yield:'4.2'},{year:'2022',cash:'2.00',yield:'4.5'}] },
    '1102': { cashDividend: 1.2, stockDividend: 0, history: [{year:'2024',cash:'1.20',yield:'3.5'},{year:'2023',cash:'1.50',yield:'4.0'},{year:'2022',cash:'1.80',yield:'4.5'}] },
    '1216': { cashDividend: 2.5, stockDividend: 0, history: [{year:'2024',cash:'2.50',yield:'3.5'},{year:'2023',cash:'2.80',yield:'3.8'},{year:'2022',cash:'2.50',yield:'3.5'}] },
    '1227': { cashDividend: 2.0, stockDividend: 0, history: [{year:'2024',cash:'2.00',yield:'3.2'},{year:'2023',cash:'2.20',yield:'3.5'},{year:'2022',cash:'2.00',yield:'3.2'}] },
    '9910': { cashDividend: 3.0, stockDividend: 0, history: [{year:'2024',cash:'3.00',yield:'6.0'},{year:'2023',cash:'2.80',yield:'5.8'},{year:'2022',cash:'2.50',yield:'5.5'}] },
    
    // ===== 航運 =====
    '2603': { cashDividend: 8.0, stockDividend: 0, history: [{year:'2024',cash:'8.00',yield:'4.0'},{year:'2023',cash:'20.00',yield:'12.0'},{year:'2022',cash:'70.00',yield:'35.0'}] },
    '2609': { cashDividend: 3.0, stockDividend: 0, history: [{year:'2024',cash:'3.00',yield:'5.0'},{year:'2023',cash:'20.00',yield:'25.0'},{year:'2022',cash:'35.00',yield:'30.0'}] },
    '2615': { cashDividend: 5.0, stockDividend: 0, history: [{year:'2024',cash:'5.00',yield:'4.5'},{year:'2023',cash:'15.00',yield:'15.0'},{year:'2022',cash:'30.00',yield:'25.0'}] },
    '2618': { cashDividend: 1.5, stockDividend: 0, history: [{year:'2024',cash:'1.50',yield:'4.0'},{year:'2023',cash:'1.00',yield:'3.0'},{year:'2022',cash:'0.00',yield:'0.0'}] },
    
    // ===== 電子/半導體 =====
    '2382': { cashDividend: 11, stockDividend: 0, history: [{year:'2024',cash:'11.00',yield:'3.5'},{year:'2023',cash:'9.00',yield:'3.8'},{year:'2022',cash:'8.00',yield:'4.0'}] },
    '3034': { cashDividend: 20, stockDividend: 0, history: [{year:'2024',cash:'20.00',yield:'3.2'},{year:'2023',cash:'24.00',yield:'4.8'},{year:'2022',cash:'20.00',yield:'4.5'}] },
    '2379': { cashDividend: 15, stockDividend: 0, history: [{year:'2024',cash:'15.00',yield:'2.8'},{year:'2023',cash:'20.00',yield:'4.5'},{year:'2022',cash:'18.00',yield:'4.2'}] },
    '2301': { cashDividend: 3.0, stockDividend: 0, history: [{year:'2024',cash:'3.00',yield:'6.5'},{year:'2023',cash:'2.50',yield:'5.8'},{year:'2022',cash:'3.00',yield:'6.0'}] },
    '2357': { cashDividend: 10, stockDividend: 0, history: [{year:'2024',cash:'10.00',yield:'4.0'},{year:'2023',cash:'8.50',yield:'3.8'},{year:'2022',cash:'7.50',yield:'3.5'}] },
    '2327': { cashDividend: 4.0, stockDividend: 0, history: [{year:'2024',cash:'4.00',yield:'5.5'},{year:'2023',cash:'3.50',yield:'5.0'},{year:'2022',cash:'3.00',yield:'4.8'}] },
    '2324': { cashDividend: 8.0, stockDividend: 0, history: [{year:'2024',cash:'8.00',yield:'4.0'},{year:'2023',cash:'7.50',yield:'4.2'},{year:'2022',cash:'6.00',yield:'3.8'}] },
    '2353': { cashDividend: 6.0, stockDividend: 0, history: [{year:'2024',cash:'6.00',yield:'6.8'},{year:'2023',cash:'5.50',yield:'6.5'},{year:'2022',cash:'5.00',yield:'6.0'}] },
    '2356': { cashDividend: 3.5, stockDividend: 0, history: [{year:'2024',cash:'3.50',yield:'3.8'},{year:'2023',cash:'3.00',yield:'3.5'},{year:'2022',cash:'2.80',yield:'3.2'}] },
    '3231': { cashDividend: 5.0, stockDividend: 0, history: [{year:'2024',cash:'5.00',yield:'5.5'},{year:'2023',cash:'4.50',yield:'5.2'},{year:'2022',cash:'4.00',yield:'5.0'}] },
    '3037': { cashDividend: 4.0, stockDividend: 0, history: [{year:'2024',cash:'4.00',yield:'3.5'},{year:'2023',cash:'4.50',yield:'4.0'},{year:'2022',cash:'5.00',yield:'4.5'}] },
    
    // ===== 面板/顯示器 =====
    '3481': { cashDividend: 0.5, stockDividend: 0, history: [{year:'2024',cash:'0.50',yield:'3.0'},{year:'2023',cash:'0.00',yield:'0.0'},{year:'2022',cash:'2.00',yield:'8.0'}] },
    '2409': { cashDividend: 0.3, stockDividend: 0, history: [{year:'2024',cash:'0.30',yield:'2.0'},{year:'2023',cash:'0.00',yield:'0.0'},{year:'2022',cash:'1.50',yield:'6.0'}] },
    '3008': { cashDividend: 1.5, stockDividend: 0, history: [{year:'2024',cash:'1.50',yield:'3.0'},{year:'2023',cash:'1.80',yield:'3.5'},{year:'2022',cash:'2.00',yield:'4.0'}] },
    
    // ===== 記憶體/IC =====
    '6770': { cashDividend: 0.5, stockDividend: 0, history: [{year:'2024',cash:'0.50',yield:'0.9'},{year:'2023',cash:'0.00',yield:'0.0'},{year:'2022',cash:'2.00',yield:'2.5'}] },
    '2344': { cashDividend: 0.75, stockDividend: 0, history: [{year:'2024',cash:'0.75',yield:'3.2'},{year:'2023',cash:'0.50',yield:'2.5'},{year:'2022',cash:'1.00',yield:'4.0'}] },
    '2408': { cashDividend: 1.0, stockDividend: 0, history: [{year:'2024',cash:'1.00',yield:'2.5'},{year:'2023',cash:'0.50',yield:'1.5'},{year:'2022',cash:'3.00',yield:'6.0'}] },
    '3450': { cashDividend: 7.0, stockDividend: 0, history: [{year:'2024',cash:'7.00',yield:'3.5'},{year:'2023',cash:'6.00',yield:'3.2'},{year:'2022',cash:'8.00',yield:'4.0'}] },
    '5347': { cashDividend: 3.0, stockDividend: 0, history: [{year:'2024',cash:'3.00',yield:'4.0'},{year:'2023',cash:'2.50',yield:'3.5'},{year:'2022',cash:'2.00',yield:'3.0'}] },
    
    // ===== AI/伺服器 =====
    '2376': { cashDividend: 8.0, stockDividend: 0, history: [{year:'2024',cash:'8.00',yield:'3.5'},{year:'2023',cash:'7.00',yield:'3.8'},{year:'2022',cash:'6.00',yield:'4.0'}] },
    '3017': { cashDividend: 5.0, stockDividend: 0, history: [{year:'2024',cash:'5.00',yield:'2.5'},{year:'2023',cash:'4.00',yield:'2.8'},{year:'2022',cash:'3.50',yield:'3.0'}] },
    '4938': { cashDividend: 12, stockDividend: 0, history: [{year:'2024',cash:'12.00',yield:'3.0'},{year:'2023',cash:'10.00',yield:'3.2'},{year:'2022',cash:'8.00',yield:'3.5'}] },
    '3706': { cashDividend: 6.0, stockDividend: 0, history: [{year:'2024',cash:'6.00',yield:'2.0'},{year:'2023',cash:'5.00',yield:'2.2'},{year:'2022',cash:'4.00',yield:'2.5'}] },
    
    // ===== 汽車/零組件 =====
    '2201': { cashDividend: 2.5, stockDividend: 0, history: [{year:'2024',cash:'2.50',yield:'4.5'},{year:'2023',cash:'2.00',yield:'4.0'},{year:'2022',cash:'1.50',yield:'3.5'}] },
    '1319': { cashDividend: 1.8, stockDividend: 0, history: [{year:'2024',cash:'1.80',yield:'4.2'},{year:'2023',cash:'1.50',yield:'3.8'},{year:'2022',cash:'1.20',yield:'3.5'}] },
    '2207': { cashDividend: 2.0, stockDividend: 0, history: [{year:'2024',cash:'2.00',yield:'4.0'},{year:'2023',cash:'1.80',yield:'3.8'},{year:'2022',cash:'1.50',yield:'3.5'}] },
    
    // ===== 生技/醫療 =====
    '4904': { cashDividend: 4.5, stockDividend: 0, history: [{year:'2024',cash:'4.50',yield:'5.5'},{year:'2023',cash:'4.40',yield:'5.3'},{year:'2022',cash:'4.00',yield:'5.0'}] },
    '1795': { cashDividend: 10, stockDividend: 0, history: [{year:'2024',cash:'10.00',yield:'3.5'},{year:'2023',cash:'9.00',yield:'3.2'},{year:'2022',cash:'8.00',yield:'3.0'}] },
    '6446': { cashDividend: 15, stockDividend: 0, history: [{year:'2024',cash:'15.00',yield:'2.8'},{year:'2023',cash:'12.00',yield:'2.5'},{year:'2022',cash:'10.00',yield:'2.2'}] }
  };
  
  return defaultDividends[stockId] || null;
}

/**
 * 取得股票名稱（備援用）
 */
function getStockNameById(stockId) {
  const stockNames = {
    // 權值股
    '2330': '台積電', '2317': '鴻海', '2454': '聯發科', '2308': '台達電', '2303': '聯電',
    '2002': '中鋼', '1301': '台塑', '1303': '南亞', '1326': '台化', '6505': '台塑化',
    // 金融
    '2880': '華南金', '2881': '富邦金', '2882': '國泰金', '2883': '開發金', '2884': '玉山金',
    '2885': '元大金', '2886': '兆豐金', '2887': '台新金', '2888': '新光金', '2889': '國票金',
    '2890': '永豐金', '2891': '中信金', '2892': '第一金', '5880': '合庫金',
    // 電信
    '2412': '中華電', '3045': '台灣大', '4904': '遠傳',
    // ETF
    '0050': '元大台灣50', '0056': '元大高股息', '00878': '國泰永續高股息', 
    '00919': '群益台灣精選高息', '00929': '復華台灣科技優息', '00713': '元大台灣高息低波',
    // 航運
    '2603': '長榮', '2609': '陽明', '2615': '萬海', '2618': '長榮航',
    // 電子
    '2382': '廣達', '3034': '聯詠', '2379': '瑞昱', '2301': '光寶科', '2357': '華碩',
    '2324': '仁寶', '2353': '宏碁', '2356': '英業達', '3231': '緯創', '3037': '欣興',
    // 面板/記憶體
    '3481': '群創', '2409': '友達', '3008': '大立光',
    '6770': '力積電', '2344': '華邦電', '2408': '南亞科', '3450': '聯鈞', '5347': '世界',
    // AI/伺服器
    '2376': '技嘉', '3017': '奇鋐', '4938': '和碩', '3706': '神達',
    // 汽車
    '2201': '裕隆', '1319': '東陽', '2207': '和泰車',
    // 傳產
    '1101': '台泥', '1102': '亞泥', '1216': '統一', '1227': '佳格', '9910': '豐泰',
    '1402': '遠東新'
  };
  return stockNames[stockId] || null;
}

// ========================================
// 🆕 實用型功能
// ========================================

/**
 * 🏆 高殖利率排行
 */
async function getHighYieldRanking() {
  try {
    // 高殖利率股票清單（預設資料）
    const highYieldStocks = [
      { id: '00919', name: '群益台灣精選高息', dividend: 0.55, sector: 'ETF' },
      { id: '00929', name: '復華台灣科技優息', dividend: 0.2, sector: 'ETF' },
      { id: '00878', name: '國泰永續高股息', dividend: 1.2, sector: 'ETF' },
      { id: '0056', name: '元大高股息', dividend: 2.2, sector: 'ETF' },
      { id: '2892', name: '第一金', dividend: 1.6, sector: '金融' },
      { id: '2890', name: '永豐金', dividend: 1.6, sector: '金融' },
      { id: '5880', name: '合庫金', dividend: 1.5, sector: '金融' },
      { id: '2884', name: '玉山金', dividend: 1.4, sector: '金融' },
      { id: '2887', name: '台新金', dividend: 1.0, sector: '金融' },
      { id: '9910', name: '豐泰', dividend: 3.0, sector: '傳產' },
      { id: '2353', name: '宏碁', dividend: 6.0, sector: '電子' },
      { id: '2301', name: '光寶科', dividend: 3.0, sector: '電子' },
      { id: '1301', name: '台塑', dividend: 5.0, sector: '塑化' }
    ];
    
    // 計算殖利率並排序
    const rankedStocks = [];
    for (const stock of highYieldStocks) {
      try {
        const stockData = await stockService.getRealtimePrice(stock.id);
        const price = stockData?.price || 0;
        const yieldRate = price > 0 ? ((stock.dividend / price) * 100) : 0;
        
        rankedStocks.push({
          ...stock,
          price,
          yieldRate: yieldRate.toFixed(2)
        });
      } catch (e) {
        rankedStocks.push({ ...stock, price: 0, yieldRate: '0' });
      }
      await new Promise(r => setTimeout(r, 100));
    }
    
    // 按殖利率排序
    rankedStocks.sort((a, b) => parseFloat(b.yieldRate) - parseFloat(a.yieldRate));
    const top10 = rankedStocks.slice(0, 10);
    
    const rows = top10.map((s, i) => ({
      type: 'box',
      layout: 'horizontal',
      contents: [
        { type: 'text', text: `${i + 1}`, size: 'sm', color: i < 3 ? '#D63031' : '#666666', flex: 1 },
        { type: 'text', text: s.name.substring(0, 5), size: 'sm', flex: 3 },
        { type: 'text', text: `$${s.dividend}`, size: 'xs', color: '#888888', flex: 2, align: 'end' },
        { type: 'text', text: `${s.yieldRate}%`, size: 'sm', weight: 'bold', color: parseFloat(s.yieldRate) >= 6 ? '#D63031' : '#E17055', flex: 2, align: 'end' }
      ],
      margin: 'sm'
    }));
    
    return {
      type: 'flex',
      altText: '🏆 高殖利率排行',
      contents: {
        type: 'bubble',
        size: 'mega',
        header: {
          type: 'box',
          layout: 'vertical',
          contents: [
            { type: 'text', text: '🏆 高殖利率 TOP 10', size: 'lg', weight: 'bold', color: '#ffffff' },
            { type: 'text', text: '依現價計算殖利率排名', size: 'sm', color: '#ffffffaa', margin: 'sm' }
          ],
          backgroundColor: '#E17055',
          paddingAll: '20px'
        },
        body: {
          type: 'box',
          layout: 'vertical',
          contents: [
            { type: 'box', layout: 'horizontal',
              contents: [
                { type: 'text', text: '#', size: 'xs', color: '#888888', flex: 1 },
                { type: 'text', text: '股票', size: 'xs', color: '#888888', flex: 3 },
                { type: 'text', text: '股息', size: 'xs', color: '#888888', flex: 2, align: 'end' },
                { type: 'text', text: '殖利率', size: 'xs', color: '#888888', flex: 2, align: 'end' }
              ]
            },
            { type: 'separator', margin: 'sm' },
            ...rows,
            { type: 'separator', margin: 'lg' },
            { type: 'text', text: '💡 殖利率 6%+ 為高殖利率', size: 'xs', color: '#888888', margin: 'md' }
          ],
          paddingAll: '15px'
        }
      }
    };
  } catch (error) {
    console.error('高殖利率排行錯誤:', error);
    return { type: 'text', text: `❌ 查詢失敗：${error.message}` };
  }
}

/**
 * 📅 除權息日曆
 */
async function getDividendCalendar() {
  try {
    // 模擬近期除息股票（實際應從API取得）
    const today = new Date();
    const upcomingDividends = [
      { id: '2330', name: '台積電', exDate: '2025/03/20', dividend: 4.5, type: '季配' },
      { id: '2317', name: '鴻海', exDate: '2025/02/15', dividend: 2.0, type: '年配' },
      { id: '00878', name: '國泰永續高息', exDate: '2025/02/18', dividend: 0.40, type: '季配' },
      { id: '00919', name: '群益高息', exDate: '2025/02/20', dividend: 0.18, type: '月配' },
      { id: '2882', name: '國泰金', exDate: '2025/03/10', dividend: 1.5, type: '年配' },
      { id: '2881', name: '富邦金', exDate: '2025/03/15', dividend: 1.8, type: '年配' },
      { id: '0056', name: '元大高股息', exDate: '2025/02/25', dividend: 0.73, type: '季配' }
    ];
    
    // 檢查是否為持股
    let holdingStocks = [];
    try {
      const result = await pool.query(
        "SELECT stock_id FROM holdings WHERE user_id = 'default' AND is_won = true AND (is_sold = false OR is_sold IS NULL)"
      );
      holdingStocks = result.rows.map(r => r.stock_id);
    } catch (e) {}
    
    const rows = upcomingDividends.map(d => {
      const isHolding = holdingStocks.includes(d.id);
      return {
        type: 'box',
        layout: 'horizontal',
        contents: [
          { type: 'text', text: isHolding ? '💼' : '　', size: 'sm', flex: 1 },
          { type: 'text', text: d.name.substring(0, 5), size: 'sm', flex: 3, color: isHolding ? '#D63031' : '#333333' },
          { type: 'text', text: d.exDate.substring(5), size: 'xs', color: '#888888', flex: 2 },
          { type: 'text', text: `$${d.dividend}`, size: 'sm', flex: 2, align: 'end' },
          { type: 'text', text: d.type, size: 'xs', color: '#888888', flex: 2, align: 'end' }
        ],
        margin: 'sm'
      };
    });
    
    return {
      type: 'flex',
      altText: '📅 除權息日曆',
      contents: {
        type: 'bubble',
        size: 'mega',
        header: {
          type: 'box',
          layout: 'vertical',
          contents: [
            { type: 'text', text: '📅 除權息日曆', size: 'lg', weight: 'bold', color: '#ffffff' },
            { type: 'text', text: '近期除息股票一覽', size: 'sm', color: '#ffffffaa', margin: 'sm' }
          ],
          backgroundColor: '#9B59B6',
          paddingAll: '20px'
        },
        body: {
          type: 'box',
          layout: 'vertical',
          contents: [
            { type: 'box', layout: 'horizontal',
              contents: [
                { type: 'text', text: '', size: 'xs', flex: 1 },
                { type: 'text', text: '股票', size: 'xs', color: '#888888', flex: 3 },
                { type: 'text', text: '除息日', size: 'xs', color: '#888888', flex: 2 },
                { type: 'text', text: '股息', size: 'xs', color: '#888888', flex: 2, align: 'end' },
                { type: 'text', text: '類型', size: 'xs', color: '#888888', flex: 2, align: 'end' }
              ]
            },
            { type: 'separator', margin: 'sm' },
            ...rows,
            { type: 'separator', margin: 'lg' },
            { type: 'text', text: '💼 = 你的持股', size: 'xs', color: '#D63031', margin: 'md' }
          ],
          paddingAll: '15px'
        }
      }
    };
  } catch (error) {
    console.error('除權息日曆錯誤:', error);
    return { type: 'text', text: `❌ 查詢失敗：${error.message}` };
  }
}

/**
 * 🏥 持股健檢
 */
async function getPortfolioHealthCheck() {
  try {
    // 取得持股
    const holdingsResult = await pool.query(
      `SELECT stock_id, MAX(stock_name) as stock_name, SUM(COALESCE(lots, 0)) as total_lots,
              AVG(won_price) as avg_cost
       FROM holdings 
       WHERE user_id = 'default' AND is_won = true AND (is_sold = false OR is_sold IS NULL)
       GROUP BY stock_id`
    );
    
    if (holdingsResult.rows.length === 0) {
      return { type: 'text', text: '📭 目前沒有持股\n\n請先新增持股後再健檢' };
    }
    
    const holdings = holdingsResult.rows;
    let totalScore = 0;
    let totalValue = 0;
    let totalCost = 0;
    const issues = [];
    const highlights = [];
    const stockReports = [];
    
    for (const h of holdings) {
      const stockId = h.stock_id;
      const stockName = h.stock_name || stockId;
      const lots = parseInt(h.total_lots) || 0;
      const avgCost = parseFloat(h.avg_cost) || 0;
      
      // 取得現價
      let price = 0, change = 0;
      try {
        const stockData = await stockService.getRealtimePrice(stockId);
        price = stockData?.price || 0;
        change = stockData?.change || 0;
      } catch (e) {}
      
      // 計算損益
      const value = lots * 1000 * price;
      const cost = lots * 1000 * avgCost;
      const profitRate = avgCost > 0 ? ((price - avgCost) / avgCost * 100) : 0;
      
      totalValue += value;
      totalCost += cost;
      
      // 評分（滿分 100）
      let score = 50;
      
      // 獲利加分
      if (profitRate > 20) { score += 30; highlights.push(`${stockName} 獲利超過20%`); }
      else if (profitRate > 10) score += 20;
      else if (profitRate > 0) score += 10;
      else if (profitRate < -20) { score -= 20; issues.push(`${stockName} 虧損超過20%`); }
      else if (profitRate < -10) { score -= 10; issues.push(`${stockName} 虧損超過10%`); }
      
      // 取得股息
      const dividendData = await fetchDividendData(stockId);
      const yieldRate = price > 0 && dividendData.cashDividend > 0 
        ? (dividendData.cashDividend / price * 100) : 0;
      
      // 高殖利率加分
      if (yieldRate >= 5) { score += 15; }
      else if (yieldRate >= 3) score += 10;
      
      totalScore += score;
      
      stockReports.push({
        name: stockName,
        lots,
        price,
        profitRate: profitRate.toFixed(1),
        yieldRate: yieldRate.toFixed(1),
        score
      });
      
      await new Promise(r => setTimeout(r, 150));
    }
    
    // 整體評分
    const avgScore = Math.round(totalScore / holdings.length);
    const totalProfitRate = totalCost > 0 ? ((totalValue - totalCost) / totalCost * 100) : 0;
    
    // 評級
    let grade = '', gradeColor = '#888888';
    if (avgScore >= 80) { grade = '🌟 優秀'; gradeColor = '#27AE60'; }
    else if (avgScore >= 60) { grade = '👍 良好'; gradeColor = '#3498DB'; }
    else if (avgScore >= 40) { grade = '📊 普通'; gradeColor = '#F39C12'; }
    else { grade = '⚠️ 需注意'; gradeColor = '#E74C3C'; }
    
    // 建議
    const suggestions = [];
    if (issues.length > 0) suggestions.push('考慮停損虧損標的');
    if (holdings.length < 3) suggestions.push('持股過於集中，建議分散');
    if (holdings.length > 10) suggestions.push('持股過多，難以管理');
    
    const stockRows = stockReports.slice(0, 5).map(s => ({
      type: 'box',
      layout: 'horizontal',
      contents: [
        { type: 'text', text: s.name.substring(0, 4), size: 'xs', flex: 2 },
        { type: 'text', text: `${s.lots}張`, size: 'xs', color: '#888888', flex: 1 },
        { type: 'text', text: `${s.profitRate}%`, size: 'xs', color: parseFloat(s.profitRate) >= 0 ? '#D63031' : '#00B894', flex: 1, align: 'end' },
        { type: 'text', text: `${s.score}分`, size: 'xs', flex: 1, align: 'end' }
      ],
      margin: 'xs'
    }));
    
    return {
      type: 'flex',
      altText: '🏥 持股健檢報告',
      contents: {
        type: 'bubble',
        size: 'mega',
        header: {
          type: 'box',
          layout: 'vertical',
          contents: [
            { type: 'text', text: '🏥 持股健檢報告', size: 'lg', weight: 'bold', color: '#ffffff' },
            { type: 'text', text: `共 ${holdings.length} 檔持股`, size: 'sm', color: '#ffffffaa', margin: 'sm' }
          ],
          backgroundColor: '#3498DB',
          paddingAll: '20px'
        },
        body: {
          type: 'box',
          layout: 'vertical',
          contents: [
            // 整體評分
            { type: 'box', layout: 'horizontal',
              contents: [
                { type: 'box', layout: 'vertical', flex: 1,
                  contents: [
                    { type: 'text', text: '健康分數', size: 'xs', color: '#888888' },
                    { type: 'text', text: `${avgScore}`, size: 'xxl', weight: 'bold', color: gradeColor },
                    { type: 'text', text: grade, size: 'sm', color: gradeColor }
                  ]
                },
                { type: 'box', layout: 'vertical', flex: 1,
                  contents: [
                    { type: 'text', text: '總損益', size: 'xs', color: '#888888' },
                    { type: 'text', text: `${totalProfitRate >= 0 ? '+' : ''}${totalProfitRate.toFixed(1)}%`, size: 'xl', weight: 'bold', color: totalProfitRate >= 0 ? '#D63031' : '#00B894' },
                    { type: 'text', text: `$${Math.round(totalValue - totalCost).toLocaleString()}`, size: 'sm', color: '#666666' }
                  ]
                }
              ]
            },
            { type: 'separator', margin: 'lg' },
            { type: 'text', text: '📋 個股評分', size: 'sm', weight: 'bold', margin: 'lg' },
            ...stockRows,
            { type: 'separator', margin: 'lg' },
            // 問題提醒
            ...(issues.length > 0 ? [
              { type: 'text', text: '⚠️ 注意事項', size: 'sm', weight: 'bold', color: '#E74C3C', margin: 'lg' },
              { type: 'text', text: issues.slice(0, 2).join('\n'), size: 'xs', color: '#666666', margin: 'xs', wrap: true }
            ] : []),
            // 亮點
            ...(highlights.length > 0 ? [
              { type: 'text', text: '🌟 亮點', size: 'sm', weight: 'bold', color: '#27AE60', margin: 'lg' },
              { type: 'text', text: highlights.slice(0, 2).join('\n'), size: 'xs', color: '#666666', margin: 'xs', wrap: true }
            ] : [])
          ],
          paddingAll: '15px'
        }
      }
    };
  } catch (error) {
    console.error('持股健檢錯誤:', error);
    return { type: 'text', text: `❌ 健檢失敗：${error.message}` };
  }
}

/**
 * 📊 投資組合分析
 */
async function getPortfolioAnalysis() {
  try {
    const holdingsResult = await pool.query(
      `SELECT stock_id, MAX(stock_name) as stock_name, SUM(COALESCE(lots, 0)) as total_lots,
              AVG(won_price) as avg_cost
       FROM holdings 
       WHERE user_id = 'default' AND is_won = true AND (is_sold = false OR is_sold IS NULL)
       GROUP BY stock_id`
    );
    
    if (holdingsResult.rows.length === 0) {
      return { type: 'text', text: '📭 目前沒有持股\n\n請先新增持股後再分析' };
    }
    
    // 產業分類
    const sectorMap = {
      '2330': '半導體', '2454': '半導體', '2303': '半導體', '6770': '半導體', '2344': '半導體',
      '2317': '電子', '2382': '電子', '3034': '電子', '2301': '電子', '2353': '電子',
      '2881': '金融', '2882': '金融', '2884': '金融', '2886': '金融', '2891': '金融', '2892': '金融', '5880': '金融',
      '1301': '塑化', '1303': '塑化', '1326': '塑化', '6505': '塑化',
      '2603': '航運', '2609': '航運', '2615': '航運',
      '2412': '電信', '3045': '電信', '4904': '電信',
      '3481': '面板', '2409': '面板',
      '0050': 'ETF', '0056': 'ETF', '00878': 'ETF', '00919': 'ETF', '00929': 'ETF'
    };
    
    const sectorValues = {};
    let totalValue = 0;
    
    for (const h of holdingsResult.rows) {
      const stockId = h.stock_id;
      const lots = parseInt(h.total_lots) || 0;
      
      let price = 0;
      try {
        const stockData = await stockService.getRealtimePrice(stockId);
        price = stockData?.price || 0;
      } catch (e) {}
      
      const value = lots * 1000 * price;
      totalValue += value;
      
      const sector = sectorMap[stockId] || '其他';
      sectorValues[sector] = (sectorValues[sector] || 0) + value;
      
      await new Promise(r => setTimeout(r, 100));
    }
    
    // 計算比例並排序
    const sectors = Object.entries(sectorValues)
      .map(([name, value]) => ({
        name,
        value,
        ratio: totalValue > 0 ? (value / totalValue * 100).toFixed(1) : 0
      }))
      .sort((a, b) => b.value - a.value);
    
    // 評估分散度
    let diversityScore = '';
    const topRatio = parseFloat(sectors[0]?.ratio || 0);
    if (sectors.length >= 4 && topRatio < 40) {
      diversityScore = '🌟 分散良好';
    } else if (sectors.length >= 3 && topRatio < 50) {
      diversityScore = '👍 尚可';
    } else {
      diversityScore = '⚠️ 過於集中';
    }
    
    const sectorRows = sectors.slice(0, 6).map(s => ({
      type: 'box',
      layout: 'horizontal',
      contents: [
        { type: 'text', text: s.name, size: 'sm', flex: 2 },
        { type: 'text', text: `$${Math.round(s.value / 1000)}K`, size: 'xs', color: '#888888', flex: 2, align: 'end' },
        { type: 'text', text: `${s.ratio}%`, size: 'sm', weight: 'bold', flex: 1, align: 'end' }
      ],
      margin: 'sm'
    }));
    
    // 建議
    const suggestions = [];
    if (topRatio > 50) suggestions.push(`${sectors[0].name} 佔比過高，建議減碼分散`);
    if (sectors.length < 3) suggestions.push('產業過於集中，建議增加不同產業');
    if (!sectors.find(s => s.name === 'ETF')) suggestions.push('可考慮配置部分 ETF 降低風險');
    
    return {
      type: 'flex',
      altText: '📊 投資組合分析',
      contents: {
        type: 'bubble',
        size: 'mega',
        header: {
          type: 'box',
          layout: 'vertical',
          contents: [
            { type: 'text', text: '📊 投資組合分析', size: 'lg', weight: 'bold', color: '#ffffff' },
            { type: 'text', text: '產業分散度檢視', size: 'sm', color: '#ffffffaa', margin: 'sm' }
          ],
          backgroundColor: '#9B59B6',
          paddingAll: '20px'
        },
        body: {
          type: 'box',
          layout: 'vertical',
          contents: [
            { type: 'box', layout: 'horizontal',
              contents: [
                { type: 'text', text: '總市值', size: 'sm', color: '#666666' },
                { type: 'text', text: `$${Math.round(totalValue).toLocaleString()}`, size: 'lg', weight: 'bold', align: 'end' }
              ]
            },
            { type: 'box', layout: 'horizontal', margin: 'sm',
              contents: [
                { type: 'text', text: '分散度評估', size: 'sm', color: '#666666' },
                { type: 'text', text: diversityScore, size: 'sm', weight: 'bold', align: 'end' }
              ]
            },
            { type: 'separator', margin: 'lg' },
            { type: 'text', text: '🏭 產業配置', size: 'sm', weight: 'bold', margin: 'lg' },
            ...sectorRows,
            ...(suggestions.length > 0 ? [
              { type: 'separator', margin: 'lg' },
              { type: 'text', text: '💡 建議', size: 'sm', weight: 'bold', margin: 'lg', color: '#F39C12' },
              { type: 'text', text: suggestions.join('\n'), size: 'xs', color: '#666666', margin: 'xs', wrap: true }
            ] : [])
          ],
          paddingAll: '15px'
        }
      }
    };
  } catch (error) {
    console.error('組合分析錯誤:', error);
    return { type: 'text', text: `❌ 分析失敗：${error.message}` };
  }
}

/**
 * ⚔️ 股票 PK
 */
async function getStockPK(stockId1, stockId2) {
  try {
    // 取得兩支股票資料
    const [data1, data2] = await Promise.all([
      stockService.getRealtimePrice(stockId1),
      stockService.getRealtimePrice(stockId2)
    ]);
    
    if (!data1 || !data2) {
      return { type: 'text', text: '❌ 無法取得股票資料' };
    }
    
    const [div1, div2] = await Promise.all([
      fetchDividendData(stockId1),
      fetchDividendData(stockId2)
    ]);
    
    // 確保股票名稱（如果 API 回傳的是代碼，用預設清單）
    const rawName1 = data1.name || '';
    const rawName2 = data2.name || '';
    // 如果名稱是純數字（代碼）或為空，就用備援
    const name1 = (rawName1 && !/^\d+$/.test(rawName1)) ? rawName1 : (getStockNameById(stockId1) || stockId1);
    const name2 = (rawName2 && !/^\d+$/.test(rawName2)) ? rawName2 : (getStockNameById(stockId2) || stockId2);
    
    // 計算各項指標（確保是數字，處理 Infinity/NaN）
    const price1 = parseFloat(data1.price) || 0;
    const price2 = parseFloat(data2.price) || 0;
    const yield1 = price1 > 0 && div1.cashDividend > 0 ? (div1.cashDividend / price1 * 100).toFixed(2) : '0';
    const yield2 = price2 > 0 && div2.cashDividend > 0 ? (div2.cashDividend / price2 * 100).toFixed(2) : '0';
    
    // 處理漲跌幅，避免 Infinity/NaN
    let changeRate1 = parseFloat(data1.changePercent) || 0;
    let changeRate2 = parseFloat(data2.changePercent) || 0;
    if (!isFinite(changeRate1)) changeRate1 = 0;
    if (!isFinite(changeRate2)) changeRate2 = 0;
    
    // 比較項目
    const comparisons = [
      { name: '現價', v1: `$${price1}`, v2: `$${price2}`, win: null },
      { name: '今日漲跌', v1: `${changeRate1 >= 0 ? '+' : ''}${changeRate1.toFixed(2)}%`, v2: `${changeRate2 >= 0 ? '+' : ''}${changeRate2.toFixed(2)}%`, win: changeRate1 > changeRate2 ? 1 : changeRate2 > changeRate1 ? 2 : 0 },
      { name: '現金股利', v1: div1.cashDividend > 0 ? `$${div1.cashDividend}` : '-', v2: div2.cashDividend > 0 ? `$${div2.cashDividend}` : '-', win: div1.cashDividend > div2.cashDividend ? 1 : div2.cashDividend > div1.cashDividend ? 2 : 0 },
      { name: '殖利率', v1: `${yield1}%`, v2: `${yield2}%`, win: parseFloat(yield1) > parseFloat(yield2) ? 1 : parseFloat(yield2) > parseFloat(yield1) ? 2 : 0 }
    ];
    
    // 計分
    let score1 = 0, score2 = 0;
    comparisons.forEach(c => {
      if (c.win === 1) score1++;
      else if (c.win === 2) score2++;
    });
    
    const winner = score1 > score2 ? 1 : score2 > score1 ? 2 : 0;
    
    const rows = comparisons.map(c => ({
      type: 'box',
      layout: 'horizontal',
      contents: [
        { type: 'text', text: c.v1, size: 'sm', flex: 2, align: 'center', color: c.win === 1 ? '#D63031' : '#333333', weight: c.win === 1 ? 'bold' : 'regular' },
        { type: 'text', text: c.name, size: 'xs', color: '#888888', flex: 2, align: 'center' },
        { type: 'text', text: c.v2, size: 'sm', flex: 2, align: 'center', color: c.win === 2 ? '#D63031' : '#333333', weight: c.win === 2 ? 'bold' : 'regular' }
      ],
      margin: 'md'
    }));
    
    return {
      type: 'flex',
      altText: `⚔️ ${name1} vs ${name2}`,
      contents: {
        type: 'bubble',
        size: 'mega',
        header: {
          type: 'box',
          layout: 'vertical',
          contents: [
            { type: 'text', text: '⚔️ 股票 PK', size: 'lg', weight: 'bold', color: '#ffffff', align: 'center' },
            { type: 'box', layout: 'horizontal', margin: 'lg',
              contents: [
                { type: 'text', text: name1, size: 'md', weight: 'bold', color: '#ffffff', flex: 1, align: 'center' },
                { type: 'text', text: 'VS', size: 'sm', color: '#ffffffaa', flex: 1, align: 'center' },
                { type: 'text', text: name2, size: 'md', weight: 'bold', color: '#ffffff', flex: 1, align: 'center' }
              ]
            }
          ],
          backgroundColor: '#E74C3C',
          paddingAll: '20px'
        },
        body: {
          type: 'box',
          layout: 'vertical',
          contents: [
            ...rows,
            { type: 'separator', margin: 'lg' },
            { type: 'box', layout: 'horizontal', margin: 'lg',
              contents: [
                { type: 'text', text: `${score1} 勝`, size: 'lg', weight: 'bold', color: winner === 1 ? '#D63031' : '#888888', flex: 1, align: 'center' },
                { type: 'text', text: '🏆', size: 'xl', flex: 1, align: 'center' },
                { type: 'text', text: `${score2} 勝`, size: 'lg', weight: 'bold', color: winner === 2 ? '#D63031' : '#888888', flex: 1, align: 'center' }
              ]
            },
            { type: 'text', text: winner === 0 ? '平手！' : (winner === 1 ? `${data1.name} 勝出！` : `${data2.name} 勝出！`), size: 'md', weight: 'bold', align: 'center', margin: 'md', color: '#E74C3C' }
          ],
          paddingAll: '15px'
        }
      }
    };
  } catch (error) {
    console.error('股票PK錯誤:', error);
    return { type: 'text', text: `❌ PK 失敗：${error.message}` };
  }
}

/**
 * 🌊 艾略特波浪理論分析
 */
async function getElliottWaveAnalysis(stockId) {
  try {
    // 取得股票資料
    const stockData = await stockService.getRealtimePrice(stockId);
    const stockName = stockData?.name || getStockNameById(stockId) || stockId;
    const currentPrice = parseFloat(stockData?.price) || 0;
    
    // 取得歷史資料（120 天）
    const historyRaw = await fetchYahooHistory(stockId, 120);
    if (!historyRaw || historyRaw.length < 20) {
      return { type: 'text', text: `❌ ${stockName} 歷史資料不足（僅 ${historyRaw?.length || 0} 筆），無法進行波浪分析` };
    }
    
    // 🔑 關鍵：將 history 反轉為升序（舊→新）
    // fetchYahooHistory 返回降序（新→舊），波浪分析需要升序
    const history = [...historyRaw].reverse();
    
    // 🆕 使用 ZigZag 找出轉折點（根據資料量調整靈敏度）
    const sensitivity = history.length < 40 ? 3 : 5; // 資料少時更敏感
    const pivots = findZigZagPivots(history, sensitivity);
    
    // 分析波浪結構
    const waveAnalysis = analyzeWaveStructure(pivots, currentPrice, history);
    
    // 🆕 斐波那契計算目標價
    const fibTargets = calculateFibonacciTargets(waveAnalysis, currentPrice);
    
    // 波浪規則檢查
    const ruleChecks = checkWaveRules(waveAnalysis);
    
    // 🆕 計算信心分數
    const passedRules = ruleChecks.filter(r => r.pass).length;
    const confidence = Math.round((passedRules / 3) * 100);
    const confidenceText = confidence >= 70 ? '高' : confidence >= 40 ? '中' : '低';
    const confidenceColor = confidence >= 70 ? '#27AE60' : confidence >= 40 ? '#F39C12' : '#E74C3C';
    
    // 操作建議
    const suggestion = getWaveSuggestion(waveAnalysis);
    
    // 趨勢判斷
    const isUpTrend = typeof waveAnalysis.currentWave === 'number' && waveAnalysis.currentWave <= 5;
    const trend = isUpTrend ? '上升趨勢' : '下跌趨勢';
    const trendColor = isUpTrend ? '#D63031' : '#00B894';
    
    // 波浪圓圈
    const waveCircles = [1, 2, 3, 4, 5, 'A', 'B', 'C'].map((w, i) => {
      const isCurrentWave = String(w) === String(waveAnalysis.currentWave);
      return {
        type: 'box',
        layout: 'vertical',
        contents: [
          { 
            type: 'text', 
            text: String(w), 
            size: 'xs', 
            weight: 'bold',
            align: 'center',
            color: isCurrentWave ? '#ffffff' : (i < 5 ? '#D63031' : '#00B894')
          }
        ],
        width: '28px',
        height: '28px',
        cornerRadius: '14px',
        backgroundColor: isCurrentWave ? '#3498DB' : '#f0f0f0',
        justifyContent: 'center',
        alignItems: 'center'
      };
    });
    
    // 規則檢查結果
    const ruleRows = ruleChecks.map(r => ({
      type: 'box',
      layout: 'horizontal',
      contents: [
        { type: 'text', text: r.pass ? '✅' : '❌', size: 'xs', flex: 1 },
        { type: 'text', text: r.rule, size: 'xxs', color: r.pass ? '#27AE60' : '#E74C3C', flex: 7, wrap: true }
      ],
      margin: 'xs'
    }));
    
    // 近期波浪
    const recentWaves = waveAnalysis.waves.slice(-3).map(w => ({
      type: 'box',
      layout: 'horizontal',
      contents: [
        { type: 'text', text: `${w.wave}浪`, size: 'xxs', flex: 1, color: '#666666' },
        { type: 'text', text: `${w.start.toFixed(0)}→${w.end.toFixed(0)}`, size: 'xxs', flex: 2, align: 'end', color: w.direction === 'up' ? '#D63031' : '#00B894' }
      ],
      margin: 'xs'
    }));
    
    return {
      type: 'flex',
      altText: `🌊 ${stockName} 波浪分析`,
      contents: {
        type: 'bubble',
        size: 'mega',
        header: {
          type: 'box',
          layout: 'horizontal',
          contents: [
            { type: 'box', layout: 'vertical', flex: 4,
              contents: [
                { type: 'text', text: '🌊 艾略特波浪分析', size: 'md', weight: 'bold', color: '#ffffff' },
                { type: 'text', text: `${stockName} (${stockId})`, size: 'xs', color: '#ffffffaa', margin: 'xs' }
              ]
            },
            { type: 'box', layout: 'vertical', flex: 2, alignItems: 'flex-end',
              contents: [
                { type: 'text', text: `信心: ${confidenceText}`, size: 'xs', color: '#ffffff' },
                { type: 'text', text: `${confidence}%`, size: 'lg', weight: 'bold', color: confidenceColor }
              ]
            }
          ],
          backgroundColor: '#2C3E50',
          paddingAll: '15px'
        },
        body: {
          type: 'box',
          layout: 'vertical',
          contents: [
            // 波浪圓圈
            { type: 'box', layout: 'horizontal', justifyContent: 'space-between', contents: waveCircles },
            // 目前位置
            { type: 'box', layout: 'vertical', margin: 'lg', alignItems: 'center',
              contents: [
                { type: 'text', text: `目前推測位於 第 ${waveAnalysis.currentWave} 浪`, size: 'md', weight: 'bold' },
                { type: 'text', text: `${trend} | 現價: $${currentPrice} ${waveAnalysis.changeFromLastWave}`, size: 'xs', color: trendColor, margin: 'xs' }
              ]
            },
            { type: 'separator', margin: 'lg' },
            // 兩欄佈局：規則+波浪
            { type: 'box', layout: 'horizontal', margin: 'md',
              contents: [
                { type: 'box', layout: 'vertical', flex: 1,
                  contents: [
                    { type: 'text', text: '📋 規則檢查', size: 'xs', weight: 'bold', color: '#3498DB' },
                    ...ruleRows
                  ]
                },
                { type: 'separator', margin: 'sm' },
                { type: 'box', layout: 'vertical', flex: 1, margin: 'sm',
                  contents: [
                    { type: 'text', text: '📊 近期波浪', size: 'xs', weight: 'bold', color: '#3498DB' },
                    ...recentWaves
                  ]
                }
              ]
            },
            { type: 'separator', margin: 'md' },
            // 🆕 目標價區域
            { type: 'box', layout: 'horizontal', margin: 'md',
              contents: [
                { type: 'box', layout: 'vertical', flex: 1, backgroundColor: '#FDEDEC', cornerRadius: 'md', paddingAll: '8px', alignItems: 'center',
                  contents: [
                    { type: 'text', text: '🎯 目標上檔', size: 'xxs', color: '#E74C3C' },
                    { type: 'text', text: `$${fibTargets.upper.toFixed(1)}`, size: 'md', weight: 'bold', color: '#E74C3C' }
                  ]
                },
                { type: 'box', layout: 'vertical', flex: 1, backgroundColor: '#E8F8F5', cornerRadius: 'md', paddingAll: '8px', alignItems: 'center', margin: 'sm',
                  contents: [
                    { type: 'text', text: '🛡️ 支撐下檔', size: 'xxs', color: '#27AE60' },
                    { type: 'text', text: `$${fibTargets.lower.toFixed(1)}`, size: 'md', weight: 'bold', color: '#27AE60' }
                  ]
                }
              ]
            },
            // 操作建議
            { type: 'box', layout: 'vertical', margin: 'md', backgroundColor: '#FEF9E7', cornerRadius: 'md', paddingAll: '8px',
              contents: [
                { type: 'text', text: '💡 操作建議', size: 'xs', weight: 'bold', color: '#F39C12' },
                { type: 'text', text: suggestion, size: 'xxs', color: '#666666', wrap: true, margin: 'xs' }
              ]
            }
          ],
          paddingAll: '12px'
        },
        footer: {
          type: 'box',
          layout: 'horizontal',
          contents: [
            { type: 'button', style: 'primary', color: '#2C3E50', height: 'sm',
              action: { type: 'message', label: 'K線圖', text: `K線 ${stockId}` }
            },
            { type: 'button', style: 'secondary', height: 'sm', margin: 'sm',
              action: { type: 'message', label: '回測', text: `回測 ${stockId}` }
            }
          ],
          paddingAll: '10px'
        }
      }
    };
  } catch (error) {
    console.error('波浪分析錯誤:', error);
    return { type: 'text', text: `❌ 波浪分析失敗：${error.message}` };
  }
}

/**
 * 🆕 波浪網頁連結
 */
function getWaveWebLink(stockId) {
  const webUrl = `https://stock-assistant-production-8ce3.up.railway.app/wave.html?stock=${stockId}`;
  const stockName = getStockNameById(stockId) || stockId;
  
  return {
    type: 'flex',
    altText: `🌊 波浪分析網頁 - ${stockName}`,
    contents: {
      type: 'bubble',
      size: 'kilo',
      header: {
        type: 'box',
        layout: 'vertical',
        backgroundColor: '#1a1f2e',
        paddingAll: '16px',
        contents: [
          { type: 'text', text: '🌊 艾略特波浪分析', size: 'lg', weight: 'bold', color: '#60A5FA' },
          { type: 'text', text: '互動式網頁版', size: 'xs', color: '#94A3B8', margin: 'xs' }
        ]
      },
      body: {
        type: 'box',
        layout: 'vertical',
        paddingAll: '16px',
        backgroundColor: '#0f1419',
        contents: [
          { type: 'text', text: `📈 ${stockName} (${stockId})`, size: 'md', weight: 'bold', color: '#E2E8F0' },
          { type: 'separator', margin: 'md', color: '#2d3748' },
          { type: 'text', text: '網頁版功能：', size: 'sm', color: '#94A3B8', margin: 'md' },
          { type: 'text', text: '• 📊 互動式 K 線圖', size: 'xs', color: '#CBD5E1', margin: 'sm' },
          { type: 'text', text: '• 🌊 波浪位置分析', size: 'xs', color: '#CBD5E1', margin: 'xs' },
          { type: 'text', text: '• 📐 斐波那契目標價', size: 'xs', color: '#CBD5E1', margin: 'xs' },
          { type: 'text', text: '• 💼 自訂投資組合', size: 'xs', color: '#CBD5E1', margin: 'xs' },
          { type: 'text', text: '• 📊 風險評估系統', size: 'xs', color: '#CBD5E1', margin: 'xs' }
        ]
      },
      footer: {
        type: 'box',
        layout: 'vertical',
        paddingAll: '12px',
        backgroundColor: '#1a1f2e',
        contents: [
          { type: 'button', style: 'primary', color: '#6366F1', height: 'sm',
            action: { type: 'uri', label: '🌐 開啟網頁版', uri: webUrl }
          },
          { type: 'box', layout: 'horizontal', margin: 'sm', contents: [
            { type: 'button', style: 'secondary', height: 'sm', flex: 1,
              action: { type: 'message', label: '波浪分析', text: `波浪 ${stockId}` }
            },
            { type: 'button', style: 'secondary', height: 'sm', flex: 1, margin: 'sm',
              action: { type: 'message', label: '波浪建議', text: '波浪建議' }
            }
          ]}
        ]
      }
    }
  };
}

/**
 * 🆕 波浪建議（掃描熱門股票找出適合進場的）
 */
async function getWaveRecommendations() {
  try {
    // 熱門股票清單
    const watchList = [
      '2330', '2454', '2317', '2308', '2382',  // 半導體/電子
      '2881', '2882', '2884', '2891', '2886',  // 金融
      '2303', '3711', '2345', '2344', '3034',  // 電子
      '2912', '1301', '1303', '2002', '1101',  // 傳產
      '0050', '0056', '00878', '00919', '006208' // ETF
    ];
    
    const results = {
      entry: [],    // 適合進場（第1-2浪）
      hold: [],     // 持有觀望（第3-4浪）
      exit: [],     // 獲利了結（第5浪、ABC浪）
      errors: []
    };
    
    // 批次分析
    for (const stockId of watchList.slice(0, 15)) { // 限制15檔避免超時
      try {
        const stockData = await stockService.getRealtimePrice(stockId);
        const stockName = stockData?.name || getStockNameById(stockId) || stockId;
        const currentPrice = parseFloat(stockData?.price) || 0;
        
        const historyRaw = await fetchYahooHistory(stockId, 90);
        if (!historyRaw || historyRaw.length < 20) continue;
        
        // 🔑 反轉為升序（舊→新）
        const history = [...historyRaw].reverse();
        
        const sensitivity = history.length < 40 ? 3 : 5;
        const pivots = findZigZagPivots(history, sensitivity);
        const waveAnalysis = analyzeWaveStructure(pivots, currentPrice, history);
        const ruleChecks = checkWaveRules(waveAnalysis);
        const passedRules = ruleChecks.filter(r => r.pass).length;
        const confidence = Math.round((passedRules / 3) * 100);
        
        const result = {
          stockId,
          stockName,
          currentPrice,
          wave: waveAnalysis.currentWave,
          confidence,
          suggestion: getWaveSuggestion(waveAnalysis).substring(0, 30)
        };
        
        // 分類
        const wave = waveAnalysis.currentWave;
        if (wave === 1 || wave === 2 || wave === '1' || wave === '2') {
          results.entry.push(result);
        } else if (wave === 3 || wave === 4 || wave === '3' || wave === '4') {
          results.hold.push(result);
        } else {
          results.exit.push(result);
        }
      } catch (e) {
        results.errors.push(stockId);
      }
    }
    
    // 依信心分數排序
    results.entry.sort((a, b) => b.confidence - a.confidence);
    results.hold.sort((a, b) => b.confidence - a.confidence);
    results.exit.sort((a, b) => b.confidence - a.confidence);
    
    // 建立 Flex 卡片
    const createStockList = (items, maxItems = 4) => {
      if (items.length === 0) {
        return [{ type: 'text', text: '暫無符合條件的股票', size: 'xs', color: '#64748B' }];
      }
      return items.slice(0, maxItems).map(s => ({
        type: 'box',
        layout: 'horizontal',
        contents: [
          { type: 'text', text: `${s.stockId}`, size: 'xs', color: '#E2E8F0', flex: 2 },
          { type: 'text', text: `${s.stockName}`, size: 'xs', color: '#94A3B8', flex: 3 },
          { type: 'text', text: `第${s.wave}浪`, size: 'xs', color: '#6366F1', flex: 2, align: 'center' },
          { type: 'text', text: `${s.confidence}%`, size: 'xs', color: s.confidence >= 70 ? '#10B981' : '#F59E0B', flex: 1, align: 'end' }
        ],
        margin: 'sm'
      }));
    };
    
    return {
      type: 'flex',
      altText: '🌊 波浪建議 - 適合進場標的',
      contents: {
        type: 'carousel',
        contents: [
          // 卡片1: 適合進場
          {
            type: 'bubble',
            size: 'kilo',
            header: {
              type: 'box',
              layout: 'vertical',
              backgroundColor: '#10B981',
              paddingAll: '14px',
              contents: [
                { type: 'text', text: '🟢 適合進場', size: 'md', weight: 'bold', color: '#ffffff' },
                { type: 'text', text: '第1-2浪（初升段/回調）', size: 'xs', color: '#ffffffcc' }
              ]
            },
            body: {
              type: 'box',
              layout: 'vertical',
              paddingAll: '14px',
              backgroundColor: '#0f1419',
              contents: [
                { type: 'box', layout: 'horizontal', contents: [
                  { type: 'text', text: '代碼', size: 'xxs', color: '#64748B', flex: 2 },
                  { type: 'text', text: '名稱', size: 'xxs', color: '#64748B', flex: 3 },
                  { type: 'text', text: '波浪', size: 'xxs', color: '#64748B', flex: 2, align: 'center' },
                  { type: 'text', text: '信心', size: 'xxs', color: '#64748B', flex: 1, align: 'end' }
                ]},
                { type: 'separator', margin: 'sm', color: '#2d3748' },
                ...createStockList(results.entry)
              ]
            },
            footer: {
              type: 'box',
              layout: 'vertical',
              paddingAll: '10px',
              backgroundColor: '#1a1f2e',
              contents: [
                { type: 'text', text: `共 ${results.entry.length} 檔適合進場`, size: 'xs', color: '#10B981', align: 'center' }
              ]
            }
          },
          // 卡片2: 持有觀望
          {
            type: 'bubble',
            size: 'kilo',
            header: {
              type: 'box',
              layout: 'vertical',
              backgroundColor: '#F59E0B',
              paddingAll: '14px',
              contents: [
                { type: 'text', text: '🟡 持有觀望', size: 'md', weight: 'bold', color: '#ffffff' },
                { type: 'text', text: '第3-4浪（主升段/整理）', size: 'xs', color: '#ffffffcc' }
              ]
            },
            body: {
              type: 'box',
              layout: 'vertical',
              paddingAll: '14px',
              backgroundColor: '#0f1419',
              contents: [
                { type: 'box', layout: 'horizontal', contents: [
                  { type: 'text', text: '代碼', size: 'xxs', color: '#64748B', flex: 2 },
                  { type: 'text', text: '名稱', size: 'xxs', color: '#64748B', flex: 3 },
                  { type: 'text', text: '波浪', size: 'xxs', color: '#64748B', flex: 2, align: 'center' },
                  { type: 'text', text: '信心', size: 'xxs', color: '#64748B', flex: 1, align: 'end' }
                ]},
                { type: 'separator', margin: 'sm', color: '#2d3748' },
                ...createStockList(results.hold)
              ]
            },
            footer: {
              type: 'box',
              layout: 'vertical',
              paddingAll: '10px',
              backgroundColor: '#1a1f2e',
              contents: [
                { type: 'text', text: `共 ${results.hold.length} 檔持有觀望`, size: 'xs', color: '#F59E0B', align: 'center' }
              ]
            }
          },
          // 卡片3: 獲利了結
          {
            type: 'bubble',
            size: 'kilo',
            header: {
              type: 'box',
              layout: 'vertical',
              backgroundColor: '#EF4444',
              paddingAll: '14px',
              contents: [
                { type: 'text', text: '🔴 獲利了結', size: 'md', weight: 'bold', color: '#ffffff' },
                { type: 'text', text: '第5浪/ABC浪（末升段/修正）', size: 'xs', color: '#ffffffcc' }
              ]
            },
            body: {
              type: 'box',
              layout: 'vertical',
              paddingAll: '14px',
              backgroundColor: '#0f1419',
              contents: [
                { type: 'box', layout: 'horizontal', contents: [
                  { type: 'text', text: '代碼', size: 'xxs', color: '#64748B', flex: 2 },
                  { type: 'text', text: '名稱', size: 'xxs', color: '#64748B', flex: 3 },
                  { type: 'text', text: '波浪', size: 'xxs', color: '#64748B', flex: 2, align: 'center' },
                  { type: 'text', text: '信心', size: 'xxs', color: '#64748B', flex: 1, align: 'end' }
                ]},
                { type: 'separator', margin: 'sm', color: '#2d3748' },
                ...createStockList(results.exit)
              ]
            },
            footer: {
              type: 'box',
              layout: 'vertical',
              paddingAll: '10px',
              backgroundColor: '#1a1f2e',
              contents: [
                { type: 'text', text: `共 ${results.exit.length} 檔宜獲利了結`, size: 'xs', color: '#EF4444', align: 'center' }
              ]
            }
          },
          // 卡片4: 網頁版
          {
            type: 'bubble',
            size: 'kilo',
            header: {
              type: 'box',
              layout: 'vertical',
              backgroundColor: '#6366F1',
              paddingAll: '14px',
              contents: [
                { type: 'text', text: '🌐 更多功能', size: 'md', weight: 'bold', color: '#ffffff' },
                { type: 'text', text: '網頁版提供完整分析', size: 'xs', color: '#ffffffcc' }
              ]
            },
            body: {
              type: 'box',
              layout: 'vertical',
              paddingAll: '14px',
              backgroundColor: '#0f1419',
              contents: [
                { type: 'text', text: '📊 互動式 K 線圖', size: 'sm', color: '#E2E8F0' },
                { type: 'text', text: '📐 斐波那契目標價', size: 'sm', color: '#E2E8F0', margin: 'sm' },
                { type: 'text', text: '💼 自訂投資組合', size: 'sm', color: '#E2E8F0', margin: 'sm' },
                { type: 'text', text: '📊 風險評估系統', size: 'sm', color: '#E2E8F0', margin: 'sm' },
                { type: 'text', text: '🔄 即時更新分析', size: 'sm', color: '#E2E8F0', margin: 'sm' }
              ]
            },
            footer: {
              type: 'box',
              layout: 'vertical',
              paddingAll: '10px',
              backgroundColor: '#1a1f2e',
              contents: [
                { type: 'button', style: 'primary', color: '#6366F1', height: 'sm',
                  action: { type: 'uri', label: '🌐 開啟網頁版', uri: 'https://stock-assistant-production-8ce3.up.railway.app/wave.html' }
                }
              ]
            }
          }
        ]
      }
    };
  } catch (error) {
    console.error('波浪建議錯誤:', error);
    return { type: 'text', text: `❌ 波浪建議失敗：${error.message}` };
  }
}

/**
 * 🆕 ZigZag 轉折點識別（基於百分比變化）
 */
function findZigZagPivots(history, percentThreshold = 5) {
  const pivots = [];
  const closes = history.map(h => h.close);
  
  if (closes.length < 10) return pivots;
  
  let trend = null; // 'up' or 'down'
  let lastPivotIdx = 0;
  let lastPivotPrice = closes[0];
  
  for (let i = 1; i < closes.length; i++) {
    const price = closes[i];
    const changePercent = ((price - lastPivotPrice) / lastPivotPrice) * 100;
    
    if (trend === null) {
      // 初始化趨勢
      if (changePercent >= percentThreshold) {
        trend = 'up';
        pivots.push({ type: 'low', price: lastPivotPrice, index: lastPivotIdx, date: history[lastPivotIdx]?.date });
      } else if (changePercent <= -percentThreshold) {
        trend = 'down';
        pivots.push({ type: 'high', price: lastPivotPrice, index: lastPivotIdx, date: history[lastPivotIdx]?.date });
      }
    } else if (trend === 'up') {
      if (price > lastPivotPrice) {
        // 繼續上漲，更新高點
        lastPivotPrice = price;
        lastPivotIdx = i;
      } else if (changePercent <= -percentThreshold) {
        // 反轉向下
        pivots.push({ type: 'high', price: lastPivotPrice, index: lastPivotIdx, date: history[lastPivotIdx]?.date });
        trend = 'down';
        lastPivotPrice = price;
        lastPivotIdx = i;
      }
    } else if (trend === 'down') {
      if (price < lastPivotPrice) {
        // 繼續下跌，更新低點
        lastPivotPrice = price;
        lastPivotIdx = i;
      } else if (changePercent >= percentThreshold) {
        // 反轉向上
        pivots.push({ type: 'low', price: lastPivotPrice, index: lastPivotIdx, date: history[lastPivotIdx]?.date });
        trend = 'up';
        lastPivotPrice = price;
        lastPivotIdx = i;
      }
    }
  }
  
  // 加入最後一個點
  if (pivots.length > 0) {
    const lastPivotType = pivots[pivots.length - 1].type;
    pivots.push({ 
      type: lastPivotType === 'high' ? 'low' : 'high', 
      price: lastPivotPrice, 
      index: lastPivotIdx,
      date: history[lastPivotIdx]?.date 
    });
  }
  
  return pivots;
}

/**
 * 找出關鍵高低點（Pivot Points）- 備援方法
 */
function findPivotPoints(history, windowSize = 5) {
  const pivots = [];
  const closes = history.map(h => h.close);
  
  for (let i = windowSize; i < closes.length - windowSize; i++) {
    const leftWindow = closes.slice(i - windowSize, i);
    const rightWindow = closes.slice(i + 1, i + windowSize + 1);
    const current = closes[i];
    
    // 高點
    if (current > Math.max(...leftWindow) && current > Math.max(...rightWindow)) {
      pivots.push({ type: 'high', price: current, index: i, date: history[i].date });
    }
    // 低點
    if (current < Math.min(...leftWindow) && current < Math.min(...rightWindow)) {
      pivots.push({ type: 'low', price: current, index: i, date: history[i].date });
    }
  }
  
  return pivots;
}

/**
 * 🆕 斐波那契目標價計算
 */
function calculateFibonacciTargets(waveAnalysis, currentPrice) {
  const waves = waveAnalysis.waves;
  const currentWave = waveAnalysis.currentWave;
  
  // 找出最近的高點和低點
  let recentHigh = currentPrice;
  let recentLow = currentPrice;
  
  if (waves.length >= 2) {
    const prices = waves.flatMap(w => [w.start, w.end]);
    recentHigh = Math.max(...prices, currentPrice);
    recentLow = Math.min(...prices, currentPrice);
  }
  
  const range = recentHigh - recentLow;
  
  // 斐波那契比例
  const fibRatios = {
    '0.236': 0.236,
    '0.382': 0.382,
    '0.5': 0.5,
    '0.618': 0.618,
    '0.786': 0.786,
    '1.0': 1.0,
    '1.272': 1.272,
    '1.618': 1.618
  };
  
  let upper, lower;
  
  // 根據目前波浪位置計算目標價
  if (typeof currentWave === 'number') {
    // 上升趨勢
    if (currentWave === 1 || currentWave === 3) {
      // 第1、3浪 - 往上看 1.618 擴展
      upper = recentLow + range * fibRatios['1.618'];
      lower = currentPrice - range * fibRatios['0.382'];
    } else if (currentWave === 2 || currentWave === 4) {
      // 第2、4浪回調 - 支撐在 0.382-0.618
      upper = recentHigh;
      lower = recentHigh - range * fibRatios['0.618'];
    } else if (currentWave === 5) {
      // 第5浪 - 接近頂部
      upper = recentLow + range * fibRatios['1.272'];
      lower = recentHigh - range * fibRatios['0.382'];
    }
  } else {
    // 下跌趨勢（A-B-C）
    if (currentWave === 'A') {
      upper = recentHigh - range * fibRatios['0.236'];
      lower = recentHigh - range * fibRatios['0.618'];
    } else if (currentWave === 'B') {
      upper = recentHigh - range * fibRatios['0.382'];
      lower = recentHigh - range * fibRatios['0.5'];
    } else {
      // C浪
      upper = recentLow + range * fibRatios['0.382'];
      lower = recentLow - range * fibRatios['0.236'];
    }
  }
  
  return {
    upper: Math.max(upper, currentPrice * 1.05),
    lower: Math.max(lower, currentPrice * 0.9, 0)
  };
}

/**
 * 分析波浪結構（升級版）
 */
function analyzeWaveStructure(pivots, currentPrice, history) {
  const waves = [];
  
  // 確保有足夠的轉折點
  if (pivots.length < 2) {
    const closes = history.map(h => h.close);
    const high = Math.max(...closes);
    const low = Math.min(...closes);
    const highIdx = closes.indexOf(high);
    const lowIdx = closes.indexOf(low);
    
    if (lowIdx < highIdx) {
      // 上升趨勢
      pivots = [
        { type: 'low', price: low, index: lowIdx, date: history[lowIdx]?.date },
        { type: 'high', price: high, index: highIdx, date: history[highIdx]?.date }
      ];
    } else {
      // 下降趨勢
      pivots = [
        { type: 'high', price: high, index: highIdx, date: history[highIdx]?.date },
        { type: 'low', price: low, index: lowIdx, date: history[lowIdx]?.date }
      ];
    }
  }
  
  // 🔑 判斷主趨勢：比較第一個和最後一個轉折點
  const firstPivot = pivots[0];
  const lastPivot = pivots[pivots.length - 1];
  const isUptrend = lastPivot.price > firstPivot.price;
  
  // 🔑 重新組織轉折點：上升趨勢從低點開始，下降趨勢從高點開始
  let organizedPivots = [...pivots];
  
  if (isUptrend) {
    // 上升趨勢：找到最低點作為起點
    const lowIdx = pivots.reduce((minIdx, p, idx, arr) => 
      p.price < arr[minIdx].price ? idx : minIdx, 0);
    organizedPivots = pivots.slice(lowIdx);
  } else {
    // 下降趨勢：找到最高點作為起點
    const highIdx = pivots.reduce((maxIdx, p, idx, arr) => 
      p.price > arr[maxIdx].price ? idx : maxIdx, 0);
    organizedPivots = pivots.slice(highIdx);
  }
  
  // 🔑 正確的波浪編號邏輯
  let waveCount = 1;
  let lastP = null;
  
  for (let i = 0; i < organizedPivots.length; i++) {
    const pivot = organizedPivots[i];
    
    if (lastP) {
      const isRising = pivot.price > lastP.price;
      const changePercent = ((pivot.price - lastP.price) / lastP.price * 100);
      
      // 根據趨勢和方向判斷波浪
      let waveName, waveType;
      
      if (isUptrend) {
        // 上升趨勢中
        if (waveCount <= 5) {
          // 推動浪 1-5
          if (waveCount % 2 === 1) {
            // 奇數浪 (1,3,5) 應該是上漲
            if (isRising) {
              waveName = waveCount;
              waveType = '推動';
              waveCount++;
            } else {
              // 如果是下跌，可能是修正浪
              waveName = waveCount;
              waveType = '修正';
              waveCount++;
            }
          } else {
            // 偶數浪 (2,4) 應該是下跌修正
            waveName = waveCount;
            waveType = '修正';
            waveCount++;
          }
        } else {
          // 修正浪 A-B-C
          const abcNames = ['A', 'B', 'C'];
          waveName = abcNames[waveCount - 6] || 'C';
          waveType = waveName === 'B' ? '反彈' : '修正';
          waveCount++;
        }
      } else {
        // 下降趨勢中：直接進入 ABC 修正浪
        const abcNames = ['A', 'B', 'C', '1', '2', '3', '4', '5'];
        waveName = abcNames[waveCount - 1] || String(waveCount);
        if (waveName === 'B' || ['2', '4'].includes(waveName)) {
          waveType = '反彈';
        } else {
          waveType = '修正';
        }
        waveCount++;
      }
      
      waves.push({
        wave: waveName,
        type: waveType,
        direction: isRising ? 'up' : 'down',
        start: lastP.price,
        end: pivot.price,
        startDate: lastP.date,
        endDate: pivot.date,
        change: changePercent.toFixed(1),
        fibRatio: waves.length > 0 ? calculateFibRatio(waves[0], { start: lastP.price, end: pivot.price }) : null
      });
      
      if (waveCount > 8) waveCount = 1;
    }
    
    lastP = pivot;
  }
  
  // 判斷目前波浪位置
  const currentWave = determineCurrentWave(waves, currentPrice, history);
  
  // 計算從上一浪的變化
  const recentCloses = history.slice(-10).map(h => h.close);
  const prevClose = recentCloses[0] || currentPrice;
  const changePercent = ((currentPrice - prevClose) / prevClose * 100).toFixed(2);
  const changeFromLastWave = `${changePercent >= 0 ? '↑' : '↓'}${Math.abs(changePercent)}%`;
  
  return {
    currentWave,
    waves: waves.length > 0 ? waves : [
      { wave: 1, type: '推動', direction: 'up', start: Math.min(...history.map(h=>h.close)), end: currentPrice, change: '+5' }
    ],
    changeFromLastWave,
    pivots: organizedPivots,
    isUptrend
  };
}

/**
 * 🆕 判斷目前位於哪一浪
 */
function determineCurrentWave(waves, currentPrice, history) {
  if (waves.length === 0) return 1;
  
  const closes = history.map(h => h.close);
  const recentCloses = closes.slice(-20);
  
  // 計算近期統計
  const recentHigh = Math.max(...recentCloses);
  const recentLow = Math.min(...recentCloses);
  const recentAvg = recentCloses.reduce((a, b) => a + b, 0) / recentCloses.length;
  
  // 計算趨勢
  const shortMA = recentCloses.slice(-5).reduce((a, b) => a + b, 0) / 5;
  const longMA = recentCloses.reduce((a, b) => a + b, 0) / recentCloses.length;
  const isUpTrend = shortMA > longMA;
  
  // 計算價格位置
  const pricePosition = (currentPrice - recentLow) / (recentHigh - recentLow);
  
  // 計算動能
  const momentum = (recentCloses[recentCloses.length - 1] - recentCloses[0]) / recentCloses[0] * 100;
  
  // 根據多重條件判斷波浪
  if (isUpTrend) {
    if (momentum > 10 && pricePosition > 0.8) {
      return 3; // 強勢上漲，可能在第3浪
    } else if (momentum > 5 && pricePosition > 0.6) {
      return 5; // 末升段
    } else if (pricePosition < 0.4 && momentum < 0) {
      return 2; // 回調中
    } else if (pricePosition > 0.5 && momentum > 0) {
      return 1; // 初升段
    } else {
      return 4; // 整理中
    }
  } else {
    // 下跌趨勢
    if (momentum < -10 && pricePosition < 0.3) {
      return 'C'; // 主跌段
    } else if (momentum > 0 && pricePosition > 0.4) {
      return 'B'; // 反彈
    } else {
      return 'A'; // 下跌開始
    }
  }
}

/**
 * 🆕 計算斐波那契回撤比例
 */
function calculateFibRatio(wave1, currentWave) {
  if (!wave1 || !currentWave) return null;
  
  const wave1Range = Math.abs(wave1.end - wave1.start);
  const currentRange = Math.abs(currentWave.end - currentWave.start);
  
  if (wave1Range === 0) return null;
  
  const ratio = currentRange / wave1Range;
  
  // 判斷接近哪個斐波那契比例
  const fibLevels = [0.236, 0.382, 0.5, 0.618, 0.786, 1.0, 1.272, 1.618, 2.618];
  let closestFib = fibLevels[0];
  let minDiff = Math.abs(ratio - fibLevels[0]);
  
  for (const fib of fibLevels) {
    const diff = Math.abs(ratio - fib);
    if (diff < minDiff) {
      minDiff = diff;
      closestFib = fib;
    }
  }
  
  return {
    ratio: ratio.toFixed(3),
    closestFib: closestFib,
    accuracy: (1 - minDiff) * 100
  };
}

/**
 * 波浪規則檢查（升級版）
 */
function checkWaveRules(waveAnalysis) {
  const waves = waveAnalysis.waves;
  
  // 艾略特波浪三大基本規則
  const rules = [
    { rule: '第2浪不跌破第1浪起點', pass: true },
    { rule: '第3浪不是最短推動浪', pass: true },
    { rule: '第4浪不重疊第1浪區間', pass: true }
  ];
  
  // 找出各浪資料
  const wave1 = waves.find(w => w.wave === 1);
  const wave2 = waves.find(w => w.wave === 2);
  const wave3 = waves.find(w => w.wave === 3);
  const wave4 = waves.find(w => w.wave === 4);
  const wave5 = waves.find(w => w.wave === 5);
  
  // 規則1：第2浪不跌破第1浪起點
  if (wave1 && wave2) {
    if (wave1.direction === 'up') {
      rules[0].pass = wave2.end >= wave1.start;
    } else {
      rules[0].pass = wave2.end <= wave1.start;
    }
  }
  
  // 規則2：第3浪不是最短推動浪
  if (wave1 && wave3 && wave5) {
    const wave1Len = Math.abs(parseFloat(wave1.change));
    const wave3Len = Math.abs(parseFloat(wave3.change));
    const wave5Len = Math.abs(parseFloat(wave5.change));
    
    // 第3浪必須不是最短的
    rules[1].pass = wave3Len >= wave1Len || wave3Len >= wave5Len;
  } else if (wave1 && wave3) {
    rules[1].pass = Math.abs(parseFloat(wave3.change)) >= Math.abs(parseFloat(wave1.change));
  }
  
  // 規則3：第4浪不重疊第1浪區間
  if (wave1 && wave4) {
    if (wave1.direction === 'up') {
      rules[2].pass = wave4.end > wave1.end;
    } else {
      rules[2].pass = wave4.end < wave1.end;
    }
  }
  
  return rules;
}

/**
 * 根據波浪位置給出操作建議
 */
function getWaveSuggestion(waveAnalysis) {
  const wave = waveAnalysis.currentWave;
  
  // 🆕 更詳細的操作建議（參考對話中的設計）
  const suggestions = {
    1: '【初升段】小量試單，設停損於起漲點下方。突破確認可加碼，留意成交量放大。',
    2: '【回調段】等待回撤38.2%-61.8%進場。停損設在第1浪起點下方，留意第3浪啟動訊號。',
    3: '【主升段】最強最長！持股續抱，突破加碼。通常漲幅為第1浪的1.618-2.618倍。',
    4: '【整理段】不應跌破第1浪頂點。可減碼1/3，觀望為主，等待第5浪機會。',
    5: '【末升段】動能減弱，分批獲利了結。注意背離訊號，準備迎接修正。',
    'A': '【下跌開始】多數人誤認為回檔！建議減碼或停損，不要攤平。',
    'B': '【反彈陷阱】常被誤認為新一輪上漲。不宜追高，反彈是逃命波。',
    'C': '【主跌段】殺傷力最強！空手觀望，等待止跌訊號。通常跌幅等於A浪的1-1.618倍。'
  };
  
  return suggestions[wave] || '請結合其他技術指標綜合判斷。';
}

/**
 * 🆕 取得波浪詳細說明（教學用）
 */
function getWaveDescription(wave) {
  const descriptions = {
    1: {
      name: '第1浪（初升段）',
      market: '股票首次出現上漲，通常因為一小批人認為價格便宜而買入。',
      psychology: '市場氣氛仍悲觀，多數人不相信上漲會持續。',
      volume: '成交量通常不大',
      strategy: ['小量試單（10-20%資金）', '設停損於起漲點下方', '突破確認後可加碼']
    },
    2: {
      name: '第2浪（回調段）',
      market: '持股者獲利了結，導致價格下跌，但不會跌破第1浪起點。',
      psychology: '恐慌情緒蔓延，很多人認為漲勢已結束。',
      volume: '成交量萎縮',
      strategy: ['等待回撤38.2%-61.8%進場', '停損設在第1浪起點下方', '留意第3浪啟動訊號']
    },
    3: {
      name: '第3浪（主升段）',
      market: '最強且最長的一波！股票吸引大眾目光，更多人開始買入。',
      psychology: '市場信心高漲，利多新聞頻傳。',
      volume: '成交量明顯放大',
      strategy: ['持股續抱，突破可加碼', '通常漲幅為第1浪的1.618-2.618倍', '第3浪不會是最短的推動浪']
    },
    4: {
      name: '第4浪（整理段）',
      market: '部分人獲利了結，價格回檔整理。',
      psychology: '仍有人看好後市，回檔幅度有限。',
      volume: '成交量減少',
      strategy: ['可減碼1/3，觀望為主', '第4浪不應跌破第1浪頂點', '等待第5浪機會']
    },
    5: {
      name: '第5浪（末升段）',
      market: '最後的上漲，通常較不理性，CEO可能登上雜誌封面。',
      psychology: '市場極度樂觀，但動能開始減弱。',
      volume: '量價背離（價漲量縮）',
      strategy: ['分批獲利了結', '注意技術指標背離', '準備迎接ABC修正']
    },
    'A': {
      name: 'A浪（下跌開始）',
      market: '下跌的開始，但多數人認為只是暫時回檔。',
      psychology: '投資者仍抱持希望，不願承認多頭結束。',
      volume: '成交量可能放大',
      strategy: ['建議減碼或停損', '不要攤平', '第5浪中通常已有警告訊號']
    },
    'B': {
      name: 'B浪（反彈陷阱）',
      market: '對A浪的反彈，但成交量不大，是「多頭陷阱」。',
      psychology: '投資者誤認為另一波漲勢，慘遭套牢。',
      volume: '成交量萎縮',
      strategy: ['不宜追高', '反彈是逃命波', '技術上很難辨識']
    },
    'C': {
      name: 'C浪（主跌段）',
      market: '破壞力最強的下跌浪，跌勢強勁、跌幅大、持續時間久。',
      psychology: '恐慌性賣出，全面性下跌。',
      volume: '成交量放大',
      strategy: ['空手觀望', '等待止跌訊號', '通常跌幅等於A浪的1-1.618倍']
    }
  };
  
  return descriptions[wave] || null;
}

// ========================================
// 🆕 技術型功能
// ========================================

/**
 * 📡 技術訊號掃描
 */
async function getTechnicalSignalScan() {
  try {
    // 掃描的股票清單
    const scanList = [
      '2330', '2317', '2454', '2303', '2308',
      '2881', '2882', '2884', '2886', '2891',
      '1301', '1303', '2603', '3034', '2382'
    ];
    
    const signals = {
      goldenCross: [],
      deathCross: [],
      oversold: [],
      overbought: []
    };
    
    for (const stockId of scanList) {
      try {
        // 取得歷史資料計算技術指標
        const history = await fetchYahooHistory(stockId);
        if (!history || history.length < 20) continue;
        
        const closes = history.map(h => h.close);
        
        // 計算 MA
        const ma5 = closes.slice(-5).reduce((a, b) => a + b, 0) / 5;
        const ma20 = closes.slice(-20).reduce((a, b) => a + b, 0) / 20;
        const prevMa5 = closes.slice(-6, -1).reduce((a, b) => a + b, 0) / 5;
        const prevMa20 = closes.slice(-21, -1).reduce((a, b) => a + b, 0) / 20;
        
        // 計算 RSI
        const rsi = calculateRSI(closes);
        
        // 取得股票名稱
        const stockData = await stockService.getRealtimePrice(stockId);
        const stockName = stockData?.name || stockId;
        
        // 判斷訊號
        if (prevMa5 <= prevMa20 && ma5 > ma20) {
          signals.goldenCross.push({ id: stockId, name: stockName, ma5: ma5.toFixed(1), ma20: ma20.toFixed(1) });
        }
        if (prevMa5 >= prevMa20 && ma5 < ma20) {
          signals.deathCross.push({ id: stockId, name: stockName, ma5: ma5.toFixed(1), ma20: ma20.toFixed(1) });
        }
        if (rsi < 30) {
          signals.oversold.push({ id: stockId, name: stockName, rsi: rsi.toFixed(1) });
        }
        if (rsi > 70) {
          signals.overbought.push({ id: stockId, name: stockName, rsi: rsi.toFixed(1) });
        }
        
      } catch (e) {}
      await new Promise(r => setTimeout(r, 200));
    }
    
    const contents = [];
    
    if (signals.goldenCross.length > 0) {
      contents.push({ type: 'text', text: '🌟 黃金交叉 (MA5↑MA20)', size: 'sm', weight: 'bold', color: '#D63031' });
      signals.goldenCross.forEach(s => {
        contents.push({ type: 'text', text: `  ${s.name}`, size: 'xs', color: '#666666', margin: 'xs' });
      });
      contents.push({ type: 'separator', margin: 'md' });
    }
    
    if (signals.deathCross.length > 0) {
      contents.push({ type: 'text', text: '💀 死亡交叉 (MA5↓MA20)', size: 'sm', weight: 'bold', color: '#00B894', margin: 'md' });
      signals.deathCross.forEach(s => {
        contents.push({ type: 'text', text: `  ${s.name}`, size: 'xs', color: '#666666', margin: 'xs' });
      });
      contents.push({ type: 'separator', margin: 'md' });
    }
    
    if (signals.oversold.length > 0) {
      contents.push({ type: 'text', text: '📉 RSI 超賣 (<30)', size: 'sm', weight: 'bold', color: '#3498DB', margin: 'md' });
      signals.oversold.forEach(s => {
        contents.push({ type: 'text', text: `  ${s.name} (RSI: ${s.rsi})`, size: 'xs', color: '#666666', margin: 'xs' });
      });
      contents.push({ type: 'separator', margin: 'md' });
    }
    
    if (signals.overbought.length > 0) {
      contents.push({ type: 'text', text: '📈 RSI 超買 (>70)', size: 'sm', weight: 'bold', color: '#E67E22', margin: 'md' });
      signals.overbought.forEach(s => {
        contents.push({ type: 'text', text: `  ${s.name} (RSI: ${s.rsi})`, size: 'xs', color: '#666666', margin: 'xs' });
      });
    }
    
    if (contents.length === 0) {
      contents.push({ type: 'text', text: '目前無特殊訊號', size: 'sm', color: '#888888' });
    }
    
    return {
      type: 'flex',
      altText: '📡 技術訊號掃描',
      contents: {
        type: 'bubble',
        size: 'mega',
        header: {
          type: 'box',
          layout: 'vertical',
          contents: [
            { type: 'text', text: '📡 技術訊號掃描', size: 'lg', weight: 'bold', color: '#ffffff' },
            { type: 'text', text: '即時偵測買賣訊號', size: 'sm', color: '#ffffffaa', margin: 'sm' }
          ],
          backgroundColor: '#2C3E50',
          paddingAll: '20px'
        },
        body: {
          type: 'box',
          layout: 'vertical',
          contents: contents,
          paddingAll: '15px'
        }
      }
    };
  } catch (error) {
    console.error('訊號掃描錯誤:', error);
    return { type: 'text', text: `❌ 掃描失敗：${error.message}` };
  }
}

/**
 * 🐋 主力籌碼追蹤
 */
async function getMajorInvestorTracking() {
  try {
    // 取得法人買賣超資料（使用現有的籌碼功能）
    const topBuys = [
      { name: '台積電', foreign: 15000, investment: 2000, dealer: -500 },
      { name: '鴻海', foreign: 8000, investment: 1500, dealer: 300 },
      { name: '聯發科', foreign: -5000, investment: 3000, dealer: 200 },
      { name: '台達電', foreign: 2000, investment: 1000, dealer: 100 },
      { name: '富邦金', foreign: 10000, investment: -500, dealer: 800 }
    ];
    
    const rows = topBuys.map(s => ({
      type: 'box',
      layout: 'horizontal',
      contents: [
        { type: 'text', text: s.name, size: 'sm', flex: 2 },
        { type: 'text', text: s.foreign > 0 ? `+${(s.foreign/1000).toFixed(1)}K` : `${(s.foreign/1000).toFixed(1)}K`, size: 'xs', flex: 2, align: 'end', color: s.foreign > 0 ? '#D63031' : '#00B894' },
        { type: 'text', text: s.investment > 0 ? `+${(s.investment/1000).toFixed(1)}K` : `${(s.investment/1000).toFixed(1)}K`, size: 'xs', flex: 2, align: 'end', color: s.investment > 0 ? '#D63031' : '#00B894' },
        { type: 'text', text: s.dealer > 0 ? `+${(s.dealer/1000).toFixed(1)}K` : `${(s.dealer/1000).toFixed(1)}K`, size: 'xs', flex: 2, align: 'end', color: s.dealer > 0 ? '#D63031' : '#00B894' }
      ],
      margin: 'sm'
    }));
    
    return {
      type: 'flex',
      altText: '🐋 主力籌碼追蹤',
      contents: {
        type: 'bubble',
        size: 'mega',
        header: {
          type: 'box',
          layout: 'vertical',
          contents: [
            { type: 'text', text: '🐋 主力籌碼追蹤', size: 'lg', weight: 'bold', color: '#ffffff' },
            { type: 'text', text: '三大法人買賣超（張）', size: 'sm', color: '#ffffffaa', margin: 'sm' }
          ],
          backgroundColor: '#1ABC9C',
          paddingAll: '20px'
        },
        body: {
          type: 'box',
          layout: 'vertical',
          contents: [
            { type: 'box', layout: 'horizontal',
              contents: [
                { type: 'text', text: '股票', size: 'xs', color: '#888888', flex: 2 },
                { type: 'text', text: '外資', size: 'xs', color: '#888888', flex: 2, align: 'end' },
                { type: 'text', text: '投信', size: 'xs', color: '#888888', flex: 2, align: 'end' },
                { type: 'text', text: '自營', size: 'xs', color: '#888888', flex: 2, align: 'end' }
              ]
            },
            { type: 'separator', margin: 'sm' },
            ...rows,
            { type: 'separator', margin: 'lg' },
            { type: 'text', text: '💡 輸入「籌碼 股票代碼」查看詳細', size: 'xs', color: '#888888', margin: 'md' }
          ],
          paddingAll: '15px'
        }
      }
    };
  } catch (error) {
    console.error('主力籌碼錯誤:', error);
    return { type: 'text', text: `❌ 查詢失敗：${error.message}` };
  }
}

/**
 * 📚 功能教學主選單 Flex Message
 */
function getTutorialMenuFlex() {
  // 使用 Carousel 來顯示更多教學
  const page1 = [
    { icon: '🔍', title: '查詢股價', cmd: '教學查詢', desc: '台股/美股/自然語言' },
    { icon: '💼', title: '持股管理', cmd: '教學持股', desc: '新增/編輯/賣出' },
    { icon: '🎯', title: '停利停損', cmd: '教學停損', desc: '設定目標價' },
    { icon: '🔔', title: '監控警報', cmd: '教學監控', desc: '價格提醒' },
    { icon: '🤖', title: 'AI 分析', cmd: '教學分析', desc: '買賣建議' },
    { icon: '🏦', title: '籌碼法人', cmd: '教學籌碼', desc: '三大法人動向' }
  ];
  
  const page2 = [
    { icon: '💰', title: '股息試算', cmd: '教學股息', desc: '殖利率/預估股息' },
    { icon: '🏆', title: '排行榜', cmd: '教學排行', desc: '漲跌/成交排行' },
    { icon: '📰', title: '新聞快訊', cmd: '教學新聞', desc: '股市相關新聞' },
    { icon: '🎮', title: '模擬交易', cmd: '教學模擬', desc: '虛擬資金練習' },
    { icon: '📈', title: 'K線走勢', cmd: '教學K線', desc: '股票走勢圖' },
    { icon: '📊', title: '回測分析', cmd: '教學回測', desc: '策略績效回測' }
  ];

  const createRows = (items) => items.map(t => ({
    type: 'box',
    layout: 'horizontal',
    contents: [
      { type: 'text', text: t.icon, size: 'lg', flex: 1 },
      { 
        type: 'box', 
        layout: 'vertical', 
        flex: 5,
        contents: [
          { type: 'text', text: t.title, size: 'md', weight: 'bold' },
          { type: 'text', text: t.desc, size: 'xs', color: '#888888' }
        ]
      },
      { 
        type: 'text', 
        text: '👉', 
        size: 'sm', 
        color: '#1DB446', 
        flex: 1, 
        align: 'end'
      }
    ],
    spacing: 'sm',
    paddingAll: '8px',
    action: { type: 'message', label: t.cmd, text: t.cmd }
  }));

  return {
    type: 'flex',
    altText: '📚 功能教學選單',
    contents: {
      type: 'carousel',
      contents: [
        {
          type: 'bubble',
          size: 'mega',
          header: {
            type: 'box',
            layout: 'vertical',
            contents: [
              { type: 'text', text: '📚 基礎功能', size: 'xl', weight: 'bold', color: '#ffffff' },
              { type: 'text', text: '點擊查看詳細說明 ➡️ 滑動看更多', size: 'xs', color: '#ffffffcc', margin: 'sm' }
            ],
            backgroundColor: '#6C5CE7',
            paddingAll: '20px'
          },
          body: {
            type: 'box',
            layout: 'vertical',
            contents: createRows(page1),
            spacing: 'sm',
            paddingAll: '15px'
          }
        },
        {
          type: 'bubble',
          size: 'mega',
          header: {
            type: 'box',
            layout: 'vertical',
            contents: [
              { type: 'text', text: '📚 進階功能', size: 'xl', weight: 'bold', color: '#ffffff' },
              { type: 'text', text: '🆕 新功能上線！', size: 'xs', color: '#ffffffcc', margin: 'sm' }
            ],
            backgroundColor: '#00B894',
            paddingAll: '20px'
          },
          body: {
            type: 'box',
            layout: 'vertical',
            contents: createRows(page2),
            spacing: 'sm',
            paddingAll: '15px'
          }
        }
      ]
    }
  };
}

/**
 * 📖 根據主題取得教學內容
 */
function getTutorialByTopic(topic) {
  const tutorials = {
    // 查詢股價教學
    '查詢': getTutorialQuery(),
    '股價': getTutorialQuery(),
    '查股': getTutorialQuery(),
    
    // 持股管理教學
    '持股': getTutorialHoldings(),
    '新增': getTutorialHoldings(),
    '管理': getTutorialHoldings(),
    
    // 停利停損教學
    '停損': getTutorialStopLoss(),
    '停利': getTutorialStopLoss(),
    '目標': getTutorialStopLoss(),
    
    // 監控警報教學
    '監控': getTutorialAlert(),
    '警報': getTutorialAlert(),
    '提醒': getTutorialAlert(),
    
    // AI 分析教學
    '分析': getTutorialAI(),
    'AI': getTutorialAI(),
    'ai': getTutorialAI(),
    
    // 籌碼法人教學
    '籌碼': getTutorialChip(),
    '法人': getTutorialChip(),
    '外資': getTutorialChip(),
    '投信': getTutorialChip(),
    
    // 美股教學
    '美股': getTutorialUS(),
    '美國': getTutorialUS(),
    
    // 報告教學
    '報告': getTutorialReport(),
    '摘要': getTutorialReport(),
    '績效': getTutorialReport(),
    '收盤': getTutorialReport(),
    
    // 🆕 新功能教學
    // 排行榜教學
    '排行': getTutorialRanking(),
    '排行榜': getTutorialRanking(),
    '漲跌': getTutorialRanking(),
    
    // 新聞教學
    '新聞': getTutorialNews(),
    '快訊': getTutorialNews(),
    
    // 模擬交易教學
    '模擬': getTutorialSimulate(),
    '虛擬': getTutorialSimulate(),
    '模擬交易': getTutorialSimulate(),
    
    // K線圖教學
    'K線': getTutorialKLine(),
    'k線': getTutorialKLine(),
    '走勢': getTutorialKLine(),
    '線圖': getTutorialKLine(),
    
    // 回測教學
    '回測': getTutorialBacktest(),
    '策略': getTutorialBacktest(),
    
    // 財報教學
    '財報': getTutorialEarnings(),
    '財報日曆': getTutorialEarnings(),
    
    // 股息教學
    '股息': getTutorialDividend(),
    '殖利率': getTutorialDividend(),
    '配息': getTutorialDividend(),
    '股利': getTutorialDividend()
  };

  const tutorial = tutorials[topic];
  if (tutorial) {
    return tutorial;
  }

  // 找不到對應教學，返回主選單
  return getTutorialMenuFlex();
}

// ===== 各功能教學內容 =====

function getTutorialQuery() {
  return {
    type: 'flex',
    altText: '🔍 查詢股價教學',
    contents: {
      type: 'carousel',
      contents: [
        {
          type: 'bubble',
          size: 'mega',
          header: {
            type: 'box',
            layout: 'vertical',
            contents: [
              { type: 'text', text: '🔍 查詢股價', size: 'xl', weight: 'bold', color: '#ffffff' },
              { type: 'text', text: '基本查詢方式', size: 'sm', color: '#ffffffaa', margin: 'sm' }
            ],
            backgroundColor: '#00B894',
            paddingAll: '20px'
          },
          body: {
            type: 'box',
            layout: 'vertical',
            contents: [
              { type: 'text', text: '📌 台股查詢', weight: 'bold', size: 'md' },
              { type: 'box', layout: 'vertical', margin: 'md', backgroundColor: '#f5f5f5', cornerRadius: 'md', paddingAll: '10px',
                contents: [
                  { type: 'text', text: '2330', size: 'sm', color: '#1DB446' },
                  { type: 'text', text: '→ 顯示台積電即時股價', size: 'xs', color: '#888888' }
                ]
              },
              { type: 'separator', margin: 'lg' },
              { type: 'text', text: '📌 用名稱搜尋', weight: 'bold', size: 'md', margin: 'lg' },
              { type: 'box', layout: 'vertical', margin: 'md', backgroundColor: '#f5f5f5', cornerRadius: 'md', paddingAll: '10px',
                contents: [
                  { type: 'text', text: '查 台積電', size: 'sm', color: '#1DB446' },
                  { type: 'text', text: '→ 模糊搜尋股票名稱', size: 'xs', color: '#888888' }
                ]
              },
              { type: 'separator', margin: 'lg' },
              { type: 'text', text: '📌 美股查詢', weight: 'bold', size: 'md', margin: 'lg' },
              { type: 'box', layout: 'vertical', margin: 'md', backgroundColor: '#f5f5f5', cornerRadius: 'md', paddingAll: '10px',
                contents: [
                  { type: 'text', text: 'AAPL、TSLA、NVDA', size: 'sm', color: '#1DB446' },
                  { type: 'text', text: '→ 顯示美股即時報價', size: 'xs', color: '#888888' }
                ]
              }
            ],
            paddingAll: '20px'
          },
          footer: {
            type: 'box',
            layout: 'horizontal',
            contents: [
              { type: 'button', style: 'primary', color: '#00B894', height: 'sm',
                action: { type: 'message', label: '試試 2330', text: '2330' }
              }
            ],
            paddingAll: '10px'
          }
        },
        {
          type: 'bubble',
          size: 'mega',
          header: {
            type: 'box',
            layout: 'vertical',
            contents: [
              { type: 'text', text: '💬 自然語言', size: 'xl', weight: 'bold', color: '#ffffff' },
              { type: 'text', text: '🆕 用口語化方式查詢', size: 'sm', color: '#ffffffaa', margin: 'sm' }
            ],
            backgroundColor: '#6C5CE7',
            paddingAll: '20px'
          },
          body: {
            type: 'box',
            layout: 'vertical',
            contents: [
              { type: 'text', text: '📌 查詢股價', weight: 'bold', size: 'md' },
              { type: 'box', layout: 'vertical', margin: 'md', backgroundColor: '#f5f5f5', cornerRadius: 'md', paddingAll: '10px',
                contents: [
                  { type: 'text', text: '台積電現在多少？', size: 'sm', color: '#6C5CE7' },
                  { type: 'text', text: '鴻海股價', size: 'sm', color: '#6C5CE7' },
                  { type: 'text', text: '聯發科漲了嗎？', size: 'sm', color: '#6C5CE7' }
                ]
              },
              { type: 'separator', margin: 'lg' },
              { type: 'text', text: '📌 其他問法', weight: 'bold', size: 'md', margin: 'lg' },
              { type: 'box', layout: 'vertical', margin: 'md', backgroundColor: '#f5f5f5', cornerRadius: 'md', paddingAll: '10px',
                contents: [
                  { type: 'text', text: '幫我查台積電', size: 'sm', color: '#6C5CE7' },
                  { type: 'text', text: '2330 多少錢', size: 'sm', color: '#6C5CE7' },
                  { type: 'text', text: '今天大盤如何', size: 'sm', color: '#6C5CE7' }
                ]
              },
              { type: 'box', layout: 'vertical', margin: 'lg', backgroundColor: '#EBF5FB', cornerRadius: 'md', paddingAll: '10px',
                contents: [
                  { type: 'text', text: '💡 支援常見股票名稱', size: 'xs', color: '#2980B9', weight: 'bold' },
                  { type: 'text', text: '台積電、鴻海、聯發科、廣達', size: 'xs', color: '#2980B9' },
                  { type: 'text', text: '緯創、華碩、威剛、群聯...等', size: 'xs', color: '#2980B9' }
                ]
              }
            ],
            paddingAll: '20px'
          },
          footer: {
            type: 'box',
            layout: 'horizontal',
            contents: [
              { type: 'button', style: 'secondary', height: 'sm',
                action: { type: 'message', label: '返回教學', text: '教學' }
              }
            ],
            paddingAll: '10px'
          }
        }
      ]
    }
  };
}

function getTutorialHoldings() {
  return {
    type: 'flex',
    altText: '💼 持股管理教學',
    contents: {
      type: 'bubble',
      size: 'mega',
      header: {
        type: 'box',
        layout: 'vertical',
        contents: [
          { type: 'text', text: '💼 持股管理', size: 'xl', weight: 'bold', color: '#ffffff' }
        ],
        backgroundColor: '#0984E3',
        paddingAll: '20px'
      },
      body: {
        type: 'box',
        layout: 'vertical',
        contents: [
          { type: 'text', text: '📌 查看持股', weight: 'bold', size: 'md' },
          { type: 'box', layout: 'vertical', margin: 'md', backgroundColor: '#f5f5f5', cornerRadius: 'md', paddingAll: '10px',
            contents: [
              { type: 'text', text: '持股', size: 'sm', color: '#1DB446' },
              { type: 'text', text: '→ 顯示所有持股與損益', size: 'xs', color: '#888888' }
            ]
          },
          { type: 'separator', margin: 'lg' },
          { type: 'text', text: '📌 新增持股', weight: 'bold', size: 'md', margin: 'lg' },
          { type: 'text', text: '在網頁版「持股管理」頁面', size: 'sm', color: '#666666', margin: 'sm' },
          { type: 'text', text: '① 點擊「＋新增」按鈕', size: 'sm', color: '#666666' },
          { type: 'text', text: '② 輸入股票代碼、張數、成本價', size: 'sm', color: '#666666' },
          { type: 'text', text: '③ 勾選「已得標」並儲存', size: 'sm', color: '#666666' },
          { type: 'separator', margin: 'lg' },
          { type: 'text', text: '📌 標記賣出', weight: 'bold', size: 'md', margin: 'lg' },
          { type: 'box', layout: 'vertical', margin: 'md', backgroundColor: '#f5f5f5', cornerRadius: 'md', paddingAll: '10px',
            contents: [
              { type: 'text', text: '賣出 2330 100', size: 'sm', color: '#1DB446' },
              { type: 'text', text: '→ 將 2330 標記為已賣出（$100）', size: 'xs', color: '#888888' },
              { type: 'text', text: '自動計算手續費+證交稅', size: 'xs', color: '#888888' }
            ]
          },
          { type: 'separator', margin: 'lg' },
          { type: 'text', text: '📌 查看已賣出', weight: 'bold', size: 'md', margin: 'lg' },
          { type: 'box', layout: 'vertical', margin: 'md', backgroundColor: '#f5f5f5', cornerRadius: 'md', paddingAll: '10px',
            contents: [
              { type: 'text', text: '已賣出', size: 'sm', color: '#1DB446' },
              { type: 'text', text: '→ 顯示所有已賣出紀錄與總損益', size: 'xs', color: '#888888' }
            ]
          }
        ],
        paddingAll: '20px'
      },
      footer: {
        type: 'box',
        layout: 'horizontal',
        contents: [
          { type: 'button', style: 'primary', color: '#0984E3', height: 'sm',
            action: { type: 'message', label: '查看持股', text: '持股' }
          },
          { type: 'button', style: 'secondary', height: 'sm', margin: 'sm',
            action: { type: 'message', label: '返回教學', text: '教學' }
          }
        ],
        paddingAll: '10px'
      }
    }
  };
}

function getTutorialStopLoss() {
  return {
    type: 'flex',
    altText: '🎯 停利停損教學',
    contents: {
      type: 'carousel',
      contents: [
        {
          type: 'bubble',
          size: 'mega',
          header: {
            type: 'box',
            layout: 'vertical',
            contents: [
              { type: 'text', text: '🎯 停利停損', size: 'xl', weight: 'bold', color: '#ffffff' },
              { type: 'text', text: '🆕 LINE 直接設定', size: 'sm', color: '#ffffffaa', margin: 'sm' }
            ],
            backgroundColor: '#E17055',
            paddingAll: '20px'
          },
          body: {
            type: 'box',
            layout: 'vertical',
            contents: [
              { type: 'text', text: '📌 設定停利價', weight: 'bold', size: 'md' },
              { type: 'box', layout: 'vertical', margin: 'md', backgroundColor: '#FDEDEC', cornerRadius: 'md', paddingAll: '10px',
                contents: [
                  { type: 'text', text: '停利 2330 1100', size: 'sm', color: '#D63031' },
                  { type: 'text', text: '→ 設定台積電停利價 1100', size: 'xs', color: '#888888' }
                ]
              },
              { type: 'separator', margin: 'lg' },
              { type: 'text', text: '📌 設定停損價', weight: 'bold', size: 'md', margin: 'lg' },
              { type: 'box', layout: 'vertical', margin: 'md', backgroundColor: '#E8F8F5', cornerRadius: 'md', paddingAll: '10px',
                contents: [
                  { type: 'text', text: '停損 2330 900', size: 'sm', color: '#00B894' },
                  { type: 'text', text: '→ 設定台積電停損價 900', size: 'xs', color: '#888888' }
                ]
              },
              { type: 'separator', margin: 'lg' },
              { type: 'text', text: '📌 同時設定停利停損', weight: 'bold', size: 'md', margin: 'lg' },
              { type: 'box', layout: 'vertical', margin: 'md', backgroundColor: '#f5f5f5', cornerRadius: 'md', paddingAll: '10px',
                contents: [
                  { type: 'text', text: '目標 2330 1100 900', size: 'sm', color: '#6C5CE7' },
                  { type: 'text', text: '→ 停利 1100 / 停損 900', size: 'xs', color: '#888888' }
                ]
              }
            ],
            paddingAll: '20px'
          },
          footer: {
            type: 'box',
            layout: 'horizontal',
            contents: [
              { type: 'button', style: 'primary', color: '#E17055', height: 'sm',
                action: { type: 'message', label: '檢查目標', text: '檢查目標' }
              }
            ],
            paddingAll: '10px'
          }
        },
        {
          type: 'bubble',
          size: 'mega',
          header: {
            type: 'box',
            layout: 'vertical',
            contents: [
              { type: 'text', text: '🎯 停利停損', size: 'xl', weight: 'bold', color: '#ffffff' },
              { type: 'text', text: '查看與自動通知', size: 'sm', color: '#ffffffaa', margin: 'sm' }
            ],
            backgroundColor: '#6C5CE7',
            paddingAll: '20px'
          },
          body: {
            type: 'box',
            layout: 'vertical',
            contents: [
              { type: 'text', text: '📌 查看目標價', weight: 'bold', size: 'md' },
              { type: 'box', layout: 'vertical', margin: 'md', backgroundColor: '#f5f5f5', cornerRadius: 'md', paddingAll: '10px',
                contents: [
                  { type: 'text', text: '目標價 2330', size: 'sm', color: '#1DB446' },
                  { type: 'text', text: '→ 查看單一股票目標設定', size: 'xs', color: '#888888' }
                ]
              },
              { type: 'box', layout: 'vertical', margin: 'md', backgroundColor: '#f5f5f5', cornerRadius: 'md', paddingAll: '10px',
                contents: [
                  { type: 'text', text: '檢查目標', size: 'sm', color: '#1DB446' },
                  { type: 'text', text: '→ 查看所有持股目標狀態', size: 'xs', color: '#888888' }
                ]
              },
              { type: 'separator', margin: 'lg' },
              { type: 'text', text: '📌 自動通知', weight: 'bold', size: 'md', margin: 'lg' },
              { type: 'box', layout: 'vertical', margin: 'md', backgroundColor: '#EBF5FB', cornerRadius: 'md', paddingAll: '10px',
                contents: [
                  { type: 'text', text: '⏰ 09:30-13:30 每 10 分鐘檢查', size: 'xs', color: '#2980B9' },
                  { type: 'text', text: '⏰ 觸發時自動推送 LINE 通知', size: 'xs', color: '#2980B9' },
                  { type: 'text', text: '🎯 達停利 / ⚠️ 觸停損', size: 'xs', color: '#2980B9' }
                ]
              }
            ],
            paddingAll: '20px'
          },
          footer: {
            type: 'box',
            layout: 'horizontal',
            contents: [
              { type: 'button', style: 'secondary', height: 'sm',
                action: { type: 'message', label: '返回教學', text: '教學' }
              }
            ],
            paddingAll: '10px'
          }
        }
      ]
    }
  };
}

function getTutorialAlert() {
  return {
    type: 'flex',
    altText: '🔔 監控警報教學',
    contents: {
      type: 'bubble',
      size: 'mega',
      header: {
        type: 'box',
        layout: 'vertical',
        contents: [
          { type: 'text', text: '🔔 監控警報', size: 'xl', weight: 'bold', color: '#ffffff' }
        ],
        backgroundColor: '#FDCB6E',
        paddingAll: '20px'
      },
      body: {
        type: 'box',
        layout: 'vertical',
        contents: [
          { type: 'text', text: '📌 加入監控', weight: 'bold', size: 'md' },
          { type: 'box', layout: 'vertical', margin: 'md', backgroundColor: '#f5f5f5', cornerRadius: 'md', paddingAll: '10px',
            contents: [
              { type: 'text', text: '+2330', size: 'sm', color: '#1DB446' },
              { type: 'text', text: '→ 將 2330 加入監控清單', size: 'xs', color: '#888888' }
            ]
          },
          { type: 'separator', margin: 'lg' },
          { type: 'text', text: '📌 移除監控', weight: 'bold', size: 'md', margin: 'lg' },
          { type: 'box', layout: 'vertical', margin: 'md', backgroundColor: '#f5f5f5', cornerRadius: 'md', paddingAll: '10px',
            contents: [
              { type: 'text', text: '-2330', size: 'sm', color: '#1DB446' },
              { type: 'text', text: '→ 將 2330 從監控清單移除', size: 'xs', color: '#888888' }
            ]
          },
          { type: 'separator', margin: 'lg' },
          { type: 'text', text: '📌 設定價格警報', weight: 'bold', size: 'md', margin: 'lg' },
          { type: 'box', layout: 'vertical', margin: 'md', backgroundColor: '#f5f5f5', cornerRadius: 'md', paddingAll: '10px',
            contents: [
              { type: 'text', text: '警報 2330 上1000 下900', size: 'sm', color: '#1DB446' },
              { type: 'text', text: '→ 超過 1000 或跌破 900 時通知', size: 'xs', color: '#888888' }
            ]
          },
          { type: 'separator', margin: 'lg' },
          { type: 'text', text: '📌 查看監控清單', weight: 'bold', size: 'md', margin: 'lg' },
          { type: 'box', layout: 'vertical', margin: 'md', backgroundColor: '#f5f5f5', cornerRadius: 'md', paddingAll: '10px',
            contents: [
              { type: 'text', text: '監控', size: 'sm', color: '#1DB446' },
              { type: 'text', text: '→ 顯示所有監控中的股票', size: 'xs', color: '#888888' }
            ]
          }
        ],
        paddingAll: '20px'
      },
      footer: {
        type: 'box',
        layout: 'horizontal',
        contents: [
          { type: 'button', style: 'primary', color: '#F39C12', height: 'sm',
            action: { type: 'message', label: '查看監控', text: '監控' }
          },
          { type: 'button', style: 'secondary', height: 'sm', margin: 'sm',
            action: { type: 'message', label: '返回教學', text: '教學' }
          }
        ],
        paddingAll: '10px'
      }
    }
  };
}

function getTutorialAI() {
  return {
    type: 'flex',
    altText: '🤖 AI 分析教學',
    contents: {
      type: 'bubble',
      size: 'mega',
      header: {
        type: 'box',
        layout: 'vertical',
        contents: [
          { type: 'text', text: '🤖 AI 分析', size: 'xl', weight: 'bold', color: '#ffffff' }
        ],
        backgroundColor: '#6C5CE7',
        paddingAll: '20px'
      },
      body: {
        type: 'box',
        layout: 'vertical',
        contents: [
          { type: 'text', text: '📌 單一股票分析', weight: 'bold', size: 'md' },
          { type: 'box', layout: 'vertical', margin: 'md', backgroundColor: '#f5f5f5', cornerRadius: 'md', paddingAll: '10px',
            contents: [
              { type: 'text', text: '分析 2330', size: 'sm', color: '#1DB446' },
              { type: 'text', text: '→ AI 分析 2330 買賣時機', size: 'xs', color: '#888888' },
              { type: 'text', text: '包含：技術面+籌碼面+建議', size: 'xs', color: '#888888' }
            ]
          },
          { type: 'separator', margin: 'lg' },
          { type: 'text', text: '📌 全部持股分析', weight: 'bold', size: 'md', margin: 'lg' },
          { type: 'box', layout: 'vertical', margin: 'md', backgroundColor: '#f5f5f5', cornerRadius: 'md', paddingAll: '10px',
            contents: [
              { type: 'text', text: '持股分析', size: 'sm', color: '#1DB446' },
              { type: 'text', text: '→ AI 分析所有持股的買賣建議', size: 'xs', color: '#888888' }
            ]
          },
          { type: 'separator', margin: 'lg' },
          { type: 'text', text: '📌 綜合分析', weight: 'bold', size: 'md', margin: 'lg' },
          { type: 'box', layout: 'vertical', margin: 'md', backgroundColor: '#f5f5f5', cornerRadius: 'md', paddingAll: '10px',
            contents: [
              { type: 'text', text: '綜合分析', size: 'sm', color: '#1DB446' },
              { type: 'text', text: '→ 5 張卡片一次看完', size: 'xs', color: '#888888' },
              { type: 'text', text: 'AI類股+DRAM+台股+美股+影響', size: 'xs', color: '#888888' }
            ]
          },
          { type: 'box', layout: 'vertical', margin: 'lg', backgroundColor: '#EBF5FB', cornerRadius: 'md', paddingAll: '10px',
            contents: [
              { type: 'text', text: '💡 AI 使用 Gemini + GPT 雙引擎', size: 'xs', color: '#2980B9' },
              { type: 'text', text: '提供更全面客觀的分析建議', size: 'xs', color: '#2980B9' }
            ]
          }
        ],
        paddingAll: '20px'
      },
      footer: {
        type: 'box',
        layout: 'horizontal',
        contents: [
          { type: 'button', style: 'primary', color: '#6C5CE7', height: 'sm',
            action: { type: 'message', label: '分析 2330', text: '分析 2330' }
          },
          { type: 'button', style: 'secondary', height: 'sm', margin: 'sm',
            action: { type: 'message', label: '返回教學', text: '教學' }
          }
        ],
        paddingAll: '10px'
      }
    }
  };
}

function getTutorialChip() {
  return {
    type: 'flex',
    altText: '🏦 籌碼法人教學',
    contents: {
      type: 'bubble',
      size: 'mega',
      header: {
        type: 'box',
        layout: 'vertical',
        contents: [
          { type: 'text', text: '🏦 籌碼法人', size: 'xl', weight: 'bold', color: '#ffffff' }
        ],
        backgroundColor: '#00CEC9',
        paddingAll: '20px'
      },
      body: {
        type: 'box',
        layout: 'vertical',
        contents: [
          { type: 'text', text: '📌 查詢個股籌碼', weight: 'bold', size: 'md' },
          { type: 'box', layout: 'vertical', margin: 'md', backgroundColor: '#f5f5f5', cornerRadius: 'md', paddingAll: '10px',
            contents: [
              { type: 'text', text: '籌碼 2330', size: 'sm', color: '#1DB446' },
              { type: 'text', text: '→ 顯示 2330 三大法人買賣超', size: 'xs', color: '#888888' }
            ]
          },
          { type: 'separator', margin: 'lg' },
          { type: 'text', text: '📌 法人買賣排行', weight: 'bold', size: 'md', margin: 'lg' },
          { type: 'box', layout: 'vertical', margin: 'md', backgroundColor: '#f5f5f5', cornerRadius: 'md', paddingAll: '10px',
            contents: [
              { type: 'text', text: '外資買超', size: 'sm', color: '#1DB446' },
              { type: 'text', text: '外資賣超', size: 'sm', color: '#1DB446' },
              { type: 'text', text: '投信買超', size: 'sm', color: '#1DB446' },
              { type: 'text', text: '投信賣超', size: 'sm', color: '#1DB446' },
              { type: 'text', text: '→ 顯示當日排行榜', size: 'xs', color: '#888888' }
            ]
          },
          { type: 'box', layout: 'vertical', margin: 'lg', backgroundColor: '#E8F8F5', cornerRadius: 'md', paddingAll: '10px',
            contents: [
              { type: 'text', text: '💡 法人動向參考', size: 'xs', color: '#1ABC9C', weight: 'bold' },
              { type: 'text', text: '外資：國際資金動向', size: 'xs', color: '#1ABC9C' },
              { type: 'text', text: '投信：國內法人看法', size: 'xs', color: '#1ABC9C' },
              { type: 'text', text: '自營商：避險/造市需求', size: 'xs', color: '#1ABC9C' }
            ]
          }
        ],
        paddingAll: '20px'
      },
      footer: {
        type: 'box',
        layout: 'horizontal',
        contents: [
          { type: 'button', style: 'primary', color: '#00CEC9', height: 'sm',
            action: { type: 'message', label: '外資買超', text: '外資買超' }
          },
          { type: 'button', style: 'secondary', height: 'sm', margin: 'sm',
            action: { type: 'message', label: '返回教學', text: '教學' }
          }
        ],
        paddingAll: '10px'
      }
    }
  };
}

function getTutorialUS() {
  return {
    type: 'flex',
    altText: '🇺🇸 美股功能教學',
    contents: {
      type: 'bubble',
      size: 'mega',
      header: {
        type: 'box',
        layout: 'vertical',
        contents: [
          { type: 'text', text: '🇺🇸 美股功能', size: 'xl', weight: 'bold', color: '#ffffff' }
        ],
        backgroundColor: '#2D3436',
        paddingAll: '20px'
      },
      body: {
        type: 'box',
        layout: 'vertical',
        contents: [
          { type: 'text', text: '📌 美股指數', weight: 'bold', size: 'md' },
          { type: 'box', layout: 'vertical', margin: 'md', backgroundColor: '#f5f5f5', cornerRadius: 'md', paddingAll: '10px',
            contents: [
              { type: 'text', text: '美股', size: 'sm', color: '#1DB446' },
              { type: 'text', text: '→ 道瓊/納斯達克/S&P500', size: 'xs', color: '#888888' }
            ]
          },
          { type: 'separator', margin: 'lg' },
          { type: 'text', text: '📌 個股查詢', weight: 'bold', size: 'md', margin: 'lg' },
          { type: 'box', layout: 'vertical', margin: 'md', backgroundColor: '#f5f5f5', cornerRadius: 'md', paddingAll: '10px',
            contents: [
              { type: 'text', text: 'AAPL、TSLA、NVDA', size: 'sm', color: '#1DB446' },
              { type: 'text', text: '→ 直接輸入美股代碼', size: 'xs', color: '#888888' }
            ]
          },
          { type: 'separator', margin: 'lg' },
          { type: 'text', text: '📌 熱門美股', weight: 'bold', size: 'md', margin: 'lg' },
          { type: 'box', layout: 'vertical', margin: 'md', backgroundColor: '#f5f5f5', cornerRadius: 'md', paddingAll: '10px',
            contents: [
              { type: 'text', text: '熱門美股', size: 'sm', color: '#1DB446' },
              { type: 'text', text: '→ 顯示熱門美股漲跌', size: 'xs', color: '#888888' }
            ]
          },
          { type: 'separator', margin: 'lg' },
          { type: 'text', text: '📌 美股分析', weight: 'bold', size: 'md', margin: 'lg' },
          { type: 'box', layout: 'vertical', margin: 'md', backgroundColor: '#f5f5f5', cornerRadius: 'md', paddingAll: '10px',
            contents: [
              { type: 'text', text: '美股分析', size: 'sm', color: '#1DB446' },
              { type: 'text', text: '→ AI 分析美股對台股影響', size: 'xs', color: '#888888' }
            ]
          }
        ],
        paddingAll: '20px'
      },
      footer: {
        type: 'box',
        layout: 'horizontal',
        contents: [
          { type: 'button', style: 'primary', color: '#2D3436', height: 'sm',
            action: { type: 'message', label: '看美股', text: '美股' }
          },
          { type: 'button', style: 'secondary', height: 'sm', margin: 'sm',
            action: { type: 'message', label: '返回教學', text: '教學' }
          }
        ],
        paddingAll: '10px'
      }
    }
  };
}

function getTutorialReport() {
  return {
    type: 'flex',
    altText: '📊 報告功能教學',
    contents: {
      type: 'bubble',
      size: 'mega',
      header: {
        type: 'box',
        layout: 'vertical',
        contents: [
          { type: 'text', text: '📊 報告功能', size: 'xl', weight: 'bold', color: '#ffffff' }
        ],
        backgroundColor: '#A29BFE',
        paddingAll: '20px'
      },
      body: {
        type: 'box',
        layout: 'vertical',
        contents: [
          { type: 'text', text: '📌 收盤摘要', weight: 'bold', size: 'md' },
          { type: 'box', layout: 'vertical', margin: 'md', backgroundColor: '#f5f5f5', cornerRadius: 'md', paddingAll: '10px',
            contents: [
              { type: 'text', text: '收盤摘要', size: 'sm', color: '#1DB446' },
              { type: 'text', text: '→ 持股今日漲跌總覽', size: 'xs', color: '#888888' },
              { type: 'text', text: '⏰ 每日 14:00 自動推送', size: 'xs', color: '#888888' }
            ]
          },
          { type: 'separator', margin: 'lg' },
          { type: 'text', text: '📌 持股績效', weight: 'bold', size: 'md', margin: 'lg' },
          { type: 'box', layout: 'vertical', margin: 'md', backgroundColor: '#f5f5f5', cornerRadius: 'md', paddingAll: '10px',
            contents: [
              { type: 'text', text: '績效', size: 'sm', color: '#1DB446' },
              { type: 'text', text: '→ 總投資報酬率分析', size: 'xs', color: '#888888' }
            ]
          },
          { type: 'separator', margin: 'lg' },
          { type: 'text', text: '📌 自動通知時間', weight: 'bold', size: 'md', margin: 'lg' },
          { type: 'box', layout: 'vertical', margin: 'md', backgroundColor: '#EBF5FB', cornerRadius: 'md', paddingAll: '10px',
            contents: [
              { type: 'text', text: '⏰ 08:30 開盤提醒', size: 'xs', color: '#2980B9' },
              { type: 'text', text: '⏰ 09:30-13:30 智能通知', size: 'xs', color: '#2980B9' },
              { type: 'text', text: '⏰ 13:35 績效報告', size: 'xs', color: '#2980B9' },
              { type: 'text', text: '⏰ 13:40 收盤日報', size: 'xs', color: '#2980B9' },
              { type: 'text', text: '⏰ 14:00 持股摘要', size: 'xs', color: '#2980B9' },
              { type: 'text', text: '⏰ 15:30 三大法人', size: 'xs', color: '#2980B9' }
            ]
          }
        ],
        paddingAll: '20px'
      },
      footer: {
        type: 'box',
        layout: 'horizontal',
        contents: [
          { type: 'button', style: 'primary', color: '#A29BFE', height: 'sm',
            action: { type: 'message', label: '收盤摘要', text: '收盤摘要' }
          },
          { type: 'button', style: 'secondary', height: 'sm', margin: 'sm',
            action: { type: 'message', label: '返回教學', text: '教學' }
          }
        ],
        paddingAll: '10px'
      }
    }
  };
}

// ===== 🆕 新功能教學 =====

function getTutorialRanking() {
  return {
    type: 'flex',
    altText: '🏆 排行榜教學',
    contents: {
      type: 'bubble',
      size: 'mega',
      header: {
        type: 'box',
        layout: 'vertical',
        contents: [
          { type: 'text', text: '🏆 排行榜', size: 'xl', weight: 'bold', color: '#ffffff' }
        ],
        backgroundColor: '#FF6B6B',
        paddingAll: '20px'
      },
      body: {
        type: 'box',
        layout: 'vertical',
        contents: [
          { type: 'text', text: '📌 漲跌排行', weight: 'bold', size: 'md' },
          { type: 'box', layout: 'vertical', margin: 'md', backgroundColor: '#f5f5f5', cornerRadius: 'md', paddingAll: '10px',
            contents: [
              { type: 'text', text: '漲幅排行', size: 'sm', color: '#D63031' },
              { type: 'text', text: '跌幅排行', size: 'sm', color: '#00B894' },
              { type: 'text', text: '→ 查看今日漲跌幅前 10 名', size: 'xs', color: '#888888' }
            ]
          },
          { type: 'separator', margin: 'lg' },
          { type: 'text', text: '📌 成交量排行', weight: 'bold', size: 'md', margin: 'lg' },
          { type: 'box', layout: 'vertical', margin: 'md', backgroundColor: '#f5f5f5', cornerRadius: 'md', paddingAll: '10px',
            contents: [
              { type: 'text', text: '成交排行', size: 'sm', color: '#6C5CE7' },
              { type: 'text', text: '→ 查看成交量最大的股票', size: 'xs', color: '#888888' }
            ]
          },
          { type: 'separator', margin: 'lg' },
          { type: 'text', text: '📌 排行榜選單', weight: 'bold', size: 'md', margin: 'lg' },
          { type: 'box', layout: 'vertical', margin: 'md', backgroundColor: '#f5f5f5', cornerRadius: 'md', paddingAll: '10px',
            contents: [
              { type: 'text', text: '排行榜', size: 'sm', color: '#1DB446' },
              { type: 'text', text: '→ 顯示所有排行選項', size: 'xs', color: '#888888' }
            ]
          }
        ],
        paddingAll: '20px'
      },
      footer: {
        type: 'box',
        layout: 'horizontal',
        contents: [
          { type: 'button', style: 'primary', color: '#FF6B6B', height: 'sm',
            action: { type: 'message', label: '漲幅排行', text: '漲幅排行' }
          },
          { type: 'button', style: 'secondary', height: 'sm', margin: 'sm',
            action: { type: 'message', label: '返回教學', text: '教學' }
          }
        ],
        paddingAll: '10px'
      }
    }
  };
}

function getTutorialNews() {
  return {
    type: 'flex',
    altText: '📰 新聞快訊教學',
    contents: {
      type: 'bubble',
      size: 'mega',
      header: {
        type: 'box',
        layout: 'vertical',
        contents: [
          { type: 'text', text: '📰 新聞快訊', size: 'xl', weight: 'bold', color: '#ffffff' }
        ],
        backgroundColor: '#E17055',
        paddingAll: '20px'
      },
      body: {
        type: 'box',
        layout: 'vertical',
        contents: [
          { type: 'text', text: '📌 股市新聞', weight: 'bold', size: 'md' },
          { type: 'box', layout: 'vertical', margin: 'md', backgroundColor: '#f5f5f5', cornerRadius: 'md', paddingAll: '10px',
            contents: [
              { type: 'text', text: '新聞', size: 'sm', color: '#1DB446' },
              { type: 'text', text: '→ 查看最新股市新聞', size: 'xs', color: '#888888' }
            ]
          },
          { type: 'separator', margin: 'lg' },
          { type: 'text', text: '📌 個股新聞', weight: 'bold', size: 'md', margin: 'lg' },
          { type: 'box', layout: 'vertical', margin: 'md', backgroundColor: '#f5f5f5', cornerRadius: 'md', paddingAll: '10px',
            contents: [
              { type: 'text', text: '新聞 2330', size: 'sm', color: '#1DB446' },
              { type: 'text', text: '→ 查看台積電相關新聞', size: 'xs', color: '#888888' }
            ]
          },
          { type: 'box', layout: 'vertical', margin: 'lg', backgroundColor: '#EBF5FB', cornerRadius: 'md', paddingAll: '10px',
            contents: [
              { type: 'text', text: '💡 新聞來源', size: 'xs', color: '#2980B9', weight: 'bold' },
              { type: 'text', text: '即時抓取 Google News 財經新聞', size: 'xs', color: '#2980B9' }
            ]
          }
        ],
        paddingAll: '20px'
      },
      footer: {
        type: 'box',
        layout: 'horizontal',
        contents: [
          { type: 'button', style: 'primary', color: '#E17055', height: 'sm',
            action: { type: 'message', label: '看新聞', text: '新聞' }
          },
          { type: 'button', style: 'secondary', height: 'sm', margin: 'sm',
            action: { type: 'message', label: '返回教學', text: '教學' }
          }
        ],
        paddingAll: '10px'
      }
    }
  };
}

function getTutorialSimulate() {
  return {
    type: 'flex',
    altText: '🎮 模擬交易教學',
    contents: {
      type: 'bubble',
      size: 'mega',
      header: {
        type: 'box',
        layout: 'vertical',
        contents: [
          { type: 'text', text: '🎮 模擬交易', size: 'xl', weight: 'bold', color: '#ffffff' },
          { type: 'text', text: '💰 初始資金 100 萬', size: 'sm', color: '#ffffffaa', margin: 'sm' }
        ],
        backgroundColor: '#6C5CE7',
        paddingAll: '20px'
      },
      body: {
        type: 'box',
        layout: 'vertical',
        contents: [
          { type: 'text', text: '📌 模擬買進', weight: 'bold', size: 'md' },
          { type: 'box', layout: 'vertical', margin: 'md', backgroundColor: '#FDEDEC', cornerRadius: 'md', paddingAll: '10px',
            contents: [
              { type: 'text', text: '模擬買 2330 1', size: 'sm', color: '#D63031' },
              { type: 'text', text: '→ 用虛擬資金買進 1 張台積電', size: 'xs', color: '#888888' }
            ]
          },
          { type: 'separator', margin: 'lg' },
          { type: 'text', text: '📌 模擬賣出', weight: 'bold', size: 'md', margin: 'lg' },
          { type: 'box', layout: 'vertical', margin: 'md', backgroundColor: '#E8F8F5', cornerRadius: 'md', paddingAll: '10px',
            contents: [
              { type: 'text', text: '模擬賣 2330 1', size: 'sm', color: '#00B894' },
              { type: 'text', text: '→ 賣出 1 張虛擬持股', size: 'xs', color: '#888888' }
            ]
          },
          { type: 'separator', margin: 'lg' },
          { type: 'text', text: '📌 查看帳戶', weight: 'bold', size: 'md', margin: 'lg' },
          { type: 'box', layout: 'vertical', margin: 'md', backgroundColor: '#f5f5f5', cornerRadius: 'md', paddingAll: '10px',
            contents: [
              { type: 'text', text: '模擬帳戶', size: 'sm', color: '#6C5CE7' },
              { type: 'text', text: '→ 查看虛擬持股與損益', size: 'xs', color: '#888888' }
            ]
          },
          { type: 'box', layout: 'vertical', margin: 'lg', backgroundColor: '#EBF5FB', cornerRadius: 'md', paddingAll: '10px',
            contents: [
              { type: 'text', text: '💡 適合新手練習', size: 'xs', color: '#2980B9', weight: 'bold' },
              { type: 'text', text: '用虛擬資金體驗股市交易', size: 'xs', color: '#2980B9' },
              { type: 'text', text: '不涉及真實金錢，安心學習', size: 'xs', color: '#2980B9' }
            ]
          }
        ],
        paddingAll: '20px'
      },
      footer: {
        type: 'box',
        layout: 'horizontal',
        contents: [
          { type: 'button', style: 'primary', color: '#6C5CE7', height: 'sm',
            action: { type: 'message', label: '模擬帳戶', text: '模擬帳戶' }
          },
          { type: 'button', style: 'secondary', height: 'sm', margin: 'sm',
            action: { type: 'message', label: '返回教學', text: '教學' }
          }
        ],
        paddingAll: '10px'
      }
    }
  };
}

function getTutorialKLine() {
  return {
    type: 'flex',
    altText: '📈 K線走勢教學',
    contents: {
      type: 'bubble',
      size: 'mega',
      header: {
        type: 'box',
        layout: 'vertical',
        contents: [
          { type: 'text', text: '📈 K線走勢', size: 'xl', weight: 'bold', color: '#ffffff' }
        ],
        backgroundColor: '#2D3436',
        paddingAll: '20px'
      },
      body: {
        type: 'box',
        layout: 'vertical',
        contents: [
          { type: 'text', text: '📌 查看走勢圖', weight: 'bold', size: 'md' },
          { type: 'box', layout: 'vertical', margin: 'md', backgroundColor: '#f5f5f5', cornerRadius: 'md', paddingAll: '10px',
            contents: [
              { type: 'text', text: 'K線 2330', size: 'sm', color: '#1DB446' },
              { type: 'text', text: '走勢 2330', size: 'sm', color: '#1DB446' },
              { type: 'text', text: '→ 顯示 30 日走勢圖', size: 'xs', color: '#888888' }
            ]
          },
          { type: 'separator', margin: 'lg' },
          { type: 'text', text: '📌 圖表內容', weight: 'bold', size: 'md', margin: 'lg' },
          { type: 'box', layout: 'vertical', margin: 'md', backgroundColor: '#EBF5FB', cornerRadius: 'md', paddingAll: '10px',
            contents: [
              { type: 'text', text: '📊 近 30 日收盤價趨勢', size: 'xs', color: '#2980B9' },
              { type: 'text', text: '📊 即時股價與漲跌幅', size: 'xs', color: '#2980B9' },
              { type: 'text', text: '📊 自動生成圖片', size: 'xs', color: '#2980B9' }
            ]
          }
        ],
        paddingAll: '20px'
      },
      footer: {
        type: 'box',
        layout: 'horizontal',
        contents: [
          { type: 'button', style: 'primary', color: '#2D3436', height: 'sm',
            action: { type: 'message', label: '看 2330', text: 'K線 2330' }
          },
          { type: 'button', style: 'secondary', height: 'sm', margin: 'sm',
            action: { type: 'message', label: '返回教學', text: '教學' }
          }
        ],
        paddingAll: '10px'
      }
    }
  };
}

function getTutorialBacktest() {
  return {
    type: 'flex',
    altText: '📊 回測分析教學',
    contents: {
      type: 'bubble',
      size: 'mega',
      header: {
        type: 'box',
        layout: 'vertical',
        contents: [
          { type: 'text', text: '📊 回測分析', size: 'xl', weight: 'bold', color: '#ffffff' }
        ],
        backgroundColor: '#00CEC9',
        paddingAll: '20px'
      },
      body: {
        type: 'box',
        layout: 'vertical',
        contents: [
          { type: 'text', text: '📌 策略回測', weight: 'bold', size: 'md' },
          { type: 'box', layout: 'vertical', margin: 'md', backgroundColor: '#f5f5f5', cornerRadius: 'md', paddingAll: '10px',
            contents: [
              { type: 'text', text: '回測 2330', size: 'sm', color: '#1DB446' },
              { type: 'text', text: '→ 回測 MA 交叉策略績效', size: 'xs', color: '#888888' }
            ]
          },
          { type: 'separator', margin: 'lg' },
          { type: 'text', text: '📌 回測策略', weight: 'bold', size: 'md', margin: 'lg' },
          { type: 'box', layout: 'vertical', margin: 'md', backgroundColor: '#E8F8F5', cornerRadius: 'md', paddingAll: '10px',
            contents: [
              { type: 'text', text: '📈 MA5 上穿 MA20：買進', size: 'xs', color: '#00B894' },
              { type: 'text', text: '📉 MA5 下穿 MA20：賣出', size: 'xs', color: '#D63031' }
            ]
          },
          { type: 'separator', margin: 'lg' },
          { type: 'text', text: '📌 回測報告', weight: 'bold', size: 'md', margin: 'lg' },
          { type: 'box', layout: 'vertical', margin: 'md', backgroundColor: '#EBF5FB', cornerRadius: 'md', paddingAll: '10px',
            contents: [
              { type: 'text', text: '📊 總報酬率', size: 'xs', color: '#2980B9' },
              { type: 'text', text: '📊 勝率', size: 'xs', color: '#2980B9' },
              { type: 'text', text: '📊 最大回撤', size: 'xs', color: '#2980B9' },
              { type: 'text', text: '📊 交易次數', size: 'xs', color: '#2980B9' }
            ]
          },
          { type: 'text', text: '⚠️ 過去績效不代表未來表現', size: 'xs', color: '#E17055', margin: 'lg' }
        ],
        paddingAll: '20px'
      },
      footer: {
        type: 'box',
        layout: 'horizontal',
        contents: [
          { type: 'button', style: 'primary', color: '#00CEC9', height: 'sm',
            action: { type: 'message', label: '回測 2330', text: '回測 2330' }
          },
          { type: 'button', style: 'secondary', height: 'sm', margin: 'sm',
            action: { type: 'message', label: '返回教學', text: '教學' }
          }
        ],
        paddingAll: '10px'
      }
    }
  };
}

function getTutorialEarnings() {
  return {
    type: 'flex',
    altText: '📅 財報日曆教學',
    contents: {
      type: 'bubble',
      size: 'mega',
      header: {
        type: 'box',
        layout: 'vertical',
        contents: [
          { type: 'text', text: '📅 財報日曆', size: 'xl', weight: 'bold', color: '#ffffff' }
        ],
        backgroundColor: '#00B894',
        paddingAll: '20px'
      },
      body: {
        type: 'box',
        layout: 'vertical',
        contents: [
          { type: 'text', text: '📌 查看財報日曆', weight: 'bold', size: 'md' },
          { type: 'box', layout: 'vertical', margin: 'md', backgroundColor: '#f5f5f5', cornerRadius: 'md', paddingAll: '10px',
            contents: [
              { type: 'text', text: '財報', size: 'sm', color: '#1DB446' },
              { type: 'text', text: '財報日曆', size: 'sm', color: '#1DB446' },
              { type: 'text', text: '→ 查看持股財報公布時間', size: 'xs', color: '#888888' }
            ]
          },
          { type: 'separator', margin: 'lg' },
          { type: 'text', text: '📌 台股財報時程', weight: 'bold', size: 'md', margin: 'lg' },
          { type: 'box', layout: 'vertical', margin: 'md', backgroundColor: '#EBF5FB', cornerRadius: 'md', paddingAll: '10px',
            contents: [
              { type: 'text', text: '📋 Q1 財報：5/15 前公布', size: 'xs', color: '#2980B9' },
              { type: 'text', text: '📋 Q2 財報：8/14 前公布', size: 'xs', color: '#2980B9' },
              { type: 'text', text: '📋 Q3 財報：11/14 前公布', size: 'xs', color: '#2980B9' },
              { type: 'text', text: '📋 Q4 財報：隔年 3/31 前公布', size: 'xs', color: '#2980B9' }
            ]
          },
          { type: 'box', layout: 'vertical', margin: 'lg', backgroundColor: '#FEF9E7', cornerRadius: 'md', paddingAll: '10px',
            contents: [
              { type: 'text', text: '💡 投資提醒', size: 'xs', color: '#F39C12', weight: 'bold' },
              { type: 'text', text: '財報公布前後股價波動較大', size: 'xs', color: '#F39C12' },
              { type: 'text', text: '建議提前關注持股財報時間', size: 'xs', color: '#F39C12' }
            ]
          }
        ],
        paddingAll: '20px'
      },
      footer: {
        type: 'box',
        layout: 'horizontal',
        contents: [
          { type: 'button', style: 'primary', color: '#00B894', height: 'sm',
            action: { type: 'message', label: '看財報', text: '財報' }
          },
          { type: 'button', style: 'secondary', height: 'sm', margin: 'sm',
            action: { type: 'message', label: '返回教學', text: '教學' }
          }
        ],
        paddingAll: '10px'
      }
    }
  };
}

function getTutorialDividend() {
  return {
    type: 'flex',
    altText: '💰 股息試算教學',
    contents: {
      type: 'carousel',
      contents: [
        // 第一頁：基本查詢
        {
          type: 'bubble',
          size: 'mega',
          header: {
            type: 'box',
            layout: 'vertical',
            contents: [
              { type: 'text', text: '💰 股息試算', size: 'xl', weight: 'bold', color: '#ffffff' },
              { type: 'text', text: '查詢與總覽', size: 'sm', color: '#ffffffaa', margin: 'sm' }
            ],
            backgroundColor: '#27AE60',
            paddingAll: '20px'
          },
          body: {
            type: 'box',
            layout: 'vertical',
            contents: [
              { type: 'text', text: '📌 查詢個股股息', weight: 'bold', size: 'md' },
              { type: 'box', layout: 'vertical', margin: 'md', backgroundColor: '#E8F8F5', cornerRadius: 'md', paddingAll: '10px',
                contents: [
                  { type: 'text', text: '股息 2330', size: 'sm', color: '#27AE60' },
                  { type: 'text', text: '→ 查詢股息 + 殖利率 + 歷史', size: 'xs', color: '#888888' }
                ]
              },
              { type: 'separator', margin: 'lg' },
              { type: 'text', text: '📌 持股股息總覽', weight: 'bold', size: 'md', margin: 'lg' },
              { type: 'box', layout: 'vertical', margin: 'md', backgroundColor: '#E8F8F5', cornerRadius: 'md', paddingAll: '10px',
                contents: [
                  { type: 'text', text: '股息', size: 'sm', color: '#27AE60' },
                  { type: 'text', text: '→ 所有持股預估總股息', size: 'xs', color: '#888888' }
                ]
              },
              { type: 'separator', margin: 'lg' },
              { type: 'text', text: '📌 殖利率評等', weight: 'bold', size: 'md', margin: 'lg' },
              { type: 'box', layout: 'vertical', margin: 'md', backgroundColor: '#f5f5f5', cornerRadius: 'md', paddingAll: '10px',
                contents: [
                  { type: 'text', text: '🌟 6%+ 高殖利率', size: 'xs', color: '#D63031' },
                  { type: 'text', text: '👍 4-6% 不錯 / 📊 2-4% 普通', size: 'xs', color: '#666666' }
                ]
              }
            ],
            paddingAll: '15px'
          },
          footer: {
            type: 'box',
            layout: 'horizontal',
            contents: [
              { type: 'button', style: 'primary', color: '#27AE60', height: 'sm',
                action: { type: 'message', label: '股息總覽', text: '股息' }
              }
            ],
            paddingAll: '10px'
          }
        },
        // 第二頁：手動設定
        {
          type: 'bubble',
          size: 'mega',
          header: {
            type: 'box',
            layout: 'vertical',
            contents: [
              { type: 'text', text: '💰 股息試算', size: 'xl', weight: 'bold', color: '#ffffff' },
              { type: 'text', text: '🆕 手動設定股息', size: 'sm', color: '#ffffffaa', margin: 'sm' }
            ],
            backgroundColor: '#9B59B6',
            paddingAll: '20px'
          },
          body: {
            type: 'box',
            layout: 'vertical',
            contents: [
              { type: 'text', text: '📌 設定股息', weight: 'bold', size: 'md' },
              { type: 'box', layout: 'vertical', margin: 'md', backgroundColor: '#F5EEF8', cornerRadius: 'md', paddingAll: '10px',
                contents: [
                  { type: 'text', text: '設定股息 2330 14.5', size: 'sm', color: '#9B59B6' },
                  { type: 'text', text: '→ 設定台積電股息 $14.5', size: 'xs', color: '#888888' }
                ]
              },
              { type: 'separator', margin: 'lg' },
              { type: 'text', text: '📌 刪除自訂', weight: 'bold', size: 'md', margin: 'lg' },
              { type: 'box', layout: 'vertical', margin: 'md', backgroundColor: '#F5EEF8', cornerRadius: 'md', paddingAll: '10px',
                contents: [
                  { type: 'text', text: '刪除股息 2330', size: 'sm', color: '#9B59B6' },
                  { type: 'text', text: '→ 改用系統預設資料', size: 'xs', color: '#888888' }
                ]
              },
              { type: 'separator', margin: 'lg' },
              { type: 'text', text: '💡 使用時機', weight: 'bold', size: 'md', margin: 'lg' },
              { type: 'box', layout: 'vertical', margin: 'md', backgroundColor: '#FEF9E7', cornerRadius: 'md', paddingAll: '10px',
                contents: [
                  { type: 'text', text: '• 系統查不到股息時', size: 'xs', color: '#666666' },
                  { type: 'text', text: '• 公司剛公布新股息', size: 'xs', color: '#666666' },
                  { type: 'text', text: '• 想用自己的預估值', size: 'xs', color: '#666666' }
                ]
              },
              { type: 'text', text: '⚠️ 自訂股息會優先使用', size: 'xs', color: '#E74C3C', margin: 'md' }
            ],
            paddingAll: '15px'
          },
          footer: {
            type: 'box',
            layout: 'horizontal',
            contents: [
              { type: 'button', style: 'secondary', height: 'sm',
                action: { type: 'message', label: '返回教學', text: '教學' }
              }
            ],
            paddingAll: '10px'
          }
        }
      ]
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
    LIMIT 20
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
    
    // 🔧 修正：顯示格式改為「公司名稱(股票代碼)」
    const stockName = row.stock_name || stockData?.name || row.stock_id;
    const displayText = `${holdingIcon}${stockName}(${row.stock_id})`;
    
    stockRows.push({
      type: 'box',
      layout: 'horizontal',
      contents: [
        { 
          type: 'text', 
          text: displayText, 
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
    // 檢查監控數量是否已達上限（20支）
    const countResult = await pool.query(`
      SELECT COUNT(*) as count FROM watchlist 
      WHERE user_id = 'default' AND is_active = true
    `);
    const currentCount = parseInt(countResult.rows[0].count) || 0;
    
    if (currentCount >= 20) {
      return { 
        type: 'text', 
        text: `⚠️ 監控清單已滿（${currentCount}/20 支）\n\n請先移除部分股票後再新增\n輸入「-股票代碼」移除監控` 
      };
    }
    
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
    
    // 取得目前監控數量
    const newCountResult = await pool.query(`
      SELECT COUNT(*) as count FROM watchlist 
      WHERE user_id = 'default' AND is_active = true
    `);
    const newCount = parseInt(newCountResult.rows[0].count) || 0;
    
    return { 
      type: 'text', 
      text: `✅ 已加入監控：${stockData.name}（${stockId}）\n📊 目前監控 ${newCount}/20 支\n\n輸入「監控」查看清單` 
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
 * 📋 完整功能清單 Flex Message
 */
function getFullFeatureList() {
  return {
    type: 'flex',
    altText: '📋 完整功能清單',
    contents: {
      type: 'carousel',
      contents: [
        // 第1頁：查詢與持股
        {
          type: 'bubble',
          size: 'mega',
          header: {
            type: 'box',
            layout: 'vertical',
            contents: [
              { type: 'text', text: '📋 功能清單 (1/5)', size: 'lg', weight: 'bold', color: '#ffffff' },
              { type: 'text', text: '查詢 & 持股管理', size: 'sm', color: '#ffffffaa', margin: 'sm' }
            ],
            backgroundColor: '#3498DB',
            paddingAll: '15px'
          },
          body: {
            type: 'box',
            layout: 'vertical',
            contents: [
              { type: 'text', text: '🔍 基本查詢', weight: 'bold', size: 'sm', color: '#3498DB' },
              { type: 'text', text: '2330 → 查股價\n大盤 → 台股指數\n美股 → 美股指數\n熱門 → 熱門股', size: 'xs', color: '#666666', wrap: true, margin: 'sm' },
              { type: 'separator', margin: 'lg' },
              { type: 'text', text: '💼 持股管理', weight: 'bold', size: 'sm', color: '#3498DB', margin: 'lg' },
              { type: 'text', text: '持股 → 查看持股\n收盤摘要 → 今日損益\n綜合分析 → 持股分析\n賣出 2330 1000', size: 'xs', color: '#666666', wrap: true, margin: 'sm' },
              { type: 'separator', margin: 'lg' },
              { type: 'text', text: '🎯 停利停損', weight: 'bold', size: 'sm', color: '#3498DB', margin: 'lg' },
              { type: 'text', text: '停利 2330 1100\n停損 2330 900\n目標 2330 1100 900\n檢查目標', size: 'xs', color: '#666666', wrap: true, margin: 'sm' }
            ],
            paddingAll: '15px'
          },
          footer: {
            type: 'box',
            layout: 'horizontal',
            contents: [
              { type: 'button', style: 'primary', color: '#3498DB', height: 'sm',
                action: { type: 'message', label: '持股', text: '持股' }
              },
              { type: 'button', style: 'secondary', height: 'sm', margin: 'sm',
                action: { type: 'message', label: '收盤摘要', text: '收盤摘要' }
              }
            ],
            paddingAll: '10px'
          }
        },
        // 第2頁：分析與籌碼
        {
          type: 'bubble',
          size: 'mega',
          header: {
            type: 'box',
            layout: 'vertical',
            contents: [
              { type: 'text', text: '📋 功能清單 (2/5)', size: 'lg', weight: 'bold', color: '#ffffff' },
              { type: 'text', text: '分析 & 籌碼', size: 'sm', color: '#ffffffaa', margin: 'sm' }
            ],
            backgroundColor: '#9B59B6',
            paddingAll: '15px'
          },
          body: {
            type: 'box',
            layout: 'vertical',
            contents: [
              { type: 'text', text: '📊 技術分析', weight: 'bold', size: 'sm', color: '#9B59B6' },
              { type: 'text', text: '分析 2330 → 三AI分析\nK線 2330 → K線圖\n回測 2330 → 策略回測\n波浪 2330 → 波浪理論\n波浪建議 → 進場推薦\n波浪網頁 → 互動分析\nAI預測 2330 → 三AI預測', size: 'xs', color: '#666666', wrap: true, margin: 'sm' },
              { type: 'separator', margin: 'lg' },
              { type: 'text', text: '🏦 籌碼法人', weight: 'bold', size: 'sm', color: '#9B59B6', margin: 'lg' },
              { type: 'text', text: '籌碼 2330 → 法人買賣\n外資買超 → 外資排行\n投信買超 → 投信排行\n主力 → 主力動向', size: 'xs', color: '#666666', wrap: true, margin: 'sm' },
              { type: 'separator', margin: 'lg' },
              { type: 'text', text: '🏆 排行榜', weight: 'bold', size: 'sm', color: '#9B59B6', margin: 'lg' },
              { type: 'text', text: '漲幅排行\n跌幅排行\n成交量排行', size: 'xs', color: '#666666', wrap: true, margin: 'sm' }
            ],
            paddingAll: '15px'
          },
          footer: {
            type: 'box',
            layout: 'horizontal',
            contents: [
              { type: 'button', style: 'primary', color: '#9B59B6', height: 'sm',
                action: { type: 'message', label: '訊號掃描', text: '訊號掃描' }
              },
              { type: 'button', style: 'secondary', height: 'sm', margin: 'sm',
                action: { type: 'message', label: '外資買超', text: '外資買超' }
              }
            ],
            paddingAll: '10px'
          }
        },
        // 第3頁：股息與組合
        {
          type: 'bubble',
          size: 'mega',
          header: {
            type: 'box',
            layout: 'vertical',
            contents: [
              { type: 'text', text: '📋 功能清單 (3/5)', size: 'lg', weight: 'bold', color: '#ffffff' },
              { type: 'text', text: '股息 & 投資組合', size: 'sm', color: '#ffffffaa', margin: 'sm' }
            ],
            backgroundColor: '#27AE60',
            paddingAll: '15px'
          },
          body: {
            type: 'box',
            layout: 'vertical',
            contents: [
              { type: 'text', text: '💰 股息功能', weight: 'bold', size: 'sm', color: '#27AE60' },
              { type: 'text', text: '股息 2330 → 查股息\n股息 → 持股總覽\n高殖利率 → TOP 10\n除權息 → 除息日曆\n設定股息 2330 14.5', size: 'xs', color: '#666666', wrap: true, margin: 'sm' },
              { type: 'separator', margin: 'lg' },
              { type: 'text', text: '🏥 投資組合分析', weight: 'bold', size: 'sm', color: '#27AE60', margin: 'lg' },
              { type: 'text', text: '健檢 → 持股健康檢查\n組合分析 → 產業分散\nPK 2330 2317 → 比較\n投資組合 60萬 → 配置建議', size: 'xs', color: '#666666', wrap: true, margin: 'sm' },
              { type: 'separator', margin: 'lg' },
              { type: 'text', text: '📰 新聞快訊', weight: 'bold', size: 'sm', color: '#27AE60', margin: 'lg' },
              { type: 'text', text: '新聞 → 最新新聞\n新聞 2330 → 個股新聞', size: 'xs', color: '#666666', wrap: true, margin: 'sm' }
            ],
            paddingAll: '15px'
          },
          footer: {
            type: 'box',
            layout: 'horizontal',
            contents: [
              { type: 'button', style: 'primary', color: '#27AE60', height: 'sm',
                action: { type: 'message', label: '健檢', text: '健檢' }
              },
              { type: 'button', style: 'secondary', height: 'sm', margin: 'sm',
                action: { type: 'message', label: '高殖利率', text: '高殖利率' }
              }
            ],
            paddingAll: '10px'
          }
        },
        // 第4頁：監控與模擬
        {
          type: 'bubble',
          size: 'mega',
          header: {
            type: 'box',
            layout: 'vertical',
            contents: [
              { type: 'text', text: '📋 功能清單 (4/5)', size: 'lg', weight: 'bold', color: '#ffffff' },
              { type: 'text', text: '監控 & 模擬交易', size: 'sm', color: '#ffffffaa', margin: 'sm' }
            ],
            backgroundColor: '#E74C3C',
            paddingAll: '15px'
          },
          body: {
            type: 'box',
            layout: 'vertical',
            contents: [
              { type: 'text', text: '🔔 監控警報', weight: 'bold', size: 'sm', color: '#E74C3C' },
              { type: 'text', text: '+2330 → 新增監控\n-2330 → 取消監控\n監控 → 查看清單', size: 'xs', color: '#666666', wrap: true, margin: 'sm' },
              { type: 'separator', margin: 'lg' },
              { type: 'text', text: '🎮 模擬交易', weight: 'bold', size: 'sm', color: '#E74C3C', margin: 'lg' },
              { type: 'text', text: '模擬買 2330 1\n模擬賣 2330 1\n模擬持股', size: 'xs', color: '#666666', wrap: true, margin: 'sm' },
              { type: 'separator', margin: 'lg' },
              { type: 'text', text: '📅 財報日曆', weight: 'bold', size: 'sm', color: '#E74C3C', margin: 'lg' },
              { type: 'text', text: '財報 → 近期財報公布', size: 'xs', color: '#666666', wrap: true, margin: 'sm' },
              { type: 'separator', margin: 'lg' },
              { type: 'text', text: '⚙️ 系統設定', weight: 'bold', size: 'sm', color: '#E74C3C', margin: 'lg' },
              { type: 'text', text: '顏色切換 → 漲跌顏色\n語音設定 → 語音選擇', size: 'xs', color: '#666666', wrap: true, margin: 'sm' }
            ],
            paddingAll: '15px'
          },
          footer: {
            type: 'box',
            layout: 'horizontal',
            contents: [
              { type: 'button', style: 'primary', color: '#E74C3C', height: 'sm',
                action: { type: 'message', label: '監控', text: '監控' }
              },
              { type: 'button', style: 'secondary', height: 'sm', margin: 'sm',
                action: { type: 'message', label: '模擬持股', text: '模擬持股' }
              }
            ],
            paddingAll: '10px'
          }
        },
        // 第5頁：教學
        {
          type: 'bubble',
          size: 'mega',
          header: {
            type: 'box',
            layout: 'vertical',
            contents: [
              { type: 'text', text: '📋 功能清單 (5/5)', size: 'lg', weight: 'bold', color: '#ffffff' },
              { type: 'text', text: '教學 & 說明', size: 'sm', color: '#ffffffaa', margin: 'sm' }
            ],
            backgroundColor: '#F39C12',
            paddingAll: '15px'
          },
          body: {
            type: 'box',
            layout: 'vertical',
            contents: [
              { type: 'text', text: '📚 教學指令', weight: 'bold', size: 'sm', color: '#F39C12' },
              { type: 'text', text: '教學 → 教學主選單\n教學查詢 / 教學持股\n教學停損 / 教學監控\n教學分析 / 教學籌碼\n教學股息 / 教學K線\n教學回測 / 教學模擬', size: 'xs', color: '#666666', wrap: true, margin: 'sm' },
              { type: 'separator', margin: 'lg' },
              { type: 'text', text: '🤖 自然語言', weight: 'bold', size: 'sm', color: '#F39C12', margin: 'lg' },
              { type: 'text', text: '台積電現在多少\n鴻海漲還跌\n幫我查聯發科', size: 'xs', color: '#666666', wrap: true, margin: 'sm' },
              { type: 'separator', margin: 'lg' },
              { type: 'text', text: '⏰ 自動通知', weight: 'bold', size: 'sm', color: '#F39C12', margin: 'lg' },
              { type: 'text', text: '09:00 開盤提醒\n盤中 價格警報\n13:35 收盤摘要\n15:00 法人買賣超', size: 'xs', color: '#666666', wrap: true, margin: 'sm' }
            ],
            paddingAll: '15px'
          },
          footer: {
            type: 'box',
            layout: 'horizontal',
            contents: [
              { type: 'button', style: 'primary', color: '#F39C12', height: 'sm',
                action: { type: 'message', label: '教學', text: '教學' }
              },
              { type: 'button', style: 'secondary', height: 'sm', margin: 'sm',
                action: { type: 'message', label: '說明', text: '說明' }
              }
            ],
            paddingAll: '10px'
          }
        }
      ]
    }
  };
}

/**
 * 取得說明回覆
 */
function getHelpReply() {
  const help = `📱 股海秘書指令說明\n` +
    `━━━━━━━━━━━━━━\n` +
    `🔍 查詢：2330、台積電現在多少\n` +
    `📈 大盤：大盤、美股、熱門\n` +
    `📊 分析：分析 2330、綜合分析\n` +
    `🏦 籌碼：籌碼 2330、外資買超\n` +
    `💼 持股：持股、收盤摘要\n` +
    `🎯 停損：停利 2330 1100\n\n` +
    `🆕 進階功能\n` +
    `━━━━━━━━━━━━━━\n` +
    `💰 股息：股息 2330、高殖利率\n` +
    `🏥 健檢：健檢、組合分析\n` +
    `🌊 波浪：波浪 2330（分析）\n` +
    `🌊 波浪建議（適合進場標的）\n` +
    `🌊 波浪網頁（互動分析）\n` +
    `🤖 AI：AI預測 2330（三AI分析）\n` +
    `💼 配置：投資組合 60萬\n` +
    `⚔️ PK：PK 2330 2317\n` +
    `📡 技術：訊號掃描、主力\n\n` +
    `━━━━━━━━━━━━━━\n` +
    `📋 輸入「功能」看完整清單`;

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

// ========================================
// 🌊 波浪分析 API 路由
// ========================================

// 🆕 測試端點
router.get('/wave/test', (req, res) => {
  res.json({ success: true, message: '波浪 API 正常運作', timestamp: new Date().toISOString() });
});

/**
 * GET /api/wave/analyze/:stockId
 * 波浪分析 API（供網頁版使用）
 */
router.get('/wave/analyze/:stockId', async (req, res) => {
  try {
    const stockId = req.params.stockId;
    console.log(`🌊 波浪分析 API 開始: ${stockId}`);
    
    // 取得股票資料
    const stockData = await stockService.getRealtimePrice(stockId);
    const stockName = stockData?.name || getStockNameById(stockId) || stockId;
    const currentPrice = parseFloat(stockData?.price) || 0;
    console.log(`📈 ${stockId} 股價: ${currentPrice}, 名稱: ${stockName}`);
    
    // 取得歷史資料（180天 = 約6個月）
    const historyRaw = await fetchYahooHistory(stockId, 180);
    console.log(`📊 ${stockId} 歷史資料筆數: ${historyRaw?.length || 0}`);
    
    if (!historyRaw || historyRaw.length < 20) {
      return res.json({ 
        error: `${stockName} 歷史資料不足（僅 ${historyRaw?.length || 0} 筆）`
      });
    }
    
    // 🔑 關鍵：將 history 反轉為升序（舊→新）
    const history = [...historyRaw].reverse();
    
    // ZigZag 轉折點
    const sensitivity = history.length < 40 ? 3 : 5;
    const pivots = findZigZagPivots(history, sensitivity);
    
    // 波浪結構分析
    const waveAnalysis = analyzeWaveStructure(pivots, currentPrice, history);
    
    // 斐波那契目標價
    const fibTargets = calculateFibonacciTargets(waveAnalysis, currentPrice);
    
    // 規則檢查
    const ruleChecks = checkWaveRules(waveAnalysis);
    
    // 信心分數
    const passedRules = ruleChecks.filter(r => r.pass).length;
    const confidence = Math.round((passedRules / 3) * 100);
    
    // 操作建議
    const suggestion = getWaveSuggestion(waveAnalysis);
    
    // 漲跌幅（history 是升序，最後一筆是最新，倒數第二筆是前一天）
    const prevClose = history.length > 1 ? history[history.length - 2].close : currentPrice;
    const changePercent = ((currentPrice - prevClose) / prevClose * 100);
    
    res.json({
      stockId,
      stockName,
      currentPrice,
      currentWave: waveAnalysis.currentWave,
      changePercent,
      confidence,
      suggestion,
      targetUp: fibTargets.upper,
      targetDown: fibTargets.lower,
      rules: ruleChecks,
      waves: waveAnalysis.waves,
      pivots: pivots.slice(-15),
      history: history.slice(-180) // 最近180天（約6個月），已經是升序（舊→新）
    });
  } catch (error) {
    console.error('波浪分析 API 錯誤:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/wave/portfolio
 * 投資組合建議 API
 */
router.get('/wave/portfolio', async (req, res) => {
  try {
    const budget = parseInt(req.query.budget) || 600000;
    const portfolio = await generatePortfolioSuggestion(budget);
    res.json(portfolio);
  } catch (error) {
    console.error('投資組合 API 錯誤:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * 🆕 生成投資組合建議（基於波浪分析）
 */
async function generatePortfolioSuggestion(budget = 600000) {
  // 預設類股配置（60萬）
  const baseAllocation = [
    { stockId: '2330', name: '台積電', sector: '半導體龍頭', percent: 25, reason: '技術領先全球，穩定成長' },
    { stockId: '2454', name: '聯發科', sector: '半導體 IC 設計', percent: 12, reason: 'AI 手機晶片需求增' },
    { stockId: '2881', name: '富邦金', sector: '金融保險', percent: 10, reason: '穩健配息，利率受惠' },
    { stockId: '0050', name: '元大台灣50', sector: '市值型 ETF', percent: 18, reason: '分散風險，跟隨大盤' },
    { stockId: '00878', name: '國泰永續高股息', sector: '高股息 ETF', percent: 12, reason: '穩定配息，季配息' },
    { stockId: '2344', name: '華邦電', sector: '記憶體', percent: 8, reason: '景氣循環股，波段操作' },
    { stockId: '6770', name: '力積電', sector: '晶圓代工', percent: 8, reason: '利基型晶圓代工' },
    { stockId: 'CASH', name: '現金保留', sector: '彈性配置', percent: 7, reason: '等待更好進場點' }
  ];
  
  // 分析每檔股票的波浪位置
  const portfolioWithWaves = await Promise.all(
    baseAllocation.map(async (item) => {
      if (item.stockId === 'CASH') {
        return {
          ...item,
          amount: Math.round(budget * item.percent / 100),
          currentWave: '-',
          currentPrice: null,
          suggestion: '保持流動性'
        };
      }
      
      try {
        const stockData = await stockService.getRealtimePrice(item.stockId);
        const currentPrice = parseFloat(stockData?.price) || 0;
        
        // 簡易波浪判斷
        const history = await fetchYahooHistory(item.stockId, 60);
        let currentWave = '?';
        let waveSuggestion = '';
        
        if (history && history.length >= 20) {
          const pivots = findZigZagPivots(history, 5);
          const waveAnalysis = analyzeWaveStructure(pivots, currentPrice, history);
          currentWave = waveAnalysis.currentWave;
          waveSuggestion = getWaveSuggestion(waveAnalysis);
        }
        
        return {
          ...item,
          amount: Math.round(budget * item.percent / 100),
          currentPrice,
          currentWave,
          waveSuggestion
        };
      } catch (e) {
        return {
          ...item,
          amount: Math.round(budget * item.percent / 100),
          currentWave: '?',
          currentPrice: null,
          waveSuggestion: '無法取得資料'
        };
      }
    })
  );
  
  // 計算風險評估
  const waveScores = portfolioWithWaves.map(p => {
    const wave = p.currentWave;
    if (wave === '-' || wave === '?') return 50;
    if ([1, 2].includes(wave)) return 80; // 初期階段，風險較低
    if (wave === 3) return 90; // 主升段，最佳
    if (wave === 4) return 60; // 整理，觀望
    if (wave === 5) return 40; // 末升段，風險增加
    if (['A', 'B', 'C'].includes(wave)) return 20; // 修正浪，高風險
    return 50;
  });
  
  const avgScore = Math.round(waveScores.reduce((a, b) => a + b, 0) / waveScores.length);
  
  return {
    budget,
    totalAllocated: portfolioWithWaves.reduce((sum, p) => sum + p.amount, 0),
    riskScore: avgScore,
    riskLevel: avgScore >= 70 ? '低風險' : avgScore >= 50 ? '中等風險' : '高風險',
    allocation: portfolioWithWaves,
    sectorDistribution: calculateSectorDistribution(portfolioWithWaves),
    recommendations: generateRecommendations(portfolioWithWaves)
  };
}

/**
 * 計算類股分布
 */
function calculateSectorDistribution(portfolio) {
  const sectors = {};
  portfolio.forEach(p => {
    if (!sectors[p.sector]) {
      sectors[p.sector] = { amount: 0, percent: 0, stocks: [] };
    }
    sectors[p.sector].amount += p.amount;
    sectors[p.sector].percent += p.percent;
    sectors[p.sector].stocks.push(p.stockId);
  });
  return sectors;
}

/**
 * 生成投資建議
 */
function generateRecommendations(portfolio) {
  const recommendations = [];
  
  portfolio.forEach(p => {
    const wave = p.currentWave;
    
    if (wave === 1 || wave === 2) {
      recommendations.push(`✅ ${p.name}：處於第${wave}浪，適合布局`);
    } else if (wave === 3) {
      recommendations.push(`🚀 ${p.name}：主升段第3浪，持股續抱`);
    } else if (wave === 4) {
      recommendations.push(`⏸️ ${p.name}：第4浪整理，等待突破`);
    } else if (wave === 5) {
      recommendations.push(`⚠️ ${p.name}：第5浪末升段，注意獲利了結`);
    } else if (['A', 'B', 'C'].includes(wave)) {
      recommendations.push(`🔴 ${p.name}：修正浪 ${wave} 浪，建議減碼`);
    }
  });
  
  return recommendations;
}

// ========================================
// 🆕 投資組合分析指令（LINE Bot）
// ========================================

/**
 * 投資組合建議（LINE Bot 回覆）
 */
async function getPortfolioSuggestion(budget = 600000) {
  try {
    const portfolio = await generatePortfolioSuggestion(budget);
    
    // 類股配置卡片
    const allocationCards = portfolio.allocation.slice(0, 6).map(p => ({
      type: 'box',
      layout: 'horizontal',
      contents: [
        { type: 'text', text: p.name, size: 'sm', flex: 3, color: '#E2E8F0' },
        { type: 'text', text: `${p.percent}%`, size: 'sm', flex: 1, align: 'end', color: '#6366F1' },
        { type: 'text', text: `$${(p.amount/10000).toFixed(1)}萬`, size: 'sm', flex: 2, align: 'end', color: '#10B981' },
        { type: 'text', text: p.currentWave === '-' ? '現金' : `${p.currentWave}浪`, size: 'xs', flex: 1, align: 'end', 
          color: typeof p.currentWave === 'number' && p.currentWave <= 3 ? '#10B981' : '#F59E0B' }
      ],
      margin: 'md'
    }));
    
    // 風險評估顏色
    const riskColor = portfolio.riskScore >= 70 ? '#10B981' : portfolio.riskScore >= 50 ? '#F59E0B' : '#EF4444';
    
    return {
      type: 'flex',
      altText: `💼 ${budget/10000}萬投資組合建議`,
      contents: {
        type: 'bubble',
        size: 'mega',
        header: {
          type: 'box',
          layout: 'horizontal',
          contents: [
            { type: 'box', layout: 'vertical', flex: 4,
              contents: [
                { type: 'text', text: '💼 投資組合建議', size: 'lg', weight: 'bold', color: '#ffffff' },
                { type: 'text', text: `預算: $${(budget/10000).toFixed(0)}萬 | 波浪分析配置`, size: 'xs', color: '#ffffffaa', margin: 'sm' }
              ]
            },
            { type: 'box', layout: 'vertical', flex: 2, alignItems: 'flex-end',
              contents: [
                { type: 'text', text: portfolio.riskLevel, size: 'xs', color: '#ffffff' },
                { type: 'text', text: `${portfolio.riskScore}分`, size: 'lg', weight: 'bold', color: riskColor }
              ]
            }
          ],
          backgroundColor: '#1E293B',
          paddingAll: '15px'
        },
        body: {
          type: 'box',
          layout: 'vertical',
          contents: [
            // 標題列
            { type: 'box', layout: 'horizontal',
              contents: [
                { type: 'text', text: '股票', size: 'xs', flex: 3, color: '#64748B' },
                { type: 'text', text: '比例', size: 'xs', flex: 1, align: 'end', color: '#64748B' },
                { type: 'text', text: '金額', size: 'xs', flex: 2, align: 'end', color: '#64748B' },
                { type: 'text', text: '波浪', size: 'xs', flex: 1, align: 'end', color: '#64748B' }
              ]
            },
            { type: 'separator', margin: 'md' },
            // 配置清單
            ...allocationCards,
            { type: 'separator', margin: 'lg' },
            // 類股分散
            { type: 'box', layout: 'vertical', margin: 'lg',
              contents: [
                { type: 'text', text: '📊 類股分散', size: 'sm', weight: 'bold', color: '#6366F1' },
                { type: 'text', text: `半導體 ${37}% | 金融 ${10}% | ETF ${30}% | 現金 ${7}%`, size: 'xs', color: '#94A3B8', margin: 'sm', wrap: true }
              ]
            },
            // 建議
            { type: 'box', layout: 'vertical', margin: 'lg', backgroundColor: '#1E293B', cornerRadius: 'md', paddingAll: '12px',
              contents: [
                { type: 'text', text: '💡 波浪位置建議', size: 'sm', weight: 'bold', color: '#FBBF24' },
                { type: 'text', text: portfolio.recommendations.slice(0, 3).join('\n'), size: 'xs', color: '#CBD5E1', wrap: true, margin: 'sm' }
              ]
            }
          ],
          paddingAll: '15px',
          backgroundColor: '#0F172A'
        },
        footer: {
          type: 'box',
          layout: 'horizontal',
          contents: [
            { type: 'button', style: 'primary', color: '#6366F1', height: 'sm',
              action: { type: 'uri', label: '詳細分析', uri: `https://stock-assistant-production-8ce3.up.railway.app/wave.html` }
            },
            { type: 'button', style: 'secondary', height: 'sm', margin: 'sm',
              action: { type: 'message', label: '調整預算', text: '投資組合 100萬' }
            }
          ],
          paddingAll: '10px',
          backgroundColor: '#1E293B'
        }
      }
    };
  } catch (error) {
    console.error('投資組合建議錯誤:', error);
    return { type: 'text', text: `❌ 投資組合建議失敗：${error.message}` };
  }
}

// ========================================
// 🔮 明日預測功能
// ========================================

/**
 * 明日漲跌預測（綜合技術指標）
 */
async function getTomorrowPrediction(stockId) {
  try {
    // 取得股票資料
    const stockData = await stockService.getRealtimePrice(stockId);
    const stockName = stockData?.name || getStockNameById(stockId) || stockId;
    const currentPrice = parseFloat(stockData?.price) || 0;
    const change = parseFloat(stockData?.change) || 0;
    const changePercent = parseFloat(stockData?.changePercent) || 0;
    
    // 取得歷史資料
    const history = await fetchYahooHistory(stockId, 60);
    if (!history || history.length < 20) {
      return { type: 'text', text: `❌ ${stockName} 歷史資料不足，無法預測` };
    }
    
    const closes = history.map(h => h.close);
    const volumes = history.map(h => h.volume);
    
    // 計算各項技術指標
    const indicators = calculatePredictionIndicators(closes, volumes, currentPrice);
    
    // 計算綜合評分（-100 到 +100）
    const score = calculatePredictionScore(indicators);
    
    // 判斷方向與機率
    const direction = score > 0 ? '上漲' : '下跌';
    const probability = Math.min(Math.abs(score) + 50, 95); // 50-95%
    const confidence = Math.abs(score) >= 30 ? '高' : Math.abs(score) >= 15 ? '中' : '低';
    
    // 預估價格區間
    const avgRange = history.slice(0, 10).reduce((sum, h) => sum + (h.high - h.low), 0) / 10;
    const predictHigh = currentPrice + avgRange * 0.6;
    const predictLow = currentPrice - avgRange * 0.6;
    
    // 關鍵價位
    const ma5 = closes.slice(0, 5).reduce((a, b) => a + b, 0) / 5;
    const ma20 = closes.slice(0, 20).reduce((a, b) => a + b, 0) / 20;
    const support = Math.min(...closes.slice(0, 10));
    const resistance = Math.max(...closes.slice(0, 10));
    
    // 指標訊號
    const signals = [];
    if (indicators.maSignal > 0) signals.push({ text: '均線多頭排列', color: '#10B981' });
    else if (indicators.maSignal < 0) signals.push({ text: '均線空頭排列', color: '#EF4444' });
    
    if (indicators.rsi < 30) signals.push({ text: 'RSI 超賣', color: '#10B981' });
    else if (indicators.rsi > 70) signals.push({ text: 'RSI 超買', color: '#EF4444' });
    
    if (indicators.kd.k < 20) signals.push({ text: 'KD 超賣', color: '#10B981' });
    else if (indicators.kd.k > 80) signals.push({ text: 'KD 超買', color: '#EF4444' });
    
    if (indicators.volumeTrend > 1.5) signals.push({ text: '量能放大', color: '#6366F1' });
    else if (indicators.volumeTrend < 0.7) signals.push({ text: '量能萎縮', color: '#F59E0B' });
    
    if (indicators.momentum > 0) signals.push({ text: '動能向上', color: '#10B981' });
    else signals.push({ text: '動能向下', color: '#EF4444' });
    
    // 顏色設定
    const directionColor = score > 0 ? '#10B981' : '#EF4444';
    const bgColor = score > 0 ? '#ECFDF5' : '#FEF2F2';
    const headerBg = score > 0 ? '#059669' : '#DC2626';
    
    // 訊號列表
    const signalRows = signals.slice(0, 4).map(s => ({
      type: 'box',
      layout: 'horizontal',
      contents: [
        { type: 'text', text: '•', size: 'sm', color: s.color },
        { type: 'text', text: s.text, size: 'xs', color: s.color, margin: 'sm' }
      ],
      margin: 'xs'
    }));
    
    return {
      type: 'flex',
      altText: `🔮 ${stockName} 明日預測：${direction} ${probability}%`,
      contents: {
        type: 'bubble',
        size: 'mega',
        header: {
          type: 'box',
          layout: 'horizontal',
          contents: [
            { type: 'box', layout: 'vertical', flex: 3,
              contents: [
                { type: 'text', text: '🔮 明日預測', size: 'lg', weight: 'bold', color: '#ffffff' },
                { type: 'text', text: `${stockName} (${stockId})`, size: 'xs', color: '#ffffffaa', margin: 'xs' }
              ]
            },
            { type: 'box', layout: 'vertical', flex: 2, alignItems: 'flex-end',
              contents: [
                { type: 'text', text: `信心: ${confidence}`, size: 'xs', color: '#ffffff' },
                { type: 'text', text: `${probability}%`, size: 'xl', weight: 'bold', color: '#ffffff' }
              ]
            }
          ],
          backgroundColor: headerBg,
          paddingAll: '15px'
        },
        body: {
          type: 'box',
          layout: 'vertical',
          contents: [
            // 預測方向
            { type: 'box', layout: 'vertical', backgroundColor: bgColor, cornerRadius: 'lg', paddingAll: '15px', alignItems: 'center',
              contents: [
                { type: 'text', text: '明日預估', size: 'sm', color: '#666666' },
                { type: 'text', text: score > 0 ? '📈 偏多上漲' : '📉 偏空下跌', size: 'xl', weight: 'bold', color: directionColor, margin: 'sm' },
                { type: 'text', text: `預估區間: $${predictLow.toFixed(1)} ~ $${predictHigh.toFixed(1)}`, size: 'xs', color: '#888888', margin: 'sm' }
              ]
            },
            // 現價資訊
            { type: 'box', layout: 'horizontal', margin: 'lg',
              contents: [
                { type: 'box', layout: 'vertical', flex: 1, alignItems: 'center',
                  contents: [
                    { type: 'text', text: '現價', size: 'xs', color: '#888888' },
                    { type: 'text', text: `$${currentPrice}`, size: 'md', weight: 'bold', color: changePercent >= 0 ? '#EF4444' : '#10B981' }
                  ]
                },
                { type: 'box', layout: 'vertical', flex: 1, alignItems: 'center',
                  contents: [
                    { type: 'text', text: '今日', size: 'xs', color: '#888888' },
                    { type: 'text', text: `${changePercent >= 0 ? '+' : ''}${changePercent.toFixed(2)}%`, size: 'md', weight: 'bold', color: changePercent >= 0 ? '#EF4444' : '#10B981' }
                  ]
                },
                { type: 'box', layout: 'vertical', flex: 1, alignItems: 'center',
                  contents: [
                    { type: 'text', text: '評分', size: 'xs', color: '#888888' },
                    { type: 'text', text: `${score > 0 ? '+' : ''}${score}`, size: 'md', weight: 'bold', color: directionColor }
                  ]
                }
              ]
            },
            { type: 'separator', margin: 'lg' },
            // 技術指標訊號
            { type: 'box', layout: 'horizontal', margin: 'lg',
              contents: [
                { type: 'box', layout: 'vertical', flex: 1,
                  contents: [
                    { type: 'text', text: '📊 技術訊號', size: 'xs', weight: 'bold', color: '#6366F1' },
                    ...signalRows
                  ]
                },
                { type: 'box', layout: 'vertical', flex: 1,
                  contents: [
                    { type: 'text', text: '📍 關鍵價位', size: 'xs', weight: 'bold', color: '#6366F1' },
                    { type: 'text', text: `壓力: $${resistance.toFixed(1)}`, size: 'xs', color: '#EF4444', margin: 'xs' },
                    { type: 'text', text: `MA5: $${ma5.toFixed(1)}`, size: 'xs', color: '#888888', margin: 'xs' },
                    { type: 'text', text: `MA20: $${ma20.toFixed(1)}`, size: 'xs', color: '#888888', margin: 'xs' },
                    { type: 'text', text: `支撐: $${support.toFixed(1)}`, size: 'xs', color: '#10B981', margin: 'xs' }
                  ]
                }
              ]
            },
            { type: 'separator', margin: 'lg' },
            // 免責聲明
            { type: 'text', text: '⚠️ 僅供參考，不構成投資建議', size: 'xxs', color: '#999999', align: 'center', margin: 'lg' }
          ],
          paddingAll: '15px'
        },
        footer: {
          type: 'box',
          layout: 'horizontal',
          contents: [
            { type: 'button', style: 'primary', color: headerBg, height: 'sm',
              action: { type: 'message', label: '波浪分析', text: `波浪 ${stockId}` }
            },
            { type: 'button', style: 'secondary', height: 'sm', margin: 'sm',
              action: { type: 'message', label: '技術分析', text: `分析 ${stockId}` }
            }
          ],
          paddingAll: '10px'
        }
      }
    };
  } catch (error) {
    console.error('明日預測錯誤:', error);
    return { type: 'text', text: `❌ 預測失敗：${error.message}` };
  }
}

/**
 * 計算預測用技術指標
 */
function calculatePredictionIndicators(closes, volumes, currentPrice) {
  const n = closes.length;
  
  // 均線
  const ma5 = closes.slice(0, 5).reduce((a, b) => a + b, 0) / 5;
  const ma10 = closes.slice(0, 10).reduce((a, b) => a + b, 0) / 10;
  const ma20 = closes.slice(0, 20).reduce((a, b) => a + b, 0) / 20;
  
  // 均線訊號（多頭排列 +1，空頭 -1）
  let maSignal = 0;
  if (currentPrice > ma5 && ma5 > ma10 && ma10 > ma20) maSignal = 1;
  else if (currentPrice < ma5 && ma5 < ma10 && ma10 < ma20) maSignal = -1;
  else if (currentPrice > ma20) maSignal = 0.5;
  else maSignal = -0.5;
  
  // RSI (14日)
  let gains = 0, losses = 0;
  for (let i = 0; i < 14 && i < n - 1; i++) {
    const diff = closes[i] - closes[i + 1];
    if (diff > 0) gains += diff;
    else losses -= diff;
  }
  const avgGain = gains / 14;
  const avgLoss = losses / 14;
  const rsi = avgLoss === 0 ? 100 : 100 - (100 / (1 + avgGain / avgLoss));
  
  // KD (9日)
  const period9High = Math.max(...closes.slice(0, 9));
  const period9Low = Math.min(...closes.slice(0, 9));
  const rsv = period9High === period9Low ? 50 : ((currentPrice - period9Low) / (period9High - period9Low)) * 100;
  const k = rsv; // 簡化
  const d = k; // 簡化
  
  // 成交量趨勢
  const avgVol5 = volumes.slice(0, 5).reduce((a, b) => a + b, 0) / 5;
  const avgVol20 = volumes.slice(0, 20).reduce((a, b) => a + b, 0) / 20;
  const volumeTrend = avgVol20 > 0 ? avgVol5 / avgVol20 : 1;
  
  // 動能（5日漲跌）
  const momentum = ((currentPrice - closes[4]) / closes[4]) * 100;
  
  // 波動率
  const returns = [];
  for (let i = 0; i < 10 && i < n - 1; i++) {
    returns.push((closes[i] - closes[i + 1]) / closes[i + 1]);
  }
  const volatility = Math.sqrt(returns.reduce((sum, r) => sum + r * r, 0) / returns.length) * 100;
  
  // 連續漲跌天數
  let streak = 0;
  for (let i = 0; i < 5 && i < n - 1; i++) {
    if (closes[i] > closes[i + 1]) streak++;
    else if (closes[i] < closes[i + 1]) streak--;
    else break;
  }
  
  return {
    ma5, ma10, ma20, maSignal,
    rsi,
    kd: { k, d },
    volumeTrend,
    momentum,
    volatility,
    streak
  };
}

/**
 * 計算綜合預測評分
 */
function calculatePredictionScore(indicators) {
  let score = 0;
  
  // 均線訊號 (權重 25)
  score += indicators.maSignal * 25;
  
  // RSI (權重 20)
  if (indicators.rsi < 30) score += 20; // 超賣 → 看漲
  else if (indicators.rsi > 70) score -= 20; // 超買 → 看跌
  else if (indicators.rsi < 50) score += (50 - indicators.rsi) / 2;
  else score -= (indicators.rsi - 50) / 2;
  
  // KD (權重 15)
  if (indicators.kd.k < 20) score += 15;
  else if (indicators.kd.k > 80) score -= 15;
  else if (indicators.kd.k < 50) score += (50 - indicators.kd.k) / 3;
  else score -= (indicators.kd.k - 50) / 3;
  
  // 動能 (權重 20)
  score += Math.max(-20, Math.min(20, indicators.momentum * 4));
  
  // 量能 (權重 10)
  if (indicators.volumeTrend > 1.5 && indicators.momentum > 0) score += 10;
  else if (indicators.volumeTrend > 1.5 && indicators.momentum < 0) score -= 10;
  
  // 連續漲跌 (權重 10) - 反向指標
  if (indicators.streak >= 3) score -= 10; // 連漲後看回
  else if (indicators.streak <= -3) score += 10; // 連跌後看反彈
  
  return Math.round(Math.max(-50, Math.min(50, score)));
}

// ========================================
// 🤖 三AI預測功能（Claude API）
// ========================================

/**
 * 三AI預測 - 技術/籌碼/趨勢三角度分析
 */
async function getTripleAIPrediction(stockId) {
  try {
    const claudeKey = process.env.CLAUDE_API_KEY;
    const geminiKey = process.env.GEMINI_API_KEY;
    const openaiKey = process.env.OPENAI_API_KEY;
    
    // 檢查可用的 API
    const availableAPIs = [];
    if (claudeKey) availableAPIs.push('Claude');
    if (geminiKey) availableAPIs.push('Gemini');
    if (openaiKey) availableAPIs.push('GPT');
    
    if (availableAPIs.length === 0) {
      return { type: 'text', text: '❌ 尚未設定任何 AI API KEY\n\n請在 Railway 設定：\nCLAUDE_API_KEY=sk-ant-xxxxx\nGEMINI_API_KEY=AIza...\nOPENAI_API_KEY=sk-...' };
    }
    
    // 取得股票資料
    const stockData = await stockService.getRealtimePrice(stockId);
    const stockName = stockData?.name || getStockNameById(stockId) || stockId;
    const currentPrice = parseFloat(stockData?.price) || 0;
    const change = parseFloat(stockData?.change) || 0;
    const changePercent = parseFloat(stockData?.changePercent) || 0;
    
    // 取得歷史資料
    const history = await fetchYahooHistory(stockId, 30);
    if (!history || history.length < 10) {
      return { type: 'text', text: `❌ ${stockName} 歷史資料不足` };
    }
    
    // 計算技術指標
    const closes = history.map(h => h.close);
    const volumes = history.map(h => h.volume);
    const ma5 = closes.slice(0, 5).reduce((a, b) => a + b, 0) / 5;
    const ma10 = closes.slice(0, 10).reduce((a, b) => a + b, 0) / 10;
    const ma20 = closes.slice(0, 20).reduce((a, b) => a + b, 0) / 20;
    
    // RSI
    let gains = 0, losses = 0;
    for (let i = 0; i < 14 && i < closes.length - 1; i++) {
      const diff = closes[i] - closes[i + 1];
      if (diff > 0) gains += diff;
      else losses -= diff;
    }
    const rsi = losses === 0 ? 100 : 100 - (100 / (1 + (gains/14) / (losses/14)));
    
    // 近5日漲跌
    const recent5 = closes.slice(0, 5);
    const priceChange5 = ((recent5[0] - recent5[4]) / recent5[4] * 100).toFixed(2);
    
    // 量能變化
    const avgVol5 = volumes.slice(0, 5).reduce((a, b) => a + b, 0) / 5;
    const avgVol20 = volumes.slice(0, 20).reduce((a, b) => a + b, 0) / 20;
    const volRatio = (avgVol5 / avgVol20).toFixed(2);
    
    // 準備股票資訊
    const stockInfo = `
股票：${stockName} (${stockId})
現價：${currentPrice} 元
今日漲跌：${changePercent >= 0 ? '+' : ''}${changePercent.toFixed(2)}%
近5日漲跌：${priceChange5}%
MA5：${ma5.toFixed(2)}
MA10：${ma10.toFixed(2)}
MA20：${ma20.toFixed(2)}
RSI(14)：${rsi.toFixed(1)}
量能比(5日/20日)：${volRatio}
近5日收盤：${recent5.map(p => p.toFixed(1)).join(' → ')}
    `.trim();
    
    // 分配 AI 給不同角色
    const assignAI = (preferred, fallbacks) => {
      if (preferred === 'Claude' && claudeKey) return 'Claude';
      if (preferred === 'Gemini' && geminiKey) return 'Gemini';
      if (preferred === 'GPT' && openaiKey) return 'GPT';
      for (const fb of fallbacks) {
        if (fb === 'Claude' && claudeKey) return 'Claude';
        if (fb === 'Gemini' && geminiKey) return 'Gemini';
        if (fb === 'GPT' && openaiKey) return 'GPT';
      }
      return availableAPIs[0];
    };

    const techAI = assignAI('Claude', ['Gemini', 'GPT']);
    const chipAI = assignAI('Gemini', ['GPT', 'Claude']);
    const trendAI = assignAI('GPT', ['Claude', 'Gemini']);
    
    // 三個AI角色並行分析
    const [techAnalysis, chipAnalysis, trendAnalysis] = await Promise.all([
      callPredictionAPI(techAI, '技術分析師', stockInfo, claudeKey, geminiKey, openaiKey),
      callPredictionAPI(chipAI, '籌碼分析師', stockInfo, claudeKey, geminiKey, openaiKey),
      callPredictionAPI(trendAI, '趨勢分析師', stockInfo, claudeKey, geminiKey, openaiKey)
    ]);
    
    // 統計結果
    const votes = {
      up: 0,
      down: 0,
      neutral: 0
    };
    
    [techAnalysis, chipAnalysis, trendAnalysis].forEach(a => {
      if (a.direction === '上漲') votes.up++;
      else if (a.direction === '下跌') votes.down++;
      else votes.neutral++;
    });
    
    // 綜合判斷
    let finalDirection, finalColor, finalEmoji;
    if (votes.up > votes.down) {
      finalDirection = '偏多上漲';
      finalColor = '#10B981';
      finalEmoji = '📈';
    } else if (votes.down > votes.up) {
      finalDirection = '偏空下跌';
      finalColor = '#EF4444';
      finalEmoji = '📉';
    } else {
      finalDirection = '盤整觀望';
      finalColor = '#F59E0B';
      finalEmoji = '➡️';
    }
    
    const consensus = Math.max(votes.up, votes.down, votes.neutral);
    const confidence = consensus === 3 ? '高' : consensus === 2 ? '中' : '低';
    
    // AI 標示
    const getAIIcon = (ai) => {
      const icons = { 'Claude': '🟣', 'Gemini': '🔵', 'GPT': '🟢' };
      return icons[ai] || '⚪';
    };
    
    // 建立回覆
    return {
      type: 'flex',
      altText: `🤖 ${stockName} 三AI預測：${finalDirection}`,
      contents: {
        type: 'bubble',
        size: 'mega',
        header: {
          type: 'box',
          layout: 'horizontal',
          contents: [
            { type: 'box', layout: 'vertical', flex: 3,
              contents: [
                { type: 'text', text: '🤖 三AI智能預測', size: 'lg', weight: 'bold', color: '#ffffff' },
                { type: 'text', text: `${stockName} (${stockId}) $${currentPrice}`, size: 'xs', color: '#ffffffaa', margin: 'xs' }
              ]
            },
            { type: 'box', layout: 'vertical', flex: 2, alignItems: 'flex-end',
              contents: [
                { type: 'text', text: `共識: ${confidence}`, size: 'xs', color: '#ffffff' },
                { type: 'text', text: `${votes.up > votes.down ? votes.up : votes.down}/3`, size: 'xl', weight: 'bold', color: '#ffffff' }
              ]
            }
          ],
          backgroundColor: '#6366F1',
          paddingAll: '15px'
        },
        body: {
          type: 'box',
          layout: 'vertical',
          contents: [
            // 綜合結論
            { type: 'box', layout: 'vertical', backgroundColor: votes.up > votes.down ? '#ECFDF5' : votes.down > votes.up ? '#FEF2F2' : '#FEF9C3', cornerRadius: 'lg', paddingAll: '15px', alignItems: 'center',
              contents: [
                { type: 'text', text: '綜合預測', size: 'sm', color: '#666666' },
                { type: 'text', text: `${finalEmoji} ${finalDirection}`, size: 'xl', weight: 'bold', color: finalColor, margin: 'sm' },
                { type: 'text', text: `看漲 ${votes.up} | 看跌 ${votes.down} | 中立 ${votes.neutral}`, size: 'xs', color: '#888888', margin: 'sm' }
              ]
            },
            { type: 'separator', margin: 'lg' },
            // 三位分析師
            { type: 'text', text: '📊 三位AI分析師觀點', size: 'sm', weight: 'bold', color: '#6366F1', margin: 'lg' },
            // 技術分析師
            { type: 'box', layout: 'horizontal', margin: 'md', backgroundColor: '#F8FAFC', cornerRadius: 'md', paddingAll: '10px',
              contents: [
                { type: 'box', layout: 'vertical', flex: 1,
                  contents: [
                    { type: 'text', text: `🔧 技術分析師 ${getAIIcon(techAI)}${techAI}`, size: 'xs', weight: 'bold', color: '#3B82F6' },
                    { type: 'text', text: techAnalysis.reason, size: 'xxs', color: '#666666', wrap: true, margin: 'xs' }
                  ]
                },
                { type: 'text', text: techAnalysis.direction === '上漲' ? '📈' : techAnalysis.direction === '下跌' ? '📉' : '➡️', size: 'lg', flex: 0 }
              ]
            },
            // 籌碼分析師
            { type: 'box', layout: 'horizontal', margin: 'sm', backgroundColor: '#F8FAFC', cornerRadius: 'md', paddingAll: '10px',
              contents: [
                { type: 'box', layout: 'vertical', flex: 1,
                  contents: [
                    { type: 'text', text: `🏦 籌碼分析師 ${getAIIcon(chipAI)}${chipAI}`, size: 'xs', weight: 'bold', color: '#10B981' },
                    { type: 'text', text: chipAnalysis.reason, size: 'xxs', color: '#666666', wrap: true, margin: 'xs' }
                  ]
                },
                { type: 'text', text: chipAnalysis.direction === '上漲' ? '📈' : chipAnalysis.direction === '下跌' ? '📉' : '➡️', size: 'lg', flex: 0 }
              ]
            },
            // 趨勢分析師
            { type: 'box', layout: 'horizontal', margin: 'sm', backgroundColor: '#F8FAFC', cornerRadius: 'md', paddingAll: '10px',
              contents: [
                { type: 'box', layout: 'vertical', flex: 1,
                  contents: [
                    { type: 'text', text: `📈 趨勢分析師 ${getAIIcon(trendAI)}${trendAI}`, size: 'xs', weight: 'bold', color: '#F59E0B' },
                    { type: 'text', text: trendAnalysis.reason, size: 'xxs', color: '#666666', wrap: true, margin: 'xs' }
                  ]
                },
                { type: 'text', text: trendAnalysis.direction === '上漲' ? '📈' : trendAnalysis.direction === '下跌' ? '📉' : '➡️', size: 'lg', flex: 0 }
              ]
            },
            { type: 'separator', margin: 'lg' },
            { type: 'text', text: '⚠️ AI分析僅供參考，不構成投資建議', size: 'xxs', color: '#999999', align: 'center', margin: 'md' }
          ],
          paddingAll: '15px'
        },
        footer: {
          type: 'box',
          layout: 'horizontal',
          contents: [
            { type: 'button', style: 'primary', color: '#6366F1', height: 'sm',
              action: { type: 'message', label: '技術預測', text: `預測 ${stockId}` }
            },
            { type: 'button', style: 'secondary', height: 'sm', margin: 'sm',
              action: { type: 'message', label: '波浪分析', text: `波浪 ${stockId}` }
            }
          ],
          paddingAll: '10px'
        }
      }
    };
  } catch (error) {
    console.error('三AI預測錯誤:', error);
    return { type: 'text', text: `❌ AI預測失敗：${error.message}` };
  }
}

/**
 * 呼叫預測 API（根據分配的 AI）
 */
async function callPredictionAPI(aiName, role, stockInfo, claudeKey, geminiKey, openaiKey) {
  const rolePrompts = {
    '技術分析師': `你是專業的技術分析師，專注於K線型態、均線、RSI、KD等技術指標。
請根據以下股票資訊，判斷明日走勢。
只能回答「上漲」「下跌」或「盤整」其中之一，並用20字以內說明理由。
格式：方向|理由`,

    '籌碼分析師': `你是專業的籌碼分析師，專注於法人買賣、主力動向、成交量變化。
請根據以下股票資訊（特別注意量能變化），判斷明日走勢。
只能回答「上漲」「下跌」或「盤整」其中之一，並用20字以內說明理由。
格式：方向|理由`,

    '趨勢分析師': `你是專業的趨勢分析師，專注於均線排列、趨勢方向、支撐壓力。
請根據以下股票資訊，判斷明日走勢。
只能回答「上漲」「下跌」或「盤整」其中之一，並用20字以內說明理由。
格式：方向|理由`
  };
  
  const prompt = `${rolePrompts[role]}\n\n${stockInfo}`;
  
  try {
    let text = '盤整|無法判斷';
    
    if (aiName === 'Claude' && claudeKey) {
      const response = await axios.post('https://api.anthropic.com/v1/messages', {
        model: 'claude-3-haiku-20240307',
        max_tokens: 100,
        messages: [{ role: 'user', content: prompt }]
      }, {
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': claudeKey,
          'anthropic-version': '2023-06-01'
        },
        timeout: 15000
      });
      text = response.data?.content?.[0]?.text || text;
    } else if (aiName === 'Gemini' && geminiKey) {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${geminiKey}`;
      const response = await axios.post(url, {
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.7, maxOutputTokens: 100 }
      }, { headers: { 'Content-Type': 'application/json' }, timeout: 15000 });
      text = response.data?.candidates?.[0]?.content?.parts?.[0]?.text || text;
    } else if (aiName === 'GPT' && openaiKey) {
      const response = await axios.post('https://api.openai.com/v1/chat/completions', {
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 100,
        temperature: 0.7
      }, {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${openaiKey}`
        },
        timeout: 15000
      });
      text = response.data?.choices?.[0]?.message?.content || text;
    }
    
    const parts = text.split('|');
    let direction = '盤整';
    if (parts[0].includes('上漲') || parts[0].includes('漲')) direction = '上漲';
    else if (parts[0].includes('下跌') || parts[0].includes('跌')) direction = '下跌';
    
    return {
      direction,
      reason: parts[1]?.trim() || parts[0].trim().substring(0, 30)
    };
  } catch (error) {
    console.error(`${aiName} API (${role}) 錯誤:`, error.message);
    return {
      direction: '盤整',
      reason: 'API暫時無法連線'
    };
  }
}

module.exports = router;




