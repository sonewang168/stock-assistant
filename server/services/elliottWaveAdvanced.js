/**
 * 🌊 艾略特波浪理論進階分析模組
 * Advanced Elliott Wave Analysis Module
 * 
 * 功能：
 * 1. 多時間框架分析（日/週/月）
 * 2. 子浪結構識別（1-2-3-4-5 子浪）
 * 3. 精細轉折點算法（多級別 ZigZag）
 * 4. 技術指標整合（MACD/RSI 背離判斷）
 * 5. 波浪延伸識別
 * 6. 詳細操作建議與風險管理
 * 7. 信心分數多維度評估
 */

// ========================================
// 🌊 艾略特波浪基礎知識庫
// ========================================

const WAVE_KNOWLEDGE = {
  // 波浪基本特徵
  characteristics: {
    1: {
      name: '第1浪（初升段）',
      alias: 'Wave 1 - Impulse Start',
      description: '趨勢開始的第一波上漲，通常因為一小群人認為價格便宜而買入。',
      marketState: '市場氣氛仍悲觀，多數人不相信上漲會持續。',
      psychology: '懷疑、觀望、少數人開始建倉',
      volumePattern: '成交量通常不大，溫和放量',
      pricePattern: '緩慢上漲，常被視為反彈',
      fibonacciRetrace: null, // 第1浪無回撤參考
      fibonacciExtension: '通常為整個推動浪的 0.382-0.618',
      typicalChange: '+10% ~ +30%',
      duration: '相對較短',
      reliability: 0.6, // 可靠度評分
      subwaves: '內部應有5個子浪（i-ii-iii-iv-v）',
      commonMistakes: ['誤認為反彈而錯過', '過早重倉'],
      keyIndicators: {
        rsi: '從超賣區回升，突破30',
        macd: '柱狀圖由負轉正',
        volume: '溫和放量'
      }
    },
    2: {
      name: '第2浪（回調段）',
      alias: 'Wave 2 - Corrective',
      description: '對第1浪的修正，持股者獲利了結導致價格下跌，但不會跌破第1浪起點。',
      marketState: '恐慌情緒蔓延，很多人認為漲勢已結束。',
      psychology: '恐慌、悲觀、多數人離場',
      volumePattern: '成交量萎縮',
      pricePattern: '急跌或緩跌，常為鋸齒形或平台形',
      fibonacciRetrace: '通常回撤第1浪的 0.382-0.786（最常見 0.618）',
      fibonacciExtension: null,
      typicalChange: '-38.2% ~ -78.6% (of Wave 1)',
      duration: '通常比第1浪短',
      reliability: 0.7,
      subwaves: '內部應有3個子浪（a-b-c）',
      commonMistakes: ['認為牛市結束而賣出', '沒有在回調時買入'],
      keyIndicators: {
        rsi: '回落但不破20',
        macd: '柱狀圖縮短',
        volume: '明顯萎縮'
      },
      rules: [
        '🔴 絕對不能跌破第1浪起點（鐵律）',
        '通常回撤 50%-61.8%',
        '常見形態：鋸齒形(Zigzag)、平台形(Flat)'
      ]
    },
    3: {
      name: '第3浪（主升段）',
      alias: 'Wave 3 - Strongest Impulse',
      description: '最強且最長的一波！股票吸引大眾目光，更多人開始買入。',
      marketState: '市場信心高漲，利多新聞頻傳，基本面改善。',
      psychology: '樂觀、貪婪、追漲',
      volumePattern: '成交量明顯放大，為最大量',
      pricePattern: '快速上漲，角度陡峭',
      fibonacciRetrace: null,
      fibonacciExtension: '通常為第1浪的 1.618-2.618（最常見 1.618）',
      typicalChange: '+50% ~ +200%',
      duration: '通常最長',
      reliability: 0.85,
      subwaves: '內部應有5個子浪（i-ii-iii-iv-v）',
      commonMistakes: ['過早獲利了結', '追高在子浪iii頂部'],
      keyIndicators: {
        rsi: '維持在50以上，常突破70',
        macd: '柱狀圖最長',
        volume: '最大成交量'
      },
      rules: [
        '🔴 絕對不是最短的推動浪（鐵律）',
        '通常是最長、最強的推動浪',
        '常出現跳空缺口'
      ]
    },
    4: {
      name: '第4浪（整理段）',
      alias: 'Wave 4 - Consolidation',
      description: '部分人獲利了結，價格回檔整理，為最後衝刺做準備。',
      marketState: '仍有人看好後市，回檔幅度有限。',
      psychology: '猶豫、分歧、部分人獲利了結',
      volumePattern: '成交量減少',
      pricePattern: '橫向整理或溫和下跌，常為三角形或平台形',
      fibonacciRetrace: '通常回撤第3浪的 0.236-0.50（最常見 0.382）',
      fibonacciExtension: null,
      typicalChange: '-23.6% ~ -50% (of Wave 3)',
      duration: '較長，橫向整理',
      reliability: 0.75,
      subwaves: '內部應有3個子浪（a-b-c）或三角形',
      commonMistakes: ['認為上漲結束', '在整理區間追漲殺跌'],
      keyIndicators: {
        rsi: '回落到40-50區間',
        macd: '柱狀圖縮短但仍為正',
        volume: '明顯萎縮'
      },
      rules: [
        '🔴 不能跌入第1浪的價格區間（鐵律）',
        '通常回撤 23.6%-38.2%',
        '常見形態：三角形、平台形、複雜形'
      ]
    },
    5: {
      name: '第5浪（末升段）',
      alias: 'Wave 5 - Final Push',
      description: '最後的上漲，通常較不理性，動能開始減弱。',
      marketState: '市場極度樂觀，CEO可能登上雜誌封面。',
      psychology: '瘋狂、過度樂觀、FOMO',
      volumePattern: '量價背離（價漲量縮）',
      pricePattern: '上漲但斜率變緩',
      fibonacciRetrace: null,
      fibonacciExtension: '通常為第1浪的 0.618-1.0，或與第1浪等長',
      typicalChange: '+20% ~ +50%',
      duration: '中等',
      reliability: 0.7,
      subwaves: '內部應有5個子浪（i-ii-iii-iv-v）',
      commonMistakes: ['過度樂觀繼續加碼', '忽視背離訊號'],
      keyIndicators: {
        rsi: '背離（價格新高但RSI未創新高）',
        macd: '背離（價格新高但MACD未創新高）',
        volume: '背離（價格新高但量能萎縮）'
      },
      rules: [
        '通常比第3浪弱',
        '常出現技術指標背離',
        '可能失敗（未創新高）'
      ]
    },
    'A': {
      name: 'A浪（下跌開始）',
      alias: 'Wave A - Decline Start',
      description: '下跌的開始，但多數人認為只是暫時回檔。',
      marketState: '投資者仍抱持希望，不願承認多頭結束。',
      psychology: '否認、希望、逢低買入',
      volumePattern: '成交量可能放大',
      pricePattern: '快速下跌',
      fibonacciRetrace: '通常回撤整個上升推動浪(1-5)的 0.382-0.50',
      fibonacciExtension: null,
      typicalChange: '-20% ~ -40%',
      duration: '快速',
      reliability: 0.65,
      subwaves: '內部可有5個子浪（衝擊型）或3個子浪（修正型）',
      commonMistakes: ['誤認為回檔而買入', '攤平持股'],
      keyIndicators: {
        rsi: '跌破50',
        macd: '死亡交叉',
        volume: '可能放大'
      }
    },
    'B': {
      name: 'B浪（反彈陷阱）',
      alias: 'Wave B - Bull Trap',
      description: '對A浪的反彈，但成交量不大，是「多頭陷阱」。',
      marketState: '投資者誤認為另一波漲勢，慘遭套牢。',
      psychology: '虛假樂觀、誤判、套牢',
      volumePattern: '成交量萎縮',
      pricePattern: '反彈但力道弱',
      fibonacciRetrace: '通常回彈A浪的 0.382-0.786',
      fibonacciExtension: null,
      typicalChange: '+10% ~ +30%',
      duration: '中等',
      reliability: 0.6,
      subwaves: '內部應有3個子浪（a-b-c）',
      commonMistakes: ['誤認為新一輪上漲', '追高買入'],
      keyIndicators: {
        rsi: '反彈但未突破50',
        macd: '柱狀圖縮短',
        volume: '萎縮'
      },
      rules: [
        '技術上最難辨識',
        '通常反彈幅度小於A浪跌幅',
        '是逃命最後機會'
      ]
    },
    'C': {
      name: 'C浪（主跌段）',
      alias: 'Wave C - Main Decline',
      description: '破壞力最強的下跌浪，跌勢強勁、跌幅大、持續時間久。',
      marketState: '恐慌性賣出，全面性下跌。',
      psychology: '恐慌、絕望、投降',
      volumePattern: '成交量放大',
      pricePattern: '急跌',
      fibonacciRetrace: null,
      fibonacciExtension: '通常為A浪的 1.0-1.618 倍',
      typicalChange: '-30% ~ -60%',
      duration: '較長',
      reliability: 0.8,
      subwaves: '內部應有5個子浪（i-ii-iii-iv-v）',
      commonMistakes: ['恐慌性賣出在底部', '未能識別底部訊號'],
      keyIndicators: {
        rsi: '跌入超賣區（<30）',
        macd: '柱狀圖最長（負值）',
        volume: '投降式放量'
      },
      rules: [
        '通常跌幅 = A浪的 1.0-1.618 倍',
        '常出現恐慌性賣盤',
        '結束後開始新的上升循環'
      ]
    }
  },

  // 斐波那契數列與比例
  fibonacci: {
    sequence: [0, 1, 1, 2, 3, 5, 8, 13, 21, 34, 55, 89, 144, 233, 377, 610],
    ratios: {
      retracement: [0.236, 0.382, 0.5, 0.618, 0.786],
      extension: [1.0, 1.272, 1.414, 1.618, 2.0, 2.618, 3.618, 4.236]
    },
    keyLevels: {
      0.236: '淺度回撤，強勢特徵',
      0.382: '正常回撤，常見於第4浪',
      0.5: '中度回撤，常見於第2浪',
      0.618: '黃金分割，最重要的回撤位',
      0.786: '深度回撤，接近極限',
      1.618: '黃金分割延伸，第3浪常見目標',
      2.618: '強勢延伸，第3浪延伸目標'
    }
  },

  // 波浪三大鐵律
  rules: {
    rule1: {
      name: '第2浪不跌破第1浪起點',
      description: '這是絕對的規則，如果違反則波浪計數錯誤',
      importance: '鐵律',
      violation: '必須重新計數'
    },
    rule2: {
      name: '第3浪不是最短推動浪',
      description: '在1、3、5三個推動浪中，第3浪絕對不會是最短的',
      importance: '鐵律',
      violation: '必須重新計數'
    },
    rule3: {
      name: '第4浪不重疊第1浪區間',
      description: '第4浪的低點不能進入第1浪的價格區間（槓桿市場例外）',
      importance: '鐵律',
      violation: '必須重新計數'
    }
  },

  // 波浪指引（不是鐵律但很常見）
  guidelines: {
    alternation: '第2浪與第4浪常呈現交替特性（一個急跌一個緩跌）',
    channeling: '1-3-5的高點和2-4的低點通常形成平行通道',
    equality: '如果第3浪延伸，則第1浪與第5浪傾向等長',
    extension: '1、3、5中通常有一個會延伸（最常見是第3浪）',
    fibonacci: '波浪之間的比例關係常呈現斐波那契比例'
  },

  // 波浪形態
  patterns: {
    impulse: {
      name: '推動浪',
      structure: '5-3-5-3-5',
      description: '由5個子浪組成，1、3、5為推動，2、4為修正'
    },
    diagonal: {
      name: '斜紋形',
      structure: '3-3-3-3-3',
      description: '楔形結構，常出現在第1浪或第5浪'
    },
    zigzag: {
      name: '鋸齒形',
      structure: '5-3-5',
      description: '最常見的修正形態，常出現在第2浪或A浪'
    },
    flat: {
      name: '平台形',
      structure: '3-3-5',
      description: '橫向整理形態，常出現在第4浪或B浪'
    },
    triangle: {
      name: '三角形',
      structure: '3-3-3-3-3',
      description: '收斂三角形，常出現在第4浪或B浪'
    }
  }
};

