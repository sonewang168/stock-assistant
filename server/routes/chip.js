/**
 * 🏦 籌碼分析 API 路由
 * 三大法人買賣超
 */

const express = require('express');
const router = express.Router();
const chipService = require('../services/chipService');

/**
 * GET /api/chip/:stockId
 * 取得個股三大法人買賣超
 */
router.get('/:stockId', async (req, res) => {
  try {
    const { stockId } = req.params;
    const days = parseInt(req.query.days) || 5;

    const data = await chipService.getInstitutionalTrading(stockId, days);

    if (!data) {
      return res.status(404).json({ 
        success: false, 
        error: '找不到此股票的三大法人資料' 
      });
    }

    res.json({
      success: true,
      stockId,
      data
    });

  } catch (error) {
    console.error('取得籌碼資料錯誤:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/chip/ranking/:type
 * 取得三大法人買賣超排行
 * type: foreign / trust / dealer
 */
router.get('/ranking/:type', async (req, res) => {
  try {
    const { type } = req.params;
    const direction = req.query.direction || 'buy';
    const limit = parseInt(req.query.limit) || 10;

    const data = await chipService.getTopInstitutionalRanking(type, direction, limit);

    if (!data) {
      return res.status(404).json({ 
        success: false, 
        error: '無法取得排行資料' 
      });
    }

    res.json({
      success: true,
      ...data
    });

  } catch (error) {
    console.error('取得排行錯誤:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/chip/update
 * 手動更新所有監控股票的三大法人資料
 */
router.post('/update', async (req, res) => {
  try {
    const results = await chipService.updateWatchlistInstitutional();
    
    res.json({
      success: true,
      updated: results.length,
      message: `已更新 ${results.length} 檔股票的三大法人資料`
    });

  } catch (error) {
    console.error('更新籌碼資料錯誤:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
