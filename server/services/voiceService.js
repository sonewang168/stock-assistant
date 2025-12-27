/**
 * 🔊 語音服務 - ElevenLabs + Gemini TTS
 */

const axios = require('axios');
const { pool } = require('../db');

class VoiceService {

  /**
   * 取得語音設定
   */
  async getVoiceSettings() {
    const result = await pool.query(`
      SELECT key, value FROM settings 
      WHERE key IN ('voice_provider', 'elevenlabs_voice_id', 'voice_enabled')
    `);
    
    const settings = {};
    result.rows.forEach(row => {
      settings[row.key] = row.value;
    });
    
    return {
      enabled: settings.voice_enabled === 'true',
      provider: settings.voice_provider || 'gemini', // 'elevenlabs' 或 'gemini'
      elevenLabsVoiceId: settings.elevenlabs_voice_id || 'pNInz6obpgDQGcFmaJgB' // Adam
    };
  }

  /**
   * 文字轉語音（自動選擇引擎）
   */
  async textToSpeech(text) {
    const settings = await this.getVoiceSettings();
    
    if (!settings.enabled) {
      return null;
    }

    if (settings.provider === 'elevenlabs') {
      return await this.elevenLabsTTS(text, settings.elevenLabsVoiceId);
    } else {
      return await this.geminiTTS(text);
    }
  }

  /**
   * ElevenLabs TTS（高品質）
   */
  async elevenLabsTTS(text, voiceId) {
    const apiKey = process.env.ELEVENLABS_API_KEY;
    
    if (!apiKey) {
      console.log('⚠️ ElevenLabs API Key 未設定');
      return null;
    }

    try {
      const url = `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`;
      
      const response = await axios.post(url, {
        text: text,
        model_id: 'eleven_multilingual_v2',
        voice_settings: {
          stability: 0.5,
          similarity_boost: 0.75,
          style: 0.5,
          use_speaker_boost: true
        }
      }, {
        headers: {
          'Accept': 'audio/mpeg',
          'Content-Type': 'application/json',
          'xi-api-key': apiKey
        },
        responseType: 'arraybuffer',
        timeout: 30000
      });

      // 轉換為 Base64
      const audioBase64 = Buffer.from(response.data).toString('base64');
      
      return {
        provider: 'elevenlabs',
        format: 'mp3',
        audio: audioBase64,
        dataUrl: `data:audio/mpeg;base64,${audioBase64}`
      };

    } catch (error) {
      console.error('ElevenLabs TTS 錯誤:', error.response?.data || error.message);
      return null;
    }
  }

  /**
   * Gemini TTS（使用 Google Cloud TTS）
   */
  async geminiTTS(text) {
    const apiKey = process.env.GEMINI_API_KEY;
    
    if (!apiKey) {
      console.log('⚠️ Gemini API Key 未設定');
      return null;
    }

    try {
      // 使用 Google Cloud Text-to-Speech API
      // 注意：這需要 Google Cloud TTS API，不是 Gemini
      // 這裡用簡易的 Google Translate TTS 作為替代方案
      
      const encodedText = encodeURIComponent(text);
      const url = `https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&tl=zh-TW&q=${encodedText}`;
      
      const response = await axios.get(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0'
        },
        responseType: 'arraybuffer',
        timeout: 15000
      });

      const audioBase64 = Buffer.from(response.data).toString('base64');
      
      return {
        provider: 'google',
        format: 'mp3',
        audio: audioBase64,
        dataUrl: `data:audio/mpeg;base64,${audioBase64}`
      };

    } catch (error) {
      console.error('Google TTS 錯誤:', error.message);
      // 備用方案：使用瀏覽器端 Web Speech API
      return {
        provider: 'browser',
        format: 'text',
        text: text,
        useBrowserTTS: true
      };
    }
  }

  /**
   * 產生股票警報語音
   */
  async generateAlertVoice(alert) {
    const stock = alert.stock;
    const isUp = stock.change >= 0;
    
    const text = `${stock.name}，${alert.message}，` +
      `現價 ${stock.price} 元，` +
      `${isUp ? '上漲' : '下跌'} ${Math.abs(stock.changePercent)} 趴`;
    
    return await this.textToSpeech(text);
  }

  /**
   * 產生日報語音
   */
  async generateDailyReportVoice(stocks, aiSummary) {
    // 取前 5 名
    const top5 = stocks.slice(0, 5);
    
    let text = '今日收盤日報。';
    
    top5.forEach((s, i) => {
      const isUp = s.change >= 0;
      text += `第 ${i + 1} 名，${s.name}，${isUp ? '上漲' : '下跌'} ${Math.abs(s.changePercent)} 趴。`;
    });
    
    if (aiSummary) {
      text += `AI 總評：${aiSummary}`;
    }
    
    return await this.textToSpeech(text);
  }

  /**
   * 取得 ElevenLabs 可用聲音列表
   */
  async getElevenLabsVoices() {
    const apiKey = process.env.ELEVENLABS_API_KEY;
    
    if (!apiKey) {
      return [];
    }

    try {
      const response = await axios.get('https://api.elevenlabs.io/v1/voices', {
        headers: {
          'xi-api-key': apiKey
        },
        timeout: 10000
      });

      return response.data.voices.map(v => ({
        id: v.voice_id,
        name: v.name,
        category: v.category,
        description: v.description,
        preview_url: v.preview_url
      }));

    } catch (error) {
      console.error('取得 ElevenLabs 聲音列表錯誤:', error.message);
      return [];
    }
  }

  /**
   * 預設聲音列表（中文友善）
   */
  getDefaultVoices() {
    return [
      { id: 'pNInz6obpgDQGcFmaJgB', name: 'Adam', description: '男聲，穩重' },
      { id: 'EXAVITQu4vr4xnSDxMaL', name: 'Bella', description: '女聲，溫柔' },
      { id: '21m00Tcm4TlvDq8ikWAM', name: 'Rachel', description: '女聲，專業' },
      { id: 'AZnzlk1XvdvUeBnXmlld', name: 'Domi', description: '女聲，活潑' },
      { id: 'MF3mGyEYCl7XYWbV9V6O', name: 'Elli', description: '女聲，年輕' },
      { id: 'TxGEqnHWrfWFTfGW9XjX', name: 'Josh', description: '男聲，年輕' },
      { id: 'VR6AewLTigWG4xSOukaG', name: 'Arnold', description: '男聲，深沉' },
      { id: 'pMsXgVXv3BLzUgSXRplE', name: 'Sam', description: '男聲，自然' }
    ];
  }
}

module.exports = new VoiceService();