// ========================================
// 🔧 技術指標計算函數
// ========================================

/**
 * 計算 RSI
 */
function calculateRSI(closes, period = 14) {
  if (closes.length < period + 1) return 50;
  
  let gains = 0, losses = 0;
  
  for (let i = closes.length - period; i < closes.length; i++) {
    const change = closes[i] - closes[i - 1];
    if (change > 0) gains += change;
    else losses -= change;
  }
  
  const avgGain = gains / period;
  const avgLoss = losses / period;
  
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - (100 / (1 + rs));
}

/**
 * 計算 MACD
 */
function calculateMACD(closes, fast = 12, slow = 26, signal = 9) {
  if (closes.length < slow + signal) {
    return { macd: 0, signal: 0, histogram: 0 };
  }
  
  const emaFast = calculateEMA(closes, fast);
  const emaSlow = calculateEMA(closes, slow);
  const macdLine = emaFast - emaSlow;
  
  // 簡化：使用最近的 MACD 值
  const macdValues = [];
  for (let i = slow - 1; i < closes.length; i++) {
    const fastEma = calculateEMA(closes.slice(0, i + 1), fast);
    const slowEma = calculateEMA(closes.slice(0, i + 1), slow);
    macdValues.push(fastEma - slowEma);
  }
  
  const signalLine = calculateEMA(macdValues, signal);
  const histogram = macdLine - signalLine;
  
  return { macd: macdLine, signal: signalLine, histogram };
}

/**
 * 計算 EMA
 */
function calculateEMA(data, period) {
  if (data.length < period) return data[data.length - 1] || 0;
  
  const multiplier = 2 / (period + 1);
  let ema = data.slice(0, period).reduce((a, b) => a + b, 0) / period;
  
  for (let i = period; i < data.length; i++) {
    ema = (data[i] - ema) * multiplier + ema;
  }
  
  return ema;
}

/**
 * 計算簡單移動平均線
 */
function calculateSMA(data, period) {
  if (data.length < period) return data[data.length - 1] || 0;
  return data.slice(-period).reduce((a, b) => a + b, 0) / period;
}

/**
 * 計算標準差
 */
function calculateStdDev(data) {
  const mean = data.reduce((a, b) => a + b, 0) / data.length;
  const squaredDiffs = data.map(x => Math.pow(x - mean, 2));
  return Math.sqrt(squaredDiffs.reduce((a, b) => a + b, 0) / data.length);
}

/**
 * 計算 ATR (Average True Range)
 */
function calculateATR(history, period = 14) {
  if (history.length < period + 1) return 0;
  
  let trSum = 0;
  for (let i = history.length - period; i < history.length; i++) {
    const high = history[i].high;
    const low = history[i].low;
    const prevClose = history[i - 1]?.close || history[i].open;
    
    const tr = Math.max(
      high - low,
      Math.abs(high - prevClose),
      Math.abs(low - prevClose)
    );
    trSum += tr;
  }
  
  return trSum / period;
}

// ========================================
// 🆕 波浪分析優化函數（方案 1+2+3）
// ========================================

/**
 * 🔧 方案1：動態 ZigZag 閾值計算
 * 根據總漲跌幅決定適合的閾值
 */
function calculateDynamicZigZagThreshold(history) {
  const closes = history.map(h => h.close);
  const overallHigh = Math.max(...closes);
  const overallLow = Math.min(...closes);
  const totalChangePercent = ((overallHigh - overallLow) / overallLow) * 100;
  
  let threshold;
  let reason;
  
  if (totalChangePercent > 200) {
    // 大漲股（如南亞科 365%）：用 12% 過濾小波動
    threshold = 12;
    reason = `大漲股(${totalChangePercent.toFixed(0)}%)`;
  } else if (totalChangePercent > 100) {
    // 中漲股：用 10%
    threshold = 10;
    reason = `中漲股(${totalChangePercent.toFixed(0)}%)`;
  } else if (totalChangePercent > 30) {
    // 一般股：用 8%
    threshold = 8;
    reason = `一般股(${totalChangePercent.toFixed(0)}%)`;
  } else {
    // 小波動股：用 5%
    threshold = 5;
    reason = `小波動股(${totalChangePercent.toFixed(0)}%)`;
  }
  
  console.log(`📐 動態閾值: ${threshold}% (${reason})`);
  
  return {
    threshold,
    totalChangePercent,
    reason
  };
}

/**
 * 🔧 方案2：RSI 背離檢測
 * 檢測價格與 RSI 的背離現象
 */
