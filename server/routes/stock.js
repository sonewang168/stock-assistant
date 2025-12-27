/**
 * 📊 股票 API 路由
 */

const express = require('express');
const router = express.Router();
const stockService = require('../services/stockService');
const technicalService = require('../services/technicalService');
const aiService = require('../services/aiService');
const { pool } = require('../db');

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
