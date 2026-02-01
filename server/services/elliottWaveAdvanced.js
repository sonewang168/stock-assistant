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
// 🔍 進階轉折點識別
// ========================================

/**
 * 多級別 ZigZag 轉折點識別
 * @param {Array} history - 歷史資料
 * @param {number} threshold - 轉折閾值（百分比）
 * @returns {Array} 轉折點陣列
 */
function findAdvancedPivots(history, threshold = 5) {
  const pivots = [];
  if (history.length < 10) return pivots;
  
  const closes = history.map(h => h.close);
  const highs = history.map(h => h.high || h.close);
  const lows = history.map(h => h.low || h.close);
  
  // 🔧 計算總漲跌幅來動態調整閾值
  const overallHigh = Math.max(...closes);
  const overallLow = Math.min(...closes);
  const totalChangePercent = ((overallHigh - overallLow) / overallLow) * 100;
  
  // 🆕 根據總漲跌幅動態調整閾值（大幅波動用較小閾值）
  let dynamicThreshold;
  if (totalChangePercent > 200) {
    dynamicThreshold = Math.max(3, threshold * 0.5);  // 大幅波動：降低閾值
  } else if (totalChangePercent > 100) {
    dynamicThreshold = Math.max(4, threshold * 0.7);
  } else if (totalChangePercent > 50) {
    dynamicThreshold = Math.max(5, threshold * 0.8);
  } else {
    dynamicThreshold = threshold;
  }
  
  console.log(`📊 ZigZag: 總漲跌 ${totalChangePercent.toFixed(1)}%, 動態閾值: ${dynamicThreshold.toFixed(1)}%`);
  
  let trend = null;
  let lastPivotPrice = closes[0];
  let lastPivotIdx = 0;
  
  for (let i = 1; i < history.length; i++) {
    const high = highs[i];
    const low = lows[i];
    const close = closes[i];
    
    if (trend === null) {
      if (close > lastPivotPrice * (1 + dynamicThreshold / 100)) {
        trend = 'up';
        pivots.push({
          type: 'low',
          price: lastPivotPrice,
          index: lastPivotIdx,
          date: history[lastPivotIdx]?.date
        });
      } else if (close < lastPivotPrice * (1 - dynamicThreshold / 100)) {
        trend = 'down';
        pivots.push({
          type: 'high',
          price: lastPivotPrice,
          index: lastPivotIdx,
          date: history[lastPivotIdx]?.date
        });
      }
    } else if (trend === 'up') {
      if (high > lastPivotPrice) {
        lastPivotPrice = high;
        lastPivotIdx = i;
      }
      if (close < lastPivotPrice * (1 - dynamicThreshold / 100)) {
        pivots.push({
          type: 'high',
          price: lastPivotPrice,
          index: lastPivotIdx,
          date: history[lastPivotIdx]?.date
        });
        trend = 'down';
        lastPivotPrice = low;
        lastPivotIdx = i;
      }
    } else if (trend === 'down') {
      if (low < lastPivotPrice) {
        lastPivotPrice = low;
        lastPivotIdx = i;
      }
      if (close > lastPivotPrice * (1 + dynamicThreshold / 100)) {
        pivots.push({
          type: 'low',
          price: lastPivotPrice,
          index: lastPivotIdx,
          date: history[lastPivotIdx]?.date
        });
        trend = 'up';
        lastPivotPrice = high;
        lastPivotIdx = i;
      }
    }
  }
  
  // 加入最後一個點
  if (pivots.length > 0) {
    const lastPivot = pivots[pivots.length - 1];
    const lastClose = closes[closes.length - 1];
    
    if (lastPivot.type === 'high' && lastClose < lastPivot.price * 0.95) {
      pivots.push({
        type: 'low',
        price: Math.min(...lows.slice(-10)),
        index: lows.slice(-10).indexOf(Math.min(...lows.slice(-10))) + history.length - 10,
        date: history[history.length - 1]?.date
      });
    } else if (lastPivot.type === 'low' && lastClose > lastPivot.price * 1.05) {
      pivots.push({
        type: 'high',
        price: Math.max(...highs.slice(-10)),
        index: highs.slice(-10).indexOf(Math.max(...highs.slice(-10))) + history.length - 10,
        date: history[history.length - 1]?.date
      });
    }
  }
  
  // 🆕 如果轉折點太少，用更小的閾值再找
  if (pivots.length < 4 && dynamicThreshold > 3) {
    console.log(`⚠️ 轉折點不足 (${pivots.length})，降低閾值重試...`);
    return findAdvancedPivots(history, dynamicThreshold * 0.6);
  }
  
  console.log(`✅ 找到 ${pivots.length} 個轉折點`);
  return pivots;
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
  
  // 🆕 使用方案1+2+3（短期+中期+長期綜合判定）
  const currentWave = determineWaveWithEnhancedLogic(lastCycleWaves, currentPrice, history);
  
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
  
  if (isUptrend) {
    if (waveCount <= 5) {
      waveName = waveCount;
      waveType = (waveCount % 2 === 1) ? '推動' : '修正';
    } else {
      const abcNames = ['A', 'B', 'C'];
      waveName = abcNames[waveCount - 6] || 'C';
      waveType = waveName === 'B' ? '反彈' : '修正';
    }
  } else {
    const abcNames = ['A', 'B', 'C', '1', '2', '3', '4', '5'];
    waveName = abcNames[waveCount - 1] || String(waveCount);
    waveType = (waveName === 'B' || ['2', '4'].includes(waveName)) ? '反彈' : '修正';
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
  if (!history || history.length === 0) return 1;
  
  const closes = history.map(h => h.close);
  const overallHigh = Math.max(...closes);
  const overallLow = Math.min(...closes);
  const startPrice = closes[0];
  
  // 🆕 計算總漲跌幅（從起點）
  const totalChangeFromStart = ((currentPrice - startPrice) / startPrice) * 100;
  // 計算從最低點的漲幅
  const totalChangeFromLow = ((currentPrice - overallLow) / overallLow) * 100;
  // 計算距離高點的回撤
  const pullbackFromHigh = ((overallHigh - currentPrice) / overallHigh) * 100;
  // 計算當前價格在整體區間的位置 (0-1)
  const pricePosition = (currentPrice - overallLow) / (overallHigh - overallLow);
  
  const recentCloses = closes.slice(-30);
  const shortMA = calculateSMA(recentCloses, 5);
  const mediumMA = calculateSMA(recentCloses, 10);
  const longMA = calculateSMA(recentCloses, 20);
  
  const rsi = calculateRSI(closes, 14);
  const momentum5 = recentCloses.length >= 5 ? 
    (recentCloses[recentCloses.length - 1] - recentCloses[recentCloses.length - 5]) / recentCloses[recentCloses.length - 5] * 100 : 0;
  
  const isUpTrend = shortMA > mediumMA && mediumMA > longMA;
  const isDownTrend = shortMA < mediumMA && mediumMA < longMA;
  
  console.log(`🌊 波浪判斷: 總漲跌=${totalChangeFromStart.toFixed(1)}%, 從低點漲=${totalChangeFromLow.toFixed(1)}%, 回撤=${pullbackFromHigh.toFixed(1)}%, 位置=${(pricePosition*100).toFixed(0)}%`);
  
  // 🔧 根據總漲幅判斷（這是關鍵改進！）
  if (totalChangeFromLow > 200) {
    // 大幅上漲 (>200%) - 很可能是第3浪或更後面
    if (pullbackFromHigh < 10 && pricePosition > 0.9) {
      // 接近高點，可能是第3浪頂部或第5浪
      return rsi > 70 ? 5 : 3;
    } else if (pullbackFromHigh >= 10 && pullbackFromHigh < 30) {
      // 有小回調，可能是第4浪
      return 4;
    } else if (pullbackFromHigh >= 30) {
      // 回調較深，可能是 A 浪
      return 'A';
    } else {
      return 3;  // 主升段
    }
  } else if (totalChangeFromLow > 100) {
    // 中等漲幅 (100-200%)
    if (pricePosition > 0.8) {
      return 3;  // 仍在主升段
    } else if (pricePosition > 0.5) {
      return momentum5 > 0 ? 3 : 4;
    } else {
      return isDownTrend ? 'A' : 2;
    }
  } else if (totalChangeFromLow > 50) {
    // 較小漲幅 (50-100%)
    if (pricePosition > 0.8 && isUpTrend) {
      return 3;
    } else if (pricePosition > 0.6) {
      return momentum5 > 0 ? 1 : 2;
    } else if (pricePosition > 0.3) {
      return isUpTrend ? 1 : 2;
    } else {
      return isDownTrend ? 'A' : 4;
    }
  } else if (totalChangeFromLow > 20) {
    // 小幅上漲 (20-50%)
    if (isUpTrend && pricePosition > 0.7) {
      return 1;
    } else if (isDownTrend) {
      return 'A';
    } else {
      return momentum5 > 0 ? 1 : 2;
    }
  } else if (totalChangeFromStart < -20) {
    // 下跌中
    if (pullbackFromHigh > 50) {
      return 'C';
    } else if (momentum5 > 0) {
      return 'B';
    } else {
      return 'A';
    }
  } else {
    // 小幅波動 - 根據波浪歷史判斷
    if (waves.length > 0) {
      const lastWave = waves[waves.length - 1];
      const nextWaveMap = {
        1: 2, 2: 3, 3: 4, 4: 5, 5: 'A',
        'A': 'B', 'B': 'C', 'C': 1
      };
      return nextWaveMap[lastWave.wave] || 1;
    }
    return 1;
  }
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

// ========================================
// 🆕 方案1+2+3：波浪分析優化
// ========================================

/**
 * 方案1：動態 ZigZag 閾值計算
 * 根據總漲跌幅調整閾值，大漲股用大閾值過濾小回調
 */
function calculateDynamicZigZagThreshold(history) {
  if (!history || history.length < 10) {
    return { threshold: 5, reason: '數據不足，使用預設值' };
  }
  
  const closes = history.map(h => h.close);
  const high = Math.max(...closes);
  const low = Math.min(...closes);
  const totalChange = ((high - low) / low) * 100;
  
  let threshold, reason;
  
  if (totalChange > 200) {
    threshold = 12;
    reason = `總漲跌${totalChange.toFixed(0)}% > 200%`;
  } else if (totalChange > 100) {
    threshold = 10;
    reason = `總漲跌${totalChange.toFixed(0)}% (100-200%)`;
  } else if (totalChange > 30) {
    threshold = 8;
    reason = `總漲跌${totalChange.toFixed(0)}% (30-100%)`;
  } else {
    threshold = 5;
    reason = `總漲跌${totalChange.toFixed(0)}% < 30%`;
  }
  
  return { threshold, reason, totalChange };
}

/**
 * 方案2：RSI 背離檢測
 * 頂背離 = 價格新高但RSI未新高 → 第5浪末端信號
 * 底背離 = 價格新低但RSI未新低 → 修正浪結束信號
 */
function detectRSIDivergence(history, lookback = 30) {
  if (!history || history.length < lookback + 14) {
    return { hasDivergence: false, type: null };
  }
  
  // 計算 RSI
  const rsiValues = [];
  for (let i = 14; i < history.length; i++) {
    let gains = 0, losses = 0;
    for (let j = i - 13; j <= i; j++) {
      const change = history[j].close - history[j - 1].close;
      if (change > 0) gains += change;
      else losses -= change;
    }
    const avgGain = gains / 14;
    const avgLoss = losses / 14;
    const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
    rsiValues.push({ index: i, rsi: 100 - (100 / (1 + rs)), price: history[i].close });
  }
  
  if (rsiValues.length < lookback) {
    return { hasDivergence: false, type: null };
  }
  
  // 取最近 lookback 個點
  const recent = rsiValues.slice(-lookback);
  
  // 找價格高點和RSI高點
  let priceHighIdx = 0, rsiHighIdx = 0;
  let priceLowIdx = 0, rsiLowIdx = 0;
  
  for (let i = 1; i < recent.length; i++) {
    if (recent[i].price > recent[priceHighIdx].price) priceHighIdx = i;
    if (recent[i].rsi > recent[rsiHighIdx].rsi) rsiHighIdx = i;
    if (recent[i].price < recent[priceLowIdx].price) priceLowIdx = i;
    if (recent[i].rsi < recent[rsiLowIdx].rsi) rsiLowIdx = i;
  }
  
  // 檢查頂背離：價格高點在後，RSI高點在前
  const lastIdx = recent.length - 1;
  const isBearish = priceHighIdx > lastIdx - 5 && rsiHighIdx < priceHighIdx - 3 && 
                    recent[priceHighIdx].rsi < recent[rsiHighIdx].rsi * 0.95;
  
  // 檢查底背離：價格低點在後，RSI低點在前
  const isBullish = priceLowIdx > lastIdx - 5 && rsiLowIdx < priceLowIdx - 3 &&
                    recent[priceLowIdx].rsi > recent[rsiLowIdx].rsi * 1.05;
  
  if (isBearish) {
    return { hasDivergence: true, type: 'bearish', description: 'RSI頂背離' };
  } else if (isBullish) {
    return { hasDivergence: true, type: 'bullish', description: 'RSI底背離' };
  }
  
  return { hasDivergence: false, type: null };
}

/**
 * 方案3輔助：日線聚合為週線
 */
function aggregateToWeekly(history) {
  if (!history || history.length === 0) return [];
  
  const weekly = [];
  let weekData = null;
  
  for (const day of history) {
    try {
      const date = new Date(day.date);
      if (isNaN(date.getTime())) continue;  // 跳過無效日期
      
      const weekStart = new Date(date);
      weekStart.setDate(date.getDate() - date.getDay());
      const weekKey = weekStart.toISOString().split('T')[0];
      
      if (!weekData || weekData.weekKey !== weekKey) {
        if (weekData) weekly.push(weekData);
        weekData = {
          weekKey,
          date: day.date,
          open: day.open,
          high: day.high,
          low: day.low,
          close: day.close,
          volume: day.volume || 0
        };
      } else {
        weekData.high = Math.max(weekData.high, day.high);
        weekData.low = Math.min(weekData.low, day.low);
        weekData.close = day.close;
        weekData.volume += day.volume || 0;
        weekData.date = day.date;
      }
    } catch (e) {
      continue;  // 跳過錯誤的資料
    }
  }
  if (weekData) weekly.push(weekData);
  
  return weekly;
}

/**
 * 方案3：週線級別轉折點識別
 */
function findWeeklyPivots(history, threshold = 10) {
  const weekly = aggregateToWeekly(history);
  if (weekly.length < 3) return [];
  
  const pivots = [];
  let lastPivot = null;
  
  for (let i = 1; i < weekly.length - 1; i++) {
    const prev = weekly[i - 1];
    const curr = weekly[i];
    const next = weekly[i + 1];
    
    // 高點
    if (curr.high > prev.high && curr.high > next.high) {
      if (!lastPivot || lastPivot.type !== 'high') {
        const change = lastPivot ? Math.abs((curr.high - lastPivot.price) / lastPivot.price * 100) : threshold;
        if (change >= threshold) {
          pivots.push({ type: 'high', price: curr.high, date: curr.date, index: i });
          lastPivot = { type: 'high', price: curr.high };
        }
      }
    }
    // 低點
    if (curr.low < prev.low && curr.low < next.low) {
      if (!lastPivot || lastPivot.type !== 'low') {
        const change = lastPivot ? Math.abs((curr.low - lastPivot.price) / lastPivot.price * 100) : threshold;
        if (change >= threshold) {
          pivots.push({ type: 'low', price: curr.low, date: curr.date, index: i });
          lastPivot = { type: 'low', price: curr.low };
        }
      }
    }
  }
  
  return pivots;
}

/**
 * 用動態閾值找主要轉折點（日線級別）
 */
function findMajorPivots(history, threshold) {
  if (!history || history.length < 3) return [];
  
  const pivots = [];
  let lastPivot = null;
  
  for (let i = 1; i < history.length - 1; i++) {
    const prev = history[i - 1];
    const curr = history[i];
    const next = history[i + 1];
    
    // 高點
    if (curr.high > prev.high && curr.high > next.high) {
      if (!lastPivot || lastPivot.type !== 'high') {
        const change = lastPivot ? Math.abs((curr.high - lastPivot.price) / lastPivot.price * 100) : threshold;
        if (change >= threshold) {
          pivots.push({ type: 'high', price: curr.high, date: curr.date, index: i });
          lastPivot = { type: 'high', price: curr.high };
        }
      } else if (curr.high > lastPivot.price) {
        // 更高的高點，更新
        pivots[pivots.length - 1] = { type: 'high', price: curr.high, date: curr.date, index: i };
        lastPivot = { type: 'high', price: curr.high };
      }
    }
    // 低點
    if (curr.low < prev.low && curr.low < next.low) {
      if (!lastPivot || lastPivot.type !== 'low') {
        const change = lastPivot ? Math.abs((curr.low - lastPivot.price) / lastPivot.price * 100) : threshold;
        if (change >= threshold) {
          pivots.push({ type: 'low', price: curr.low, date: curr.date, index: i });
          lastPivot = { type: 'low', price: curr.low };
        }
      } else if (curr.low < lastPivot.price) {
        // 更低的低點，更新
        pivots[pivots.length - 1] = { type: 'low', price: curr.low, date: curr.date, index: i };
        lastPivot = { type: 'low', price: curr.low };
      }
    }
  }
  
  return pivots;
}

/**
 * 🆕 A+B+C 多重視角分析
 * 從短線、中線、長線三個角度分析波浪位置
 */
function analyzeMultipleTimeframes(history, currentPrice, threshold) {
  if (!history || history.length < 20) {
    return {
      shortTerm: { wave: 1, reason: '數據不足' },
      midTerm: { wave: 1, reason: '數據不足' },
      longTerm: { wave: 1, reason: '數據不足' },
      consensus: 'low'
    };
  }
  
  // ========================================
  // 視角A：短線（6個月 ≈ 130個交易日）
  // ========================================
  const shortLen = Math.min(130, history.length);
  const shortHistory = history.slice(-shortLen);
  const shortTerm = analyzeTimeframeWave(shortHistory, currentPrice, threshold * 0.8, '短線');
  
  // ========================================
  // 視角B：中線（9個月 ≈ 195個交易日）
  // ========================================
  const midLen = Math.min(195, history.length);
  const midHistory = history.slice(-midLen);
  const midTerm = analyzeTimeframeWave(midHistory, currentPrice, threshold, '中線');
  
  // ========================================
  // 視角C：長線（12個月 ≈ 260個交易日）
  // ========================================
  const longLen = Math.min(260, history.length);
  const longHistory = history.slice(-longLen);
  const longTerm = analyzeTimeframeWave(longHistory, currentPrice, threshold * 1.2, '長線');
  
  // ========================================
  // 計算共識
  // ========================================
  const waves = [shortTerm.wave, midTerm.wave, longTerm.wave].filter(w => typeof w === 'number');
  const avgWave = waves.length > 0 ? Math.round(waves.reduce((a, b) => a + b, 0) / waves.length) : 3;
  
  // 判斷一致性
  const maxWave = Math.max(...waves);
  const minWave = Math.min(...waves);
  const spread = maxWave - minWave;
  
  let consensus;
  if (spread <= 1) {
    consensus = 'high'; // 三個視角一致
  } else if (spread <= 2) {
    consensus = 'medium'; // 有些分歧
  } else {
    consensus = 'low'; // 分歧大
  }
  
  return {
    shortTerm,
    midTerm,
    longTerm,
    consensus,
    averageWave: avgWave,
    spread
  };
}

/**
 * 分析單一時間框架的波浪位置
 */
function analyzeTimeframeWave(history, currentPrice, threshold, label) {
  if (!history || history.length < 10) {
    return { wave: 1, reason: '數據不足', label };
  }
  
  const closes = history.map(h => h.close);
  const high = Math.max(...closes);
  const low = Math.min(...closes);
  const range = high - low;
  
  if (range === 0) {
    return { wave: 1, reason: '價格無波動', label };
  }
  
  // 找出這個時間框架內的轉折點
  const pivots = findMajorPivots(history, threshold);
  const waveCount = Math.max(1, pivots.length - 1);
  
  // 計算關鍵指標
  const pricePosition = (currentPrice - low) / range;
  const fromLow = ((currentPrice - low) / low) * 100;
  const fromHigh = ((high - currentPrice) / high) * 100;
  
  let wave, reason;
  
  // ========================================
  // 🆕 改進的波浪判斷邏輯
  // 核心原則：價格位置 + 趨勢特徵 > 單純轉折點數量
  // ========================================
  
  // 根據轉折點數量和價格位置判斷
  if (waveCount <= 1) {
    if (pricePosition > 0.7) {
      wave = 1;
      reason = `${label}初升段，漲${fromLow.toFixed(0)}%`;
    } else {
      wave = 1;
      reason = `${label}築底階段`;
    }
  }
  else if (waveCount === 2) {
    if (fromHigh > 15) {
      wave = 2;
      reason = `${label}回調${fromHigh.toFixed(0)}%，第2浪修正`;
    } else {
      wave = 1;
      reason = `${label}第1浪延續`;
    }
  }
  else if (waveCount <= 4) {
    if (pricePosition > 0.85 && fromHigh < 10) {
      wave = 3;
      reason = `${label}主升段，接近高點`;
    } else if (fromHigh >= 15 && fromHigh < 30) {
      wave = 4;
      reason = `${label}回調${fromHigh.toFixed(0)}%，可能第4浪`;
    } else if (fromHigh >= 30) {
      wave = 4;
      reason = `${label}深度修正中`;
    } else {
      wave = 3;
      reason = `${label}第3浪進行中`;
    }
  }
  else {
    // waveCount >= 5
    // 🆕 改進：轉折點多不代表就是第5浪
    // 6-12個月數據本來就會有很多轉折，應該看整體趨勢特徵
    
    // 計算從起點到現在的漲跌幅
    const startPrice = closes[0];
    const totalChange = ((currentPrice - startPrice) / startPrice) * 100;
    
    // 判斷目前是上漲還是回調趨勢
    const recentCloses = closes.slice(-20);
    const recentHigh = Math.max(...recentCloses);
    const recentLow = Math.min(...recentCloses);
    const recentTrend = recentCloses[recentCloses.length - 1] > recentCloses[0] ? 'up' : 'down';
    
    if (fromHigh >= 30) {
      // 從高點大幅回撤，進入修正浪
      wave = 'A';
      reason = `${label}回調${fromHigh.toFixed(0)}%，可能進入修正`;
    } else if (fromHigh >= 20) {
      // 中度回撤
      if (totalChange > 50) {
        wave = 4;
        reason = `${label}漲幅${totalChange.toFixed(0)}%後回調，第4浪整理`;
      } else {
        wave = 2;
        reason = `${label}回調${fromHigh.toFixed(0)}%，可能第2浪`;
      }
    } else if (pricePosition < 0.5) {
      // 價格位置在下半部
      if (totalChange > 30 && recentTrend === 'down') {
        wave = 4;
        reason = `${label}回調整理中`;
      } else if (totalChange > 0) {
        wave = 2;
        reason = `${label}上漲後回調`;
      } else {
        wave = 1;
        reason = `${label}築底階段`;
      }
    } else if (pricePosition < 0.7) {
      // 價格位置中等偏上
      if (totalChange > 100) {
        // 漲幅巨大，可能是第3浪主升段
        wave = 3;
        reason = `${label}漲幅${totalChange.toFixed(0)}%，主升段`;
      } else if (fromHigh > 10) {
        wave = 4;
        reason = `${label}整理中`;
      } else {
        wave = 3;
        reason = `${label}上升趨勢`;
      }
    } else if (pricePosition < 0.85) {
      // 價格位置偏高
      if (totalChange > 150 && fromHigh < 10) {
        // 大漲且接近高點，但還沒到極端
        wave = 3;
        reason = `${label}漲幅${totalChange.toFixed(0)}%，主升段延續`;
      } else if (fromHigh > 5) {
        wave = 4;
        reason = `${label}高位整理`;
      } else {
        wave = 3;
        reason = `${label}主升段`;
      }
    } else {
      // pricePosition >= 0.85 且接近高點
      if (totalChange > 200 && fromHigh < 5) {
        // 超大漲幅且在最高點附近，才判定為第5浪
        wave = 5;
        reason = `${label}漲幅${totalChange.toFixed(0)}%，可能第5浪末端`;
      } else if (totalChange > 100 && fromHigh < 10) {
        // 大漲且接近高點
        if (recentTrend === 'up') {
          wave = 3;
          reason = `${label}漲幅${totalChange.toFixed(0)}%，主升段持續`;
        } else {
          wave = 5;
          reason = `${label}第5浪，注意風險`;
        }
      } else if (fromHigh < 5) {
        wave = 3;
        reason = `${label}創新高中`;
      } else {
        wave = 4;
        reason = `${label}高位回調`;
      }
    }
  }
  
  return { wave, reason, label, waveCount, pricePosition: pricePosition * 100 };
}

/**
 * 🆕 綜合三個視角得出最終結論
 */
function synthesizeWaveConclusion(multiView, divergence, pricePosition, pullbackFromHigh, totalChange) {
  const short = multiView.shortTerm.wave;
  const mid = multiView.midTerm.wave;
  const long = multiView.longTerm.wave;
  
  // 收集數字波浪
  const numericWaves = [short, mid, long].filter(w => typeof w === 'number');
  
  let wave, confidence, reason, suggestion;
  
  // ========================================
  // 情況1：三個視角一致或接近
  // ========================================
  if (multiView.consensus === 'high') {
    wave = multiView.averageWave;
    confidence = 85;
    reason = `短中長線一致指向第${wave}浪`;
    
    if (wave === 3) {
      suggestion = '三線共振，主升段持有';
    } else if (wave === 5) {
      suggestion = '三線指向末端，謹慎操作';
    } else if (wave <= 2) {
      suggestion = '初升段，可考慮布局';
    } else {
      suggestion = '修正中，等待機會';
    }
  }
  // ========================================
  // 情況2：有一定分歧
  // ========================================
  else if (multiView.consensus === 'medium') {
    // 取中位數
    const sorted = [...numericWaves].sort((a, b) => a - b);
    wave = sorted[Math.floor(sorted.length / 2)] || 3;
    confidence = 70;
    
    // 判斷是上升途中還是見頂
    if (short > long) {
      reason = `短線第${short}浪，長線第${long}浪，短線領先`;
      suggestion = '短線較強，但注意長線位置';
    } else if (long > short) {
      reason = `短線第${short}浪，長線第${long}浪，長線領先`;
      suggestion = '可能是更大週期的延伸';
    } else {
      reason = `視角有分歧，建議第${wave}浪`;
      suggestion = '分歧中，建議觀望';
    }
  }
  // ========================================
  // 情況3：分歧很大
  // ========================================
  else {
    wave = multiView.averageWave;
    confidence = 55;
    reason = `短(${short})中(${mid})長(${long})分歧大，結構不明確`;
    suggestion = '波浪結構不清晰，建議觀望或用其他指標輔助';
  }
  
  // ========================================
  // 用技術指標調整
  // ========================================
  
  // RSI 頂背離 → 提高警覺
  if (divergence.hasDivergence && divergence.type === 'bearish') {
    if (wave >= 3) {
      reason += '，RSI頂背離⚠️';
      suggestion += '，注意回調風險';
      confidence = Math.max(60, confidence - 5);
    }
  }
  
  // RSI 底背離 → 可能反彈
  if (divergence.hasDivergence && divergence.type === 'bullish') {
    if (wave === 4 || wave === 'A' || wave === 'C') {
      reason += '，RSI底背離';
      suggestion += '，可能即將反彈';
    }
  }
  
  // 接近高點且是第3浪以上
  if (pullbackFromHigh < 5 && wave >= 3) {
    suggestion += '，接近高點宜謹慎';
  }
  
  // 深度回調
  if (pullbackFromHigh > 25) {
    if (wave === 3) {
      wave = 4;
      reason = `深度回調${pullbackFromHigh.toFixed(0)}%，調整為第4浪`;
    }
  }
  
  return { wave, confidence, reason, suggestion };
}

/**
 * 🔑 方案1+2+3 整合判斷函數
 * 
 * 判斷邏輯：
 * 1. 用動態閾值（方案1）計算主要轉折點數量
 * 2. 用RSI背離（方案2）判斷是否在浪末端
 * 3. 用週線波浪數（方案3）驗證判斷
 * 
 * 核心原則：
 * - 主要轉折點 ≤2 → 第1或2浪
 * - 主要轉折點 3-4 且大漲 → 第3浪主升段
 * - 主要轉折點 ≥5 或有頂背離 → 第5浪
 */
function determineWaveWithEnhancedLogic(waves, currentPrice, history) {
  if (!history || history.length === 0) {
    return { wave: 1, confidence: 50, reason: '數據不足' };
  }
  
  const closes = history.map(h => h.close);
  const overallHigh = Math.max(...closes);
  const overallLow = Math.min(...closes);
  
  // 關鍵指標
  const totalChangeFromLow = ((currentPrice - overallLow) / overallLow) * 100;
  const pullbackFromHigh = ((overallHigh - currentPrice) / overallHigh) * 100;
  const pricePosition = (currentPrice - overallLow) / (overallHigh - overallLow);
  
  // 🔧 方案1：動態閾值
  const dynamicResult = calculateDynamicZigZagThreshold(history);
  const threshold = dynamicResult.threshold;
  
  // 🔧 方案2：RSI背離
  const divergence = detectRSIDivergence(history, 30);
  
  // 🔧 方案3：用動態閾值找主要轉折點
  const majorPivots = findMajorPivots(history, threshold);
  const majorWaveCount = Math.max(1, majorPivots.length - 1);
  
  // 週線驗證
  const weeklyPivots = findWeeklyPivots(history, threshold);
  const weeklyWaveCount = Math.max(1, weeklyPivots.length - 1);
  
  // ========================================
  // 🆕 A+B+C 多重視角分析
  // ========================================
  const multiView = analyzeMultipleTimeframes(history, currentPrice, threshold);
  
  console.log(`🌊 A+B+C 多重視角分析:`);
  console.log(`   視角A（短線）: 第${multiView.shortTerm.wave}浪 - ${multiView.shortTerm.reason}`);
  console.log(`   視角B（中線）: 第${multiView.midTerm.wave}浪 - ${multiView.midTerm.reason}`);
  console.log(`   視角C（長線）: 第${multiView.longTerm.wave}浪 - ${multiView.longTerm.reason}`);
  console.log(`   RSI背離: ${divergence.type || '無'}`);
  console.log(`   價格位置: ${(pricePosition * 100).toFixed(0)}%`);
  console.log(`   漲幅: ${totalChangeFromLow.toFixed(1)}%, 回撤: ${pullbackFromHigh.toFixed(1)}%`);
  
  // ========================================
  // 🆕 綜合 A+B+C 視角得出建議
  // ========================================
  const { wave, confidence, reason, suggestion } = synthesizeWaveConclusion(
    multiView, divergence, pricePosition, pullbackFromHigh, totalChangeFromLow
  );
  
  console.log(`   🎯 綜合建議: 第${wave}浪 (信心${confidence}%) - ${reason}`);
  
  // 🔧 週線驗證微調
  let finalWave = wave;
  let finalConfidence = confidence;
  let finalReason = reason;
  
  if (weeklyWaveCount <= 2 && (wave === 5 || wave === 4)) {
    console.log(`⚠️ 週線驗證提示：週線僅${weeklyWaveCount}浪，建議謹慎`);
    finalReason += `（週線僅${weeklyWaveCount}浪）`;
  }
  
  return {
    wave: finalWave,
    confidence: finalConfidence,
    reason: finalReason,
    suggestion: suggestion || '',
    divergence,
    weeklyWaveCount,
    majorWaveCount,
    dynamicThreshold: threshold,
    // 🆕 多重視角詳情
    multiViewAnalysis: {
      shortTerm: multiView.shortTerm,
      midTerm: multiView.midTerm,
      longTerm: multiView.longTerm,
      consensus: multiView.consensus
    }
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
  WAVE_KNOWLEDGE,
  // 🆕 方案1+2+3
  calculateDynamicZigZagThreshold,
  detectRSIDivergence,
  aggregateToWeekly,
  findWeeklyPivots,
  findMajorPivots,
  determineWaveWithEnhancedLogic
};
