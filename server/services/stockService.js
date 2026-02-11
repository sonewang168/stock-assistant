/**
 * 📊 股票服務 - 即時股價抓取（台股 + 美股）
 */

const axios = require('axios');
const { pool } = require('../db');

// 載入股票代碼對照表
let twStocks = null;
try {
  twStocks = require('../data/twStocks');
} catch (e) {
  console.log('⚠️ 未載入股票對照表，將使用預設查詢順序');
}

class StockService {
  
  /**
   * 判斷是否為美股代碼
   */
  isUSStock(stockId) {
    // 美股代碼：全英文字母，1-5個字元
    return /^[A-Za-z]{1,5}$/.test(stockId);
  }

  /**
   * 取得即時股價（自動判斷台股/美股）
   */
  async getRealtimePrice(stockId) {
    try {
      // 判斷是美股還是台股
      if (this.isUSStock(stockId)) {
        return await this.getUSStockPrice(stockId.toUpperCase());
      }
      
      // 判斷是否為盤後時段（台灣時間 13:35 ~ 隔日 08:55）
      const now = new Date();
      const twHour = parseInt(now.toLocaleString('en-US', { timeZone: 'Asia/Taipei', hour: '2-digit', hour12: false }));
      const twMinute = parseInt(now.toLocaleString('en-US', { timeZone: 'Asia/Taipei', minute: '2-digit' }));
      const isAfterMarket = (twHour > 13 || (twHour === 13 && twMinute >= 35)) || twHour < 9;
      
      console.log(`⏰ ${stockId} 台灣時間: ${twHour}:${twMinute}, 盤後: ${isAfterMarket}`);
      
      // 🆕 盤後時段：優先用 Yahoo Finance（更穩定）
      if (isAfterMarket) {
        console.log(`📊 ${stockId} 盤後時段，優先使用 Yahoo Finance`);
        const closingData = await this.fetchClosingPrice(stockId);
        if (closingData && closingData.price > 0) {
          // 取得基本資料（名稱等）- 使用對照表優化
          let baseData = null;
          const stockInfo = twStocks ? twStocks.getStockInfo(stockId) : null;
          
          if (stockInfo && stockInfo.market === 'OTC') {
            baseData = await this.fetchOTC(stockId);
            if (!baseData) baseData = await this.fetchTWSE(stockId);
          } else {
            baseData = await this.fetchTWSE(stockId);
            if (!baseData) baseData = await this.fetchOTC(stockId);
          }
          
          if (baseData) {
            const yahooPrice = closingData.price;
            const yahooYesterday = closingData.previousClose || 0;
            
            // 🔧 修正：盤後時優先用 Yahoo 價格，但昨收價優先用 TWSE/OTC 原始數據
            // 保留 TWSE/OTC 的原始昨收價作為備援
            const originalYesterday = baseData.yesterday || 0;
            
            baseData.price = yahooPrice;
            // 🔧 關鍵修正：昨收價優先順序 - Yahoo > TWSE/OTC原始 > 當日收盤價
            if (yahooYesterday > 0) {
              baseData.yesterday = yahooYesterday;
            } else if (originalYesterday > 0) {
              baseData.yesterday = originalYesterday;
              console.log(`⚠️ ${stockId} Yahoo無昨收，使用TWSE/OTC昨收: ${originalYesterday}`);
            } else {
              baseData.yesterday = yahooPrice;
              console.log(`⚠️ ${stockId} 無法取得昨收，使用當日價: ${yahooPrice}`);
            }
            
            // 🆕 開高低：優先使用 Yahoo 數據，其次 TWSE/OTC，最後用收盤價
            baseData.open = closingData.open || (baseData.open && baseData.open > 0 ? baseData.open : yahooPrice);
            baseData.high = closingData.high || (baseData.high && baseData.high > 0 ? baseData.high : yahooPrice);
            baseData.low = closingData.low || (baseData.low && baseData.low > 0 ? baseData.low : yahooPrice);
            
            // 🆕 成交量：優先使用 Yahoo 數據
            if (closingData.volume && closingData.volume > 0) {
              baseData.volume = closingData.volume;
            }
            
            baseData.change = yahooPrice - baseData.yesterday;
            baseData.changePercent = baseData.yesterday > 0 
              ? ((baseData.change / baseData.yesterday) * 100).toFixed(2) 
              : '0.00';
            baseData.colorMode = 'tw';
            
            // 補上名稱
            if (stockInfo && stockInfo.name) baseData.name = stockInfo.name;
            console.log(`✅ ${stockId} 盤後 Yahoo: 價=${yahooPrice}, 昨收=${baseData.yesterday}, 開=${baseData.open}, 高=${baseData.high}, 低=${baseData.low}`);
            return baseData;
          }
        }
      }
      
      // 盤中或 Yahoo 失敗：使用 TWSE/OTC 即時報價
      // 使用對照表優化查詢順序
      let data = null;
      const stockInfo = twStocks ? twStocks.getStockInfo(stockId) : null;
      
      if (stockInfo) {
        // 有對照表資料，直接查對應市場
        if (stockInfo.market === 'OTC') {
          console.log(`📋 ${stockId} (${stockInfo.name}) 為上櫃股票`);
          data = await this.fetchOTC(stockId);
        } else {
          console.log(`📋 ${stockId} (${stockInfo.name}) 為上市股票`);
          data = await this.fetchTWSE(stockId);
        }
        // 如果查詢失敗，試試另一個市場
        if (!data) {
          data = stockInfo.market === 'OTC' ? await this.fetchTWSE(stockId) : await this.fetchOTC(stockId);
        }
        // 補上名稱
        if (data && !data.name) {
          data.name = stockInfo.name;
        }
      } else {
        // 沒有對照表，依序嘗試
        data = await this.fetchTWSE(stockId);
        if (!data) {
          data = await this.fetchOTC(stockId);
        }
      }
      
      // 備援：如果即時價等於昨收，再試一次 Yahoo
      if (data && data.price === data.yesterday) {
        console.log(`⚠️ ${stockId} 即時價等於昨收，嘗試 Yahoo...`);
        const closingData = await this.fetchClosingPrice(stockId);
        if (closingData && closingData.price > 0 && closingData.price !== data.yesterday) {
          data.price = closingData.price;
          data.change = closingData.change || (data.price - data.yesterday);
          data.changePercent = (data.yesterday && data.yesterday > 0) 
            ? ((data.change / data.yesterday) * 100).toFixed(2) 
            : '0.00';
          // 🆕 同步更新開高低（TWSE 回傳 - 時這些也可能是錯的）
          if (closingData.open && closingData.open > 0) data.open = closingData.open;
          if (closingData.high && closingData.high > 0) data.high = closingData.high;
          if (closingData.low && closingData.low > 0) data.low = closingData.low;
          if (closingData.volume && closingData.volume > 0) data.volume = closingData.volume;
          console.log(`✅ ${stockId} Yahoo備援: 價=${data.price}, 開=${data.open}, 高=${data.high}, 低=${data.low}`);
        }
      }
      
      if (data) {
        data = this.calculateChange(data);
        data.colorMode = 'tw';
      }
      
      return data;
    } catch (error) {
      console.error(`取得 ${stockId} 股價失敗:`, error.message);
      return null;
    }
  }

