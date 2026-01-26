/**
 * 📈 績效報告服務
 * 每日持股損益統計、績效追蹤
 */

const { pool } = require('../db');
const stockService = require('./stockService');
const lineService = require('./lineService');

class PerformanceService {

  /**
   * 計算持股績效
   */
  async calculatePerformance(userId = 'default') {
    try {
      // 取得所有已得標持股
      const holdings = await pool.query(`
        SELECT * FROM holdings 
        WHERE user_id = $1 AND is_won = true
        ORDER BY created_at DESC
      `, [userId]);

      if (holdings.rows.length === 0) {
        return { success: false, message: '目前沒有持股' };
      }

      let totalCost = 0;
      let totalValue = 0;
      const details = [];

      for (const h of holdings.rows) {
        const stockData = await stockService.getRealtimePrice(h.stock_id);
        if (!stockData) continue;

        const costPrice = parseFloat(h.won_price) || parseFloat(h.bid_price) || 0;
        const totalShares = (h.lots || 0) * 1000 + (h.odd_shares || 0);
        const cost = costPrice * totalShares;
        const value = stockData.price * totalShares;
        const profit = value - cost;
        const profitPercent = cost > 0 ? ((profit / cost) * 100) : 0;

        totalCost += cost;
        totalValue += value;

        details.push({
          stockId: h.stock_id,
          stockName: stockData.name || h.stock_name,
          lots: h.lots,
          oddShares: h.odd_shares,
          totalShares,
          costPrice,
          currentPrice: stockData.price,
          change: stockData.change,
          changePercent: stockData.changePercent,
          cost,
          value,
          profit,
          profitPercent: profitPercent.toFixed(2),
          isProfit: profit >= 0
        });

        await new Promise(r => setTimeout(r, 100));
      }

      const totalProfit = totalValue - totalCost;
      const totalProfitPercent = totalCost > 0 ? ((totalProfit / totalCost) * 100) : 0;

      return {
        success: true,
        userId,
        date: new Date().toISOString().slice(0, 10),
        summary: {
          holdingsCount: details.length,
          totalCost: Math.round(totalCost),
          totalValue: Math.round(totalValue),
          totalProfit: Math.round(totalProfit),
          totalProfitPercent: totalProfitPercent.toFixed(2),
          isProfit: totalProfit >= 0
        },
        details: details.sort((a, b) => b.profitPercent - a.profitPercent), // 依報酬率排序
        topGainer: details.length > 0 ? details.reduce((a, b) => parseFloat(a.profitPercent) > parseFloat(b.profitPercent) ? a : b) : null,
        topLoser: details.length > 0 ? details.reduce((a, b) => parseFloat(a.profitPercent) < parseFloat(b.profitPercent) ? a : b) : null
      };
    } catch (error) {
      console.error('計算績效失敗:', error.message);
      return { success: false, error: error.message };
    }
  }

  /**
   * 儲存績效快照
   */
  async saveSnapshot(userId = 'default') {
    try {
      const perf = await this.calculatePerformance(userId);
      if (!perf.success) return false;

      await pool.query(`
        INSERT INTO performance_snapshots 
        (user_id, snapshot_date, total_cost, total_value, total_profit, profit_percent, holdings_count, snapshot_data)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        ON CONFLICT (user_id, snapshot_date)
        DO UPDATE SET 
          total_cost = EXCLUDED.total_cost,
          total_value = EXCLUDED.total_value,
          total_profit = EXCLUDED.total_profit,
          profit_percent = EXCLUDED.profit_percent,
          holdings_count = EXCLUDED.holdings_count,
          snapshot_data = EXCLUDED.snapshot_data
      `, [
        userId,
        perf.date,
        perf.summary.totalCost,
        perf.summary.totalValue,
        perf.summary.totalProfit,
        perf.summary.totalProfitPercent,
        perf.summary.holdingsCount,
        JSON.stringify(perf.details)
      ]);

      console.log(`📊 已儲存 ${userId} 的績效快照`);
      return true;
    } catch (error) {
      console.error('儲存績效快照失敗:', error.message);
      return false;
    }
  }

  /**
   * 取得歷史績效
   */
  async getPerformanceHistory(userId = 'default', days = 30) {
    try {
      const result = await pool.query(`
        SELECT * FROM performance_snapshots
        WHERE user_id = $1
        ORDER BY snapshot_date DESC
        LIMIT $2
      `, [userId, days]);

      return result.rows;
    } catch (error) {
      console.error('取得績效歷史失敗:', error.message);
      return [];
    }
  }

