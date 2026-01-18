/**
 * 🤖 AI 服務 - Gemini + OpenAI 雙 AI 股市分析
 */

const axios = require('axios');
const { pool } = require('../db');

class AIService {

  /**
   * 取得 AI 風格設定
   */
  async getAIStyle() {
    const result = await pool.query(
      "SELECT value FROM settings WHERE key = 'ai_style'"
    );
    return result.rows[0]?.value || 'sarcastic';
  }

  /**
   * 🎯 雙 AI 買賣建議分析（Gemini + OpenAI）
   */
  async analyzeBuySellTiming(stockData, technicalData, holdingData = null) {
    const geminiKey = process.env.GEMINI_API_KEY;
    const openaiKey = process.env.OPENAI_API_KEY;

    // 組合分析提示詞
    const analysisPrompt = this.buildAnalysisPrompt(stockData, technicalData, holdingData);

    // 並行呼叫兩個 AI
    const [geminiResult, openaiResult] = await Promise.all([
      geminiKey ? this.callGemini(analysisPrompt, geminiKey) : null,
      openaiKey ? this.callOpenAI(analysisPrompt, openaiKey) : null
    ]);

    // 綜合分析結果
    const combined = this.combineAnalysis(geminiResult, openaiResult, stockData);

    return combined;
  }

  /**
   * 建立分析提示詞
   */
  buildAnalysisPrompt(stockData, technicalData, holdingData) {
    // 技術指標資訊
    let technicalInfo = '無技術指標資料';
    if (technicalData) {
      technicalInfo = `
【技術指標】
- RSI(14): ${technicalData.rsi || 'N/A'}（30以下超賣買入訊號，70以上超買賣出訊號）
- KD值: K=${technicalData.kd?.k || 'N/A'}, D=${technicalData.kd?.d || 'N/A'}（K>D黃金交叉買入，K<D死亡交叉賣出）
- MACD: DIF=${technicalData.macd?.dif || 'N/A'}, MACD=${technicalData.macd?.macd || 'N/A'}（DIF>0多頭，DIF<0空頭）
- 布林通道: 上軌=${technicalData.bollinger?.upper || 'N/A'}, 中軌=${technicalData.bollinger?.middle || 'N/A'}, 下軌=${technicalData.bollinger?.lower || 'N/A'}
- 均線: MA5=${technicalData.ma5 || 'N/A'}, MA10=${technicalData.ma10 || 'N/A'}, MA20=${technicalData.ma20 || 'N/A'}, MA60=${technicalData.ma60 || 'N/A'}
- 價格位置: ${this.getPricePosition(stockData.price, technicalData)}`;
    }

    // 持股資訊
    let holdingInfo = '';
    if (holdingData) {
      const costPrice = parseFloat(holdingData.won_price) || parseFloat(holdingData.bid_price) || 0;
      const totalShares = (holdingData.lots || 0) * 1000 + (holdingData.odd_shares || 0);
      const profitPercent = costPrice > 0 
        ? (((stockData.price - costPrice) / costPrice) * 100).toFixed(2)
        : 0;
      holdingInfo = `
【持股資訊】
- 持有: ${holdingData.lots || 0}張 ${holdingData.odd_shares || 0}股（共${totalShares}股）
- 成本價: $${costPrice}
- 目前股價: $${stockData.price}
- 獲利狀況: ${profitPercent >= 0 ? '+' : ''}${profitPercent}%
- 市值: $${Math.round(stockData.price * totalShares).toLocaleString()}`;
    }

    return `你是專業的台灣股市技術分析師，擁有20年以上的實戰經驗。請根據以下資訊，提供【詳細且專業】的買賣時機分析。

【股票基本資訊】
- 股票: ${stockData.name}（${stockData.id}）
- 現價: $${stockData.price}
- 漲跌: ${stockData.change > 0 ? '+' : ''}${stockData.change}（${stockData.changePercent > 0 ? '+' : ''}${stockData.changePercent}%）
- 今日區間: $${stockData.low || 'N/A'} ~ $${stockData.high || 'N/A'}
- 成交量: ${stockData.volume ? stockData.volume.toLocaleString() : 'N/A'}
${technicalInfo}
${holdingInfo}

【分析要求】
請從以下角度進行深入分析：
1. 技術面分析：結合 RSI、KD、MACD、布林通道、均線等指標
2. 價格位置分析：目前股價在技術面的相對位置
3. 趨勢判斷：短期（1-5日）和中期（1-4週）趨勢
4. 風險評估：潛在的風險因素和支撐壓力位
5. 操作策略：具體的進出場時機和價位建議

請以 JSON 格式回覆，只輸出 JSON 不要其他文字：
{
  "action": "strong_buy" 或 "buy" 或 "hold" 或 "sell" 或 "strong_sell",
  "confidence": 1-100 的信心度,
  "reason": "150-200字的詳細分析理由，包含技術面解讀、趨勢判斷、關鍵價位說明",
  "technical_analysis": "80-100字的技術指標綜合解讀",
  "trend_analysis": "短期趨勢和中期趨勢判斷（50字）",
  "buy_price": 建議買入價格（數字）,
  "sell_price": 建議賣出價格（數字）,
  "stop_loss": 建議停損價格（數字）,
  "support_price": 支撐價位（數字）,
  "resistance_price": 壓力價位（數字）,
  "timing": "具體的最佳操作時機建議（50字，如：盤中若跌破XX元可分批買進，或等待KD黃金交叉確認後再進場）",
  "risk_level": "low" 或 "medium" 或 "high",
  "risk_factors": "主要風險因素說明（30字）",
  "holding_advice": "針對持股者的詳細操作建議（50字，如有持股資訊）",
  "short_term_target": "短期目標價（1-2週）",
  "mid_term_target": "中期目標價（1-2月）"
}`;
  }

