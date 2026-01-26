/**
 * 🔔 智能通知 API 路由
 */

const express = require('express');
const router = express.Router();
const smartAlertService = require('../services/smartAlertService');

/**
 * GET /api/smart-alerts
 * 取得使用者的智能通知設定
 */
router.get('/', async (req, res) => {
  try {
    const userId = req.query.userId || 'default';
    const alerts = await smartAlertService.getUserAlerts(userId);

    res.json({
      success: true,
      count: alerts.length,
      alerts
    });

  } catch (error) {
    console.error('取得智能通知錯誤:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/smart-alerts
 * 新增智能通知
 */
router.post('/', async (req, res) => {
  try {
    const { userId = 'default', stockId, alertType, conditionValue } = req.body;

    if (!stockId || !alertType) {
      return res.status(400).json({ 
        success: false, 
        error: '請提供 stockId 和 alertType' 
      });
    }

    const alert = await smartAlertService.addSmartAlert(userId, stockId, alertType, conditionValue);

    res.json({
      success: !!alert,
      alert
    });

  } catch (error) {
    console.error('新增智能通知錯誤:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/smart-alerts/setup-default
 * 為股票設定所有預設智能通知
 */
router.post('/setup-default', async (req, res) => {
  try {
    const { userId = 'default', stockId } = req.body;

    if (!stockId) {
      return res.status(400).json({ 
        success: false, 
        error: '請提供 stockId' 
      });
    }

    await smartAlertService.setupDefaultAlerts(userId, stockId);

    res.json({
      success: true,
      message: `已為 ${stockId} 設定所有智能通知`
    });

  } catch (error) {
    console.error('設定預設通知錯誤:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * DELETE /api/smart-alerts/:id
 * 刪除智能通知
 */
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.query.userId || 'default';

    const result = await smartAlertService.deleteSmartAlert(id, userId);

    res.json({
      success: result,
      message: result ? '已刪除' : '刪除失敗'
    });

  } catch (error) {
    console.error('刪除智能通知錯誤:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/smart-alerts/check
 * 手動觸發智能通知檢查
 */
router.post('/check', async (req, res) => {
  try {
    const alerts = await smartAlertService.checkAllAlerts();

    res.json({
      success: true,
      triggered: alerts.length,
      alerts
    });

  } catch (error) {
    console.error('檢查智能通知錯誤:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/smart-alerts/types
 * 取得所有通知類型說明
 */
router.get('/types', (req, res) => {
  const types = [
    { type: 'rsi_overbought', name: 'RSI 超買', description: 'RSI > 70 時通知' },
    { type: 'rsi_oversold', name: 'RSI 超賣', description: 'RSI < 30 時通知' },
    { type: 'kd_golden_cross', name: 'KD 黃金交叉', description: 'K 線向上穿越 D 線' },
    { type: 'kd_death_cross', name: 'KD 死亡交叉', description: 'K 線向下穿越 D 線' },
    { type: 'macd_bullish', name: 'MACD 翻多', description: 'DIF 由負轉正' },
    { type: 'macd_bearish', name: 'MACD 翻空', description: 'DIF 由正轉負' },
    { type: 'volume_spike', name: '成交量暴增', description: '成交量超過均量 2 倍' },
    { type: 'ma_cross_up', name: '突破月線', description: '股價突破 20 日均線' },
    { type: 'ma_cross_down', name: '跌破月線', description: '股價跌破 20 日均線' }
  ];

  res.json({
    success: true,
    types
  });
});

module.exports = router;
