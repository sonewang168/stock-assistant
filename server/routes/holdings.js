/**
 * 💼 持股管理 API 路由（競標版）
 */

const express = require('express');
const router = express.Router();
const { pool } = require('../db');
const stockService = require('../services/stockService');

/**
 * GET /api/holdings
 * 取得所有持股（含即時價格與損益）
 */
router.get('/', async (req, res) => {
  try {
    const userId = req.query.userId || 'default';
    
    // 建立資料表（如果不存在）- 加入 lots 和 odd_shares 欄位
    await pool.query(`
      CREATE TABLE IF NOT EXISTS holdings (
        id SERIAL PRIMARY KEY,
        user_id VARCHAR(100) DEFAULT 'default',
        stock_id VARCHAR(10) NOT NULL,
        stock_name VARCHAR(50),
        lots INTEGER DEFAULT 0,
        odd_shares INTEGER DEFAULT 0,
        shares INTEGER DEFAULT 0,
        bid_price DECIMAL(10,2),
        won_price DECIMAL(10,2),
        is_won BOOLEAN DEFAULT false,
        target_price_high DECIMAL(10,2),
        target_price_low DECIMAL(10,2),
        notify_enabled BOOLEAN DEFAULT true,
        notes TEXT,
        bid_date DATE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    
    // 嘗試新增欄位（如果不存在）
    try {
      await pool.query(`ALTER TABLE holdings ADD COLUMN IF NOT EXISTS lots INTEGER DEFAULT 0`);
      await pool.query(`ALTER TABLE holdings ADD COLUMN IF NOT EXISTS odd_shares INTEGER DEFAULT 0`);
    } catch (e) {}
    
    const sql = `
      SELECT * FROM holdings
      WHERE user_id = $1
      ORDER BY created_at DESC
    `;
    
    const result = await pool.query(sql, [userId]);
    const holdings = [];
    let totalCost = 0;
    let totalValue = 0;
    let totalLots = 0;
    let totalOddShares = 0;
    let wonCount = 0;
    
    for (const row of result.rows) {
      // 計算張數和零股
      const lots = parseInt(row.lots) || Math.floor((parseInt(row.shares) || 0) / 1000);
      const oddShares = row.odd_shares !== undefined && row.odd_shares !== null 
        ? parseInt(row.odd_shares) 
        : ((parseInt(row.shares) || 0) % 1000);
      const totalShares = lots * 1000 + oddShares;
      
      // 取得即時價格
      let currentPrice = null;
      let profit = 0;
      let profitPercent = 0;
      
      try {
        const stockData = await stockService.getRealtimePrice(row.stock_id);
        if (stockData) {
          currentPrice = stockData.price;
          
          // 計算損益（以標得價為成本）
          const costPrice = parseFloat(row.won_price) || parseFloat(row.bid_price) || 0;
          
          if (costPrice > 0 && totalShares > 0 && row.is_won) {
            const cost = costPrice * totalShares;
            const value = currentPrice * totalShares;
            profit = value - cost;
            profitPercent = ((currentPrice - costPrice) / costPrice * 100).toFixed(2);
            
            totalCost += cost;
            totalValue += value;
            totalLots += lots;
            totalOddShares += oddShares;
            wonCount++;
          }
        }
      } catch (e) {
        console.log(`無法取得 ${row.stock_id} 即時價格`);
      }
      
      holdings.push({
        ...row,
        lots,
        odd_shares: oddShares,
        totalShares,
        currentPrice,
        profit,
        profitPercent: parseFloat(profitPercent)
      });
      
      // 避免太快打 API
      await new Promise(r => setTimeout(r, 200));
    }
    
    // 統計資料
    const stats = {
      count: wonCount,
      totalLots,
      totalOddShares,
      totalShares: totalLots * 1000 + totalOddShares,
      totalCost,
      totalValue,
      totalProfit: totalValue - totalCost,
      totalProfitPercent: totalCost > 0 
        ? ((totalValue - totalCost) / totalCost * 100).toFixed(2) 
        : 0
    };
    
    res.json({ holdings, stats });
  } catch (error) {
    console.error('取得持股錯誤:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/holdings
 * 新增持股
 */
router.post('/', async (req, res) => {
  try {
    const {
      stock_id,
      lots = 0,
      odd_shares = 0,
      shares = 0,
      bid_price,
      won_price,
      is_won = false,
      target_price_high,
      target_price_low,
      notify_enabled = true,
      notes,
      user_id = 'default'
    } = req.body;
    
    if (!stock_id) {
      return res.status(400).json({ error: '請輸入股票代碼' });
    }
    
    // 計算總股數
    const totalShares = (parseInt(lots) || 0) * 1000 + (parseInt(odd_shares) || 0) || parseInt(shares) || 0;
    const finalLots = parseInt(lots) || Math.floor(totalShares / 1000);
    const finalOddShares = odd_shares !== undefined ? parseInt(odd_shares) : (totalShares % 1000);
    
    // 嘗試取得股票名稱
    let stockName = stock_id;
    try {
      const stockData = await stockService.getRealtimePrice(stock_id);
      if (stockData && stockData.name) {
        stockName = stockData.name;
      }
    } catch (e) {
      console.log(`無法取得 ${stock_id} 名稱`);
    }
    
    const sql = `
      INSERT INTO holdings (
        user_id, stock_id, stock_name, lots, odd_shares, shares, bid_price, won_price, 
        is_won, target_price_high, target_price_low, notify_enabled, notes
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
      RETURNING *
    `;
    
    const result = await pool.query(sql, [
      user_id, stock_id, stockName, finalLots, finalOddShares, totalShares, bid_price, won_price,
      is_won, target_price_high, target_price_low, notify_enabled, notes
    ]);
    
    res.json({ 
      success: true, 
      holding: result.rows[0] 
    });
  } catch (error) {
    console.error('新增持股錯誤:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * PUT /api/holdings/:id
 * 更新持股
 */
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const {
      lots,
      odd_shares,
      shares,
      bid_price,
      won_price,
      is_won,
      target_price_high,
      target_price_low,
      notify_enabled,
      notes
    } = req.body;
    
    // 計算總股數
    let totalShares = shares;
    if (lots !== undefined || odd_shares !== undefined) {
      const l = parseInt(lots) || 0;
      const o = parseInt(odd_shares) || 0;
      totalShares = l * 1000 + o;
    }
    
    const sql = `
      UPDATE holdings SET
        lots = COALESCE($1, lots),
        odd_shares = COALESCE($2, odd_shares),
        shares = COALESCE($3, shares),
        bid_price = COALESCE($4, bid_price),
        won_price = COALESCE($5, won_price),
        is_won = COALESCE($6, is_won),
        target_price_high = COALESCE($7, target_price_high),
        target_price_low = COALESCE($8, target_price_low),
        notify_enabled = COALESCE($9, notify_enabled),
        notes = COALESCE($10, notes),
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $11
      RETURNING *
    `;
    
    const result = await pool.query(sql, [
      lots, odd_shares, totalShares, bid_price, won_price, is_won,
      target_price_high, target_price_low, notify_enabled, notes, id
    ]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: '找不到此持股' });
    }
    
    res.json({ success: true, holding: result.rows[0] });
  } catch (error) {
    console.error('更新持股錯誤:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * DELETE /api/holdings/:id
 * 刪除持股
 */
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    const sql = `DELETE FROM holdings WHERE id = $1 RETURNING *`;
    const result = await pool.query(sql, [id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: '找不到此持股' });
    }
    
    res.json({ success: true });
  } catch (error) {
    console.error('刪除持股錯誤:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/holdings/alerts
 * 取得需要通知的持股（供排程使用）
 */
router.get('/alerts', async (req, res) => {
  try {
    const sql = `
      SELECT * FROM holdings
      WHERE notify_enabled = true AND is_won = true
      AND (target_price_high IS NOT NULL OR target_price_low IS NOT NULL)
    `;
    
    const result = await pool.query(sql);
    const alerts = [];
    
    for (const row of result.rows) {
      try {
        const stockData = await stockService.getRealtimePrice(row.stock_id);
        if (stockData) {
          const currentPrice = stockData.price;
          
          // 檢查是否觸發目標價
          if (row.target_price_high && currentPrice >= parseFloat(row.target_price_high)) {
            alerts.push({
              ...row,
              currentPrice,
              alertType: 'HIGH',
              message: `📈 ${row.stock_name || row.stock_id} 已達上漲目標價 $${row.target_price_high}！目前 $${currentPrice}`
            });
          }
          
          if (row.target_price_low && currentPrice <= parseFloat(row.target_price_low)) {
            alerts.push({
              ...row,
              currentPrice,
              alertType: 'LOW',
              message: `📉 ${row.stock_name || row.stock_id} 已跌破下跌目標價 $${row.target_price_low}！目前 $${currentPrice}`
            });
          }
        }
      } catch (e) {
        console.log(`無法檢查 ${row.stock_id} 警報`);
      }
      
      await new Promise(r => setTimeout(r, 200));
    }
    
    res.json({ alerts });
  } catch (error) {
    console.error('檢查持股警報錯誤:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
