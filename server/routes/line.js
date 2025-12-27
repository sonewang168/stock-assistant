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
  
  // 搜尋股票：查 台積電、找 鴻海
  if (/^[查找搜]\s*.+$/.test(msg)) {
    const keyword = msg.replace(/^[查找搜]\s*/, '').trim();
    return await searchStock(keyword);
  }
  
  // 指令列表
  const commands = {
    '持股': () => getPortfolioReply(),
    '監控': () => getWatchlistReply(),
    '熱門': () => getHotStocksReply(),
    '大盤': () => getMarketReply(),
    '指數': () => getMarketReply(),
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
  
  // 嘗試用名稱搜尋
  if (msg.length >= 2 && !/^\d+$/.test(msg)) {
    const searchResult = await searchStock(msg);
    if (searchResult.text.includes('找到')) {
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
 * 取得指數/大盤回覆
 */
async function getMarketReply() {
  try {
    // 取得大盤指數
    const taiex = await stockService.getRealtimePrice('t00');
    
    if (!taiex) {
      return { type: 'text', text: '⚠️ 無法取得大盤資訊' };
    }
    
    const isUp = taiex.change >= 0;
    
    let info = `📈 台股大盤\n`;
    info += `━━━━━━━━━━━━━━\n`;
    info += `加權指數：${taiex.price}\n`;
    info += `漲跌：${isUp ? '📈 +' : '📉 '}${taiex.change}（${taiex.changePercent}%）\n`;
    info += `成交量：${(taiex.volume / 100000000).toFixed(0)} 億\n\n`;
    
    // 熱門股簡報
    const hotStocks = ['2330', '2317', '2454', '2308', '3008'];
    info += `🔥 權值股動態\n`;
    
    for (const id of hotStocks.slice(0, 3)) {
      const stock = await stockService.getRealtimePrice(id);
      if (stock) {
        const up = stock.change >= 0;
        info += `• ${stock.name}：${stock.price}（${up ? '+' : ''}${stock.changePercent}%）\n`;
      }
    }
    
    return { type: 'text', text: info };
    
  } catch (error) {
    console.error('取得大盤錯誤:', error);
    return { type: 'text', text: '⚠️ 取得大盤資訊失敗' };
  }
}

/**
 * 搜尋股票（用名稱）
 */
async function searchStock(keyword) {
  try {
    // 先從資料庫搜尋
    const dbResult = await pool.query(`
      SELECT id, name, market FROM stocks 
      WHERE name LIKE $1 OR id LIKE $1
      LIMIT 5
    `, [`%${keyword}%`]);
    
    if (dbResult.rows.length > 0) {
      let info = `🔍 搜尋「${keyword}」\n`;
      info += `━━━━━━━━━━━━━━\n`;
      
      for (const row of dbResult.rows) {
        info += `• ${row.name}（${row.id}）\n`;
      }
      
      info += `\n💡 輸入代碼查詢詳情`;
      return { type: 'text', text: info };
    }
    
    // 完整股票對照表
    const stockMap = {
      // ===== 權值股 =====
      '台積電': '2330', '台積': '2330', 'TSMC': '2330',
      '鴻海': '2317', '聯發科': '2454', '聯發': '2454',
      '台達電': '2308', '台達': '2308',
      '大立光': '3008', '聯電': '2303',
      '日月光投控': '3711', '日月光': '3711',
      '中華電': '2412', '中華電信': '2412',
      '台塑': '1301', '南亞': '1303', '台化': '1326',
      '台塑化': '6505', '台泥': '1101', '亞泥': '1102',
      '統一': '1216', '統一超': '2912',
      '和泰車': '2207', '裕隆': '2201',
      
      // ===== 金融股 =====
      '國泰金': '2882', '國泰': '2882',
      '富邦金': '2881', '富邦': '2881',
      '中信金': '2891', '中信': '2891',
      '玉山金': '2884', '玉山': '2884',
      '元大金': '2885', '元大': '2885',
      '兆豐金': '2886', '兆豐': '2886',
      '第一金': '2892', '合庫金': '5880',
      '華南金': '2880', '台新金': '2887',
      '永豐金': '2890', '新光金': '2888',
      '開發金': '2883', '國票金': '2889',
      '台企銀': '2834', '彰銀': '2801',
      
      // ===== 電子股 =====
      '廣達': '2382', '仁寶': '2324', '緯創': '3231',
      '英業達': '2356', '和碩': '4938', '華碩': '2357',
      '宏碁': '2353', '微星': '2377', '技嘉': '2376',
      '友達': '2409', '群創': '3481',
      '瑞昱': '2379', '聯詠': '3034', '矽力': '6415',
      '群聯': '8299', '祥碩': '5269', '創意': '3443',
      '世芯': '3661', '智原': '3035', 'M31': '6643',
      '欣興': '3037', '景碩': '3189', '南電': '8046',
      '華通': '2313', '燿華': '2367', '健鼎': '3044',
      '台光電': '2383', '聯茂': '6213',
      '可成': '2474', '鴻準': '2354',
      '臻鼎': '4958', '嘉聯益': '6153',
      '穩懋': '3105', '宏捷科': '8086',
      '環球晶': '6488', '合晶': '6182', '中美晶': '5483',
      '力成': '6239', '京元電子': '2449', '京元電': '2449',
      '矽格': '6257', '頎邦': '6147',
      '精測': '6510', '雍智': '6861',
      '大聯大': '3702', '文曄': '3036', '至上': '8112',
      '正文': '4906', '啟碁': '6285', '中磊': '5388',
      '智邦': '2345', '明泰': '3380',
      
      // ===== 半導體設備 =====
      '弘塑': '3131', '辛耘': '3583', '家登': '3680',
      '漢唐': '2404', '帆宣': '6196', '京鼎': '3413',
      '萬潤': '6187', '翔名': '8091',
      
      // ===== AI / 伺服器 =====
      '緯穎': '6669', '川湖': '2059', '勤誠': '8210',
      '奇鋐': '3017', '雙鴻': '3324', '超眾': '6230',
      '信驊': '5274', '神基': '3005', '研華': '2395',
      '樺漢': '6414', '安勤': '3479',
      
      // ===== 傳產股 =====
      '長榮': '2603', '陽明': '2609', '萬海': '2615',
      '長榮航': '2618', '華航': '2610', '星宇': '2646',
      '遠東新': '1402', '新纖': '1409', '力麗': '1444',
      '正新': '2105', '建大': '2106',
      '台玻': '1802', '永豐餘': '1907',
      '遠傳': '4904', '台灣大': '3045', '亞太電': '3682',
      '葡萄王': '1707', '大統益': '1232',
      '豐泰': '9910', '寶成': '9904', '鈺齊': '9802',
      '巨大': '9921', '美利達': '9914',
      '上銀': '2049', '亞德客': '1590',
      '研揚': '2463', '凌華': '6166',
      
      // ===== 生技醫療 =====
      '保瑞': '6472', '大江': '8436', '美時': '1795',
      '中裕': '4147', '藥華藥': '6446', '合一': '4743',
      '晟德': '4123', '東洋': '4105', '杏輝': '1734',
      '佳醫': '4104', '大樹': '6469', '杏一': '4175',
      '精華': '1565', '明基醫': '4116',
      
      // ===== 營建 =====
      '興富發': '2542', '華固': '2548', '長虹': '5534',
      '潤泰新': '9945', '遠雄': '5522', '國建': '2501',
      '冠德': '2520', '皇翔': '2545', '達麗': '6177',
      '宏璟': '2527', '櫻花建': '2539',
      
      // ===== 觀光餐飲 =====
      '晶華': '2707', '雄獅': '2731', '王品': '2727',
      '瓦城': '2729', '六角': '2732', '美食': '2723',
      
      // ===== 鋼鐵 =====
      '中鋼': '2002', '中鴻': '2014', '東鋼': '2006',
      '大成鋼': '2027', '榮剛': '5009', '千附': '8383',
      
      // ===== 電機 =====
      '東元': '1504', '大同': '2371', '士電': '1503',
      '華城': '1519', '中興電': '1513', '亞力': '1514',
      
      // ===== ETF =====
      '元大50': '0050', '0050': '0050', '台灣50': '0050',
      '元大高股息': '0056', '0056': '0056', '高股息': '0056',
      '國泰永續高股息': '00878', '00878': '00878', '永續高股息': '00878',
      '復華台灣科技優息': '00929', '00929': '00929', '科技優息': '00929',
      '元大台灣價值高息': '00940', '00940': '00940',
      '統一台灣高息動能': '00939', '00939': '00939',
      '群益台灣精選高息': '00919', '00919': '00919',
      '富邦特選高股息': '00900', '00900': '00900',
      '國泰股利精選30': '00701', '00701': '00701',
      '元大台灣ESG永續': '00850', '00850': '00850',
      '富邦台50': '006208', '006208': '006208',
      '永豐台灣ESG': '00888', '00888': '00888',
      '元大美債20年': '00679B', '美債20': '00679B',
      '元大投資級公司債': '00720B',
      '國泰20年美債': '00687B',
      'S&P500': '00646', '元大S&P500': '00646',
      '富邦NASDAQ': '00662', 'NASDAQ': '00662',
      '國泰費城半導體': '00830', '費半': '00830',
      '中信中國高股息': '00882', '00882': '00882',
      '富邦越南': '00885', '00885': '00885',
      '國泰日經225': '00657',
      
      // ===== 其他熱門 =====
      '寶雅': '5904', '全家': '5903', '三商家購': '2945',
      '誠品生活': '2926', '特力': '2908',
      '裕融': '9941', '中租': '5871', '和潤': '6592',
      '台積ADR': '2330', '聯電ADR': '2303'
    };
    
    // 嘗試匹配
    for (const [name, id] of Object.entries(stockMap)) {
      if (name.includes(keyword) || keyword.includes(name)) {
        // 找到匹配，直接查詢
        return await getStockInfoReply(id);
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
 * 取得熱門股票
 */
async function getHotStocksReply() {
  try {
    const hotStocks = [
      { id: '2330', name: '台積電' },
      { id: '2317', name: '鴻海' },
      { id: '2454', name: '聯發科' },
      { id: '0050', name: '元大50' },
      { id: '0056', name: '元大高股息' },
      { id: '00878', name: '國泰永續高股息' },
      { id: '2882', name: '國泰金' },
      { id: '2881', name: '富邦金' }
    ];
    
    let info = `🔥 熱門股票\n`;
    info += `━━━━━━━━━━━━━━\n`;
    
    for (const stock of hotStocks) {
      const data = await stockService.getRealtimePrice(stock.id);
      if (data) {
        const up = data.change >= 0;
        info += `${stock.name}（${stock.id}）\n`;
        info += `  💰 ${data.price}（${up ? '📈+' : '📉'}${data.changePercent}%）\n`;
      }
    }
    
    info += `\n💡 輸入代碼查看詳情`;
    
    return { type: 'text', text: info };
    
  } catch (error) {
    console.error('取得熱門股票錯誤:', error);
    return { type: 'text', text: '⚠️ 取得熱門股票失敗' };
  }
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
    `   2330（輸入代碼）\n` +
    `   查 台積電（搜名稱）\n\n` +
    `📈 大盤/熱門\n` +
    `   「大盤」看加權指數\n` +
    `   「熱門」看熱門股\n\n` +
    `➕ 監控管理\n` +
    `   +2330（加入監控）\n` +
    `   -2330（移除監控）\n` +
    `   「監控」看清單\n\n` +
    `🔊 語音播報\n` +
    `   語音 2330\n\n` +
    `💼「持股」看持股\n` +
    `❓「說明」顯示此訊息`;

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
