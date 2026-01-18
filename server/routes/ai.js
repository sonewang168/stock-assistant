/**
 * 🤖 AI 分析 API 路由
 * 雙 AI（Gemini + OpenAI）買賣建議分析
 */

const express = require('express');
const router = express.Router();
const { pool } = require('../db');
const aiService = require('../services/aiService');
const stockService = require('../services/stockService');
const technicalService = require('../services/technicalService');

/**
 * GET /api/ai/analyze/:stockId
 * 取得單一股票的 AI 買賣建議
 */
router.get('/analyze/:stockId', async (req, res) => {
  try {
    const { stockId } = req.params;
    const userId = req.query.userId || 'default';

    // 1. 取得即時股價
    const stockData = await stockService.getRealtimePrice(stockId);
    if (!stockData) {
      return res.status(404).json({ error: '找不到此股票' });
    }

    // 2. 取得技術指標
    let technicalData = null;
    try {
      technicalData = await technicalService.getFullIndicators(stockId);
    } catch (e) {
      console.log('技術指標取得失敗:', e.message);
    }

    // 3. 取得持股資訊（如果有）
    let holdingData = null;
    try {
      const holdingResult = await pool.query(
        'SELECT * FROM holdings WHERE stock_id = $1 AND user_id = $2 AND is_won = true LIMIT 1',
        [stockId, userId]
      );
      if (holdingResult.rows.length > 0) {
        holdingData = holdingResult.rows[0];
      }
    } catch (e) {
      console.log('持股資訊取得失敗:', e.message);
    }

    // 4. 呼叫雙 AI 分析
    const analysis = await aiService.analyzeBuySellTiming(stockData, technicalData, holdingData);

    res.json({
      success: true,
      stockId,
      stockData,
      technicalData,
      holdingData,
      analysis
    });

  } catch (error) {
    console.error('AI 分析錯誤:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/ai/analyze-holdings
 * 分析所有持股的買賣建議
 */
router.get('/analyze-holdings', async (req, res) => {
  try {
    const userId = req.query.userId || 'default';

    // 取得所有已得標持股
    const holdingsResult = await pool.query(
      'SELECT * FROM holdings WHERE user_id = $1 AND is_won = true ORDER BY created_at DESC',
      [userId]
    );

    if (holdingsResult.rows.length === 0) {
      return res.json({ success: true, holdings: [], message: '目前沒有持股' });
    }

    const analyses = [];

    for (const holding of holdingsResult.rows) {
      try {
        // 取得即時股價
        const stockData = await stockService.getRealtimePrice(holding.stock_id);
        if (!stockData) continue;

        // 取得技術指標
        let technicalData = null;
        try {
          technicalData = await technicalService.getFullIndicators(holding.stock_id);
        } catch (e) {}

        // AI 分析
        const analysis = await aiService.analyzeBuySellTiming(stockData, technicalData, holding);

        analyses.push({
          holding,
          stockData,
          analysis
        });

        // 避免 API 過載
        await new Promise(r => setTimeout(r, 500));

      } catch (e) {
        console.log(`分析 ${holding.stock_id} 失敗:`, e.message);
      }
    }

    res.json({
      success: true,
      count: analyses.length,
      analyses
    });

  } catch (error) {
    console.error('持股分析錯誤:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/ai/status
 * 檢查 AI 服務狀態
 */
router.get('/status', async (req, res) => {
  const geminiKey = process.env.GEMINI_API_KEY;
  const openaiKey = process.env.OPENAI_API_KEY;

  res.json({
    gemini: {
      enabled: !!geminiKey,
      status: geminiKey ? '已設定' : '未設定'
    },
    openai: {
      enabled: !!openaiKey,
      status: openaiKey ? '已設定' : '未設定'
    },
    dualAI: !!(geminiKey && openaiKey),
    message: geminiKey && openaiKey 
      ? '雙 AI 模式已啟用' 
      : geminiKey || openaiKey 
        ? '單 AI 模式' 
        : 'AI 功能未設定'
  });
});

module.exports = router;
