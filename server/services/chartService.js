/**
 * 📊 圖表服務 - K線圖、技術指標圖
 * 使用 QuickChart API 產生圖片
 */

const QuickChart = require('quickchart-js');
const stockService = require('./stockService');

class ChartService {

  /**
   * 產生 K 線圖 URL
   */
  async generateKLineChart(stockId, days = 30) {
    try {
      const history = await stockService.getPriceHistory(stockId, days);
      
      if (!history || history.length < 5) {
        return null;
      }

      // 反轉資料（從舊到新）
      const data = history.reverse();
      
      const labels = data.map(d => {
        const date = new Date(d.date);
        return `${date.getMonth() + 1}/${date.getDate()}`;
      });
      
      const closes = data.map(d => parseFloat(d.close_price));
      const highs = data.map(d => parseFloat(d.high_price));
      const lows = data.map(d => parseFloat(d.low_price));
      
      // 計算 MA5, MA20
      const ma5 = this.calculateMA(closes, 5);
      const ma20 = this.calculateMA(closes, 20);

      const chart = new QuickChart();
      chart.setWidth(800);
      chart.setHeight(450);
      chart.setBackgroundColor('#1a1a2e');
      
      chart.setConfig({
        type: 'line',
        data: {
          labels: labels,
          datasets: [
            {
              label: '收盤價',
              data: closes,
              borderColor: '#64c8ff',
              backgroundColor: 'rgba(100, 200, 255, 0.1)',
              fill: true,
              tension: 0.1,
              pointRadius: 0
            },
            {
              label: 'MA5',
              data: ma5,
              borderColor: '#FF9800',
              borderWidth: 1,
              pointRadius: 0,
              fill: false
            },
            {
              label: 'MA20',
              data: ma20,
              borderColor: '#E91E63',
              borderWidth: 1,
              pointRadius: 0,
              fill: false
            }
          ]
        },
        options: {
          plugins: {
            title: {
              display: true,
              text: `${stockId} K線走勢 (${days}日)`,
              color: '#ffffff',
              font: { size: 18 }
            },
            legend: {
              labels: { color: '#ffffff' }
            }
          },
          scales: {
            x: {
              ticks: { color: '#888888' },
              grid: { color: 'rgba(255,255,255,0.1)' }
            },
            y: {
              ticks: { color: '#888888' },
              grid: { color: 'rgba(255,255,255,0.1)' }
            }
          }
        }
      });

      return chart.getUrl();
      
    } catch (error) {
      console.error('K線圖產生失敗:', error);
      return null;
    }
  }

  /**
   * 產生技術指標圖（RSI + KD）
   */
  async generateIndicatorChart(stockId, days = 30) {
    try {
      const history = await stockService.getPriceHistory(stockId, days + 20);
      
      if (!history || history.length < 20) {
        return null;
      }

      const data = history.reverse();
      const closes = data.map(d => parseFloat(d.close_price));
      const highs = data.map(d => parseFloat(d.high_price));
      const lows = data.map(d => parseFloat(d.low_price));
      
      // 計算 RSI
      const rsi = this.calculateRSI(closes, 14);
      
      // 計算 KD
      const { k, d } = this.calculateKD(highs, lows, closes, 9);
      
      const labels = data.slice(-days).map(d => {
        const date = new Date(d.date);
        return `${date.getMonth() + 1}/${date.getDate()}`;
      });

      const chart = new QuickChart();
      chart.setWidth(800);
      chart.setHeight(400);
      chart.setBackgroundColor('#1a1a2e');
      
      chart.setConfig({
        type: 'line',
        data: {
          labels: labels,
          datasets: [
            {
              label: 'RSI(14)',
              data: rsi.slice(-days),
              borderColor: '#64c8ff',
              borderWidth: 2,
              pointRadius: 0,
              yAxisID: 'y'
            },
            {
              label: 'K(9)',
              data: k.slice(-days),
              borderColor: '#FF9800',
              borderWidth: 2,
              pointRadius: 0,
              yAxisID: 'y'
            },
            {
              label: 'D(9)',
              data: d.slice(-days),
              borderColor: '#E91E63',
              borderWidth: 2,
              pointRadius: 0,
              yAxisID: 'y'
            }
          ]
        },
        options: {
          plugins: {
            title: {
              display: true,
              text: `${stockId} 技術指標`,
              color: '#ffffff',
              font: { size: 18 }
            },
            legend: {
              labels: { color: '#ffffff' }
            },
            annotation: {
              annotations: {
                line1: {
                  type: 'line',
                  yMin: 80,
                  yMax: 80,
                  borderColor: '#D32F2F',
                  borderWidth: 1,
                  borderDash: [5, 5]
                },
                line2: {
                  type: 'line',
                  yMin: 20,
                  yMax: 20,
                  borderColor: '#388E3C',
                  borderWidth: 1,
                  borderDash: [5, 5]
                }
              }
            }
          },
          scales: {
            x: {
              ticks: { color: '#888888' },
              grid: { color: 'rgba(255,255,255,0.1)' }
            },
            y: {
              min: 0,
              max: 100,
              ticks: { color: '#888888' },
              grid: { color: 'rgba(255,255,255,0.1)' }
            }
          }
        }
      });

      return chart.getUrl();
      
    } catch (error) {
      console.error('技術指標圖產生失敗:', error);
      return null;
    }
  }