  /**
   * 🆕 抓取今日收盤價（盤後使用）
   */
  async fetchClosingPrice(stockId) {
    try {
      // 🔀 根據對照表決定優先嘗試的市場
      const stockInfo = twStocks ? twStocks.getStockInfo(stockId) : null;
      const isOTC = stockInfo && stockInfo.market === 'OTC';
      
      console.log(`📊 fetchClosingPrice ${stockId}: ${isOTC ? '上櫃優先' : '上市優先'}`);
      
      // 方法1: Yahoo Finance 台股（根據市場類型優先嘗試）
      let yahooData = null;
      if (isOTC) {
        // 上櫃股票：先嘗試 .TWO，失敗再嘗試 .TW
        yahooData = await this.fetchTWStockFromYahooOTC(stockId);
        if (!yahooData || yahooData.price <= 0) {
          yahooData = await this.fetchTWStockFromYahoo(stockId);
        }
      } else {
        // 上市股票：先嘗試 .TW，失敗再嘗試 .TWO
        yahooData = await this.fetchTWStockFromYahoo(stockId);
      }
      
      if (yahooData && yahooData.price > 0) {
        return yahooData;
      }
      
      // 方法2: Google Finance
      const googleData = await this.fetchTWStockFromGoogle(stockId);
      if (googleData && googleData.price > 0) {
        return googleData;
      }
      
      return null;
    } catch (error) {
      console.error(`抓取 ${stockId} 收盤價失敗:`, error.message);
      return null;
    }
  }

  /**
   * 🆕 從 Yahoo Finance 抓取台股
   */
  async fetchTWStockFromYahoo(stockId) {
    try {
      const symbol = `${stockId}.TW`;
      const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d&range=1d`;
      
      const response = await axios.get(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept': 'application/json'
        },
        timeout: 10000
      });

      const result = response.data?.chart?.result?.[0];
      if (!result) {
        // 嘗試上櫃 .TWO
        return await this.fetchTWStockFromYahooOTC(stockId);
      }

      const meta = result.meta;
      const price = meta.regularMarketPrice || 0;
      const previousClose = meta.previousClose || meta.chartPreviousClose || 0;
      const change = price - previousClose;
      
      // 🆕 抓取開高低數據
      const quote = result.indicators?.quote?.[0] || {};
      const opens = quote.open || [];
      const highs = quote.high || [];
      const lows = quote.low || [];
      const volumes = quote.volume || [];
      
      // 取最後一個有效值
      const getLastValid = (arr) => {
        for (let i = arr.length - 1; i >= 0; i--) {
          if (arr[i] !== null && !isNaN(arr[i])) return arr[i];
        }
        return 0;
      };
      
      const open = getLastValid(opens) || price;
      const high = getLastValid(highs) || price;
      const low = getLastValid(lows) || price;
      const volume = getLastValid(volumes) || 0;

      console.log(`📊 Yahoo TW ${stockId}: 價=${price}, 昨收=${previousClose}, 開=${open}, 高=${high}, 低=${low}`);
      
      return {
        price: parseFloat(price.toFixed(2)),
        change: parseFloat(change.toFixed(2)),
        previousClose,
        open: parseFloat(open.toFixed(2)),
        high: parseFloat(high.toFixed(2)),
        low: parseFloat(low.toFixed(2)),
        volume: parseInt(volume)
      };
    } catch (error) {
      // 嘗試上櫃
      return await this.fetchTWStockFromYahooOTC(stockId);
    }
  }

  /**
   * 🆕 從 Yahoo Finance 抓取台股上櫃
   */
  async fetchTWStockFromYahooOTC(stockId) {
    try {
      const symbol = `${stockId}.TWO`;
      const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d&range=1d`;
      
      const response = await axios.get(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept': 'application/json'
        },
        timeout: 10000
      });

      const result = response.data?.chart?.result?.[0];
      if (!result) return null;

      const meta = result.meta;
      const price = meta.regularMarketPrice || 0;
      const previousClose = meta.previousClose || meta.chartPreviousClose || 0;
      const change = price - previousClose;
      
      // 🆕 抓取開高低數據
      const quote = result.indicators?.quote?.[0] || {};
      const opens = quote.open || [];
      const highs = quote.high || [];
      const lows = quote.low || [];
      const volumes = quote.volume || [];
      
      // 取最後一個有效值
      const getLastValid = (arr) => {
        for (let i = arr.length - 1; i >= 0; i--) {
          if (arr[i] !== null && !isNaN(arr[i])) return arr[i];
        }
        return 0;
      };
      
