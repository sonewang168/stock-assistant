/**
 * 💼 持股組合 API 路由
 */

const express = require('express');
const router = express.Router();
const { pool } = require('../db');
const stockService = require('../services/stockService');

/**
 * GET /api/portfolio
 * 取得持股組合
 */
router.get('/', async (req, res) => {
  try {
    const userId = req.query.userId || 'default';
    
    const sql = `
      SELECT p.*, s.name as stock_name
      FROM portfolio p
      JOIN stocks s ON p.stock_id = s.id
      WHERE p.user_id = $1
      ORDER BY p.created_at DESC
    `;
    
    const result = await pool.query(sql, [userId]);
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/portfolio/performance
 * 取得持股損益報告
 */
router.get('/performance', async (req, res) => {
  try {
    const userId = req.query.userId || 'default';
    
    const sql = `
      SELECT p.*, s.name as stock_name
      FROM portfolio p
      JOIN stocks s ON p.stock_id = s.id
      WHERE p.user_id = $1 AND p.shares > 0
    `;
    
    const result = await pool.query(sql, [userId]);
    const holdings = [];
    let totalCost = 0;
    let totalValue = 0;
    
    for (const row of result.rows) {
      const stockData = await stockService.getRealtimePrice(row.stock_id);
      
      if (stockData) {
        const cost = row.shares * parseFloat(row.avg_cost);
        const value = row.shares * stockData.price;
        const profit = value - cost;
        const profitPercent = ((profit / cost) * 100).toFixed(2);
        
        holdings.push({
          stockId: row.stock_id,
          name: row.stock_name,
          shares: row.shares,
          avgCost: parseFloat(row.avg_cost),
          currentPrice: stockData.price,
          cost: cost,
          value: value,
          profit: profit,
          profitPercent: parseFloat(profitPercent),
          dayChange: stockData.changePercent
        });
        
        totalCost += cost;
        totalValue += value;
      }
      
      await new Promise(r => setTimeout(r, 300));
    }
    
    res.json({
      holdings,
      totalCost,
      totalValue,
      totalProfit: totalValue - totalCost,
      totalProfitPercent: totalCost > 0 
        ? ((totalValue - totalCost) / totalCost * 100).toFixed(2) 
        : 0
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/portfolio
 * 新增持股
 */
router.post('/', async (req, res) => {
  try {
    const { stockId, userId = 'default', shares, avgCost, buyDate, notes } = req.body;
    
    if (!stockId || !shares || !avgCost) {
      return res.status(400).json({ error: '缺少必要欄位' });
    }
    
    const sql = `
      INSERT INTO portfolio (stock_id, user_id, shares, avg_cost, buy_date, notes)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *
    `;
    
    const result = await pool.query(sql, [stockId, userId, shares, avgCost, buyDate, notes]);
    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * PUT /api/portfolio/:id
 * 更新持股
 */
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { shares, avgCost, notes } = req.body;
    
    const sql = `
      UPDATE portfolio 
      SET shares = COALESCE($1, shares),
          avg_cost = COALESCE($2, avg_cost),
          notes = COALESCE($3, notes),
          updated_at = CURRENT_TIMESTAMP
      WHERE id = $4
      RETURNING *
    `;
    
    const result = await pool.query(sql, [shares, avgCost, notes, id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: '找不到此持股' });
    }
    
    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * DELETE /api/portfolio/:id
 * 刪除持股
 */
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    const sql = `DELETE FROM portfolio WHERE id = $1 RETURNING *`;
    const result = await pool.query(sql, [id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: '找不到此持股' });
    }
    
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