  /**
   * 產生成交量圖
   */
  async generateVolumeChart(stockId, days = 30) {
    try {
      const history = await stockService.getPriceHistory(stockId, days);
      
      if (!history || history.length < 5) {
        return null;
      }

      const data = history.reverse();
      
      const labels = data.map(d => {
        const date = new Date(d.date);
        return `${date.getMonth() + 1}/${date.getDate()}`;
      });
      
      const volumes = data.map(d => parseInt(d.volume) / 1000); // 轉換成張
      const closes = data.map(d => parseFloat(d.close_price));
      
      // 計算漲跌判斷顏色
      const colors = data.map((d, i) => {
        if (i === 0) return '#888888';
        const prevClose = parseFloat(data[i-1].close_price);
        const currClose = parseFloat(d.close_price);
        return currClose >= prevClose ? '#D32F2F' : '#388E3C';
      });

      const chart = new QuickChart();
      chart.setWidth(800);
      chart.setHeight(350);
      chart.setBackgroundColor('#1a1a2e');
      
      chart.setConfig({
        type: 'bar',
        data: {
          labels: labels,
          datasets: [
            {
              label: '成交量(張)',
              data: volumes,
              backgroundColor: colors,
              borderWidth: 0
            }
          ]
        },
        options: {
          plugins: {
            title: {
              display: true,
              text: `${stockId} 成交量 (${days}日)`,
              color: '#ffffff',
              font: { size: 18 }
            },
            legend: {
              labels: { color: '#ffffff' }
            }
          },
          scales: {
            x: {
              ticks: { color: '#888888' },
              grid: { color: 'rgba(255,255,255,0.1)' }
            },
            y: {
              ticks: { color: '#888888' },
              grid: { color: 'rgba(255,255,255,0.1)' }
            }
          }
        }
      });

      return chart.getUrl();
      
    } catch (error) {
      console.error('成交量圖產生失敗:', error);
      return null;
    }
  }

  /**
   * 計算移動平均
   */
  calculateMA(data, period) {
    const result = [];
    for (let i = 0; i < data.length; i++) {
      if (i < period - 1) {
        result.push(null);
      } else {
        const sum = data.slice(i - period + 1, i + 1).reduce((a, b) => a + b, 0);
        result.push(parseFloat((sum / period).toFixed(2)));
      }
    }
    return result;
  }

  /**
   * 計算 RSI
   */
  calculateRSI(closes, period = 14) {
    const result = [];
    let gains = 0;
    let losses = 0;

    for (let i = 1; i < closes.length; i++) {
      const change = closes[i] - closes[i - 1];
      
      if (i <= period) {
        if (change > 0) gains += change;
        else losses -= change;
        
        if (i === period) {
          const avgGain = gains / period;
          const avgLoss = losses / period;
          const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
          result.push(parseFloat((100 - 100 / (1 + rs)).toFixed(2)));
        } else {
          result.push(null);
        }
      } else {
        const prevAvgGain = gains / period;
        const prevAvgLoss = losses / period;
        
        const currentGain = change > 0 ? change : 0;
        const currentLoss = change < 0 ? -change : 0;
        
        gains = prevAvgGain * (period - 1) + currentGain;
        losses = prevAvgLoss * (period - 1) + currentLoss;
        
        const avgGain = gains / period;
        const avgLoss = losses / period;
        const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
        result.push(parseFloat((100 - 100 / (1 + rs)).toFixed(2)));
      }
    }
    
    return [null, ...result];
  }

  /**
   * 計算 KD
   */
  calculateKD(highs, lows, closes, period = 9) {
    const k = [];
    const d = [];
    let prevK = 50;
    let prevD = 50;

    for (let i = 0; i < closes.length; i++) {
      if (i < period - 1) {
        k.push(null);
        d.push(null);
        continue;
      }

      const periodHighs = highs.slice(i - period + 1, i + 1);
      const periodLows = lows.slice(i - period + 1, i + 1);
      
      const highestHigh = Math.max(...periodHighs);
      const lowestLow = Math.min(...periodLows);
      
      const rsv = highestHigh === lowestLow ? 50 : 
        ((closes[i] - lowestLow) / (highestHigh - lowestLow)) * 100;
      
      const currentK = (2/3) * prevK + (1/3) * rsv;
      const currentD = (2/3) * prevD + (1/3) * currentK;
      
      k.push(parseFloat(currentK.toFixed(2)));
      d.push(parseFloat(currentD.toFixed(2)));
      
      prevK = currentK;
      prevD = currentD;
    }

    return { k, d };
  }
}

module.exports = new ChartService();
