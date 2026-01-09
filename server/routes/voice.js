/**
 * 🔊 語音 API 路由
 */

const express = require('express');
const router = express.Router();
const voiceService = require('../services/voiceService');
const stockService = require('../services/stockService');
const { pool } = require('../db');

/**
 * GET /api/voice/settings
 * 取得語音設定
 */
router.get('/settings', async (req, res) => {
  try {
    const settings = await voiceService.getVoiceSettings();
    res.json(settings);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * PUT /api/voice/settings
 * 更新語音設定
 */
router.put('/settings', async (req, res) => {
  try {
    const { enabled, provider, voiceId } = req.body;
    
    const updates = [];
    
    if (enabled !== undefined) {
      updates.push(pool.query(
        `INSERT INTO settings (key, value) VALUES ('voice_enabled', $1)
         ON CONFLICT (key) DO UPDATE SET value = $1`,
        [enabled.toString()]
      ));
    }
    
    if (provider) {
      updates.push(pool.query(
        `INSERT INTO settings (key, value) VALUES ('voice_provider', $1)
         ON CONFLICT (key) DO UPDATE SET value = $1`,
        [provider]
      ));
    }
    
    if (voiceId) {
      updates.push(pool.query(
        `INSERT INTO settings (key, value) VALUES ('elevenlabs_voice_id', $1)
         ON CONFLICT (key) DO UPDATE SET value = $1`,
        [voiceId]
      ));
    }
    
    await Promise.all(updates);
    
    const newSettings = await voiceService.getVoiceSettings();
    res.json(newSettings);
    
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/voice/speak
 * 文字轉語音
 */
router.post('/speak', async (req, res) => {
  try {
    const { text } = req.body;
    
    if (!text) {
      return res.status(400).json({ error: '缺少 text 參數' });
    }
    
    const result = await voiceService.textToSpeech(text);
    
    if (!result) {
      return res.status(503).json({ error: '語音服務不可用' });
    }
    
    res.json(result);
    
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/voice/stock/:id
 * 播報股票資訊
 */
router.get('/stock/:id', async (req, res) => {
  try {
    const stockId = req.params.id;
    const stockData = await stockService.getRealtimePrice(stockId);
    
    if (!stockData) {
      return res.status(404).json({ error: '找不到此股票' });
    }
    
    const isUp = stockData.change >= 0;
    const text = `${stockData.name}，現價 ${stockData.price} 元，` +
      `${isUp ? '上漲' : '下跌'} ${Math.abs(stockData.change)} 元，` +
      `漲跌幅 ${isUp ? '正' : '負'} ${Math.abs(stockData.changePercent)} 趴`;
    
    const result = await voiceService.textToSpeech(text);
    
    if (!result) {
      return res.status(503).json({ error: '語音服務不可用' });
    }
    
    res.json({
      stock: stockData,
      voice: result
    });
    
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/voice/voices
 * 取得可用聲音列表
 */
router.get('/voices', async (req, res) => {
  try {
    // 先嘗試取得 ElevenLabs 聲音
    let voices = await voiceService.getElevenLabsVoices();
    
    // 如果沒有，使用預設列表
    if (voices.length === 0) {
      voices = voiceService.getDefaultVoices();
    }
    
    res.json(voices);
    
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/voice/test
 * 測試語音（用於設定頁面）
 */
router.post('/test', async (req, res) => {
  try {
    const { provider, voiceId } = req.body;
    const testText = '您好，我是股海秘書，很高興為您服務。台積電今日上漲 2.5 趴。';
    
    let result;
    
    if (provider === 'elevenlabs') {
      result = await voiceService.elevenLabsTTS(testText, voiceId || 'pNInz6obpgDQGcFmaJgB');
    } else {
      result = await voiceService.geminiTTS(testText);
    }
    
    if (!result) {
      return res.status(503).json({ error: '語音服務測試失敗' });
    }
    
    res.json(result);
    
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/voice/alert/:alertId
 * 播報警報內容
 */
router.get('/alert/:alertId', async (req, res) => {
  try {
    const alertId = req.params.alertId;
    
    // 取得警報紀錄
    const result = await pool.query(
      'SELECT * FROM alert_logs WHERE id = $1',
      [alertId]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: '找不到此警報' });
    }
    
    const alert = result.rows[0];
    const isUp = parseFloat(alert.change_percent) >= 0;
    
    let text = `${alert.stock_name}，${alert.alert_type}，`;
    text += `現價 ${alert.price} 元，`;
    text += `${isUp ? '上漲' : '下跌'} ${Math.abs(alert.change_percent)} 趴。`;
    
    if (alert.ai_comment) {
      text += `AI 評論：${alert.ai_comment}`;
    }
    
    const voiceResult = await voiceService.textToSpeech(text);
    
    if (!voiceResult) {
      return res.status(503).json({ error: '語音服務不可用' });
    }
    
    res.json({
      alert,
      voice: voiceResult
    });
    
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