  /**
   * 取得價格位置描述
   */
  getPricePosition(price, technical) {
    if (!technical?.bollinger) return '無法判斷';
    
    const { upper, middle, lower } = technical.bollinger;
    if (price >= upper) return '接近布林上軌（高檔）';
    if (price <= lower) return '接近布林下軌（低檔）';
    if (price > middle) return '布林中軌之上（偏多）';
    return '布林中軌之下（偏空）';
  }

  /**
   * 呼叫 Gemini API
   */
  async callGemini(prompt, apiKey) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;

      const response = await axios.post(url, {
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.4,
          maxOutputTokens: 1500
        }
      }, {
        headers: { 'Content-Type': 'application/json' },
        timeout: 30000
      });

      const result = response.data;
      if (result.candidates && result.candidates[0]) {
        const text = result.candidates[0].content.parts[0].text.trim();
        return this.parseAIResponse(text, 'Gemini');
      }
      return null;
    } catch (error) {
      console.error('Gemini API 錯誤:', error.message);
      return null;
    }
  }

  /**
   * 呼叫 OpenAI API
   */
  async callOpenAI(prompt, apiKey) {
    try {
      const response = await axios.post('https://api.openai.com/v1/chat/completions', {
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: '你是專業的台灣股市技術分析師，擁有20年以上實戰經驗，擅長技術指標分析和買賣時機判斷。請提供詳細且專業的分析，只用 JSON 格式回覆。' },
          { role: 'user', content: prompt }
        ],
        temperature: 0.4,
        max_tokens: 1500
      }, {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        timeout: 30000
      });

      const text = response.data.choices[0]?.message?.content?.trim();
      if (text) {
        return this.parseAIResponse(text, 'OpenAI');
      }
      return null;
    } catch (error) {
      console.error('OpenAI API 錯誤:', error.message);
      return null;
    }
  }

  /**
   * 解析 AI 回應
   */
  parseAIResponse(text, source) {
    try {
      // 嘗試提取 JSON
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        parsed.source = source;
        return parsed;
      }
    } catch (e) {
      console.error(`解析 ${source} 回應失敗:`, e.message);
    }
    return null;
  }

  /**
   * 綜合兩個 AI 的分析結果
   */
  combineAnalysis(geminiResult, openaiResult, stockData) {
    const results = {
      gemini: geminiResult,
      openai: openaiResult,
      combined: null,
      timestamp: new Date().toISOString()
    };

    // 動作分數對照
    const actionScore = {
      'strong_buy': 2,
      'buy': 1,
      'hold': 0,
      'sell': -1,
      'strong_sell': -2
    };

    const scoreToAction = (score) => {
      if (score >= 1.5) return 'strong_buy';
      if (score >= 0.5) return 'buy';
      if (score <= -1.5) return 'strong_sell';
      if (score <= -0.5) return 'sell';
      return 'hold';
    };

    // 計算綜合分數
    let totalScore = 0;
    let totalConfidence = 0;
    let count = 0;
    let reasons = [];
    let buyPrices = [];
    let sellPrices = [];
    let stopLosses = [];
    let timings = [];
    let holdingAdvices = [];
    let riskLevels = [];

    if (geminiResult) {
      totalScore += actionScore[geminiResult.action] || 0;
      totalConfidence += geminiResult.confidence || 50;
      count++;
      if (geminiResult.reason) reasons.push(`🤖 Gemini：${geminiResult.reason}`);
      if (geminiResult.buy_price) buyPrices.push(geminiResult.buy_price);
      if (geminiResult.sell_price) sellPrices.push(geminiResult.sell_price);
      if (geminiResult.stop_loss) stopLosses.push(geminiResult.stop_loss);
      if (geminiResult.timing) timings.push(geminiResult.timing);
      if (geminiResult.holding_advice) holdingAdvices.push(geminiResult.holding_advice);
      if (geminiResult.risk_level) riskLevels.push(geminiResult.risk_level);
    }

    if (openaiResult) {
      totalScore += actionScore[openaiResult.action] || 0;
      totalConfidence += openaiResult.confidence || 50;
      count++;
      if (openaiResult.reason) reasons.push(`🧠 GPT：${openaiResult.reason}`);
      if (openaiResult.buy_price) buyPrices.push(openaiResult.buy_price);
      if (openaiResult.sell_price) sellPrices.push(openaiResult.sell_price);
      if (openaiResult.stop_loss) stopLosses.push(openaiResult.stop_loss);
      if (openaiResult.timing) timings.push(openaiResult.timing);
      if (openaiResult.holding_advice) holdingAdvices.push(openaiResult.holding_advice);
      if (openaiResult.risk_level) riskLevels.push(openaiResult.risk_level);
    }

    if (count === 0) {
      results.combined = {
        action: 'hold',
        actionText: '持有觀望',
        confidence: 0,
        reason: 'AI 服務暫時無法使用',
        consensus: false,
        aiCount: 0
      };
      return results;
    }

    const avgScore = totalScore / count;
    const avgConfidence = Math.round(totalConfidence / count);
    const combinedAction = scoreToAction(avgScore);

    // 判斷兩個 AI 是否一致
    const consensus = geminiResult && openaiResult && 
      geminiResult.action === openaiResult.action;

    // 動作文字對照
    const actionText = {
      'strong_buy': '🔥 強力買入',
      'buy': '📈 建議買入',
      'hold': '⏸️ 持有觀望',
      'sell': '📉 建議賣出',
      'strong_sell': '⚠️ 強力賣出'
    };

    // 計算平均價格
    const avgPrice = (arr) => arr.length > 0 
      ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length * 100) / 100 
      : null;

    // 風險等級
    const riskMap = { 'low': 1, 'medium': 2, 'high': 3 };
    const avgRisk = riskLevels.length > 0
      ? Math.round(riskLevels.reduce((a, b) => a + (riskMap[b] || 2), 0) / riskLevels.length)
      : 2;
    const riskText = { 1: '低', 2: '中', 3: '高' };

    results.combined = {
      action: combinedAction,
      actionText: actionText[combinedAction],
      confidence: avgConfidence,
      consensusBonus: consensus ? 10 : 0,
      finalConfidence: Math.min(100, avgConfidence + (consensus ? 10 : 0)),
      reasons: reasons,
      buyPrice: avgPrice(buyPrices),
      sellPrice: avgPrice(sellPrices),
      stopLoss: avgPrice(stopLosses),
      timings: timings,
      holdingAdvices: holdingAdvices,
      riskLevel: riskText[avgRisk],
      consensus: consensus,
      aiCount: count,
      stock: {
        id: stockData.id,
        name: stockData.name,
        price: stockData.price,
        change: stockData.change,
        changePercent: stockData.changePercent
      }
    };

    return results;
  }

  /**
   * 產生股票評論
   */
  async generateComment(alert) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return '（AI 評論未設定）';
    }

    const style = await this.getAIStyle();
    const stock = alert.stock;

    const stylePrompt = style === 'sarcastic'
      ? `你是一個毒舌股市評論員，用諷刺幽默的口吻評論股票，會嘲諷追高殺低的散戶，用詞辛辣但有道理。使用繁體中文台灣用語。`
      : `你是專業股市分析師，用簡潔專業的口吻分析股票走勢，提供有價值的觀點。使用繁體中文台灣用語。`;

    const prompt = `${stylePrompt}

請針對以下股票狀況，寫一段 50 字以內的短評：

股票：${stock.name}（${stock.id}）
現價：${stock.price} 元
漲跌：${stock.change > 0 ? '+' : ''}${stock.change} 元（${stock.changePercent}%）
今日最高：${stock.high}
今日最低：${stock.low}
事件：${alert.message}

只輸出評論內容，不要有其他說明。`;

    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;

      const response = await axios.post(url, {
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.8,
          maxOutputTokens: 100
        }
      }, {
        headers: { 'Content-Type': 'application/json' },
        timeout: 15000
      });

      const result = response.data;
      if (result.candidates && result.candidates[0]) {
        return result.candidates[0].content.parts[0].text.trim();
      }

      return '（AI 暫時無法回應）';

    } catch (error) {
      console.error('Gemini API 錯誤:', error.message);
      return '（AI 評論產生失敗）';
    }
  }

  /**
   * 產生日報總結
   */
  async generateDailySummary(stockDataList) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return '（AI 總結未設定）';
    }

    const style = await this.getAIStyle();

    const stylePrompt = style === 'sarcastic'
      ? '用毒舌諷刺的風格，針對今日股票表現寫 100 字總結，嘲諷一下表現差的。繁體中文。'
      : '用專業分析師口吻，針對今日股票表現寫 100 字總結。繁體中文。';

    const stockSummary = stockDataList.map(s =>
      `${s.name}(${s.id}): ${s.price}元 ${s.changePercent}%`
    ).join('\n');

    const prompt = `${stylePrompt}\n\n今日監控股票：\n${stockSummary}`;

    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;

      const response = await axios.post(url, {
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.8,
          maxOutputTokens: 200
        }
      }, {
        headers: { 'Content-Type': 'application/json' },
        timeout: 15000
      });

      const result = response.data;
      if (result.candidates && result.candidates[0]) {
        return result.candidates[0].content.parts[0].text.trim();
      }

      return '（無法產生總結）';

    } catch (error) {
      console.error('Gemini 日報總結錯誤:', error.message);
      return '（AI 總結失敗）';
    }
  }

  /**
   * 搜尋個股新聞
   */
  async searchStockNews(stockName, stockId) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return '（新聞功能未設定）';
    }

    const prompt = `請搜尋並整理「${stockName}（${stockId}）」最近的股市新聞，
列出 3 條最重要的新聞標題和簡短摘要（每條 30 字內）。
格式：
1. 標題：摘要
2. 標題：摘要
3. 標題：摘要

只輸出新聞列表，不要其他說明。如果找不到近期新聞，就說「暫無重大新聞」。`;

    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;

      const response = await axios.post(url, {
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.3,
          maxOutputTokens: 300
        }
      }, {
        headers: { 'Content-Type': 'application/json' },
        timeout: 15000
      });

      const result = response.data;
      if (result.candidates && result.candidates[0]) {
        return result.candidates[0].content.parts[0].text.trim();
      }

      return '暫無相關新聞';

    } catch (error) {
      return '新聞抓取失敗';
    }
  }

  /**
   * PTT 情緒分析
   */
  async analyzePTTSentiment(stockName) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return { heat: 5, sentiment: 5, summary: '未設定 AI' };
    }

    const prompt = `分析「${stockName}」在 PTT Stock 股板的近期討論熱度和情緒。
請用 1-10 分評估：
- 討論熱度（1=冷門，10=爆量討論）
- 多空情緒（1=極度看空，10=極度看多）

回覆格式（JSON）：
{"heat": 數字, "sentiment": 數字, "summary": "一句話總結"}`;

    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;

      const response = await axios.post(url, {
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.5,
          maxOutputTokens: 150
        }
      }, {
        headers: { 'Content-Type': 'application/json' },
        timeout: 15000
      });

      const result = response.data;
      if (result.candidates && result.candidates[0]) {
        const text = result.candidates[0].content.parts[0].text.trim();
        // 嘗試解析 JSON
        const match = text.match(/\{[\s\S]*\}/);
        if (match) {
          return JSON.parse(match[0]);
        }
      }

      return { heat: 5, sentiment: 5, summary: '無法分析' };

    } catch (error) {
      return { heat: 5, sentiment: 5, summary: '分析失敗' };
    }
  }
}

module.exports = new AIService();
