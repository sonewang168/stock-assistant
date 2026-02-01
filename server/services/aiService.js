  /**
   * 🎯 三 AI 買賣建議分析（樂觀派 Gemini + 謹慎派 GPT + 中立派 Claude）
   */
  async analyzeBuySellTiming(stockData, technicalData, holdingData = null) {
    const geminiKey = process.env.GEMINI_API_KEY;
    const openaiKey = process.env.OPENAI_API_KEY;
    const claudeKey = process.env.CLAUDE_API_KEY;

    console.log('🤖 三AI分析啟動:');
    console.log(`   Gemini: ${geminiKey ? '✅' : '❌'}, OpenAI: ${openaiKey ? '✅' : '❌'}, Claude: ${claudeKey ? '✅' : '❌'}`);

    if (!geminiKey && !openaiKey && !claudeKey) {
      return {
        optimistic: null, cautious: null, neutral: null,
        combined: { action: 'hold', actionText: '持有觀望', confidence: 0, reason: 'AI 服務未設定', aiCount: 0 }
      };
    }

    const baseInfo = this.buildBaseInfo(stockData, technicalData, holdingData);

    const optimisticPrompt = `樂觀派台股分析師。繁體中文。只輸出純JSON：
${baseInfo}
{"action":"buy","confidence":85,"opportunity":"30字機會","target_price":數字,"support_price":數字}`;

    const cautiousPrompt = `謹慎派台股分析師。繁體中文。只輸出純JSON：
${baseInfo}
{"action":"hold","confidence":70,"risk_factors":"30字風險","resistance_price":數字,"stop_loss":數字}`;

    const neutralPrompt = `中立派台股分析師。繁體中文。只輸出純JSON：
${baseInfo}
{"action":"hold","confidence":60,"analysis":"30字分析","fair_price":數字,"strategy":"操作建議"}`;

    const promises = [];
    
    // 樂觀派 - Gemini
    if (geminiKey) promises.push(this.callGeminiAnalysis(optimisticPrompt, geminiKey, 'optimistic'));
    else if (openaiKey) promises.push(this.callOpenAIAnalysis(optimisticPrompt, openaiKey, 'optimistic'));
    else promises.push(this.callClaudeAnalysis(optimisticPrompt, claudeKey, 'optimistic'));

    // 謹慎派 - OpenAI
    if (openaiKey) promises.push(this.callOpenAIAnalysis(cautiousPrompt, openaiKey, 'cautious'));
    else if (geminiKey) promises.push(this.callGeminiAnalysis(cautiousPrompt, geminiKey, 'cautious'));
    else promises.push(this.callClaudeAnalysis(cautiousPrompt, claudeKey, 'cautious'));

    // 中立派 - Claude
    if (claudeKey) promises.push(this.callClaudeAnalysis(neutralPrompt, claudeKey, 'neutral'));
    else if (geminiKey) promises.push(this.callGeminiAnalysis(neutralPrompt, geminiKey, 'neutral'));
    else promises.push(this.callOpenAIAnalysis(neutralPrompt, openaiKey, 'neutral'));

    const [optimisticResult, cautiousResult, neutralResult] = await Promise.all(promises);
    const combined = this.combineThreeAIAnalysis(optimisticResult, cautiousResult, neutralResult, stockData);

    return { optimistic: optimisticResult, cautious: cautiousResult, neutral: neutralResult, combined };
  }

  /**
   * 🟢 呼叫 Gemini API
   */
  async callGeminiAnalysis(prompt, apiKey, role) {
    try {
      console.log(`   🟢 呼叫 Gemini (${role})...`);
      const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;
      const response = await axios.post(url, {
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.7, maxOutputTokens: 1000 }
      }, { headers: { 'Content-Type': 'application/json' }, timeout: 20000 });

      let text = response.data?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!text) return { ai: 'Gemini 2.5', error: '無回應' };
      text = text.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        parsed.ai = 'Gemini 2.5';
        console.log(`   ✅ Gemini (${role}) 成功`);
        return parsed;
      }
      return { ai: 'Gemini 2.5', error: '解析失敗' };
    } catch (error) {
      console.error(`   ❌ Gemini (${role}) 錯誤:`, error.message);
      return { ai: 'Gemini 2.5', error: error.message };
    }
  }

  /**
   * 🔴 呼叫 OpenAI API
   */
  async callOpenAIAnalysis(prompt, apiKey, role) {
    try {
      console.log(`   🔴 呼叫 OpenAI (${role})...`);
      const response = await axios.post('https://api.openai.com/v1/chat/completions', {
        model: 'gpt-5.1',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 500, temperature: 0.7
      }, {
        headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        timeout: 20000
      });

      let text = response.data.choices[0]?.message?.content?.trim();
      if (!text) return { ai: 'GPT-5.1', error: '無回應' };
      text = text.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        parsed.ai = 'GPT-5.1';
        console.log(`   ✅ OpenAI (${role}) 成功`);
        return parsed;
      }
      return { ai: 'GPT-5.1', error: '解析失敗' };
    } catch (error) {
      console.error(`   ❌ OpenAI (${role}) 錯誤:`, error.message);
      return { ai: 'GPT-5.1', error: error.message };
    }
  }

  /**
   * 🟣 呼叫 Claude API
   */
  async callClaudeAnalysis(prompt, apiKey, role) {
    try {
      console.log(`   🟣 呼叫 Claude (${role})...`);
      const response = await axios.post('https://api.anthropic.com/v1/messages', {
        model: 'claude-sonnet-4-5-20250929',
        max_tokens: 500,
        messages: [{ role: 'user', content: prompt }]
      }, {
        headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
        timeout: 20000
      });

      let text = response.data?.content?.[0]?.text;
      if (!text) return { ai: 'Claude 4.5', error: '無回應' };
      text = text.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        parsed.ai = 'Claude 4.5';
        console.log(`   ✅ Claude (${role}) 成功`);
        return parsed;
      }
      return { ai: 'Claude 4.5', error: '解析失敗' };
    } catch (error) {
      console.error(`   ❌ Claude (${role}) 錯誤:`, error.message);
      return { ai: 'Claude 4.5', error: error.message };
    }
  }

  /**
   * 📊 綜合三AI分析結果
   */
  combineThreeAIAnalysis(optimistic, cautious, neutral, stockData) {
    const actionScore = { 'strong_buy': 2, 'buy': 1, 'hold': 0, 'sell': -1, 'strong_sell': -2 };
    
    let totalScore = 0, aiCount = 0;
    let votes = { up: 0, down: 0, neutral: 0 };

    [optimistic, cautious, neutral].forEach(result => {
      if (result && !result.error) {
        const action = result.action || 'hold';
        totalScore += actionScore[action] || 0;
        aiCount++;
        if (action.includes('buy')) votes.up++;
        else if (action.includes('sell')) votes.down++;
        else votes.neutral++;
      }
    });

    const avgScore = aiCount > 0 ? totalScore / aiCount : 0;
    let action, actionText;
    if (avgScore >= 1.2) { action = 'strong_buy'; actionText = '🔥 強力買入'; }
    else if (avgScore >= 0.4) { action = 'buy'; actionText = '📈 建議買入'; }
    else if (avgScore <= -1.2) { action = 'strong_sell'; actionText = '⚠️ 強力賣出'; }
    else if (avgScore <= -0.4) { action = 'sell'; actionText = '📉 建議賣出'; }
    else { action = 'hold'; actionText = '➡️ 持有觀望'; }

    let consensus = votes.up >= 2 ? `📈 ${votes.up}/3 AI 看漲` : 
                   votes.down >= 2 ? `📉 ${votes.down}/3 AI 看跌` : '🤔 意見分歧';

    return {
      action, actionText,
      confidence: Math.round((optimistic?.confidence || 50) * 0.4 + (cautious?.confidence || 50) * 0.3 + (neutral?.confidence || 50) * 0.3),
      consensus, votes, aiCount,
      targetPrice: optimistic?.target_price || neutral?.fair_price,
      supportPrice: optimistic?.support_price || cautious?.stop_loss,
      resistancePrice: cautious?.resistance_price,
      buyPrice: optimistic?.support_price || cautious?.stop_loss,
      optimisticView: optimistic?.opportunity || '分析中...',
      cautiousView: cautious?.risk_factors || '分析中...',
      neutralView: neutral?.analysis || neutral?.strategy || '分析中...',
      // 兼容舊格式
      positive: { opportunity: optimistic?.opportunity || '暫無分析', target: optimistic?.target_price, support: optimistic?.support_price },
      negative: { riskFactors: cautious?.risk_factors || '暫無分析', resistance: cautious?.resistance_price, stopLoss: cautious?.stop_loss }
    };
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
        model: 'gpt-5.1',
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

      let text = response.data.choices[0]?.message?.content?.trim();
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
      // 移除 markdown 格式標記
      text = text.replace(/```json\s*/gi, "").replace(/```\s*/g, "").trim();
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
   * 產生股票評論（🔥 雙 AI 分析：樂觀派 vs 謹慎派）
   */
  async generateComment(alert) {
    const geminiKey = process.env.GEMINI_API_KEY;
    const openaiKey = process.env.OPENAI_API_KEY;
    
    console.log(`🤖 雙 AI 分析啟動...`);
    console.log(`   Gemini Key: ${geminiKey ? '✅ 已設定' : '❌ 未設定'}`);
    console.log(`   OpenAI Key: ${openaiKey ? '✅ 已設定' : '❌ 未設定'}`);
    
    if (!geminiKey && !openaiKey) {
      return '（AI 評論未設定）';
    }

    const stock = alert.stock;

    // 🎯 雙 AI 提示詞
    const baseInfo = `
【個股資訊】
股票：${stock.name}（${stock.id}）
現價：${stock.price} 元
漲跌：${stock.change > 0 ? '+' : ''}${stock.change} 元（${stock.changePercent}%）
最高：${stock.high} 元 / 最低：${stock.low} 元
成交量：${stock.volume ? (stock.volume / 1000).toFixed(0) + ' 張' : '未知'}
事件：${alert.message}`;

    // 🟢 樂觀派 AI（看多角度）
    const bullishPrompt = `你是「多頭分析師」，專門從正面角度解讀股市。請用繁體中文台灣用語分析。
${baseInfo}

請從【看多角度】分析（約 120 字）：
1. 技術面利多訊號（K線、量能、均線）
2. 可能的上漲催化劑
3. 支撐價位與目標價
4. 持有或加碼的理由

語氣積極但專業，給出具體價位。`;

    // 🔴 謹慎派 AI（看空角度）
    const bearishPrompt = `你是「風控分析師」，專門從風險角度評估股市。請用繁體中文台灣用語分析。
${baseInfo}

請從【風險角度】分析（約 120 字）：
1. 技術面警訊（壓力、量能異常、指標背離）
2. 可能的下跌風險因素
3. 壓力價位與停損價
4. 減碼或觀望的理由

語氣謹慎但客觀，給出具體價位。`;

    // 📊 綜合建議
    const summaryPrompt = `你是「投資策略師」，綜合多空觀點給出平衡建議。請用繁體中文台灣用語。
${baseInfo}

請給出【操作策略】（約 80 字）：
1. 關鍵價位：支撐___元 / 壓力___元
2. 持有者建議
3. 觀望者建議
4. 一句話結論`;

    try {
      const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${geminiKey}`;
      
      // 並行呼叫：樂觀派(Gemini) + 謹慎派(Gemini或OpenAI) + 綜合建議
      const requests = [];
      
      // 樂觀派分析（Gemini）
      if (geminiKey) {
        console.log('   🟢 呼叫 Gemini 樂觀派...');
        requests.push(
          axios.post(geminiUrl, {
            contents: [{ parts: [{ text: bullishPrompt }] }],
            generationConfig: { temperature: 0.7, maxOutputTokens: 300 }
          }, { headers: { 'Content-Type': 'application/json' }, timeout: 20000 })
          .catch((err) => {
            console.error('   ❌ Gemini 樂觀派失敗:', err.message);
            return null;
          })
        );
      } else {
        requests.push(Promise.resolve(null));
      }

      // 謹慎派分析（優先用 OpenAI，沒有則用 Gemini）
      if (openaiKey) {
        console.log('   🔴 呼叫 OpenAI GPT-4o 謹慎派...');
        requests.push(
          axios.post('https://api.openai.com/v1/chat/completions', {
            model: 'gpt-5.1',
            messages: [{ role: 'user', content: bearishPrompt }],
            max_tokens: 300,
            temperature: 0.7
          }, { 
            headers: { 
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${openaiKey}`
            }, 
            timeout: 20000 
          })
          .catch((err) => {
            console.error('   ❌ OpenAI 謹慎派失敗:', err.response?.data?.error?.message || err.message);
            return null;
          })
        );
      } else if (geminiKey) {
        console.log('   🔴 呼叫 Gemini 謹慎派（無 OpenAI Key）...');
        requests.push(
          axios.post(geminiUrl, {
            contents: [{ parts: [{ text: bearishPrompt }] }],
            generationConfig: { temperature: 0.7, maxOutputTokens: 300 }
          }, { headers: { 'Content-Type': 'application/json' }, timeout: 20000 })
          .catch((err) => {
            console.error('   ❌ Gemini 謹慎派失敗:', err.message);
            return null;
          })
        );
      } else {
        requests.push(Promise.resolve(null));
      }

      // 綜合建議（Gemini）
      if (geminiKey) {
        console.log('   📊 呼叫 Gemini 綜合建議...');
        requests.push(
          axios.post(geminiUrl, {
            contents: [{ parts: [{ text: summaryPrompt }] }],
            generationConfig: { temperature: 0.6, maxOutputTokens: 200 }
          }, { headers: { 'Content-Type': 'application/json' }, timeout: 20000 })
          .catch((err) => {
            console.error('   ❌ Gemini 綜合建議失敗:', err.message);
            return null;
          })
        );
      } else {
        requests.push(Promise.resolve(null));
      }

      const [bullishRes, bearishRes, summaryRes] = await Promise.all(requests);

      // 解析結果
      let bullishText = '（分析中...）';
      let bearishText = '（分析中...）';
      let summaryText = '';

      if (bullishRes?.data) {
        bullishText = bullishRes.data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || bullishText;
        console.log('   ✅ Gemini 樂觀派完成');
      }

      if (bearishRes?.data) {
        // OpenAI 格式
        if (bearishRes.data?.choices) {
          bearishText = bearishRes.data.choices[0]?.message?.content?.trim() || bearishText;
          console.log('   ✅ OpenAI 謹慎派完成');
        } 
        // Gemini 格式
        else if (bearishRes.data?.candidates) {
          bearishText = bearishRes.data.candidates[0]?.content?.parts?.[0]?.text?.trim() || bearishText;
          console.log('   ✅ Gemini 謹慎派完成');
        }
      }

      if (summaryRes?.data) {
        summaryText = summaryRes.data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';
        console.log('   ✅ 綜合建議完成');
      }

      // 組合雙 AI 分析結果
      const aiSource1 = geminiKey ? 'Gemini' : 'AI';
      const aiSource2 = openaiKey ? 'GPT-4o' : 'Gemini';

      let result = `🟢【${aiSource1} 樂觀派】\n${bullishText}\n\n🔴【${aiSource2} 謹慎派】\n${bearishText}`;
      
      if (summaryText) {
        result += `\n\n📊【綜合策略】\n${summaryText}`;
      }

      console.log('   ✅ 雙 AI 分析完成');
      return result;

    } catch (error) {
      console.error('雙 AI 分析錯誤:', error.message);
      return '（AI 評論產生失敗）';
    }
  }

  /**
   * 產生日報總結（深度多面向分析）
   */
  async generateDailySummary(stockDataList) {
    const geminiKey = process.env.GEMINI_API_KEY;
    const openaiKey = process.env.OPENAI_API_KEY;
    
    if (!geminiKey && !openaiKey) {
      return '（AI 總結未設定）';
    }

    // 整理股票資料
    const upStocks = stockDataList.filter(s => parseFloat(s.changePercent) > 0);
    const downStocks = stockDataList.filter(s => parseFloat(s.changePercent) < 0);
    const topGainer = [...stockDataList].sort((a, b) => parseFloat(b.changePercent) - parseFloat(a.changePercent))[0];
    const topLoser = [...stockDataList].sort((a, b) => parseFloat(a.changePercent) - parseFloat(b.changePercent))[0];

    const stockSummary = stockDataList.map(s =>
      `${s.name}(${s.id}): ${s.price}元 ${s.changePercent > 0 ? '+' : ''}${s.changePercent}%`
    ).join('\n');

    const baseInfo = `
【今日監控組合】
${stockSummary}

【統計】上漲 ${upStocks.length} 檔 / 下跌 ${downStocks.length} 檔
最強：${topGainer ? `${topGainer.name} ${topGainer.changePercent}%` : '無'}
最弱：${topLoser ? `${topLoser.name} ${topLoser.changePercent}%` : '無'}`;

    // 🟢 樂觀派日報
    const bullishPrompt = `你是「多頭首席分析師」，專門從正面角度撰寫日報。繁體中文台灣用語。
${baseInfo}

請撰寫【樂觀派日報】（約 150 字）：
1. 今日亮點與強勢股分析
2. 技術面利多訊號
3. 持續看好的理由
4. 建議加碼或持有的標的`;

    // 🔴 謹慎派日報
    const bearishPrompt = `你是「風控首席分析師」，專門從風險角度撰寫日報。繁體中文台灣用語。
${baseInfo}

請撰寫【謹慎派日報】（約 150 字）：
1. 今日警訊與弱勢股分析
2. 技術面風險訊號
3. 需要注意的風險因素
4. 建議減碼或觀望的標的`;

    // 📊 明日策略
    const strategyPrompt = `你是「投資策略長」，綜合多空觀點給出明日策略。繁體中文台灣用語。
${baseInfo}

請給出【明日操作策略】（約 100 字）：
1. 明日觀察重點
2. 關鍵價位提醒
3. 操作建議（持有者/觀望者）
4. 一句話總結`;

    try {
      const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${geminiKey}`;
      
      const requests = [];
      
      // 樂觀派（Gemini）
      if (geminiKey) {
        requests.push(
          axios.post(geminiUrl, {
            contents: [{ parts: [{ text: bullishPrompt }] }],
            generationConfig: { temperature: 0.7, maxOutputTokens: 350 }
          }, { headers: { 'Content-Type': 'application/json' }, timeout: 25000 })
          .catch(() => null)
        );
      } else {
        requests.push(Promise.resolve(null));
      }

      // 謹慎派（優先 OpenAI）
      if (openaiKey) {
        requests.push(
          axios.post('https://api.openai.com/v1/chat/completions', {
            model: 'gpt-5.1',
            messages: [{ role: 'user', content: bearishPrompt }],
            max_tokens: 350,
            temperature: 0.7
          }, { 
            headers: { 
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${openaiKey}`
            }, 
            timeout: 25000 
          })
          .catch(() => null)
        );
      } else if (geminiKey) {
        requests.push(
          axios.post(geminiUrl, {
            contents: [{ parts: [{ text: bearishPrompt }] }],
            generationConfig: { temperature: 0.7, maxOutputTokens: 350 }
          }, { headers: { 'Content-Type': 'application/json' }, timeout: 25000 })
          .catch(() => null)
        );
      } else {
        requests.push(Promise.resolve(null));
      }

      // 明日策略（Gemini）
      if (geminiKey) {
        requests.push(
          axios.post(geminiUrl, {
            contents: [{ parts: [{ text: strategyPrompt }] }],
            generationConfig: { temperature: 0.6, maxOutputTokens: 250 }
          }, { headers: { 'Content-Type': 'application/json' }, timeout: 25000 })
          .catch(() => null)
        );
      } else {
        requests.push(Promise.resolve(null));
      }

      const [bullishRes, bearishRes, strategyRes] = await Promise.all(requests);

      // 解析結果
      let bullishText = '（分析中...）';
      let bearishText = '（分析中...）';
      let strategyText = '';

      if (bullishRes?.data) {
        bullishText = bullishRes.data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || bullishText;
      }

      if (bearishRes?.data) {
        if (bearishRes.data?.choices) {
          bearishText = bearishRes.data.choices[0]?.message?.content?.trim() || bearishText;
        } else if (bearishRes.data?.candidates) {
          bearishText = bearishRes.data.candidates[0]?.content?.parts?.[0]?.text?.trim() || bearishText;
        }
      }

      if (strategyRes?.data) {
        strategyText = strategyRes.data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';
      }

      // 組合雙 AI 日報
      const aiSource1 = geminiKey ? 'Gemini' : 'AI';
      const aiSource2 = openaiKey ? 'GPT-4o' : 'Gemini';

      let result = `🟢【${aiSource1} 樂觀派】\n${bullishText}\n\n🔴【${aiSource2} 謹慎派】\n${bearishText}`;
      
      if (strategyText) {
        result += `\n\n📊【明日策略】\n${strategyText}`;
      }

      return result;

    } catch (error) {
      console.error('雙 AI 日報錯誤:', error.message);
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
