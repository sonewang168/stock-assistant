const express = require('express');
const router = express.Router();
const { pool } = require('../db');
const stockService = require('../services/stockService');

// 取得監控清單
router.get('/', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT w.*, s.name as stock_name 
      FROM watchlist w 
      LEFT JOIN stocks s ON w.stock_id = s.id 
      WHERE w.is_active = true 
      ORDER BY w.created_at DESC
    `);
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 新增監控
router.post('/', async (req, res) => {
  const { stock_id, target_price_high, target_price_low, alert_percent_up, alert_percent_down } = req.body;
  try {
    const stockData = await stockService.getRealtimePrice(stock_id);
    if (!stockData) {
      return res.status(404).json({ error: '找不到股票' });
    }
    await pool.query(`
      INSERT INTO stocks (id, name, market) VALUES ($1, $2, $3)
      ON CONFLICT (id) DO UPDATE SET name = $2
    `, [stock_id, stockData.name, stockData.market || 'TSE']);
    
    await pool.query(`
      INSERT INTO watchlist (stock_id, stock_name, user_id, target_price_high, target_price_low, alert_percent_up, alert_percent_down, is_active)
      VALUES ($1, $2, 'default', $3, $4, $5, $6, true)
      ON CONFLICT (stock_id, user_id) DO UPDATE SET 
        target_price_high = COALESCE($3, watchlist.target_price_high),
        target_price_low = COALESCE($4, watchlist.target_price_low),
        alert_percent_up = COALESCE($5, watchlist.alert_percent_up),
        alert_percent_down = COALESCE($6, watchlist.alert_percent_down),
        is_active = true
    `, [stock_id, stockData.name, target_price_high, target_price_low, alert_percent_up, alert_percent_down]);
    
    res.json({ success: true, stock: stockData });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 更新監控設定
router.put('/:stock_id', async (req, res) => {
  const { stock_id } = req.params;
  const { target_price_high, target_price_low, alert_percent_up, alert_percent_down } = req.body;
  try {
    await pool.query(`
      UPDATE watchlist SET 
        target_price_high = $2, target_price_low = $3,
        alert_percent_up = $4, alert_percent_down = $5
      WHERE stock_id = $1 AND user_id = 'default'
    `, [stock_id, target_price_high, target_price_low, alert_percent_up, alert_percent_down]);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 刪除監控
router.delete('/:stock_id', async (req, res) => {
  const { stock_id } = req.params;
  try {
    await pool.query(`
      UPDATE watchlist SET is_active = false 
      WHERE stock_id = $1 AND user_id = 'default'
    `, [stock_id]);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