function detectRSIDivergence(history, lookback = 30) {
  if (history.length < lookback + 14) {
    return { hasDivergence: false, type: null, confidence: 0 };
  }
  
  const closes = history.map(h => h.close);
  const recentCloses = closes.slice(-lookback);
  
  // 計算每天的 RSI
  const rsiValues = [];
  for (let i = 14; i <= closes.length; i++) {
    const rsi = calculateRSI(closes.slice(0, i), 14);
    rsiValues.push(rsi);
  }
  const recentRSI = rsiValues.slice(-lookback);
  
  // 找價格高點
  let priceHighIdx = 0;
  let priceHigh = recentCloses[0];
  for (let i = 1; i < recentCloses.length; i++) {
    if (recentCloses[i] > priceHigh) {
      priceHigh = recentCloses[i];
      priceHighIdx = i;
    }
  }
  
  // 找價格低點
  let priceLowIdx = 0;
  let priceLow = recentCloses[0];
  for (let i = 1; i < recentCloses.length; i++) {
    if (recentCloses[i] < priceLow) {
      priceLow = recentCloses[i];
      priceLowIdx = i;
    }
  }
  
  // 找 RSI 高點
  let rsiHighIdx = 0;
  let rsiHigh = recentRSI[0] || 50;
  for (let i = 1; i < recentRSI.length; i++) {
    if (recentRSI[i] > rsiHigh) {
      rsiHigh = recentRSI[i];
      rsiHighIdx = i;
    }
  }
  
  // 找 RSI 低點
  let rsiLowIdx = 0;
  let rsiLow = recentRSI[0] || 50;
  for (let i = 1; i < recentRSI.length; i++) {
    if (recentRSI[i] < rsiLow) {
      rsiLow = recentRSI[i];
      rsiLowIdx = i;
    }
  }
  
  const currentPrice = recentCloses[recentCloses.length - 1];
  const currentRSI = recentRSI[recentRSI.length - 1] || 50;
  
  // 頂背離：價格創新高，但 RSI 未創新高
  const isNearPriceHigh = currentPrice >= priceHigh * 0.98;
  const rsiNotAtHigh = currentRSI < rsiHigh * 0.95;
  const bearishDivergence = isNearPriceHigh && rsiNotAtHigh && priceHighIdx > lookback * 0.5;
  
  // 底背離：價格創新低，但 RSI 未創新低
  const isNearPriceLow = currentPrice <= priceLow * 1.02;
  const rsiNotAtLow = currentRSI > rsiLow * 1.05;
  const bullishDivergence = isNearPriceLow && rsiNotAtLow && priceLowIdx > lookback * 0.5;
  
  let result = { hasDivergence: false, type: null, confidence: 0 };
  
  if (bearishDivergence) {
    result = {
      hasDivergence: true,
      type: 'bearish',  // 頂背離（看跌）
      confidence: Math.min(90, 50 + (rsiHigh - currentRSI)),
      detail: `價格接近高點 ${priceHigh.toFixed(2)}，但 RSI(${currentRSI.toFixed(0)}) < 前高RSI(${rsiHigh.toFixed(0)})`
    };
  } else if (bullishDivergence) {
    result = {
      hasDivergence: true,
      type: 'bullish',  // 底背離（看漲）
      confidence: Math.min(90, 50 + (currentRSI - rsiLow)),
      detail: `價格接近低點 ${priceLow.toFixed(2)}，但 RSI(${currentRSI.toFixed(0)}) > 前低RSI(${rsiLow.toFixed(0)})`
    };
  }
  
  console.log(`📊 RSI背離檢測: ${result.hasDivergence ? result.type + '背離' : '無背離'}`);
  
  return result;
}

/**
 * 🔧 方案3：週線數據聚合
 * 將日線數據聚合為週線
 */
function aggregateToWeekly(history) {
  if (history.length < 5) return history;
  
  const weeklyData = [];
  let weekStart = null;
  let weekHigh = 0;
  let weekLow = Infinity;
  let weekOpen = 0;
  let weekClose = 0;
  let weekVolume = 0;
  
  for (let i = 0; i < history.length; i++) {
    const day = history[i];
    const date = new Date(day.date);
    const dayOfWeek = date.getDay(); // 0=週日, 1=週一, ..., 6=週六
    
    if (weekStart === null || dayOfWeek === 1) {
      // 新的一週開始（週一）或第一筆數據
      if (weekStart !== null) {
        // 儲存上一週數據
        weeklyData.push({
          date: weekStart,
          open: weekOpen,
          high: weekHigh,
          low: weekLow,
          close: weekClose,
          volume: weekVolume
        });
      }
      
      // 開始新一週
      weekStart = day.date;
      weekOpen = day.open || day.close;
      weekHigh = day.high || day.close;
      weekLow = day.low || day.close;
      weekClose = day.close;
      weekVolume = day.volume || 0;
    } else {
      // 同一週內，更新數據
      weekHigh = Math.max(weekHigh, day.high || day.close);
      weekLow = Math.min(weekLow, day.low || day.close);
      weekClose = day.close;
      weekVolume += day.volume || 0;
    }
  }
  
  // 儲存最後一週
  if (weekStart !== null) {
    weeklyData.push({
      date: weekStart,
      open: weekOpen,
      high: weekHigh,
      low: weekLow,
      close: weekClose,
      volume: weekVolume
    });
  }
  
  console.log(`📅 週線聚合: ${history.length} 日線 → ${weeklyData.length} 週線`);
  
  return weeklyData;
}

/**
 * 🔧 使用週線級別識別主要轉折點
 */
function findWeeklyPivots(history, threshold = 10) {
  const weeklyData = aggregateToWeekly(history);
  return findAdvancedPivotsCore(weeklyData, threshold);
}

/**
 * 🆕 核心轉折點識別（供日線和週線共用）
 */
function findAdvancedPivotsCore(data, threshold) {
  const pivots = [];
  if (data.length < 3) return pivots;
  
  const closes = data.map(h => h.close);
  
  let trend = null;
  let lastPivotPrice = closes[0];
  let lastPivotIdx = 0;
  
  // 加入起點
  pivots.push({
    type: 'start',
    price: closes[0],
    date: data[0].date,
    index: 0
  });
  
  for (let i = 1; i < data.length; i++) {
    const price = closes[i];
    const changeFromPivot = ((price - lastPivotPrice) / lastPivotPrice) * 100;
    
    if (trend === null) {
      // 初始化趨勢
      if (changeFromPivot >= threshold) {
        trend = 'up';
        pivots[pivots.length - 1].type = 'low';
      } else if (changeFromPivot <= -threshold) {
        trend = 'down';
        pivots[pivots.length - 1].type = 'high';
      }
    } else if (trend === 'up') {
      if (price > lastPivotPrice) {
        // 繼續上漲，更新臨時高點
        lastPivotPrice = price;
        lastPivotIdx = i;
      } else if (changeFromPivot <= -threshold) {
        // 轉向下跌，確認高點
        pivots.push({
          type: 'high',
          price: lastPivotPrice,
          date: data[lastPivotIdx].date,
          index: lastPivotIdx
        });
        trend = 'down';
        lastPivotPrice = price;
        lastPivotIdx = i;
      }
    } else if (trend === 'down') {
      if (price < lastPivotPrice) {
        // 繼續下跌，更新臨時低點
        lastPivotPrice = price;
        lastPivotIdx = i;
      } else if (changeFromPivot >= threshold) {
        // 轉向上漲，確認低點
        pivots.push({
          type: 'low',
          price: lastPivotPrice,
          date: data[lastPivotIdx].date,
          index: lastPivotIdx
        });
        trend = 'up';
        lastPivotPrice = price;
        lastPivotIdx = i;
      }
    }
  }
  
  // 加入終點
  const lastClose = closes[closes.length - 1];
  const lastPivot = pivots[pivots.length - 1];
  if (lastPivot && Math.abs((lastClose - lastPivot.price) / lastPivot.price * 100) > threshold * 0.5) {
    pivots.push({
      type: trend === 'up' ? 'high' : 'low',
      price: lastClose,
      date: data[data.length - 1].date,
      index: data.length - 1
    });
  }
  
  return pivots;
}

/**
 * 🆕 綜合波浪判斷（整合方案1+2+3）
 */
