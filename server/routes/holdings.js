/**
 * 💼 持股管理 API 路由（競標版）
 */

const express = require('express');
const router = express.Router();
const { pool } = require('../db');
const stockService = require('../services/stockService');
const twStocks = require('../data/twStocks');

// 手續費常數
const FEE_RATE = 0.001425;
const TAX_RATE = 0.003;

// 確保資料表存在
async function ensureTable() {
  try {
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
        is_sold BOOLEAN DEFAULT false,
        sold_price DECIMAL(10,2),
        sold_date DATE,
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
    const columns = [
      'ALTER TABLE holdings ADD COLUMN IF NOT EXISTS lots INTEGER DEFAULT 0',
      'ALTER TABLE holdings ADD COLUMN IF NOT EXISTS odd_shares INTEGER DEFAULT 0',
      'ALTER TABLE holdings ADD COLUMN IF NOT EXISTS is_sold BOOLEAN DEFAULT false',
      'ALTER TABLE holdings ADD COLUMN IF NOT EXISTS sold_price DECIMAL(10,2)',
      'ALTER TABLE holdings ADD COLUMN IF NOT EXISTS sold_date DATE',
      'ALTER TABLE holdings ADD COLUMN IF NOT EXISTS alert_percent_up DECIMAL(5,2)',
      'ALTER TABLE holdings ADD COLUMN IF NOT EXISTS alert_percent_down DECIMAL(5,2)'
    ];
    
    for (const sql of columns) {
      try { await pool.query(sql); } catch (e) {}
    }
  } catch (e) {
    console.error('建立 holdings 資料表錯誤:', e.message);
  }
}

/**
 * GET /api/holdings/alerts
 * 取得需要通知的持股（供排程使用）
 * 注意：這個路由必須在 /:id 前面，否則會被攔截
 */