  /**
   * 計算與昨日比較
   */
  async getPerformanceChange(userId = 'default') {
    try {
      const today = await this.calculatePerformance(userId);
      if (!today.success) return null;

      // 取得昨天的快照
      const yesterday = await pool.query(`
        SELECT * FROM performance_snapshots
        WHERE user_id = $1 AND snapshot_date < CURRENT_DATE
        ORDER BY snapshot_date DESC
        LIMIT 1
      `, [userId]);

      if (yesterday.rows.length === 0) {
        return {
          today: today.summary,
          yesterday: null,
          change: null
        };
      }

      const yest = yesterday.rows[0];
      const profitChange = today.summary.totalProfit - parseFloat(yest.total_profit);
      const valueChange = today.summary.totalValue - parseFloat(yest.total_value);

      return {
        today: today.summary,
        yesterday: {
          totalCost: parseFloat(yest.total_cost),
          totalValue: parseFloat(yest.total_value),
          totalProfit: parseFloat(yest.total_profit),
          totalProfitPercent: parseFloat(yest.profit_percent)
        },
        change: {
          profitChange: Math.round(profitChange),
          valueChange: Math.round(valueChange),
          profitChangePercent: yest.total_cost > 0 
            ? ((profitChange / parseFloat(yest.total_cost)) * 100).toFixed(2)
            : 0,
          isImproved: profitChange >= 0
        }
      };
    } catch (error) {
      console.error('計算績效變化失敗:', error.message);
      return null;
    }
  }