function determineWaveWithEnhancedLogic(waves, currentPrice, history) {
  if (!history || history.length === 0) return { wave: 1, confidence: 50, reason: '數據不足' };
  
  const closes = history.map(h => h.close);
  const overallHigh = Math.max(...closes);
  const overallLow = Math.min(...closes);
  const startPrice = closes[0];
  
  // 計算關鍵指標
  const totalChangeFromLow = ((currentPrice - overallLow) / overallLow) * 100;
  const totalChangeFromStart = ((currentPrice - startPrice) / startPrice) * 100;
  const pullbackFromHigh = ((overallHigh - currentPrice) / overallHigh) * 100;
  const pricePosition = (currentPrice - overallLow) / (overallHigh - overallLow);
  
  // RSI 背離檢測
  const divergence = detectRSIDivergence(history, 30);
  
  // 週線級別分析
  const weeklyPivots = findWeeklyPivots(history, 10);
  const weeklyWaveCount = Math.max(1, weeklyPivots.length - 1);
  
  console.log(`🌊 綜合判斷: 從低點漲=${totalChangeFromLow.toFixed(1)}%, 回撤=${pullbackFromHigh.toFixed(1)}%, 週線波浪數=${weeklyWaveCount}, RSI背離=${divergence.type || '無'}`);
  
  let wave, confidence, reason;
  
  // 🔑 方案2：根據漲幅特徵判斷
  if (totalChangeFromLow > 200) {
    // 大漲 > 200%
    if (divergence.hasDivergence && divergence.type === 'bearish') {
      // 有頂背離 → 可能是第 5 浪末端
      wave = 5;
      confidence = 75;
      reason = `大漲${totalChangeFromLow.toFixed(0)}%且有RSI頂背離，可能第5浪末端`;
    } else if (pullbackFromHigh < 10 && pricePosition > 0.9) {
      // 接近高點且無背離 → 第 3 浪延伸中
      wave = 3;
      confidence = 85;
      reason = `大漲${totalChangeFromLow.toFixed(0)}%，接近高點，無背離，第3浪延伸中`;
    } else if (pullbackFromHigh >= 10 && pullbackFromHigh < 25) {
      // 小回調 10-25% → 可能是第 3 浪整理
      wave = 3;
      confidence = 80;
      reason = `大漲後回調${pullbackFromHigh.toFixed(0)}%，第3浪整理中`;
    } else if (pullbackFromHigh >= 25 && pullbackFromHigh < 40) {
      // 中等回調 25-40% → 可能是第 4 浪
      wave = 4;
      confidence = 70;
      reason = `大漲後回調${pullbackFromHigh.toFixed(0)}%，可能進入第4浪`;
    } else if (pullbackFromHigh >= 40) {
      // 深度回調 > 40% → 可能進入 ABC 修正
      wave = 'A';
      confidence = 65;
      reason = `大漲後深度回調${pullbackFromHigh.toFixed(0)}%，可能進入ABC修正`;
    } else {
      wave = 3;
      confidence = 80;
      reason = `大漲${totalChangeFromLow.toFixed(0)}%，主升段進行中`;
    }
  } else if (totalChangeFromLow > 100) {
    // 中等漲幅 100-200%
    if (divergence.hasDivergence && divergence.type === 'bearish') {
      wave = 5;
      confidence = 70;
      reason = `中等漲幅${totalChangeFromLow.toFixed(0)}%且有RSI頂背離`;
    } else if (pricePosition > 0.8) {
      wave = 3;
      confidence = 75;
      reason = `中等漲幅${totalChangeFromLow.toFixed(0)}%，價格在高位，第3浪`;
    } else if (pricePosition > 0.5) {
      wave = pullbackFromHigh > 15 ? 4 : 3;
      confidence = 70;
      reason = `中等漲幅，價格在中位，回調${pullbackFromHigh.toFixed(0)}%`;
    } else {
      wave = 2;
      confidence = 65;
      reason = `中等漲幅但價格在低位，可能回調中`;
    }
  } else if (totalChangeFromLow > 30) {
    // 小漲幅 30-100%
    if (pricePosition > 0.8) {
      wave = weeklyWaveCount >= 3 ? 3 : 1;
      confidence = 70;
      reason = `小漲幅${totalChangeFromLow.toFixed(0)}%，價格在高位`;
    } else if (pricePosition > 0.4) {
      wave = 1;
      confidence = 65;
      reason = `小漲幅，可能在第1浪`;
    } else {
      wave = 2;
      confidence = 60;
      reason = `小漲幅但價格在低位，可能回調中`;
    }
  } else if (totalChangeFromStart < -20) {
    // 下跌中
    if (pullbackFromHigh > 50) {
      wave = 'C';
      confidence = 70;
      reason = `深度下跌${pullbackFromHigh.toFixed(0)}%，可能在C浪`;
    } else if (divergence.hasDivergence && divergence.type === 'bullish') {
      wave = 'C';
      confidence = 75;
      reason = `下跌中有底背離，C浪可能接近尾聲`;
    } else {
      wave = 'A';
      confidence = 65;
      reason = `下跌中，可能在A浪`;
    }
  } else {
    // 小幅波動
    if (waves && waves.length > 0) {
      const lastWave = waves[waves.length - 1];
      const nextWaveMap = { 1: 2, 2: 3, 3: 4, 4: 5, 5: 'A', 'A': 'B', 'B': 'C', 'C': 1 };
      wave = nextWaveMap[lastWave.wave] || 1;
      confidence = 55;
      reason = `小幅波動，依序列判斷`;
    } else {
      wave = 1;
      confidence = 50;
      reason = `小幅波動，預設第1浪`;
    }
  }
  
  // 🔧 方案3：用週線驗證
  if (weeklyWaveCount <= 2 && wave > 3 && typeof wave === 'number') {
    // 週線只有 1-2 個波浪，但判斷為 4、5 浪 → 可能過度解讀
    console.log(`⚠️ 週線驗證：週線僅 ${weeklyWaveCount} 浪，下調波浪判斷`);
    wave = Math.min(wave, 3);
    confidence = Math.max(50, confidence - 10);
    reason += `（週線驗證下調）`;
  }
  
  return { wave, confidence, reason, divergence, weeklyWaveCount };
}

// ========================================
// 🔍 進階轉折點識別
// ========================================

/**
 * 多級別 ZigZag 轉折點識別
 * @param {Array} history - 歷史資料
 * @param {number} threshold - 轉折閾值（百分比）
 * @returns {Array} 轉折點陣列
 */
function findAdvancedPivots(history, threshold = 5) {
  // 🆕 使用動態閾值
  const dynamicResult = calculateDynamicZigZagThreshold(history);
  const effectiveThreshold = Math.max(threshold, dynamicResult.threshold);
  
  console.log(`📊 ZigZag: 傳入閾值=${threshold}%, 動態閾值=${dynamicResult.threshold}%, 使用=${effectiveThreshold}%`);
  
  return findAdvancedPivotsCore(history, effectiveThreshold);
}

// ========================================
// 🌊 進階波浪結構分析
// ========================================

/**
 * 分析波浪結構（進階版）
 */
function analyzeWaveStructureAdvanced(pivots, currentPrice, history) {
  const waves = [];
  
  if (pivots.length < 2) {
    return createDefaultWaveStructure(history, currentPrice);
  }
  
  // 判斷主趨勢
  const firstPivot = pivots[0];
  const lastPivot = pivots[pivots.length - 1];
  const isUptrend = lastPivot.price > firstPivot.price;
  
  // 重新組織轉折點
  let organizedPivots = reorganizePivots(pivots, isUptrend);
  
  // 波浪標記
  let waveCount = 1;
  let lastP = null;
  const waveRatios = [];
  
  for (let i = 0; i < organizedPivots.length; i++) {
    const pivot = organizedPivots[i];
    
    if (lastP) {
      const isRising = pivot.price > lastP.price;
      const changePercent = ((pivot.price - lastP.price) / lastP.price * 100);
      const absChange = Math.abs(changePercent);
      
      // 計算與前一浪的比例
      let fibRatio = null;
      if (waves.length > 0) {
        const prevWave = waves[waves.length - 1];
        const prevRange = Math.abs(prevWave.end - prevWave.start);
        const currRange = Math.abs(pivot.price - lastP.price);
        if (prevRange > 0) {
          const ratio = currRange / prevRange;
          fibRatio = findClosestFibRatio(ratio);
        }
      }
      
      // 波浪命名
      const { waveName, waveType } = determineWaveName(waveCount, isUptrend, isRising);
      
      waves.push({
        wave: waveName,
        type: waveType,
        direction: isRising ? 'up' : 'down',
        start: lastP.price,
        end: pivot.price,
        startDate: lastP.date,
        endDate: pivot.date,
        startIndex: lastP.index,
        endIndex: pivot.index,
        change: changePercent.toFixed(2),
        absChange: absChange.toFixed(2),
        fibRatio: fibRatio,
        duration: pivot.index - lastP.index
      });
      
      waveCount++;
      // 🔧 波浪週期結束時重置（但保留所有波浪用於後續篩選）
      if (waveCount > 8) waveCount = 1;
    }
    
    lastP = pivot;
  }
  
  // 🆕 只保留最後一個完整週期的波浪（避免重複標記）
  const lastCycleWaves = getLastCycleWaves(waves);
  
  // 分析子浪結構
  const subwaveAnalysis = analyzeSubwaves(lastCycleWaves, history);
  
  // 判斷當前波浪位置（使用最後週期的波浪）
  const currentWave = determineCurrentWaveAdvanced(lastCycleWaves, currentPrice, history);
  
  // 計算波浪統計
  const waveStats = calculateWaveStatistics(lastCycleWaves);
  
  return {
    currentWave,
    waves: lastCycleWaves.length > 0 ? lastCycleWaves : createDefaultWaves(history, currentPrice),
    allWaves: waves,  // 保留完整波浪歷史（用於詳細分析）
    pivots: organizedPivots,
    isUptrend,
    subwaves: subwaveAnalysis,
    statistics: waveStats
  };
}

/**
 * 🆕 取得最後一個完整週期的波浪
 * 艾略特波浪：1-2-3-4-5（推動）+ A-B-C（修正）= 8 浪
 */
function getLastCycleWaves(waves) {
  if (waves.length <= 8) {
    return waves;
  }
  
  // 找到最後一個「第1浪」的位置，作為最後週期的開始
  let lastCycleStart = 0;
  for (let i = waves.length - 1; i >= 0; i--) {
    if (waves[i].wave === 1 || waves[i].wave === '1') {
      lastCycleStart = i;
      break;
    }
  }
  
  // 如果找不到第1浪，找最後一個 A 浪作為起點
  if (lastCycleStart === 0 && waves.length > 8) {
    for (let i = waves.length - 1; i >= 0; i--) {
      if (waves[i].wave === 'A') {
        lastCycleStart = Math.max(0, i - 5);  // A 浪前面可能有 1-5
        break;
      }
    }
  }
  
  // 返回最後週期的波浪（最多 8 個）
  const lastCycle = waves.slice(lastCycleStart);
  return lastCycle.slice(-8);  // 確保最多 8 個
}

/**
 * 重新組織轉折點
 */