router.get('/alerts', async (req, res) => {
  try {
    await ensureTable();
    
    const sql = `
      SELECT * FROM holdings
      WHERE notify_enabled = true AND is_won = true AND (is_sold = false OR is_sold IS NULL)
      AND (target_price_high IS NOT NULL OR target_price_low IS NOT NULL)
    `;
    
    const result = await pool.query(sql);
    const alerts = [];
    
    for (const row of result.rows) {
      try {
        const stockData = await stockService.getRealtimePrice(row.stock_id);
        if (stockData) {
          const currentPrice = stockData.price;
          
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

/**
 * GET /api/holdings
 * 取得所有持股（含即時價格與損益）
 */
router.get('/', async (req, res) => {
  try {
    await ensureTable();
    
    const userId = req.query.userId || 'default';
    const showSold = req.query.sold === 'true';
    
    console.log(`📡 Holdings API: userId=${userId}, showSold=${showSold}`);
    
    // 根據參數決定查詢持股中或已賣出
    const sql = showSold 
      ? `SELECT * FROM holdings WHERE user_id = $1 AND is_sold = true ORDER BY sold_date DESC, updated_at DESC`
      : `SELECT * FROM holdings WHERE user_id = $1 AND (is_sold = false OR is_sold IS NULL) ORDER BY created_at DESC`;
    
    const result = await pool.query(sql, [userId]);
    console.log(`📦 查詢結果: ${result.rows.length} 筆`);
    
    const holdings = [];
    let totalCost = 0;
    let totalValue = 0;
    let totalLots = 0;
    let totalOddShares = 0;
    let wonCount = 0;
    let totalNetProfit = 0;
    
    for (const row of result.rows) {
      const lots = parseInt(row.lots) || Math.floor((parseInt(row.shares) || 0) / 1000);
      const oddShares = row.odd_shares !== undefined && row.odd_shares !== null 
        ? parseInt(row.odd_shares) 
        : ((parseInt(row.shares) || 0) % 1000);
      const totalShares = lots * 1000 + oddShares;
      
      let currentPrice = null;
      let profit = 0;
      let profitPercent = 0;
      let netProfit = 0;
      let buyFee = 0;
      let sellFee = 0;
      let tax = 0;
      
      const costPrice = parseFloat(row.won_price) || parseFloat(row.bid_price) || 0;
      
      if (showSold) {
        // 已賣出：計算實際損益
        const soldPrice = parseFloat(row.sold_price) || 0;
        if (costPrice > 0 && soldPrice > 0 && totalShares > 0) {
          const cost = costPrice * totalShares;
          const value = soldPrice * totalShares;
          profit = value - cost;
          buyFee = Math.round(cost * FEE_RATE);
          sellFee = Math.round(value * FEE_RATE);
          tax = Math.round(value * TAX_RATE);
          netProfit = profit - buyFee - sellFee - tax;
          profitPercent = ((netProfit / cost) * 100).toFixed(2);
          
          totalCost += cost;
          totalNetProfit += netProfit;
          wonCount++;
        }
        currentPrice = soldPrice;
        
        // 🆕 已賣出也自動補上缺少的股票名稱
        if (!row.stock_name || row.stock_name === row.stock_id) {
          try {
            const stockData = await stockService.getRealtimePrice(row.stock_id);
            if (stockData && stockData.name && stockData.name !== row.stock_id) {
              row.stock_name = stockData.name;
              pool.query('UPDATE holdings SET stock_name = $1 WHERE id = $2', [stockData.name, row.id])
                .catch(e => console.log('更新股票名稱失敗:', e.message));
            }
          } catch (e) {}
        }
      } else {
        // 持股中：取得即時價格
        try {
          const stockData = await stockService.getRealtimePrice(row.stock_id);
          if (stockData) {
            currentPrice = stockData.price;
            
            // 🆕 自動補上缺少的股票名稱
            if ((!row.stock_name || row.stock_name === row.stock_id) && stockData.name && stockData.name !== row.stock_id) {
              row.stock_name = stockData.name;
              // 異步更新資料庫（不等待）
              pool.query('UPDATE holdings SET stock_name = $1 WHERE id = $2', [stockData.name, row.id])
                .catch(e => console.log('更新股票名稱失敗:', e.message));
            }
            
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
      }
      
      // 🔧 使用 twStocks 對照表補全缺少的名稱
      if (!row.stock_name || row.stock_name === row.stock_id) {
        const twInfo = twStocks.getStockInfo(row.stock_id);
        if (twInfo && twInfo.name) {
          row.stock_name = twInfo.name;
        }
      }
      
      holdings.push({
        ...row,
        lots,
        odd_shares: oddShares,
        totalShares,
        currentPrice,
        profit,
        profitPercent: parseFloat(profitPercent),
        netProfit,
        buyFee,
        sellFee,
        tax
      });
      
      await new Promise(r => setTimeout(r, 200));
    }
    
    // 統計資料
    const stats = showSold ? {
      count: wonCount,
      totalCost,
      totalNetProfit,
      totalProfitPercent: totalCost > 0 ? ((totalNetProfit / totalCost) * 100).toFixed(2) : 0
    } : {
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
    await ensureTable();
    
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
    
    const totalShares = (parseInt(lots) || 0) * 1000 + (parseInt(odd_shares) || 0) || parseInt(shares) || 0;
    const finalLots = parseInt(lots) || Math.floor(totalShares / 1000);
    const finalOddShares = odd_shares !== undefined ? parseInt(odd_shares) : (totalShares % 1000);
    
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
      is_sold,
      sold_price,
      target_price_high,
      target_price_low,
      alert_percent_up,
      alert_percent_down,
      notify_enabled,
      notes
    } = req.body;
    
    let totalShares = shares;
    if (lots !== undefined || odd_shares !== undefined) {
      const l = parseInt(lots) || 0;
      const o = parseInt(odd_shares) || 0;
      totalShares = l * 1000 + o;
    }
    
    let soldDate = null;
    if (is_sold === true && sold_price) {
      soldDate = new Date().toISOString().split('T')[0];
    }
    
    const sql = `
      UPDATE holdings SET
        lots = COALESCE($1, lots),
        odd_shares = COALESCE($2, odd_shares),
        shares = COALESCE($3, shares),
        bid_price = COALESCE($4, bid_price),
        won_price = COALESCE($5, won_price),
        is_won = COALESCE($6, is_won),
        is_sold = COALESCE($7, is_sold),
        sold_price = COALESCE($8, sold_price),
        sold_date = COALESCE($9, sold_date),
        target_price_high = COALESCE($10, target_price_high),
        target_price_low = COALESCE($11, target_price_low),
        alert_percent_up = COALESCE($12, alert_percent_up),
        alert_percent_down = COALESCE($13, alert_percent_down),
        notify_enabled = COALESCE($14, notify_enabled),
        notes = COALESCE($15, notes),
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $16
      RETURNING *
    `;
    
    const result = await pool.query(sql, [
      lots, odd_shares, totalShares, bid_price, won_price, is_won,
      is_sold, sold_price, soldDate,
      target_price_high, target_price_low, alert_percent_up, alert_percent_down, notify_enabled, notes, id
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

module.exports = router;
