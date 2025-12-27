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

module.exports = router;