  /**
   * 發送每日績效報告到 LINE
   */
  async sendDailyReport(userId = 'default') {
    try {
      const perf = await this.calculatePerformance(userId);
      if (!perf.success) {
        console.log('沒有持股，不發送績效報告');
        return false;
      }

      const change = await this.getPerformanceChange(userId);
      const isProfit = perf.summary.isProfit;
      const headerColor = isProfit ? '#D32F2F' : '#388E3C';

      // 個股明細（最多5檔）
      const stockDetails = perf.details.slice(0, 5).map(d => ({
        type: 'box',
        layout: 'horizontal',
        contents: [
          { type: 'text', text: d.stockName, size: 'sm', flex: 3 },
          { type: 'text', text: `$${d.currentPrice}`, size: 'sm', align: 'end', flex: 2 },
          { 
            type: 'text', 
            text: `${parseFloat(d.profitPercent) >= 0 ? '+' : ''}${d.profitPercent}%`, 
            size: 'sm', 
            align: 'end', 
            flex: 2,
            color: parseFloat(d.profitPercent) >= 0 ? '#D32F2F' : '#388E3C'
          }
        ],
        margin: 'sm'
      }));

      // 變化說明
      let changeText = '';
      if (change && change.change) {
        const c = change.change;
        changeText = c.isImproved 
          ? `📈 比昨日增加 $${Math.abs(c.profitChange).toLocaleString()}`
          : `📉 比昨日減少 $${Math.abs(c.profitChange).toLocaleString()}`;
      }

      const flexMessage = {
        type: 'flex',
        altText: `📊 每日績效：${isProfit ? '獲利' : '虧損'} ${perf.summary.totalProfitPercent}%`,
        contents: {
          type: 'bubble',
          size: 'mega',
          header: {
            type: 'box',
            layout: 'vertical',
            contents: [
              { type: 'text', text: '📊 每日績效報告', size: 'lg', color: '#ffffff', weight: 'bold' },
              { type: 'text', text: perf.date, size: 'sm', color: '#ffffffaa', margin: 'sm' }
            ],
            backgroundColor: headerColor,
            paddingAll: '20px'
          },
          body: {
            type: 'box',
            layout: 'vertical',
            contents: [
              // 總覽
              {
                type: 'box',
                layout: 'vertical',
                contents: [
                  {
                    type: 'text',
                    text: `${isProfit ? '+' : ''}$${perf.summary.totalProfit.toLocaleString()}`,
                    size: 'xxl',
                    weight: 'bold',
                    color: isProfit ? '#D32F2F' : '#388E3C',
                    align: 'center'
                  },
                  {
                    type: 'text',
                    text: `報酬率 ${isProfit ? '+' : ''}${perf.summary.totalProfitPercent}%`,
                    size: 'md',
                    align: 'center',
                    color: '#666666',
                    margin: 'sm'
                  }
                ]
              },
              { type: 'separator', margin: 'lg' },
              // 統計
              {
                type: 'box',
                layout: 'vertical',
                margin: 'lg',
                contents: [
                  {
                    type: 'box',
                    layout: 'horizontal',
                    contents: [
                      { type: 'text', text: '持股數', size: 'sm', color: '#888888' },
                      { type: 'text', text: `${perf.summary.holdingsCount} 檔`, size: 'sm', align: 'end' }
                    ]
                  },
                  {
                    type: 'box',
                    layout: 'horizontal',
                    margin: 'sm',
                    contents: [
                      { type: 'text', text: '總成本', size: 'sm', color: '#888888' },
                      { type: 'text', text: `$${perf.summary.totalCost.toLocaleString()}`, size: 'sm', align: 'end' }
                    ]
                  },
                  {
                    type: 'box',
                    layout: 'horizontal',
                    margin: 'sm',
                    contents: [
                      { type: 'text', text: '總市值', size: 'sm', color: '#888888' },
                      { type: 'text', text: `$${perf.summary.totalValue.toLocaleString()}`, size: 'sm', align: 'end', weight: 'bold' }
                    ]
                  }
                ]
              },
              { type: 'separator', margin: 'lg' },
              // 個股明細
              {
                type: 'box',
                layout: 'vertical',
                margin: 'lg',
                contents: [
                  { type: 'text', text: '📋 持股明細', size: 'sm', color: '#888888', margin: 'sm' },
                  ...stockDetails
                ]
              },
              // 最佳/最差
              {
                type: 'box',
                layout: 'horizontal',
                margin: 'lg',
                contents: [
                  { 
                    type: 'text', 
                    text: `🏆 ${perf.topGainer?.stockName || '-'} +${perf.topGainer?.profitPercent || 0}%`, 
                    size: 'xs', 
                    color: '#D32F2F',
                    flex: 1
                  },
                  { 
                    type: 'text', 
                    text: `📉 ${perf.topLoser?.stockName || '-'} ${perf.topLoser?.profitPercent || 0}%`, 
                    size: 'xs', 
                    color: '#388E3C',
                    flex: 1,
                    align: 'end'
                  }
                ]
              }
            ],
            paddingAll: '20px'
          },
          footer: {
            type: 'box',
            layout: 'vertical',
            contents: [
              { type: 'text', text: changeText || '首日記錄', size: 'xs', color: '#888888', align: 'center' }
            ],
            paddingAll: '15px'
          }
        }
      };

      await lineService.broadcastMessage(flexMessage);
      
      // 儲存快照
      await this.saveSnapshot(userId);
      
      console.log('📊 已發送每日績效報告');
      return true;

    } catch (error) {
      console.error('發送績效報告失敗:', error.message);
      return false;
    }
  }

  /**
   * 發送週報
   */
  async sendWeeklyReport(userId = 'default') {
    try {
      const history = await this.getPerformanceHistory(userId, 7);
      if (history.length < 2) {
        console.log('資料不足，無法產生週報');
        return false;
      }

      const latest = history[0];
      const oldest = history[history.length - 1];
      
      const profitChange = parseFloat(latest.total_profit) - parseFloat(oldest.total_profit);
      const isImproved = profitChange >= 0;

      const message = `📊 本週績效回顧\n` +
        `━━━━━━━━━━━━\n` +
        `📅 ${oldest.snapshot_date} → ${latest.snapshot_date}\n\n` +
        `💰 總市值：$${parseInt(latest.total_value).toLocaleString()}\n` +
        `📈 總損益：${parseFloat(latest.total_profit) >= 0 ? '+' : ''}$${parseInt(latest.total_profit).toLocaleString()}\n` +
        `📊 報酬率：${parseFloat(latest.profit_percent) >= 0 ? '+' : ''}${latest.profit_percent}%\n\n` +
        `${isImproved ? '📈' : '📉'} 本週變化：${isImproved ? '+' : ''}$${parseInt(profitChange).toLocaleString()}`;

      await lineService.broadcastMessage({ type: 'text', text: message });
      return true;
    } catch (error) {
      console.error('發送週報失敗:', error.message);
      return false;
    }
  }
}

module.exports = new PerformanceService();
