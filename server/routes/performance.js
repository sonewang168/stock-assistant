/**
 * 📈 績效報告 API 路由
 */

const express = require('express');
const router = express.Router();
const performanceService = require('../services/performanceService');

/**
 * GET /api/performance
 * 取得持股績效
 */
router.get('/', async (req, res) => {
  try {
    const userId = req.query.userId || 'default';
    const data = await performanceService.calculatePerformance(userId);

    res.json(data);

  } catch (error) {
    console.error('取得績效錯誤:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/performance/change
 * 取得績效變化（與昨日比較）
 */
router.get('/change', async (req, res) => {
  try {
    const userId = req.query.userId || 'default';
    const data = await performanceService.getPerformanceChange(userId);

    res.json({
      success: true,
      ...data
    });

  } catch (error) {
    console.error('取得績效變化錯誤:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/performance/history
 * 取得歷史績效
 */
router.get('/history', async (req, res) => {
  try {
    const userId = req.query.userId || 'default';
    const days = parseInt(req.query.days) || 30;
    const data = await performanceService.getPerformanceHistory(userId, days);

    res.json({
      success: true,
      count: data.length,
      history: data
    });

  } catch (error) {
    console.error('取得績效歷史錯誤:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/performance/snapshot
 * 手動儲存績效快照
 */
router.post('/snapshot', async (req, res) => {
  try {
    const userId = req.body.userId || 'default';
    const result = await performanceService.saveSnapshot(userId);

    res.json({
      success: result,
      message: result ? '績效快照已儲存' : '儲存失敗'
    });

  } catch (error) {
    console.error('儲存快照錯誤:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/performance/send-report
 * 手動發送績效報告
 */
router.post('/send-report', async (req, res) => {
  try {
    const userId = req.body.userId || 'default';
    const result = await performanceService.sendDailyReport(userId);

    res.json({
      success: result,
      message: result ? '績效報告已發送' : '發送失敗'
    });

  } catch (error) {
    console.error('發送報告錯誤:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;
