/**
 * 🤖 AI 服務 - Gemini 股市評論
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

  /**
   * 🤖 AI 對話 - 問股票問題
   */
  async chat(userMessage, stockContext = null) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return '抱歉，AI 功能未設定。請設定 GEMINI_API_KEY 環境變數。';
    }

    let systemPrompt = `你是「股海秘書」AI 助理，專門回答台股和美股相關問題。
你的特色：
- 使用繁體中文台灣用語
- 回答簡潔有力，不囉嗦
- 會提供實用的投資觀點
- 台股用紅漲綠跌，美股用綠漲紅跌
- 適時提醒投資風險

回答長度控制在 200 字以內。`;

    if (stockContext) {
      systemPrompt += `\n\n目前討論的股票資訊：
股票：${stockContext.name}（${stockContext.id}）
現價：${stockContext.price}
漲跌：${stockContext.change > 0 ? '+' : ''}${stockContext.change}（${stockContext.changePercent}%）
開盤：${stockContext.open}
最高：${stockContext.high}
最低：${stockContext.low}`;
    }

    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;

      const response = await axios.post(url, {
        contents: [
          { role: 'user', parts: [{ text: systemPrompt }] },
          { role: 'model', parts: [{ text: '好的，我是股海秘書 AI 助理，請問有什麼問題？' }] },
          { role: 'user', parts: [{ text: userMessage }] }
        ],
        generationConfig: {
          temperature: 0.7,
          maxOutputTokens: 500
        }
      }, {
        headers: { 'Content-Type': 'application/json' },
        timeout: 20000
      });

      const result = response.data;
      if (result.candidates && result.candidates[0]) {
        return result.candidates[0].content.parts[0].text.trim();
      }

      return '抱歉，AI 暫時無法回應。';

    } catch (error) {
      console.error('AI 對話錯誤:', error.message);
      return '抱歉，AI 回應失敗，請稍後再試。';
    }
  }

  /**
   * 🤖 AI 選股建議
   */
  async getStockRecommendation(criteria) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return null;
    }

    const prompt = `根據以下條件，推薦 5 檔台股或美股：
${criteria}

回覆格式（JSON 陣列）：
[
  {"code": "股票代碼", "name": "股票名稱", "reason": "推薦理由（20字內）"},
  ...
]

只輸出 JSON，不要其他說明。`;

    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;

      const response = await axios.post(url, {
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.6,
          maxOutputTokens: 500
        }
      }, {
        headers: { 'Content-Type': 'application/json' },
        timeout: 20000
      });

      const result = response.data;
      if (result.candidates && result.candidates[0]) {
        const text = result.candidates[0].content.parts[0].text.trim();
        const match = text.match(/\[[\s\S]*\]/);
        if (match) {
          return JSON.parse(match[0]);
        }
      }

      return null;

    } catch (error) {
      console.error('AI 選股錯誤:', error.message);
      return null;
    }
  }

  /**
   * 🤖 AI 財報摘要
   */
  async summarizeEarnings(stockName, stockId) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return '財報功能未設定';
    }

    const prompt = `請簡要分析「${stockName}（${stockId}）」最近一季的財報表現：
1. 營收年增率
2. EPS 表現
3. 毛利率變化
4. 簡短評論（30字）

回覆格式：
營收：XX%
EPS：XX元
毛利率：XX%
評論：XXXX

如果找不到資料，就說「暫無財報資料」。`;

    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;

      const response = await axios.post(url, {
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.3,
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

      return '暫無財報資料';

    } catch (error) {
      return '財報查詢失敗';
    }
  }
}

module.exports = new AIService();
