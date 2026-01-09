/**
 * 🎯 到價提醒 API 路由
 */

const express = require('express');
const router = express.Router();
const { pool } = require('../db');

/**
 * GET /api/alert
 * 取得到價提醒清單
 */
router.get('/', async (req, res) => {
  try {
    const userId = req.query.userId || 'default';
    
    const sql = `
      SELECT a.*, s.name as stock_name
      FROM price_alerts a
      JOIN stocks s ON a.stock_id = s.id
      WHERE a.user_id = $1 AND a.is_active = true
      ORDER BY a.created_at DESC
    `;
    
    const result = await pool.query(sql, [userId]);
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/alert/logs
 * 取得推播紀錄
 */
router.get('/logs', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 50;
    
    const sql = `
      SELECT * FROM alert_logs 
      ORDER BY created_at DESC 
      LIMIT $1
    `;
    
    const result = await pool.query(sql, [limit]);
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/alert
 * 新增到價提醒
 */
router.post('/', async (req, res) => {
  try {
    const { stockId, userId = 'default', targetPrice, condition } = req.body;
    
    if (!stockId || !targetPrice || !condition) {
      return res.status(400).json({ error: '缺少必要欄位' });
    }
    
    if (!['above', 'below'].includes(condition)) {
      return res.status(400).json({ error: 'condition 必須是 above 或 below' });
    }
    
    const sql = `
      INSERT INTO price_alerts (stock_id, user_id, target_price, condition)
      VALUES ($1, $2, $3, $4)
      RETURNING *
    `;
    
    const result = await pool.query(sql, [stockId, userId, targetPrice, condition]);
    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * PUT /api/alert/:id
 * 更新到價提醒
 */
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { targetPrice, condition, isActive } = req.body;
    
    const sql = `
      UPDATE price_alerts 
      SET target_price = COALESCE($1, target_price),
          condition = COALESCE($2, condition),
          is_active = COALESCE($3, is_active)
      WHERE id = $4
      RETURNING *
    `;
    
    const result = await pool.query(sql, [targetPrice, condition, isActive, id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: '找不到此提醒' });
    }
    
    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * DELETE /api/alert/:id
 * 刪除到價提醒
 */
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    const sql = `DELETE FROM price_alerts WHERE id = $1 RETURNING *`;
    const result = await pool.query(sql, [id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: '找不到此提醒' });
    }
    
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/alert/:id/reset
 * 重設提醒（已觸發後可重設）
 */
router.post('/:id/reset', async (req, res) => {
  try {
    const { id } = req.params;
    
    const sql = `
      UPDATE price_alerts 
      SET is_triggered = false, triggered_at = NULL, is_active = true
      WHERE id = $1
      RETURNING *
    `;
    
    const result = await pool.query(sql, [id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: '找不到此提醒' });
    }
    
    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