function reorganizePivots(pivots, isUptrend) {
  if (isUptrend) {
    // 上升趨勢：找到最低點作為起點
    const lowIdx = pivots.reduce((minIdx, p, idx, arr) => 
      p.price < arr[minIdx].price ? idx : minIdx, 0);
    return pivots.slice(lowIdx);
  } else {
    // 下降趨勢：找到最高點作為起點
    const highIdx = pivots.reduce((maxIdx, p, idx, arr) => 
      p.price > arr[maxIdx].price ? idx : maxIdx, 0);
    return pivots.slice(highIdx);
  }
}

/**
 * 確定波浪名稱
 */
function determineWaveName(waveCount, isUptrend, isRising) {
  let waveName, waveType;
  
  // 🔧 艾略特波浪序列：1(↑) → 2(↓) → 3(↑) → 4(↓) → 5(↑) → A(↓) → B(↑) → C(↓)
  const waveSequence = [
    { label: 1, expectedDir: 'up', type: '推動' },
    { label: 2, expectedDir: 'down', type: '修正' },
    { label: 3, expectedDir: 'up', type: '推動' },
    { label: 4, expectedDir: 'down', type: '修正' },
    { label: 5, expectedDir: 'up', type: '推動' },
    { label: 'A', expectedDir: 'down', type: '修正' },
    { label: 'B', expectedDir: 'up', type: '反彈' },
    { label: 'C', expectedDir: 'down', type: '修正' }
  ];
  
  const actualDir = isRising ? 'up' : 'down';
  const seqIndex = (waveCount - 1) % 8;
  const expectedSeq = waveSequence[seqIndex];
  
  // 🔑 如果方向符合預期，使用正常序列
  if (actualDir === expectedSeq.expectedDir) {
    waveName = expectedSeq.label;
    waveType = expectedSeq.type;
  } else {
    // 方向不符合，使用實際方向對應的波浪
    // 上漲：1, 3, 5, B
    // 下跌：2, 4, A, C
    if (isRising) {
      // 上漲但預期是下跌 → 可能是 B 浪反彈或新週期的推動浪
      if (waveCount >= 6) {
        waveName = 'B';
        waveType = '反彈';
      } else {
        waveName = waveCount;
        waveType = '推動';
      }
    } else {
      // 下跌但預期是上漲 → 可能是修正浪
      if (waveCount > 5) {
        waveName = seqIndex === 5 ? 'A' : 'C';
        waveType = '修正';
      } else {
        waveName = waveCount;
        waveType = '修正';
      }
    }
  }
  
  return { waveName, waveType };
}

/**
 * 找到最接近的斐波那契比例
 */
function findClosestFibRatio(ratio) {
  const allFibLevels = [0.236, 0.382, 0.5, 0.618, 0.786, 1.0, 1.272, 1.618, 2.0, 2.618];
  
  let closest = allFibLevels[0];
  let minDiff = Math.abs(ratio - closest);
  
  for (const fib of allFibLevels) {
    const diff = Math.abs(ratio - fib);
    if (diff < minDiff) {
      minDiff = diff;
      closest = fib;
    }
  }
  
  return {
    ratio: ratio.toFixed(3),
    closestFib: closest,
    accuracy: Math.round((1 - minDiff / closest) * 100)
  };
}

/**
 * 分析子浪結構
 */
function analyzeSubwaves(waves, history) {
  // 簡化版：返回子浪數量估計
  return waves.map(w => {
    const duration = w.duration || 10;
    const expectedSubwaves = w.type === '推動' ? 5 : 3;
    return {
      wave: w.wave,
      expectedSubwaves,
      estimatedSubwaves: Math.min(expectedSubwaves, Math.floor(duration / 5) + 1)
    };
  });
}

/**
 * 計算波浪統計
 */
function calculateWaveStatistics(waves) {
  if (waves.length === 0) return {};
  
  const changes = waves.map(w => parseFloat(w.absChange));
  const durations = waves.map(w => w.duration || 0);
  
  return {
    totalWaves: waves.length,
    avgChange: (changes.reduce((a, b) => a + b, 0) / changes.length).toFixed(2),
    maxChange: Math.max(...changes).toFixed(2),
    minChange: Math.min(...changes).toFixed(2),
    avgDuration: Math.round(durations.reduce((a, b) => a + b, 0) / durations.length),
    impulseWaves: waves.filter(w => w.type === '推動').length,
    correctiveWaves: waves.filter(w => w.type !== '推動').length
  };
}

/**
 * 創建預設波浪結構
 */
function createDefaultWaveStructure(history, currentPrice) {
  const closes = history.map(h => h.close);
  const high = Math.max(...closes);
  const low = Math.min(...closes);
  const highIdx = closes.indexOf(high);
  const lowIdx = closes.indexOf(low);
  const isUptrend = currentPrice > (high + low) / 2;
  
  // 🔧 生成更準確的波浪結構
  const waves = createSmartWaves(history, currentPrice);
  
  // 根據波浪結構判斷當前位置
  let currentWave = 1;
  if (waves.length > 0) {
    const lastWave = waves[waves.length - 1];
    const nextWaveMap = {
      1: 2, 2: 3, 3: 4, 4: 5, 5: 'A',
      'A': 'B', 'B': 'C', 'C': 1
    };
    currentWave = nextWaveMap[lastWave.wave] || 1;
  }
  
  return {
    currentWave,
    waves,
    pivots: [],
    isUptrend,
    subwaves: [],
    statistics: {}
  };
}

/**
 * 🆕 智能生成波浪結構（改進版）
 * 根據價格走勢自動識別關鍵轉折點
 */
function createSmartWaves(history, currentPrice) {
  if (history.length < 20) return [];
  
  const closes = history.map(h => h.close);
  const highs = history.map(h => h.high || h.close);
  const lows = history.map(h => h.low || h.close);
  
  // 找到關鍵點位
  const overallHigh = Math.max(...closes);
  const overallLow = Math.min(...closes);
  const highIdx = closes.indexOf(overallHigh);
  const lowIdx = closes.indexOf(overallLow);
  
  // 計算總漲跌幅
  const startPrice = closes[0];
  const endPrice = currentPrice;
  const totalChange = (endPrice - startPrice) / startPrice * 100;
  
  const waves = [];
  
  // 使用較小的閾值來找轉折點
  const range = overallHigh - overallLow;
  const smallThreshold = range * 0.1; // 10% of range
  
  // 找到所有顯著轉折點
  const pivots = findSignificantPivots(history, smallThreshold);
  
  if (pivots.length >= 2) {
    // 根據轉折點生成波浪
    let waveNum = 1;
    for (let i = 1; i < pivots.length && waveNum <= 8; i++) {
      const prev = pivots[i - 1];
      const curr = pivots[i];
      const isRising = curr.price > prev.price;
      
      let waveName, waveType;
      if (waveNum <= 5) {
        waveName = waveNum;
        waveType = (waveNum % 2 === 1) ? '推動' : '修正';
      } else {
        const abcNames = ['A', 'B', 'C'];
        waveName = abcNames[waveNum - 6] || 'C';
        waveType = waveName === 'B' ? '反彈' : '修正';
      }
      
      waves.push({
        wave: waveName,
        type: waveType,
        direction: isRising ? 'up' : 'down',
        start: prev.price,
        end: curr.price,
        startDate: history[prev.index]?.date,
        endDate: history[curr.index]?.date,
        startIndex: prev.index,
        endIndex: curr.index,
        change: ((curr.price - prev.price) / prev.price * 100).toFixed(2)
      });
      
      waveNum++;
    }
  }
  
  // 如果還是沒有波浪，生成基本結構
  if (waves.length === 0) {
    // 根據趨勢生成基本波浪
    if (totalChange > 50) {
      // 大漲：可能是第3浪
      waves.push({
        wave: 1,
        type: '推動',
        direction: 'up',
        start: overallLow,
        end: overallLow + range * 0.3,
        startIndex: lowIdx,
        endIndex: Math.min(lowIdx + Math.floor(history.length * 0.2), history.length - 1),
        startDate: history[lowIdx]?.date,
        endDate: history[Math.min(lowIdx + Math.floor(history.length * 0.2), history.length - 1)]?.date,
        change: '30'
      });
      waves.push({
        wave: 2,
        type: '修正',
        direction: 'down',
        start: overallLow + range * 0.3,
        end: overallLow + range * 0.15,
        startIndex: Math.min(lowIdx + Math.floor(history.length * 0.2), history.length - 1),
        endIndex: Math.min(lowIdx + Math.floor(history.length * 0.35), history.length - 1),
        startDate: history[Math.min(lowIdx + Math.floor(history.length * 0.2), history.length - 1)]?.date,
        endDate: history[Math.min(lowIdx + Math.floor(history.length * 0.35), history.length - 1)]?.date,
        change: '-15'
      });
      waves.push({
        wave: 3,
        type: '推動',
        direction: 'up',
        start: overallLow + range * 0.15,
        end: overallHigh,
        startIndex: Math.min(lowIdx + Math.floor(history.length * 0.35), history.length - 1),
        endIndex: highIdx,
        startDate: history[Math.min(lowIdx + Math.floor(history.length * 0.35), history.length - 1)]?.date,
        endDate: history[highIdx]?.date,
        change: ((overallHigh - (overallLow + range * 0.15)) / (overallLow + range * 0.15) * 100).toFixed(2)
      });
      
      // 如果現價低於高點，加入第4浪或第5浪
      if (currentPrice < overallHigh * 0.95) {
        waves.push({
          wave: 4,
          type: '修正',
          direction: 'down',
          start: overallHigh,
          end: currentPrice,
          startIndex: highIdx,
          endIndex: history.length - 1,
          startDate: history[highIdx]?.date,
          endDate: history[history.length - 1]?.date,
          change: ((currentPrice - overallHigh) / overallHigh * 100).toFixed(2)
        });
      }
    } else if (totalChange > 0) {
      // 小漲：可能是第1浪
      waves.push({
        wave: 1,
        type: '推動',
        direction: 'up',
        start: overallLow,
        end: currentPrice,
        startIndex: lowIdx,
        endIndex: history.length - 1,
        startDate: history[lowIdx]?.date,
        endDate: history[history.length - 1]?.date,
        change: totalChange.toFixed(2)
      });
    } else {
      // 下跌：可能是 A 浪
      waves.push({
        wave: 'A',
        type: '修正',
        direction: 'down',
        start: overallHigh,
        end: currentPrice,
        startIndex: highIdx,
        endIndex: history.length - 1,
        startDate: history[highIdx]?.date,
        endDate: history[history.length - 1]?.date,
        change: totalChange.toFixed(2)
      });
    }
  }
  
  return waves;
}

