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
}

module.exports = new AIService();
