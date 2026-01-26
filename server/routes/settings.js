/**
 * ⚙️ 設定 API 路由
 */

const express = require('express');
const router = express.Router();
const { pool } = require('../db');

/**
 * GET /api/settings
 * 取得所有設定
 */
router.get('/', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM settings');
    
    // 轉換成物件
    const settings = {};
    result.rows.forEach(row => {
      settings[row.key] = row.value;
    });
    
    res.json(settings);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/settings/:key
 * 取得單一設定
 */
router.get('/:key', async (req, res) => {
  try {
    const { key } = req.params;
    const result = await pool.query(
      'SELECT value FROM settings WHERE key = $1',
      [key]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: '找不到此設定' });
    }
    
    res.json({ key, value: result.rows[0].value });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * PUT /api/settings/:key
 * 更新設定
 */
router.put('/:key', async (req, res) => {
  try {
    const { key } = req.params;
    const { value } = req.body;
    
    const sql = `
      INSERT INTO settings (key, value, updated_at) 
      VALUES ($1, $2, CURRENT_TIMESTAMP)
      ON CONFLICT (key) 
      DO UPDATE SET value = $2, updated_at = CURRENT_TIMESTAMP
      RETURNING *
    `;
    
    const result = await pool.query(sql, [key, value]);
    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * PUT /api/settings
 * 批次更新設定
 */
router.put('/', async (req, res) => {
  try {
    const settings = req.body;
    
    for (const [key, value] of Object.entries(settings)) {
      await pool.query(
        `INSERT INTO settings (key, value, updated_at) 
         VALUES ($1, $2, CURRENT_TIMESTAMP)
         ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = CURRENT_TIMESTAMP`,
        [key, value]
      );
    }
    
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * DELETE /api/settings/:key
 * 刪除設定
 */
router.delete('/:key', async (req, res) => {
  try {
    const { key } = req.params;
    await pool.query('DELETE FROM settings WHERE key = $1', [key]);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/settings/test-market-reminder
 * 測試開盤提醒
 */
router.post('/test-market-reminder', async (req, res) => {
  try {
    const lineService = require('../services/lineService');
    
    // 取得 LINE User ID
    const result = await pool.query(
      "SELECT value FROM settings WHERE key = 'line_user_id'"
    );
    const userId = result.rows[0]?.value || process.env.LINE_USER_ID;

    if (!userId) {
      return res.json({ success: false, error: '未設定 LINE User ID' });
    }

    // 取得設定
    const settingsResult = await pool.query('SELECT * FROM settings');
    const settings = {};
    settingsResult.rows.forEach(row => {
      settings[row.key] = row.value;
    });

    const twReminder = settings.tw_market_reminder || '5';

    // 取得持股
    const holdings = await pool.query(`
      SELECT h.*, s.name as stock_name
      FROM holdings h
      LEFT JOIN stocks s ON h.stock_id = s.id
      WHERE h.user_id = 'default' AND h.is_won = true
    `);

    // 取得監控清單
    const watchlist = await pool.query(`
      SELECT w.stock_id, s.name as stock_name
      FROM watchlist w
      LEFT JOIN stocks s ON w.stock_id = s.id
      WHERE w.user_id = 'default' AND w.is_active = true
      LIMIT 10
    `);

    const today = new Date().toLocaleDateString('zh-TW', { 
      month: 'numeric', 
      day: 'numeric',
      weekday: 'short'
    });

    // 建立測試 Flex Message
    const flexMessage = {
      type: 'flex',
      altText: `🔔 測試：台股開盤提醒`,
      contents: {
        type: 'bubble',
        size: 'mega',
        header: {
          type: 'box',
          layout: 'vertical',
          contents: [
            { type: 'text', text: '🔔 台股即將開盤（測試）', size: 'xl', weight: 'bold', color: '#ffffff' },
            { type: 'text', text: `設定：提前 ${twReminder} 分鐘提醒`, size: 'sm', color: '#ffffffaa', margin: 'sm' }
          ],
          backgroundColor: '#FF9800',
          paddingAll: '20px'
        },
        body: {
          type: 'box',
          layout: 'vertical',
          contents: [
            {
              type: 'text',
              text: `📦 持股：${holdings.rows.length} 檔`,
              size: 'md',
              weight: 'bold'
            },
            holdings.rows.length > 0 ? {
              type: 'text',
              text: holdings.rows.slice(0, 5).map(h => h.stock_name || h.stock_id).join('、'),
              size: 'sm',
              color: '#666666',
              wrap: true,
              margin: 'sm'
            } : { type: 'text', text: '無持股', size: 'sm', color: '#999999', margin: 'sm' },
            { type: 'separator', margin: 'lg' },
            {
              type: 'text',
              text: `👀 監控：${watchlist.rows.length} 檔`,
              size: 'md',
              weight: 'bold',
              margin: 'lg'
            },
            watchlist.rows.length > 0 ? {
              type: 'text',
              text: watchlist.rows.slice(0, 8).map(w => w.stock_id).join('、'),
              size: 'sm',
              color: '#666666',
              wrap: true,
              margin: 'sm'
            } : { type: 'text', text: '無監控', size: 'sm', color: '#999999', margin: 'sm' }
          ],
          paddingAll: '20px'
        },
        footer: {
          type: 'box',
          layout: 'horizontal',
          contents: [
            {
              type: 'button',
              action: { type: 'message', label: '📊 大盤', text: '大盤' },
              style: 'secondary',
              height: 'sm',
              flex: 1
            },
            {
              type: 'button',
              action: { type: 'message', label: '💼 持股', text: '持股' },
              style: 'secondary',
              height: 'sm',
              flex: 1,
              margin: 'sm'
            },
            {
              type: 'button',
              action: { type: 'message', label: '📈 績效', text: '績效' },
              style: 'primary',
              height: 'sm',
              flex: 1,
              margin: 'sm'
            }
          ],
          paddingAll: '15px'
        }
      }
    };

    await lineService.sendFlexMessage(userId, flexMessage);
    res.json({ success: true });

  } catch (error) {
    console.error('測試開盤提醒錯誤:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;