/**
 * 🆕 找到顯著的轉折點
 */
function findSignificantPivots(history, threshold) {
  const pivots = [];
  const closes = history.map(h => h.close);
  const highs = history.map(h => h.high || h.close);
  const lows = history.map(h => h.low || h.close);
  
  if (history.length < 5) return pivots;
  
  let trend = null;
  let lastPivotPrice = closes[0];
  let lastPivotIdx = 0;
  
  for (let i = 1; i < history.length; i++) {
    const high = highs[i];
    const low = lows[i];
    const close = closes[i];
    
    if (trend === null) {
      if (close > lastPivotPrice + threshold) {
        trend = 'up';
        pivots.push({ type: 'low', price: lastPivotPrice, index: lastPivotIdx });
      } else if (close < lastPivotPrice - threshold) {
        trend = 'down';
        pivots.push({ type: 'high', price: lastPivotPrice, index: lastPivotIdx });
      }
    } else if (trend === 'up') {
      if (high > lastPivotPrice) {
        lastPivotPrice = high;
        lastPivotIdx = i;
      }
      if (close < lastPivotPrice - threshold) {
        pivots.push({ type: 'high', price: lastPivotPrice, index: lastPivotIdx });
        trend = 'down';
        lastPivotPrice = low;
        lastPivotIdx = i;
      }
    } else {
      if (low < lastPivotPrice) {
        lastPivotPrice = low;
        lastPivotIdx = i;
      }
      if (close > lastPivotPrice + threshold) {
        pivots.push({ type: 'low', price: lastPivotPrice, index: lastPivotIdx });
        trend = 'up';
        lastPivotPrice = high;
        lastPivotIdx = i;
      }
    }
  }
  
  // 加入最後一個點
  if (pivots.length > 0) {
    const lastPivot = pivots[pivots.length - 1];
    if (lastPivot.type === 'high') {
      pivots.push({ type: 'low', price: Math.min(...lows.slice(-5)), index: history.length - 1 });
    } else {
      pivots.push({ type: 'high', price: Math.max(...highs.slice(-5)), index: history.length - 1 });
    }
  }
  
  return pivots;
}

/**
 * 創建預設波浪（舊版保留向後相容）
 */
function createDefaultWaves(history, currentPrice) {
  return createSmartWaves(history, currentPrice);
}

// ========================================
// 🎯 當前波浪判斷（進階版）
// ========================================

/**
 * 判斷當前波浪位置（進階版）
 * 🔧 主要改進：根據總漲幅和波浪結構來判斷
 */
function determineCurrentWaveAdvanced(waves, currentPrice, history) {
  // 🆕 使用增強版邏輯（方案1+2+3）
  const result = determineWaveWithEnhancedLogic(waves, currentPrice, history);
  
  console.log(`🌊 波浪判斷結果: 第${result.wave}浪, 信心度=${result.confidence}%, 原因=${result.reason}`);
  
  // 返回波浪編號（保持向後兼容）
  return result.wave;
}

// ========================================
// 📊 進階規則檢查
// ========================================

/**
 * 波浪規則檢查（進階版）
 */
function checkWaveRulesAdvanced(waveAnalysis) {
  const waves = waveAnalysis.waves;
  
  // 三大鐵律
  const rules = [
    { 
      rule: '第2浪不跌破第1浪起點', 
      pass: true, 
      importance: '鐵律',
      detail: ''
    },
    { 
      rule: '第3浪不是最短推動浪', 
      pass: true, 
      importance: '鐵律',
      detail: ''
    },
    { 
      rule: '第4浪不重疊第1浪區間', 
      pass: true, 
      importance: '鐵律',
      detail: ''
    }
  ];
  
  // 找出各浪
  const wave1 = waves.find(w => w.wave === 1);
  const wave2 = waves.find(w => w.wave === 2);
  const wave3 = waves.find(w => w.wave === 3);
  const wave4 = waves.find(w => w.wave === 4);
  const wave5 = waves.find(w => w.wave === 5);
  
  // 規則1檢查
  if (wave1 && wave2) {
    if (wave1.direction === 'up') {
      rules[0].pass = wave2.end >= wave1.start;
      rules[0].detail = `W1起點: ${wave1.start.toFixed(1)}, W2低點: ${wave2.end.toFixed(1)}`;
    } else {
      rules[0].pass = wave2.end <= wave1.start;
    }
  }
  
  // 規則2檢查
  if (wave1 && wave3 && wave5) {
    const w1Len = Math.abs(parseFloat(wave1.change));
    const w3Len = Math.abs(parseFloat(wave3.change));
    const w5Len = Math.abs(parseFloat(wave5.change));
    
    rules[1].pass = w3Len >= w1Len || w3Len >= w5Len;
    rules[1].detail = `W1: ${w1Len.toFixed(1)}%, W3: ${w3Len.toFixed(1)}%, W5: ${w5Len.toFixed(1)}%`;
  } else if (wave1 && wave3) {
    const w1Len = Math.abs(parseFloat(wave1.change));
    const w3Len = Math.abs(parseFloat(wave3.change));
    rules[1].pass = w3Len >= w1Len;
    rules[1].detail = `W1: ${w1Len.toFixed(1)}%, W3: ${w3Len.toFixed(1)}%`;
  }
  
  // 規則3檢查
  if (wave1 && wave4) {
    if (wave1.direction === 'up') {
      rules[2].pass = wave4.end > wave1.end;
      rules[2].detail = `W1頂點: ${wave1.end.toFixed(1)}, W4低點: ${wave4.end.toFixed(1)}`;
    } else {
      rules[2].pass = wave4.end < wave1.end;
    }
  }
  
  // 額外指引檢查
  const guidelines = [];
  
  // 交替原則
  if (wave2 && wave4) {
    const w2Sharp = Math.abs(parseFloat(wave2.change)) > 10;
    const w4Sharp = Math.abs(parseFloat(wave4.change)) > 10;
    const alternates = w2Sharp !== w4Sharp;
    guidelines.push({
      guideline: '交替原則（第2浪與第4浪形態不同）',
      follows: alternates,
      detail: `W2: ${w2Sharp ? '急跌' : '緩跌'}, W4: ${w4Sharp ? '急跌' : '緩跌'}`
    });
  }
  
  // 第3浪延伸
  if (wave1 && wave3) {
    const ratio = Math.abs(parseFloat(wave3.change)) / Math.abs(parseFloat(wave1.change));
    const isExtended = ratio >= 1.618;
    guidelines.push({
      guideline: '第3浪延伸（≥1.618倍W1）',
      follows: isExtended,
      detail: `W3/W1 = ${ratio.toFixed(2)}`
    });
  }
  
  return { rules, guidelines };
}

// ========================================
// 🎯 目標價計算（進階版）
// ========================================

/**
 * 計算目標價位（進階版）
 */
