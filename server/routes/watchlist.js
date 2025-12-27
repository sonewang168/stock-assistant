/**
 * 📋 監控清單 API 路由
 */

const express = require('express');
const router = express.Router();
const { pool } = require('../db');

/**
 * GET /api/watchlist
 * 取得監控清單
 */
router.get('/', async (req, res) => {
  try {
    const userId = req.query.userId || 'default';
    
    const sql = `
      SELECT w.*, s.name as stock_name, s.market
      FROM watchlist w
      JOIN stocks s ON w.stock_id = s.id
      WHERE w.user_id = $1 AND w.is_active = true
      ORDER BY w.created_at DESC
    `;
    
    const result = await pool.query(sql, [userId]);
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/watchlist
 * 新增監控股票
 */
router.post('/', async (req, res) => {
  try {
    const { stockId, userId = 'default', customThreshold, notes } = req.body;
    
    if (!stockId) {
      return res.status(400).json({ error: '缺少 stockId' });
    }
    
    const sql = `
      INSERT INTO watchlist (stock_id, user_id, custom_threshold, notes)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (stock_id, user_id) 
      DO UPDATE SET 
        custom_threshold = $3, 
        notes = $4, 
        is_active = true
      RETURNING *
    `;
    
    const result = await pool.query(sql, [stockId, userId, customThreshold, notes]);
    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * PUT /api/watchlist/:id
 * 更新監控設定
 */
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { customThreshold, notes, isActive } = req.body;
    
    const sql = `
      UPDATE watchlist 
      SET custom_threshold = COALESCE($1, custom_threshold),
          notes = COALESCE($2, notes),
          is_active = COALESCE($3, is_active)
      WHERE id = $4
      RETURNING *
    `;
    
    const result = await pool.query(sql, [customThreshold, notes, isActive, id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: '找不到此監控項目' });
    }
    
    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * DELETE /api/watchlist/:id
 * 移除監控
 */
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    // 軟刪除
    const sql = `
      UPDATE watchlist SET is_active = false WHERE id = $1 RETURNING *
    `;
    
    const result = await pool.query(sql, [id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: '找不到此監控項目' });
    }
    
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/watchlist/toggle/:stockId
 * 切換監控狀態
 */
router.post('/toggle/:stockId', async (req, res) => {
  try {
    const { stockId } = req.params;
    const userId = req.body.userId || 'default';
    
    // 檢查是否已存在
    const checkSql = `
      SELECT * FROM watchlist WHERE stock_id = $1 AND user_id = $2
    `;
    const checkResult = await pool.query(checkSql, [stockId, userId]);
    
    if (checkResult.rows.length > 0) {
      // 已存在，切換狀態
      const toggleSql = `
        UPDATE watchlist 
        SET is_active = NOT is_active 
        WHERE stock_id = $1 AND user_id = $2
        RETURNING *
      `;
      const result = await pool.query(toggleSql, [stockId, userId]);
      res.json(result.rows[0]);
    } else {
      // 不存在，新增
      const insertSql = `
        INSERT INTO watchlist (stock_id, user_id) VALUES ($1, $2) RETURNING *
      `;
      const result = await pool.query(insertSql, [stockId, userId]);
      res.json(result.rows[0]);
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