      const open = getLastValid(opens) || price;
      const high = getLastValid(highs) || price;
      const low = getLastValid(lows) || price;
      const volume = getLastValid(volumes) || 0;

      console.log(`📊 Yahoo TWO ${stockId}: 價=${price}, 昨收=${previousClose}, 開=${open}, 高=${high}, 低=${low}`);
      
      return {
        price: parseFloat(price.toFixed(2)),
        change: parseFloat(change.toFixed(2)),
        previousClose,
        open: parseFloat(open.toFixed(2)),
        high: parseFloat(high.toFixed(2)),
        low: parseFloat(low.toFixed(2)),
        volume: parseInt(volume)
      };
    } catch (error) {
      return null;
    }
  }

  /**
   * 🆕 從 Google Finance 抓取台股
   */
  async fetchTWStockFromGoogle(stockId) {
    try {
      const url = `https://www.google.com/finance/quote/${stockId}:TPE`;
      
      const response = await axios.get(url, {
        headers: { 
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept': 'text/html'
        },
        timeout: 10000
      });

      const html = response.data;
      
      // 解析價格
      const priceMatch = html.match(/data-last-price="([0-9,.]+)"/);
      const changeMatch = html.match(/data-price-change="([0-9,.-]+)"/);
      
      if (priceMatch) {
        const price = parseFloat(priceMatch[1].replace(/,/g, ''));
        const change = changeMatch ? parseFloat(changeMatch[1].replace(/,/g, '')) : 0;

        console.log(`📊 Google TW ${stockId}: ${price}`);
        
        return {
          price: parseFloat(price.toFixed(2)),
          change: parseFloat(change.toFixed(2))
        };
      }
      return null;
    } catch (error) {
      return null;
    }
  }

  /**
   * 🇺🇸 取得美股即時股價（使用多個來源）
   */
  async getUSStockPrice(symbol) {
    // 🆕 優先透過 CF Worker 代理（Railway IP 被 Yahoo 擋 502）
    const CF_WORKER_URL = process.env.CF_INDICES_URL;
    if (CF_WORKER_URL) {
      try {
        const resp = await axios.get(`${CF_WORKER_URL}/?symbols=${encodeURIComponent(symbol)}&_t=${Date.now()}`, { timeout: 15000 });
        if (resp.data?.success && resp.data.data?.length > 0) {
          const d = resp.data.data[0];
          const usStockNames = {
            'AAPL': '蘋果', 'TSLA': '特斯拉', 'NVDA': '輝達', 'MSFT': '微軟',
            'GOOGL': '谷歌', 'GOOG': '谷歌', 'AMZN': '亞馬遜', 'META': 'Meta',
            'AMD': '超微', 'INTC': '英特爾', 'TSM': '台積電ADR', 'BABA': '阿里巴巴',
            'JD': '京東', 'PDD': '拼多多', 'NIO': '蔚來', 'XPEV': '小鵬',
            'LI': '理想', 'PLTR': 'Palantir', 'COIN': 'Coinbase', 'ROKU': 'Roku',
            'SQ': 'Block', 'PYPL': 'PayPal', 'NFLX': 'Netflix', 'DIS': '迪士尼',
            'BA': '波音', 'F': '福特', 'GM': '通用', 'JPM': '摩根大通',
            'V': 'Visa', 'MA': 'Mastercard', 'WMT': '沃爾瑪', 'COST': '好市多',
            'SPY': 'S&P500 ETF', 'QQQ': '納指100 ETF', 'VOO': 'Vanguard S&P500',
            'AVGO': '博通', 'MU': '美光', 'UVXY': 'UVXY恐慌', 'ARM': 'ARM',
            'QCOM': '高通', 'MRVL': 'Marvell', 'LRCX': '科磊', 'AMAT': '應材',
            'KLAC': 'KLA', 'ASML': 'ASML', 'SMCI': '超微電腦', 'DELL': '戴爾',
          };
          console.log(`✅ CF Worker 美股 ${symbol}: $${d.price} (${d.changePercent > 0 ? '+' : ''}${d.changePercent}%)`);
          return {
            id: symbol, name: usStockNames[symbol] || symbol,
            price: d.price, open: 0, high: 0, low: 0,
            yesterday: d.prevClose, volume: 0,
            change: d.change, changePercent: d.changePercent,
            market: 'US', colorMode: 'us', currency: 'USD',
            marketState: 'REGULAR',
            time: new Date().toLocaleTimeString('zh-TW', { timeZone: 'America/New_York' })
          };
        }
      } catch (e) {
        console.log(`   CF Worker 美股 ${symbol} 失敗: ${e.message}`);
      }
    }

    // 備援：直接呼叫 Yahoo（Railway IP 可能被擋）
    let data = await this.fetchUSStockFromYahoo(symbol);
    
    if (!data) {
      console.log(`   嘗試備用來源 (v7)...`);
      data = await this.fetchUSStockFromYahooV7(symbol);
    }
    
    if (!data) {
      console.log(`   嘗試備用來源 (quote)...`);
      data = await this.fetchUSStockFromYahooQuote(symbol);
    }

    if (!data) {
      console.log(`   嘗試備用來源 (Google)...`);
      data = await this.fetchUSStockFromGoogle(symbol);
    }
    
    if (!data) {
      console.log(`   嘗試備用來源 (Yahoo HTML)...`);
      data = await this.fetchUSStockFromYahooHTML(symbol);
    }
    
    return data;
  }

  /**
   * Yahoo Finance HTML 頁面爬取（最後備援）
   */
  async fetchUSStockFromYahooHTML(symbol) {
    try {
      const url = `https://finance.yahoo.com/quote/${symbol}`;
      
      const response = await axios.get(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
          'Cache-Control': 'no-cache'
        },
        timeout: 15000
      });

      const html = response.data;
      
      // 嘗試從 JSON-LD 或頁面中提取數據
      const priceMatch = html.match(/regularMarketPrice.*?(\d+\.?\d*)/);
      const changeMatch = html.match(/regularMarketChange.*?(-?\d+\.?\d*)/);
      const changePercentMatch = html.match(/regularMarketChangePercent.*?(-?\d+\.?\d*)/);
      
      // 備用正則
      const priceMatch2 = html.match(/data-field="regularMarketPrice"[^>]*>([0-9,.]+)</);
      const finStreamMatch = html.match(/"regularMarketPrice":{"raw":([0-9.]+)/);
      
      let price = null;
      if (priceMatch) price = parseFloat(priceMatch[1]);
      else if (priceMatch2) price = parseFloat(priceMatch2[1].replace(/,/g, ''));
      else if (finStreamMatch) price = parseFloat(finStreamMatch[1]);
      
      if (price && price > 0) {
        const change = changeMatch ? parseFloat(changeMatch[1]) : 0;
        const changePercent = changePercentMatch ? parseFloat(changePercentMatch[1]) : 0;
        
        const usStockNames = {
          'AAPL': '蘋果', 'TSLA': '特斯拉', 'NVDA': '輝達', 'MSFT': '微軟',
          'GOOGL': '谷歌', 'GOOG': '谷歌', 'AMZN': '亞馬遜', 'META': 'Meta',
          'AMD': '超微', 'INTC': '英特爾', 'TSM': '台積電ADR', 'MU': '美光',
          'WDC': '威騰', 'STX': '希捷'
        };

        console.log(`   ✅ Yahoo HTML ${symbol}: $${price}`);
        return {
          id: symbol,
          name: usStockNames[symbol] || symbol,
          price: parseFloat(price.toFixed(2)),
          change: parseFloat(change.toFixed(2)),
          changePercent: changePercent.toFixed(2),
          market: 'US',
          colorMode: 'us',
          currency: 'USD'
        };
      }
    } catch (e) {
      console.error(`Yahoo HTML ${symbol} 失敗:`, e.message);
    }
    return null;
  }

  /**
   * Google Finance 備援（美股個股）
   */
  async fetchUSStockFromGoogle(symbol) {
    try {
      const url = `https://www.google.com/finance/quote/${symbol}:NASDAQ`;
      
      let response = await axios.get(url, {
        headers: { 
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept': 'text/html'
        },
        timeout: 10000
      });

      // 如果 NASDAQ 找不到，試試 NYSE
      if (!response.data.includes('data-last-price')) {
        const urlNYSE = `https://www.google.com/finance/quote/${symbol}:NYSE`;
        response = await axios.get(urlNYSE, {
          headers: { 
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Accept': 'text/html'
          },
          timeout: 10000
        });
      }

      const html = response.data;
      
      // 解析價格
      const priceMatch = html.match(/data-last-price="([0-9,.]+)"/);
      const changeMatch = html.match(/data-price-change="([0-9,.-]+)"/);
      const changePercentMatch = html.match(/data-price-change-percent="([0-9,.-]+)"/);
      
      if (priceMatch) {
        const price = parseFloat(priceMatch[1].replace(/,/g, ''));
        const change = changeMatch ? parseFloat(changeMatch[1].replace(/,/g, '')) : 0;
        const changePercent = changePercentMatch ? parseFloat(changePercentMatch[1]) : 0;

        const usStockNames = {
          'AAPL': '蘋果', 'TSLA': '特斯拉', 'NVDA': '輝達', 'MSFT': '微軟',
          'GOOGL': '谷歌', 'GOOG': '谷歌', 'AMZN': '亞馬遜', 'META': 'Meta',
          'AMD': '超微', 'INTC': '英特爾', 'TSM': '台積電ADR'
        };

        return {
          id: symbol,
          name: usStockNames[symbol] || symbol,
          price: parseFloat(price.toFixed(2)),
          change: parseFloat(change.toFixed(2)),
          changePercent: changePercent.toFixed(2),
          market: 'US',
          colorMode: 'us',
          currency: 'USD'
        };
      }
    } catch (e) {
      console.error(`Google Finance ${symbol} 失敗:`, e.message);
    }
    return null;
  }

  /**
   * Yahoo Finance v8 API
   */
  async fetchUSStockFromYahoo(symbol) {
    try {
      const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d&range=5d`;
      
      const response = await axios.get(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
          'Accept': 'application/json, text/plain, */*',
          'Accept-Language': 'en-US,en;q=0.9',
          'Accept-Encoding': 'gzip, deflate, br',
          'Origin': 'https://finance.yahoo.com',
          'Referer': 'https://finance.yahoo.com/',
          'Sec-Ch-Ua': '"Chromium";v="122", "Not(A:Brand";v="24", "Google Chrome";v="122"',
          'Sec-Ch-Ua-Mobile': '?0',
          'Sec-Ch-Ua-Platform': '"Windows"',
          'Sec-Fetch-Dest': 'empty',
          'Sec-Fetch-Mode': 'cors',
          'Sec-Fetch-Site': 'same-site'
        },
        timeout: 15000
      });

      const result = response.data?.chart?.result?.[0];
      if (!result) {
        console.log(`   Yahoo v8: ${symbol} 無資料`);
        return null;
      }

      const meta = result.meta;
      const quote = result.indicators?.quote?.[0];
      
      if (!meta) {
        console.log(`   Yahoo v8: ${symbol} meta 為空`);
        return null;
      }

      const price = meta.regularMarketPrice || 0;
      const previousClose = meta.previousClose || meta.chartPreviousClose || 0;
      const change = price - previousClose;
      const changePercent = previousClose > 0 ? ((change / previousClose) * 100).toFixed(2) : 0;

      // 美股名稱對照
      const usStockNames = {
        'AAPL': '蘋果', 'TSLA': '特斯拉', 'NVDA': '輝達', 'MSFT': '微軟',
        'GOOGL': '谷歌', 'GOOG': '谷歌', 'AMZN': '亞馬遜', 'META': 'Meta',
        'AMD': '超微', 'INTC': '英特爾', 'TSM': '台積電ADR', 'BABA': '阿里巴巴',
        'JD': '京東', 'PDD': '拼多多', 'NIO': '蔚來', 'XPEV': '小鵬',
        'LI': '理想', 'PLTR': 'Palantir', 'COIN': 'Coinbase', 'ROKU': 'Roku',
        'SQ': 'Block', 'PYPL': 'PayPal', 'NFLX': 'Netflix', 'DIS': '迪士尼',
        'BA': '波音', 'F': '福特', 'GM': '通用', 'JPM': '摩根大通',
        'V': 'Visa', 'MA': 'Mastercard', 'WMT': '沃爾瑪', 'COST': '好市多',
        'SPY': 'S&P500 ETF', 'QQQ': '納指100 ETF', 'VOO': 'Vanguard S&P500'
      };

      return {
        id: symbol,
        name: usStockNames[symbol] || meta.shortName || meta.longName || symbol,
        price: parseFloat(price.toFixed(2)),
        open: quote?.open?.[quote.open.length - 1] || meta.regularMarketOpen || 0,
        high: quote?.high?.[quote.high.length - 1] || meta.regularMarketDayHigh || 0,
        low: quote?.low?.[quote.low.length - 1] || meta.regularMarketDayLow || 0,
        yesterday: previousClose,
        volume: quote?.volume?.[quote.volume.length - 1] || meta.regularMarketVolume || 0,
        change: parseFloat(change.toFixed(2)),
        changePercent: changePercent,
        market: 'US',
        colorMode: 'us',
        currency: meta.currency || 'USD',
        marketState: meta.marketState || 'UNKNOWN',
        time: new Date().toLocaleTimeString('zh-TW', { timeZone: 'America/New_York' })
      };

    } catch (error) {
      const status = error.response?.status || 'N/A';
      const msg = error.response?.data?.chart?.error?.description || error.message;
      console.error(`取得美股 ${symbol} 失敗 (v8): [${status}] ${msg}`);
      return null;
    }
  }

  /**
   * Yahoo Finance v7 API（備用）
   */
  async fetchUSStockFromYahooV7(symbol) {
    try {
      const url = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${symbol}`;
      
      const response = await axios.get(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': '*/*',
          'Origin': 'https://finance.yahoo.com',
          'Referer': 'https://finance.yahoo.com/'
        },
        timeout: 15000
      });

      const quote = response.data?.quoteResponse?.result?.[0];
      if (!quote) {
        console.log(`   Yahoo v7: ${symbol} 無資料`);
        return null;
      }

      const usStockNames = {
        'AAPL': '蘋果', 'TSLA': '特斯拉', 'NVDA': '輝達', 'MSFT': '微軟',
        'GOOGL': '谷歌', 'GOOG': '谷歌', 'AMZN': '亞馬遜', 'META': 'Meta',
        'AMD': '超微', 'INTC': '英特爾', 'TSM': '台積電ADR'
      };

      const price = quote.regularMarketPrice || 0;
      const previousClose = quote.regularMarketPreviousClose || 0;
      const change = quote.regularMarketChange || (price - previousClose);
      const changePercent = quote.regularMarketChangePercent || 
        (previousClose > 0 ? ((change / previousClose) * 100) : 0);

      return {
        id: symbol,
        name: usStockNames[symbol] || quote.shortName || quote.longName || symbol,
        price: parseFloat(price.toFixed(2)),
        open: quote.regularMarketOpen || 0,
        high: quote.regularMarketDayHigh || 0,
        low: quote.regularMarketDayLow || 0,
        yesterday: previousClose,
        volume: quote.regularMarketVolume || 0,
        change: parseFloat(change.toFixed(2)),
        changePercent: parseFloat(changePercent).toFixed(2),
        market: 'US',
        colorMode: 'us',
        currency: quote.currency || 'USD',
        marketState: quote.marketState || 'UNKNOWN',
        time: new Date().toLocaleTimeString('zh-TW', { timeZone: 'America/New_York' })
      };

    } catch (error) {
      const status = error.response?.status || 'N/A';
      const msg = error.response?.data?.quoteResponse?.error?.description || error.message;
      console.error(`取得美股 ${symbol} 失敗 (v7): [${status}] ${msg}`);
      return null;
    }
  }

  /**
   * Yahoo Finance Quote API（第三備用）
   */
  async fetchUSStockFromYahooQuote(symbol) {
    try {
      // 使用 query2 端點
      const url = `https://query2.finance.yahoo.com/v10/finance/quoteSummary/${symbol}?modules=price`;
      
      const response = await axios.get(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
          'Accept': 'application/json'
        },
        timeout: 15000
      });

      const priceData = response.data?.quoteSummary?.result?.[0]?.price;
      if (!priceData) {
        console.log(`   Yahoo quote: ${symbol} 無資料`);
        return null;
      }

      const usStockNames = {
        'AAPL': '蘋果', 'TSLA': '特斯拉', 'NVDA': '輝達', 'MSFT': '微軟',
        'AMD': '超微', 'GOOGL': '谷歌', 'AMZN': '亞馬遜', 'META': 'Meta'
      };

      const price = priceData.regularMarketPrice?.raw || 0;
      const previousClose = priceData.regularMarketPreviousClose?.raw || 0;
      const change = priceData.regularMarketChange?.raw || 0;
      const changePercent = priceData.regularMarketChangePercent?.raw || 0;

      return {
        id: symbol,
        name: usStockNames[symbol] || priceData.shortName || symbol,
        price: parseFloat(price.toFixed(2)),
        open: priceData.regularMarketOpen?.raw || 0,
        high: priceData.regularMarketDayHigh?.raw || 0,
        low: priceData.regularMarketDayLow?.raw || 0,
        yesterday: previousClose,
        volume: priceData.regularMarketVolume?.raw || 0,
        change: parseFloat(change.toFixed(2)),
        changePercent: parseFloat(changePercent).toFixed(2),
        market: 'US',
        colorMode: 'us',
        currency: priceData.currency || 'USD',
        marketState: priceData.marketState || 'UNKNOWN',
        time: new Date().toLocaleTimeString('zh-TW', { timeZone: 'America/New_York' })
      };

    } catch (error) {
      const status = error.response?.status || 'N/A';
      console.error(`取得美股 ${symbol} 失敗 (quote): [${status}] ${error.message}`);
      return null;
    }
  }

  /**
   * 🇺🇸 取得美股指數
   */
  async getUSIndices() {
    try {
      const indices = [
        { symbol: '^DJI', name: '道瓊工業', finageSymbol: 'DJI' },
        { symbol: '^GSPC', name: 'S&P 500', finageSymbol: 'SPX' },
        { symbol: '^IXIC', name: '納斯達克', finageSymbol: 'IXIC' },
        { symbol: '^SOX', name: '費城半導體', finageSymbol: 'SOX' }
      ];

      const results = [];
      
      for (const index of indices) {
        let data = null;
        
        // 嘗試方法 1: Yahoo v8 chart API
        data = await this.fetchIndexFromYahooV8(index);
        
        // 嘗試方法 2: Yahoo v7 quote API
        if (!data) {
          data = await this.fetchIndexFromYahooV7(index);
        }
        
        // 嘗試方法 3: Yahoo v6 quote API
        if (!data) {
          data = await this.fetchIndexFromYahooV6(index);
        }
        
        // 嘗試方法 4: 使用 Google Finance 頁面解析
        if (!data) {
          data = await this.fetchIndexFromGoogle(index);
        }

        if (data) {
          results.push(data);
        }
        
        await this.sleep(500);
      }

      return results;

    } catch (error) {
      console.error('取得美股指數失敗:', error.message);
      return [];
    }
  }

  /**
   * Yahoo v8 chart API
   */
  async fetchIndexFromYahooV8(index) {
    try {
      const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(index.symbol)}?interval=1d&range=5d`;
      
      const response = await axios.get(url, {
        headers: { 
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
          'Accept': 'application/json',
          'Accept-Language': 'en-US,en;q=0.9',
          'Origin': 'https://finance.yahoo.com',
          'Referer': 'https://finance.yahoo.com/',
          'Sec-Fetch-Dest': 'empty',
          'Sec-Fetch-Mode': 'cors',
          'Sec-Fetch-Site': 'same-site'
        },
        timeout: 10000
      });

      const result = response.data?.chart?.result?.[0];
      if (result) {
        const meta = result.meta;
        const price = meta.regularMarketPrice || 0;
        const previousClose = meta.previousClose || meta.chartPreviousClose || 0;
        const change = price - previousClose;
        const changePercent = previousClose > 0 ? ((change / previousClose) * 100).toFixed(2) : 0;

        return {
          symbol: index.symbol,
          name: index.name,
          price: parseFloat(price.toFixed(2)),
          change: parseFloat(change.toFixed(2)),
          changePercent: changePercent,
          colorMode: 'us'
        };
      }
    } catch (e) {
      // Silent fail, try next method
    }
    return null;
  }

  /**
   * Yahoo v7 quote API  
   */
  async fetchIndexFromYahooV7(index) {
    try {
      const url = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(index.symbol)}`;
      
      const response = await axios.get(url, {
        headers: { 
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
          'Accept': '*/*',
          'Accept-Language': 'en-US,en;q=0.9'
        },
        timeout: 10000
      });

      const quote = response.data?.quoteResponse?.result?.[0];
      if (quote) {
        const price = quote.regularMarketPrice || 0;
        const change = quote.regularMarketChange || 0;
        const changePercent = quote.regularMarketChangePercent || 0;

        return {
          symbol: index.symbol,
          name: index.name,
          price: parseFloat(price.toFixed(2)),
          change: parseFloat(change.toFixed(2)),
          changePercent: parseFloat(changePercent).toFixed(2),
          colorMode: 'us'
        };
      }
    } catch (e) {
      // Silent fail
    }
    return null;
  }

  /**
   * Yahoo v6 quote API
   */
  async fetchIndexFromYahooV6(index) {
    try {
      const url = `https://query2.finance.yahoo.com/v6/finance/quote?symbols=${encodeURIComponent(index.symbol)}`;
      
      const response = await axios.get(url, {
        headers: { 
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/121.0',
          'Accept': 'application/json'
        },
        timeout: 10000
      });

      const quote = response.data?.quoteResponse?.result?.[0];
      if (quote) {
        const price = quote.regularMarketPrice || 0;
        const change = quote.regularMarketChange || 0;
        const changePercent = quote.regularMarketChangePercent || 0;

        return {
          symbol: index.symbol,
          name: index.name,
          price: parseFloat(price.toFixed(2)),
          change: parseFloat(change.toFixed(2)),
          changePercent: parseFloat(changePercent).toFixed(2),
          colorMode: 'us'
        };
      }
    } catch (e) {
      // Silent fail
    }
    return null;
  }

  /**
   * Google Finance 備援（解析網頁）
   */
  async fetchIndexFromGoogle(index) {
    try {
      // Google Finance 使用不同的代碼
      const googleSymbols = {
        '^DJI': '.DJI:INDEXDJX',
        '^GSPC': '.INX:INDEXSP', 
        '^IXIC': '.IXIC:INDEXNASDAQ',
        '^SOX': 'SOX:INDEXNASDAQ'
      };
      
      const gSymbol = googleSymbols[index.symbol];
      if (!gSymbol) return null;

      const url = `https://www.google.com/finance/quote/${gSymbol}`;
      
      const response = await axios.get(url, {
        headers: { 
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept': 'text/html'
        },
        timeout: 10000
      });

      const html = response.data;
      
      // 解析價格 - 找 data-last-price
      const priceMatch = html.match(/data-last-price="([0-9,.]+)"/);
      const changeMatch = html.match(/data-price-change="([0-9,.-]+)"/);
      const changePercentMatch = html.match(/data-price-change-percent="([0-9,.-]+)"/);
      
      if (priceMatch) {
        const price = parseFloat(priceMatch[1].replace(/,/g, ''));
        const change = changeMatch ? parseFloat(changeMatch[1].replace(/,/g, '')) : 0;
        const changePercent = changePercentMatch ? parseFloat(changePercentMatch[1]) : 0;

        return {
          symbol: index.symbol,
          name: index.name,
          price: parseFloat(price.toFixed(2)),
          change: parseFloat(change.toFixed(2)),
          changePercent: changePercent.toFixed(2),
          colorMode: 'us'
        };
      }
    } catch (e) {
      console.error(`Google Finance ${index.name} 失敗:`, e.message);
    }
    return null;
  }

  /**
   * 抓取上市股票
   */
  async fetchTWSE(stockId) {
    try {
      // 加入時間戳記避免快取
      const timestamp = Date.now();
      const url = `https://mis.twse.com.tw/stock/api/getStockInfo.jsp?ex_ch=tse_${stockId}.tw&_=${timestamp}`;
      const response = await axios.get(url, {
        headers: { 
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Cache-Control': 'no-cache, no-store',
          'Pragma': 'no-cache'
        },
        timeout: 10000
      });

      const data = response.data;
      if (data.msgArray && data.msgArray.length > 0) {
        const stock = data.msgArray[0];
        
        // 🔧 修正：解析數值
        const parseVal = (val) => {
          if (!val || val === '-' || val === '') return null;
          const num = parseFloat(val);
          return isNaN(num) || num <= 0 ? null : num;
        };
        
        // 即時價：優先用 stock.z，無效時用昨收
        const rawYesterday = parseVal(stock.y);
        const rawPrice = parseVal(stock.z);
        const currentPrice = rawPrice || rawYesterday || 0;
        
        // 昨收價：如果無效，先不用當天價格替換（讓 line.js 處理）
        const yesterday = rawYesterday || 0;
        
        console.log(`📈 TWSE ${stockId}: 即時=${stock.z}→${currentPrice}, 昨收=${stock.y}→${yesterday}, 時間=${stock.t}`);
        
        // 開高低：無效時用當天價格
        const open = parseVal(stock.o) || currentPrice;
        const high = parseVal(stock.h) || currentPrice;
        const low = parseVal(stock.l) || currentPrice;
        
        // 使用 twStocks 對照表補全名稱
        let stockName = stock.n || '';
        if (!stockName || stockName === stockId) {
          const twInfo = twStocks ? twStocks.getStockInfo(stockId) : null;
          if (twInfo && twInfo.name) {
            stockName = twInfo.name;
          } else {
            stockName = stockId;
          }
        }
        
        return {
          id: stockId,
          name: stockName,
          price: currentPrice,
          open: open,
          high: high,
          low: low,
          yesterday: yesterday,
          volume: parseInt(stock.v) || 0,
          time: stock.t || '',
          market: 'TSE'
        };
      }
      return null;
    } catch (error) {
      console.error(`TWSE ${stockId} 錯誤:`, error.message);
      return null;
    }
  }

  /**
   * 抓取上櫃股票
   */
  async fetchOTC(stockId) {
    try {
      // 加入時間戳記避免快取
      const timestamp = Date.now();
      const url = `https://mis.twse.com.tw/stock/api/getStockInfo.jsp?ex_ch=otc_${stockId}.tw&_=${timestamp}`;
      const response = await axios.get(url, {
        headers: { 
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Cache-Control': 'no-cache, no-store',
          'Pragma': 'no-cache'
        },
        timeout: 10000
      });

      const data = response.data;
      if (data.msgArray && data.msgArray.length > 0) {
        const stock = data.msgArray[0];
        
        // 🔧 修正：解析數值
        const parseVal = (val) => {
          if (!val || val === '-' || val === '') return null;
          const num = parseFloat(val);
          return isNaN(num) || num <= 0 ? null : num;
        };
        
        // 即時價：優先用 stock.z，無效時用昨收
        const rawYesterday = parseVal(stock.y);
        const rawPrice = parseVal(stock.z);
        const currentPrice = rawPrice || rawYesterday || 0;
        
        // 昨收價：如果無效，先不用當天價格替換（讓 line.js 處理）
        const yesterday = rawYesterday || 0;
        
        console.log(`📈 OTC ${stockId}: 即時=${stock.z}→${currentPrice}, 昨收=${stock.y}→${yesterday}, 時間=${stock.t}`);
        
        // 開高低：無效時用當天價格
        const open = parseVal(stock.o) || currentPrice;
        const high = parseVal(stock.h) || currentPrice;
        const low = parseVal(stock.l) || currentPrice;
        
        // 使用 twStocks 對照表補全名稱
        let stockName = stock.n || '';
        if (!stockName || stockName === stockId) {
          const twInfo = twStocks ? twStocks.getStockInfo(stockId) : null;
          if (twInfo && twInfo.name) {
            stockName = twInfo.name;
          } else {
            stockName = stockId;
          }
        }
        
        return {
          id: stockId,
          name: stockName,
          price: currentPrice,
          open: open,
          high: high,
          low: low,
          yesterday: yesterday,
          volume: parseInt(stock.v) || 0,
          time: stock.t || '',
          market: 'OTC'
        };
      }
      return null;
    } catch (error) {
      console.error(`OTC ${stockId} 錯誤:`, error.message);
      return null;
    }
  }

  /**
   * 計算漲跌幅
   */
  calculateChange(stockData) {
    if (!stockData) return stockData;
    
    // 確保 yesterday 是有效的數值
    const yesterday = parseFloat(stockData.yesterday) || 0;
    const price = parseFloat(stockData.price) || 0;
    
    if (yesterday <= 0 || price <= 0) {
      // 無法計算，設為 0
      stockData.change = stockData.change || 0;
      stockData.changePercent = stockData.changePercent || '0.00';
      return stockData;
    }

    stockData.change = price - yesterday;
    stockData.changePercent = ((stockData.change / yesterday) * 100).toFixed(2);
    
    // 最終檢查：避免 Infinity 或 NaN
    if (!isFinite(parseFloat(stockData.changePercent))) {
      stockData.changePercent = '0.00';
    }
    
    return stockData;
  }

  /**
   * 批次取得多檔股票
   */
  async getBatchPrices(stockIds) {
    const results = [];
    
    for (const stockId of stockIds) {
      const data = await this.getRealtimePrice(stockId);
      if (data) {
        results.push(data);
      }
      // 避免請求太快
      await this.sleep(300);
    }
    
    return results;
  }

  /**
   * 取得三大法人買賣超
   */
  async getInstitutionalData(stockId) {
    try {
      const today = new Date();
      const dateStr = today.toISOString().slice(0, 10).replace(/-/g, '');
      
      const url = `https://www.twse.com.tw/rwd/zh/fund/T86?date=${dateStr}&selectType=ALLBUT0999&response=json`;
      const response = await axios.get(url, {
        headers: { 'User-Agent': 'Mozilla/5.0' },
        timeout: 15000
      });

      const data = response.data;
      if (data.data) {
        for (const row of data.data) {
          if (row[0].trim() === stockId) {
            return {
              stockId: stockId,
              date: today.toISOString().slice(0, 10),
              foreign: this.parseNumber(row[4]),
              investment: this.parseNumber(row[10]),
              dealer: this.parseNumber(row[11]),
              total: this.parseNumber(row[18])
            };
          }
        }
      }
      return null;
    } catch (error) {
      console.error(`取得 ${stockId} 籌碼資料失敗:`, error.message);
      return null;
    }
  }

  parseNumber(str) {
    if (!str) return 0;
    return parseInt(str.toString().replace(/,/g, '')) || 0;
  }

  /**
   * 儲存價格歷史
   */
  async savePriceHistory(stockData) {
    if (!stockData) return;

    try {
      // 先確保股票存在於 stocks 表中（解決外鍵約束問題）
      const ensureStockSQL = `
        INSERT INTO stocks (id, name, market) 
        VALUES ($1, $2, $3) 
        ON CONFLICT (id) DO UPDATE SET name = $2, market = $3
      `;
      await pool.query(ensureStockSQL, [
        stockData.id,
        stockData.name || stockData.id,
        stockData.market || 'TSE'
      ]);

      // 儲存價格歷史
      const sql = `
        INSERT INTO price_history (stock_id, date, open_price, high_price, low_price, close_price, volume)
        VALUES ($1, CURRENT_DATE, $2, $3, $4, $5, $6)
        ON CONFLICT (stock_id, date) 
        DO UPDATE SET 
          open_price = $2, high_price = $3, low_price = $4, 
          close_price = $5, volume = $6
      `;

      await pool.query(sql, [
        stockData.id,
        stockData.open,
        stockData.high,
        stockData.low,
        stockData.price,
        stockData.volume
      ]);
      
      console.log(`✅ 已更新 ${stockData.id} ${stockData.name} 價格歷史`);
    } catch (error) {
      console.error('儲存價格歷史失敗:', error.message);
    }
  }

  /**
   * 儲存籌碼資料
   */
  async saveChipData(chipData) {
    if (!chipData) return;

    const sql = `
      INSERT INTO chip_data (stock_id, date, foreign_buy, investment_buy, dealer_buy)
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (stock_id, date) 
      DO UPDATE SET 
        foreign_buy = $3, investment_buy = $4, dealer_buy = $5
    `;

    try {
      await pool.query(sql, [
        chipData.stockId,
        chipData.date,
        chipData.foreign,
        chipData.investment,
        chipData.dealer
      ]);
    } catch (error) {
      console.error('儲存籌碼資料失敗:', error.message);
    }
  }

  /**
   * 取得價格歷史
   */
  async getPriceHistory(stockId, days = 60) {
    const sql = `
      SELECT * FROM price_history 
      WHERE stock_id = $1 
      ORDER BY date DESC 
      LIMIT $2
    `;

    const result = await pool.query(sql, [stockId, days]);
    return result.rows;
  }

  /**
   * 取得籌碼歷史
   */
  async getChipHistory(stockId, days = 30) {
    const sql = `
      SELECT * FROM chip_data 
      WHERE stock_id = $1 
      ORDER BY date DESC 
      LIMIT $2
    `;

    const result = await pool.query(sql, [stockId, days]);
    return result.rows;
  }

  /**
   * 取得排行榜資料
   */
  async getRanking(type = 'up') {
    try {
      // 使用熱門股票作為基礎
      const hotStocks = [
        '2330', '2317', '2454', '2308', '2382', '3231', '2303', '2412',
        '2881', '2882', '2891', '2886', '2884', '2603', '2609', '2615',
        '3034', '2379', '2357', '2376', '2377', '3661', '3443', '6669'
      ];
      
      const results = [];
      
      for (const stockId of hotStocks.slice(0, 15)) {
        try {
          const data = await this.getRealtimePrice(stockId);
          if (data && data.price > 0) {
            results.push({
              id: stockId,
              name: data.name || stockId,
              price: data.price,
              change: data.change || 0,
              changePercent: parseFloat(data.changePercent) || 0,
              volume: data.volume || 0
            });
          }
          await this.sleep(200);
        } catch (e) {}
      }
      
      // 根據類型排序
      if (type === 'up') {
        results.sort((a, b) => b.changePercent - a.changePercent);
      } else if (type === 'down') {
        results.sort((a, b) => a.changePercent - b.changePercent);
      } else if (type === 'volume') {
        results.sort((a, b) => b.volume - a.volume);
      }
      
      return results.slice(0, 10);
    } catch (error) {
      console.error('取得排行榜錯誤:', error.message);
      return [];
    }
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

module.exports = new StockService();