function calculateTargetsAdvanced(waveAnalysis, currentPrice, history) {
  const waves = waveAnalysis.waves;
  const currentWave = waveAnalysis.currentWave;
  
  let targetUp = currentPrice * 1.1;
  let targetDown = currentPrice * 0.9;
  let stopLoss = currentPrice * 0.95;
  let fibLevels = [];
  
  // 找關鍵波浪
  const wave1 = waves.find(w => w.wave === 1);
  const wave2 = waves.find(w => w.wave === 2);
  const wave3 = waves.find(w => w.wave === 3);
  const wave4 = waves.find(w => w.wave === 4);
  const waveA = waves.find(w => w.wave === 'A');
  
  // 根據當前波浪計算目標
  if (typeof currentWave === 'number') {
    switch (currentWave) {
      case 1:
        // 第1浪：預估第3浪目標
        if (wave1) {
          const w1Range = Math.abs(wave1.end - wave1.start);
          targetUp = wave1.end + w1Range * 1.618; // 第3浪 = W1 * 1.618
          targetDown = wave1.start; // 第2浪回撤不破W1起點
          stopLoss = wave1.start * 0.98;
        }
        break;
        
      case 2:
        // 第2浪：進場點計算
        if (wave1) {
          const w1Range = wave1.end - wave1.start;
          targetUp = wave1.end + w1Range * 1.618; // 第3浪目標
          targetDown = wave1.start + w1Range * 0.382; // 可能的W2低點
          stopLoss = wave1.start;
          
          // 斐波那契回撤位
          fibLevels = [
            { level: 0.382, price: wave1.end - w1Range * 0.382, label: '38.2% 回撤' },
            { level: 0.5, price: wave1.end - w1Range * 0.5, label: '50% 回撤' },
            { level: 0.618, price: wave1.end - w1Range * 0.618, label: '61.8% 回撤' },
            { level: 0.786, price: wave1.end - w1Range * 0.786, label: '78.6% 回撤' }
          ];
        }
        break;
        
      case 3:
        // 第3浪：持有目標
        if (wave1) {
          const w1Range = Math.abs(wave1.end - wave1.start);
          targetUp = wave1.end + w1Range * 2.618; // 第3浪延伸目標
          targetDown = wave1.end; // 第4浪支撐
          stopLoss = wave2 ? wave2.end * 0.98 : wave1.end * 0.95;
          
          fibLevels = [
            { level: 1.618, price: wave1.start + w1Range * 1.618, label: '161.8% 延伸' },
            { level: 2.0, price: wave1.start + w1Range * 2.0, label: '200% 延伸' },
            { level: 2.618, price: wave1.start + w1Range * 2.618, label: '261.8% 延伸' }
          ];
        }
        break;
        
      case 4:
        // 第4浪：等待進場
        if (wave1 && wave3) {
          const w3Range = Math.abs(wave3.end - wave3.start);
          targetUp = wave3.end + w3Range * 0.618; // 第5浪目標
          targetDown = wave3.end - w3Range * 0.382; // W4 回撤
          stopLoss = wave1.end; // W4 不能跌破 W1 頂點
          
          fibLevels = [
            { level: 0.236, price: wave3.end - w3Range * 0.236, label: '23.6% 回撤' },
            { level: 0.382, price: wave3.end - w3Range * 0.382, label: '38.2% 回撤' },
            { level: 0.5, price: wave3.end - w3Range * 0.5, label: '50% 回撤' }
          ];
        }
        break;
        
      case 5:
        // 第5浪：準備出場
        if (wave1 && wave3) {
          const w1Range = Math.abs(wave1.end - wave1.start);
          targetUp = wave3.end + w1Range; // W5 ≈ W1
          targetDown = wave3.end - (wave3.end - wave3.start) * 0.382;
          stopLoss = wave4 ? wave4.end : wave3.end * 0.95;
        }
        break;
    }
  } else {
    // ABC 修正浪
    switch (currentWave) {
      case 'A':
        if (waves.length > 0) {
          const lastHigh = Math.max(...waves.map(w => Math.max(w.start, w.end)));
          const lastLow = Math.min(...waves.map(w => Math.min(w.start, w.end)));
          const range = lastHigh - lastLow;
          targetUp = currentPrice + range * 0.382; // B浪反彈
          targetDown = lastLow - range * 0.382; // A浪可能低點
          stopLoss = lastHigh;
        }
        break;
        
      case 'B':
        if (waveA) {
          const aRange = Math.abs(waveA.end - waveA.start);
          targetUp = waveA.start - aRange * 0.382; // B浪反彈目標
          targetDown = waveA.end - aRange * 1.618; // C浪目標
          stopLoss = waveA.start * 1.02;
        }
        break;
        
      case 'C':
        if (waveA) {
          const aRange = Math.abs(waveA.end - waveA.start);
          targetUp = currentPrice + aRange * 0.382; // 新一輪反彈
          targetDown = waveA.end - aRange * 1.618; // C浪延伸
          stopLoss = currentPrice * 1.05;
        }
        break;
    }
  }
  
  return {
    targetUp: Math.round(targetUp * 100) / 100,
    targetDown: Math.round(targetDown * 100) / 100,
    stopLoss: Math.round(stopLoss * 100) / 100,
    fibLevels,
    riskReward: ((targetUp - currentPrice) / (currentPrice - stopLoss)).toFixed(2)
  };
}

// ========================================
// 💡 操作建議（進階版）
// ========================================

/**
 * 生成操作建議（進階版）
 */
function generateAdvancedSuggestion(waveAnalysis, targets, technicals) {
  const wave = waveAnalysis.currentWave;
  const knowledge = WAVE_KNOWLEDGE.characteristics[wave];
  
  if (!knowledge) {
    return {
      action: '觀望',
      confidence: 50,
      summary: '請結合其他技術指標綜合判斷。',
      details: []
    };
  }
  
  // 基本建議
  let action, confidence;
  const details = [];
  
  switch (wave) {
    case 1:
      action = '輕倉試單';
      confidence = 60;
      details.push('📌 建議投入資金：10-20%');
      details.push(`📌 停損設在：${targets.stopLoss}（第1浪起點下方）`);
      details.push(`📌 目標價位：${targets.targetUp}（預估第3浪）`);
      details.push('📌 觀察重點：成交量是否放大確認突破');
      break;
      
    case 2:
      action = '等待進場';
      confidence = 70;
      details.push('📌 最佳進場區間：斐波那契 50%-61.8% 回撤');
      if (targets.fibLevels && targets.fibLevels.length > 0) {
        targets.fibLevels.forEach(f => {
          details.push(`   - ${f.label}: ${f.price.toFixed(2)}`);
        });
      }
      details.push(`📌 停損設在：${targets.stopLoss}（第1浪起點下方）`);
      details.push('📌 觀察重點：回撤時量縮，反彈時量增');
      break;
      
    case 3:
      action = '持有/加碼';
      confidence = 85;
      details.push('📌 這是最強最長的推動浪！');
      details.push(`📌 第一目標：${targets.fibLevels?.[0]?.price.toFixed(2) || targets.targetUp}（161.8%延伸）`);
      details.push(`📌 第二目標：${targets.fibLevels?.[2]?.price.toFixed(2) || (targets.targetUp * 1.1).toFixed(2)}（261.8%延伸）`);
      details.push(`📌 移動停損：${targets.stopLoss}（W2低點）`);
      details.push('📌 觀察重點：價量齊揚，突破要加碼');
      break;
      
    case 4:
      action = '減碼觀望';
      confidence = 65;
      details.push('📌 建議減碼 1/3 持股');
      details.push(`📌 支撐區間：${targets.fibLevels?.[0]?.price.toFixed(2) || targets.targetDown} - ${targets.fibLevels?.[1]?.price.toFixed(2) || (targets.targetDown * 0.95).toFixed(2)}`);
      details.push(`📌 絕對停損：${wave1?.end || targets.stopLoss}（第1浪頂點）`);
      details.push('📌 觀察重點：整理時量縮，等待第5浪訊號');
      break;
      
    case 5:
      action = '分批出場';
      confidence = 70;
      details.push('📌 動能減弱，注意背離訊號！');
      details.push(`📌 預估高點：${targets.targetUp}`);
      details.push('📌 建議分批獲利了結（1/3 → 1/3 → 1/3）');
      details.push('📌 觀察重點：RSI/MACD 背離、量價背離');
      if (technicals?.rsiDivergence) {
        details.push('⚠️ 已出現 RSI 背離！');
      }
      if (technicals?.macdDivergence) {
        details.push('⚠️ 已出現 MACD 背離！');
      }
      break;
      
    case 'A':
      action = '停損/減碼';
      confidence = 65;
      details.push('📌 下跌趨勢開始！');
      details.push('📌 多數人誤認為回檔，請提高警覺');
      details.push(`📌 預估低點：${targets.targetDown}`);
      details.push('📌 建議：停損或至少減碼 50%');
      details.push('📌 不要攤平！');
      break;
      
    case 'B':
      action = '逢高減碼';
      confidence = 60;
      details.push('📌 這是反彈陷阱（誘多）！');
      details.push(`📌 反彈目標：${targets.targetUp}（僅參考）`);
      details.push('📌 這是逃命的最後機會');
      details.push('📌 不要追高買入！');
      details.push('📌 觀察重點：反彈量縮，為假突破');
      break;
      
    case 'C':
      action = '空手觀望';
      confidence = 75;
      details.push('📌 主跌段，殺傷力最強！');
      details.push(`📌 預估低點：${targets.targetDown}（A浪的1-1.618倍）`);
      details.push('📌 等待止跌訊號再進場');
      details.push('📌 觀察重點：恐慌性賣盤後的止跌');
      break;
  }
  
  return {
    action,
    confidence,
    summary: knowledge.description,
    psychology: knowledge.psychology,
    volumePattern: knowledge.volumePattern,
    details,
    rules: knowledge.rules || [],
    keyIndicators: knowledge.keyIndicators || {}
  };
}

// ========================================
// 📈 多時間框架分析
// ========================================

/**
 * 多時間框架波浪分析
 */
