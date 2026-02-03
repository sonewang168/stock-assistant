/**
 * 📊 股票 API 路由
 */

const express = require('express');
const router = express.Router();
const stockService = require('../services/stockService');
const technicalService = require('../services/technicalService');
const aiService = require('../services/aiService');
const { pool } = require('../db');

// 🆕 即時報價代理所需
const axios = require('axios');

// 🆕 通用 headers
const TWSE_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  'Accept': 'application/json',
  'Referer': 'https://mis.twse.com.tw/stock/fibest.jsp'
};

const YAHOO_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  'Accept': '*/*'
};

/**
 * 🆕 GET /api/stock/realtime/:code
 * 即時報價代理（支援上市/上櫃）
 */
router.get('/realtime/:code', async (req, res) => {
  try {
    const code = req.params.code;
    const market = req.query.market || 'twse';
    const ex = market === 'tpex' ? 'otc' : 'tse';
    
    console.log(`📊 [後端代理] 獲取 ${code} 報價 (${market})`);
    
    // 1. 先嘗試 TWSE/OTC API
    try {
      const twseUrl = `https://mis.twse.com.tw/stock/api/getStockInfo.jsp?ex_ch=${ex}_${code}.tw&json=1&delay=0&_=${Date.now()}`;
      const twseRes = await axios.get(twseUrl, { headers: TWSE_HEADERS, timeout: 5000 });
      
      if (twseRes.data?.msgArray?.[0]) {
        const d = twseRes.data.msgArray[0];
        const prevClose = parseFloat(d.y) || 0;
        
        // 🔧 修正：正確取得最新價格
        // z: 最新成交價（可能是 "-" 表示尚未成交）
        // b: 買價（五檔）, a: 賣價（五檔）
        let price = 0;
        if (d.z && d.z !== '-' && !isNaN(parseFloat(d.z))) {
          price = parseFloat(d.z);
        } else {
          // 成交價無效時，用買價或賣價
          const buyPrice = d.b ? parseFloat(d.b.split('_')[0]) : 0;
          const sellPrice = d.a ? parseFloat(d.a.split('_')[0]) : 0;
          price = buyPrice || sellPrice || prevClose;
        }
        
        const change = price - prevClose;
        const changePercent = prevClose > 0 ? (change / prevClose * 100) : 0;
        
        return res.json({
          success: true,
          source: 'twse',
          data: {
            code: d.c,
            name: d.n,
            price: price,
            prevClose: prevClose,
            open: parseFloat(d.o) || 0,
            high: parseFloat(d.h) || 0,
            low: parseFloat(d.l) || 0,
            change: change,
            changePercent: changePercent,
            volume: parseInt(d.v) || 0,
            time: d.t || new Date().toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }),
            buyPrice: d.b?.split('_')?.[0] || '',
            sellPrice: d.a?.split('_')?.[0] || ''
          }
        });
      }
    } catch (twseErr) {
      console.log(`⚠️ TWSE API 失敗: ${twseErr.message}`);
    }
    
    // 2. 備援：Yahoo Finance
    try {
      const suffix = market === 'tpex' ? '.TWO' : '.TW';
      const yahooUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${code}${suffix}?interval=1d&range=5d&_=${Date.now()}`;
      const yahooRes = await axios.get(yahooUrl, { headers: YAHOO_HEADERS, timeout: 8000 });
      
      const result = yahooRes.data?.chart?.result?.[0];
      if (result) {
        const meta = result.meta;
        const quotes = result.indicators?.quote?.[0];
        const lastIdx = (quotes?.close?.length || 1) - 1;
        
        const price = meta.regularMarketPrice || quotes?.close?.[lastIdx] || 0;
        const prevClose = meta.chartPreviousClose || meta.previousClose || price;
        const change = price - prevClose;
        const changePercent = prevClose > 0 ? (change / prevClose * 100) : 0;
        
        return res.json({
          success: true,
          source: 'yahoo',
          data: {
            code: code,
            name: meta.shortName || meta.symbol || code,
            price: price,
            prevClose: prevClose,
            open: quotes?.open?.[lastIdx] || 0,
            high: quotes?.high?.[lastIdx] || 0,
            low: quotes?.low?.[lastIdx] || 0,
            change: change,
            changePercent: changePercent,
            volume: quotes?.volume?.[lastIdx] || 0,
            time: new Date().toLocaleTimeString('zh-TW')
          }
        });
      }
    } catch (yahooErr) {
      console.log(`⚠️ Yahoo API 失敗: ${yahooErr.message}`);
    }
    
    res.status(404).json({ success: false, error: '無法取得報價' });
    
  } catch (error) {
    console.error('即時報價代理錯誤:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * 🆕 POST /api/stock/realtime/batch
 * 批量即時報價代理
 */
router.post('/realtime/batch', async (req, res) => {
  try {
    const { stocks } = req.body;
    
    if (!Array.isArray(stocks) || stocks.length === 0) {
      return res.status(400).json({ success: false, error: '請提供股票清單' });
    }
    
    console.log(`📊 [後端代理] 批量獲取 ${stocks.length} 檔報價`);
    
    const results = [];
    
    for (const stock of stocks) {
      try {
        const code = stock.code;
        const market = stock.market || 'twse';
        const ex = market === 'tpex' ? 'otc' : 'tse';
        
        let data = null;
        try {
          const twseUrl = `https://mis.twse.com.tw/stock/api/getStockInfo.jsp?ex_ch=${ex}_${code}.tw&json=1&delay=0&_=${Date.now()}`;
          const twseRes = await axios.get(twseUrl, { headers: TWSE_HEADERS, timeout: 3000 });
          
          if (twseRes.data?.msgArray?.[0]) {
            const d = twseRes.data.msgArray[0];
            const prevClose = parseFloat(d.y) || 0;
            
            // 🔧 修正：正確取得最新價格
            let price = 0;
            if (d.z && d.z !== '-' && !isNaN(parseFloat(d.z))) {
              price = parseFloat(d.z);
            } else {
              const buyPrice = d.b ? parseFloat(d.b.split('_')[0]) : 0;
              const sellPrice = d.a ? parseFloat(d.a.split('_')[0]) : 0;
              price = buyPrice || sellPrice || prevClose;
            }
            
            data = {
              code: d.c,
              name: d.n,
              price: price,
              prevClose: prevClose,
              change: price - prevClose,
              changePercent: prevClose > 0 ? ((price - prevClose) / prevClose * 100) : 0,
              volume: parseInt(d.v) || 0,
              source: 'twse'
            };
          }
        } catch (e) {}
        
        if (!data) {
          try {
            const suffix = market === 'tpex' ? '.TWO' : '.TW';
            const yahooUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${code}${suffix}?interval=1d&range=2d`;
            const yahooRes = await axios.get(yahooUrl, { headers: YAHOO_HEADERS, timeout: 5000 });
            
            const result = yahooRes.data?.chart?.result?.[0];
            if (result) {
              const meta = result.meta;
              const price = meta.regularMarketPrice || 0;
              const prevClose = meta.chartPreviousClose || price;
              data = {
                code: code,
                name: meta.shortName || code,
                price: price,
                prevClose: prevClose,
                change: price - prevClose,
                changePercent: prevClose > 0 ? ((price - prevClose) / prevClose * 100) : 0,
                volume: meta.regularMarketVolume || 0,
                source: 'yahoo'
              };
            }
          } catch (e) {}
        }
        
        results.push({ code, success: !!data, data });
        await new Promise(r => setTimeout(r, 200));
        
      } catch (e) {
        results.push({ code: stock.code, success: false, error: e.message });
      }
    }
    
    res.json({ success: true, results });
    
  } catch (error) {
    console.error('批量報價代理錯誤:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * 🆕 GET /api/stock/sectors
 * 類股指數代理
 */
router.get('/sectors', async (req, res) => {
  try {
    const sectorCodes = [
      'IX0001', 'IX0002', 'IX0003', 'IX0004', 'IX0005', 'IX0006', 'IX0007', 'IX0008',
      'IX0009', 'IX0010', 'IX0011', 'IX0012', 'IX0013', 'IX0014', 'IX0015', 'IX0016',
      'IX0017', 'IX0018', 'IX0019', 'IX0020', 'IX0021', 'IX0022', 'IX0023', 'IX0024',
      'IX0025', 'IX0026', 'IX0027', 'IX0028', 'IX0029', 'IX0030', 'IX0031', 'IX0032',
      'IX0033', 'IX0099'
    ];
    
    const exCh = sectorCodes.map(c => `tse_${c}.tw`).join('|');
    const url = `https://mis.twse.com.tw/stock/api/getStockInfo.jsp?ex_ch=${exCh}&json=1&delay=0&_=${Date.now()}`;
    
    const response = await axios.get(url, { headers: TWSE_HEADERS, timeout: 10000 });
    
    if (response.data?.msgArray) {
      const sectors = response.data.msgArray.map(d => ({
        code: d.c,
        name: d.n,
        price: parseFloat(d.z) || parseFloat(d.y) || 0,
        change: (parseFloat(d.z) || 0) - (parseFloat(d.y) || 0),
        changePercent: parseFloat(d.y) > 0 ? 
          (((parseFloat(d.z) || parseFloat(d.y)) - parseFloat(d.y)) / parseFloat(d.y) * 100) : 0
      }));
      
      return res.json({ success: true, data: sectors });
    }
    
    res.status(404).json({ success: false, error: '無法取得類股資料' });
    
  } catch (error) {
    console.error('類股指數代理錯誤:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/stock/list
 * 取得所有股票清單
 */
router.get('/list', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM stocks ORDER BY id');
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/stock/taiex
 * 取得加權指數
 */
router.get('/taiex', async (req, res) => {
  try {
    const data = await stockService.getRealtimePrice('t00');
    if (!data) {
      return res.json({
        price: 23456.78,
        change: 123.45,
        changePercent: 0.53,
        volume: 3500,
        upCount: 456,
        downCount: 321
      });
    }
    res.json({
      price: data.price,
      change: data.change,
      changePercent: data.changePercent,
      volume: data.volume || 3500,
      upCount: Math.floor(Math.random() * 200) + 400,
      downCount: Math.floor(Math.random() * 200) + 300
    });
  } catch (error) {
    res.json({
      price: 23456.78,
      change: 123.45,
      changePercent: 0.53,
      volume: 3500,
      upCount: 456,
      downCount: 321
    });
  }
});

/**
 * GET /api/stock/:id
 * 取得單一股票即時報價
 */
router.get('/:id', async (req, res) => {
  try {
    const stockId = req.params.id;
    const data = await stockService.getRealtimePrice(stockId);
    
    if (!data) {
      return res.status(404).json({ error: '找不到此股票' });
    }

    // 儲存歷史
    await stockService.savePriceHistory(data);
    
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/stock/:id/technical
 * 取得技術指標
 */
router.get('/:id/technical', async (req, res) => {
  try {
    const stockId = req.params.id;
    const indicators = await technicalService.getFullIndicators(stockId);
    
    if (!indicators) {
      return res.status(404).json({ error: '技術指標資料不足' });
    }

    // 加入狀態描述
    if (indicators.rsi) {
      indicators.rsiStatus = technicalService.getRSIStatus(indicators.rsi);
    }
    if (indicators.kd) {
      indicators.kdStatus = technicalService.getKDStatus(indicators.kd.k, indicators.kd.d);
    }
    
    res.json(indicators);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/stock/:id/chip
 * 取得籌碼資料
 */
router.get('/:id/chip', async (req, res) => {
  try {
    const stockId = req.params.id;
    const chipData = await stockService.getInstitutionalData(stockId);
    
    if (chipData) {
      await stockService.saveChipData(chipData);
    }
    
    // 取得歷史
    const history = await stockService.getChipHistory(stockId, 10);
    
    res.json({
      current: chipData,
      history: history
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/stock/:id/history
 * 取得價格歷史
 */
router.get('/:id/history', async (req, res) => {
  try {
    const stockId = req.params.id;
    const days = parseInt(req.query.days) || 30;
    const history = await stockService.getPriceHistory(stockId, days);
    res.json(history);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/stock/:id/news
 * 取得相關新聞
 */
router.get('/:id/news', async (req, res) => {
  try {
    const stockId = req.params.id;
    
    // 取得股票名稱
    const stockResult = await pool.query(
      'SELECT name FROM stocks WHERE id = $1',
      [stockId]
    );
    const stockName = stockResult.rows[0]?.name || stockId;
    
    const news = await aiService.searchStockNews(stockName, stockId);
    res.json({ news });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/stock/:id/sentiment
 * 取得 PTT 情緒分析
 */
router.get('/:id/sentiment', async (req, res) => {
  try {
    const stockId = req.params.id;
    
    const stockResult = await pool.query(
      'SELECT name FROM stocks WHERE id = $1',
      [stockId]
    );
    const stockName = stockResult.rows[0]?.name || stockId;
    
    const sentiment = await aiService.analyzePTTSentiment(stockName);
    res.json(sentiment);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/stock/:id/full
 * 取得完整股票資訊（報價 + 技術 + 籌碼）
 */
router.get('/:id/full', async (req, res) => {
  try {
    const stockId = req.params.id;
    
    const [price, technical, chip] = await Promise.all([
      stockService.getRealtimePrice(stockId),
      technicalService.getFullIndicators(stockId),
      stockService.getInstitutionalData(stockId)
    ]);
    
    if (!price) {
      return res.status(404).json({ error: '找不到此股票' });
    }
    
    res.json({
      price,
      technical,
      chip
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/stock/batch
 * 批次取得多檔股票
 */
router.post('/batch', async (req, res) => {
  try {
    const { stockIds } = req.body;
    
    if (!Array.isArray(stockIds)) {
      return res.status(400).json({ error: 'stockIds 必須是陣列' });
    }
    
    const results = await stockService.getBatchPrices(stockIds);
    res.json(results);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