function analyzeMultiTimeframe(dailyHistory, weeklyHistory, monthlyHistory) {
  const results = {};
  
  // 日線分析
  if (dailyHistory && dailyHistory.length >= 20) {
    const dailyPivots = findAdvancedPivots(dailyHistory, 5);
    results.daily = analyzeWaveStructureAdvanced(dailyPivots, dailyHistory[dailyHistory.length - 1].close, dailyHistory);
    results.daily.timeframe = '日線';
  }
  
  // 週線分析
  if (weeklyHistory && weeklyHistory.length >= 20) {
    const weeklyPivots = findAdvancedPivots(weeklyHistory, 8);
    results.weekly = analyzeWaveStructureAdvanced(weeklyPivots, weeklyHistory[weeklyHistory.length - 1].close, weeklyHistory);
    results.weekly.timeframe = '週線';
  }
  
  // 月線分析
  if (monthlyHistory && monthlyHistory.length >= 12) {
    const monthlyPivots = findAdvancedPivots(monthlyHistory, 10);
    results.monthly = analyzeWaveStructureAdvanced(monthlyPivots, monthlyHistory[monthlyHistory.length - 1].close, monthlyHistory);
    results.monthly.timeframe = '月線';
  }
  
  // 綜合判斷
  results.consensus = determineMultiTimeframeConsensus(results);
  
  return results;
}

/**
 * 多時間框架共識判斷
 */
function determineMultiTimeframeConsensus(mtfResults) {
  const waves = [];
  const trends = [];
  
  if (mtfResults.daily) {
    waves.push(mtfResults.daily.currentWave);
    trends.push(mtfResults.daily.isUptrend);
  }
  if (mtfResults.weekly) {
    waves.push(mtfResults.weekly.currentWave);
    trends.push(mtfResults.weekly.isUptrend);
  }
  if (mtfResults.monthly) {
    waves.push(mtfResults.monthly.currentWave);
    trends.push(mtfResults.monthly.isUptrend);
  }
  
  const uptrends = trends.filter(t => t).length;
  const downtrends = trends.length - uptrends;
  
  let consensus;
  if (uptrends === trends.length) {
    consensus = '多頭排列';
  } else if (downtrends === trends.length) {
    consensus = '空頭排列';
  } else {
    consensus = '趨勢分歧';
  }
  
  return {
    consensus,
    uptrends,
    downtrends,
    waves,
    recommendation: uptrends > downtrends ? '偏多操作' : uptrends < downtrends ? '偏空操作' : '觀望為主'
  };
}

// ========================================
// 🔄 信心分數計算（進階版）
// ========================================

/**
 * 計算綜合信心分數
 */
function calculateAdvancedConfidence(waveAnalysis, ruleChecks, technicals, targets) {
  let score = 50; // 基礎分
  
  // 規則通過加分
  const passedRules = ruleChecks.rules.filter(r => r.pass).length;
  score += passedRules * 10; // 每條規則 +10
  
  // 指引通過加分
  if (ruleChecks.guidelines) {
    const passedGuidelines = ruleChecks.guidelines.filter(g => g.follows).length;
    score += passedGuidelines * 5; // 每條指引 +5
  }
  
  // 技術指標加分
  if (technicals) {
    if (technicals.rsiConfirm) score += 5;
    if (technicals.macdConfirm) score += 5;
    if (technicals.volumeConfirm) score += 5;
    if (technicals.rsiDivergence) score -= 10; // 背離減分
    if (technicals.macdDivergence) score -= 10;
  }
  
  // 風險報酬比加分
  if (targets && targets.riskReward) {
    const rr = parseFloat(targets.riskReward);
    if (rr >= 3) score += 10;
    else if (rr >= 2) score += 5;
    else if (rr < 1) score -= 5;
  }
  
  // 限制在 0-100
  score = Math.max(0, Math.min(100, score));
  
  const level = score >= 80 ? '極高' : score >= 65 ? '高' : score >= 50 ? '中' : score >= 35 ? '低' : '極低';
  
  return {
    score: Math.round(score),
    level,
    breakdown: {
      rules: passedRules * 10,
      guidelines: (ruleChecks.guidelines?.filter(g => g.follows).length || 0) * 5,
      technicals: technicals ? 
        (technicals.rsiConfirm ? 5 : 0) + (technicals.macdConfirm ? 5 : 0) + (technicals.volumeConfirm ? 5 : 0) 
        - (technicals.rsiDivergence ? 10 : 0) - (technicals.macdDivergence ? 10 : 0) : 0,
      riskReward: targets?.riskReward >= 2 ? 5 : 0
    }
  };
}

// ========================================
// 📤 主要導出函數
// ========================================

/**
 * 進階波浪分析主函數
 */
async function analyzeElliottWaveAdvanced(history, currentPrice) {
  // 確保資料足夠
  if (!history || history.length < 30) {
    return {
      error: '歷史資料不足（需至少30筆）',
      data: null
    };
  }
  
  // 找出轉折點
  const pivots = findAdvancedPivots(history, 5);
  
  // 分析波浪結構
  const waveAnalysis = analyzeWaveStructureAdvanced(pivots, currentPrice, history);
  
  // 規則檢查
  const ruleChecks = checkWaveRulesAdvanced(waveAnalysis);
  
  // 計算技術指標
  const closes = history.map(h => h.close);
  const technicals = {
    rsi: calculateRSI(closes, 14),
    macd: calculateMACD(closes),
    shortMA: calculateSMA(closes, 5),
    longMA: calculateSMA(closes, 20),
    rsiConfirm: false,
    macdConfirm: false,
    volumeConfirm: false,
    rsiDivergence: false,
    macdDivergence: false
  };
  
  // 判斷確認/背離
  const isUptrend = waveAnalysis.isUptrend;
  technicals.rsiConfirm = isUptrend ? technicals.rsi > 50 : technicals.rsi < 50;
  technicals.macdConfirm = isUptrend ? technicals.macd.histogram > 0 : technicals.macd.histogram < 0;
  
  // 檢查背離
  if (history.length >= 20) {
    const recentCloses = closes.slice(-20);
    const priceTrend = recentCloses[recentCloses.length - 1] > recentCloses[0];
    technicals.rsiDivergence = (priceTrend && technicals.rsi < 50) || (!priceTrend && technicals.rsi > 50);
    technicals.macdDivergence = (priceTrend && technicals.macd.histogram < 0) || (!priceTrend && technicals.macd.histogram > 0);
  }
  
  // 計算目標價
  const targets = calculateTargetsAdvanced(waveAnalysis, currentPrice, history);
  
  // 生成建議
  const suggestion = generateAdvancedSuggestion(waveAnalysis, targets, technicals);
  
  // 計算信心分數
  const confidence = calculateAdvancedConfidence(waveAnalysis, ruleChecks, technicals, targets);
  
  return {
    // 基本資訊
    currentWave: waveAnalysis.currentWave,
    isUptrend: waveAnalysis.isUptrend,
    trend: waveAnalysis.isUptrend ? '上升趨勢' : '下降趨勢',
    
    // 波浪資料
    waves: waveAnalysis.waves,
    pivots: waveAnalysis.pivots,
    statistics: waveAnalysis.statistics,
    
    // 規則檢查
    rules: ruleChecks.rules,
    guidelines: ruleChecks.guidelines,
    
    // 技術指標
    technicals: {
      rsi: Math.round(technicals.rsi * 10) / 10,
      macd: Math.round(technicals.macd.histogram * 100) / 100,
      shortMA: Math.round(technicals.shortMA * 100) / 100,
      longMA: Math.round(technicals.longMA * 100) / 100,
      rsiDivergence: technicals.rsiDivergence,
      macdDivergence: technicals.macdDivergence
    },
    
    // 目標價
    targetUp: targets.targetUp,
    targetDown: targets.targetDown,
    stopLoss: targets.stopLoss,
    fibLevels: targets.fibLevels,
    riskReward: targets.riskReward,
    
    // 建議
    suggestion: suggestion.summary,
    action: suggestion.action,
    details: suggestion.details,
    psychology: suggestion.psychology,
    volumePattern: suggestion.volumePattern,
    keyIndicators: suggestion.keyIndicators,
    
    // 信心分數
    confidence: confidence.score,
    confidenceLevel: confidence.level,
    confidenceBreakdown: confidence.breakdown,
    
    // 知識庫
    waveKnowledge: WAVE_KNOWLEDGE.characteristics[waveAnalysis.currentWave] || null
  };
}

// 導出
module.exports = {
  analyzeElliottWaveAdvanced,
  findAdvancedPivots,
  analyzeWaveStructureAdvanced,
  checkWaveRulesAdvanced,
  calculateTargetsAdvanced,
  generateAdvancedSuggestion,
  calculateAdvancedConfidence,
  analyzeMultiTimeframe,
  calculateRSI,
  calculateMACD,
  calculateSMA,
  calculateEMA,
  calculateATR,
  // 🆕 新增函數（方案1+2+3）
  calculateDynamicZigZagThreshold,
  detectRSIDivergence,
  aggregateToWeekly,
  findWeeklyPivots,
  determineWaveWithEnhancedLogic,
  WAVE_KNOWLEDGE
};
