/**
 * 📊 股海秘書 - 前端應用程式
 */

const API_BASE = '/api';

class StockApp {
  constructor() {
    this.currentTab = 'dashboard';
    this.init();
  }

  async init() {
    // 開機動畫
    setTimeout(() => {
      document.getElementById('splash').classList.add('fade-out');
      document.getElementById('app').classList.remove('hidden');
      
      setTimeout(() => {
        document.getElementById('splash').remove();
      }, 500);
    }, 2500);

    // 綁定事件
    this.bindEvents();

    // 載入資料
    setTimeout(() => {
      this.loadDashboard();
    }, 2600);
  }

  bindEvents() {
    // Tab 切換
    document.querySelectorAll('.tab, .nav-item').forEach(tab => {
      tab.addEventListener('click', (e) => {
        const tabName = e.currentTarget.dataset.tab;
        this.switchTab(tabName);
      });
    });

    // 搜尋框 Enter
    document.getElementById('stockSearch').addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        this.searchStock();
      }
    });
  }

  switchTab(tabName) {
    this.currentTab = tabName;

    // 更新 Tab 樣式
    document.querySelectorAll('.tab, .nav-item').forEach(t => {
      t.classList.toggle('active', t.dataset.tab === tabName);
    });

    // 顯示對應頁面
    document.querySelectorAll('.page').forEach(p => {
      p.classList.toggle('active', p.id === tabName);
    });

    // 載入資料
    switch (tabName) {
      case 'dashboard':
        this.loadDashboard();
        break;
      case 'watchlist':
        this.loadWatchlist();
        break;
      case 'portfolio':
        this.loadPortfolio();
        break;
      case 'alerts':
        this.loadAlerts();
        break;
    }
  }

  // ==================== Dashboard ====================

  async loadDashboard() {
    await Promise.all([
      this.loadHotStocks(),
      this.loadRecentAlerts()
    ]);
  }

  async loadHotStocks() {
    const container = document.getElementById('hotStocks');
    
    try {
      const hotIds = ['2330', '0050', '2317', '2454', '0056', '00878'];
      const response = await fetch(`${API_BASE}/stock/batch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stockIds: hotIds })
      });
      
      const stocks = await response.json();
      
      container.innerHTML = stocks.map(stock => `
        <div class="stock-card" onclick="app.showStock('${stock.id}')">
          <div class="stock-card-name">${stock.name}</div>
          <div class="stock-card-price">${stock.price}</div>
          <div class="stock-card-change ${stock.change >= 0 ? 'up' : 'down'}">
            ${stock.change >= 0 ? '▲' : '▼'} ${stock.changePercent}%
          </div>
        </div>
      `).join('');
      
    } catch (error) {
      container.innerHTML = '<div class="loading">載入失敗</div>';
    }
  }

  async loadRecentAlerts() {
    const container = document.getElementById('recentAlerts');
    
    try {
      const response = await fetch(`${API_BASE}/alert/logs?limit=5`);
      const logs = await response.json();
      
      if (logs.length === 0) {
        container.innerHTML = '<div class="loading">尚無推播紀錄</div>';
        return;
      }
      
      container.innerHTML = logs.map(log => `
        <div class="alert-log">
          <div class="alert-log-header">
            <span class="alert-log-stock">${log.stock_name || log.stock_id}</span>
            <span class="alert-log-time">${new Date(log.created_at).toLocaleString('zh-TW')}</span>
          </div>
          <div class="alert-log-message">${log.alert_type}: ${log.ai_comment || ''}</div>
        </div>
      `).join('');
      
    } catch (error) {
      container.innerHTML = '<div class="loading">載入失敗</div>';
    }
  }

  async searchStock() {
    const input = document.getElementById('stockSearch');
    const stockId = input.value.trim().toUpperCase();
    
    // 支援台股（4-6位數字）和美股（1-5位英文）
    if (!stockId || !(/^\d{4,6}$/.test(stockId) || /^[A-Z]{1,5}$/.test(stockId))) {
      this.showToast('請輸入股票代碼（台股如2330，美股如AAPL）');
      return;
    }
    
    await this.showStock(stockId);
  }

  async showStock(stockId) {
    const container = document.getElementById('stockResult');
    container.classList.remove('hidden');
    container.innerHTML = '<div class="loading">載入中...</div>';
    
    try {
      const response = await fetch(`${API_BASE}/stock/${stockId}/full`);
      
      if (!response.ok) {
        throw new Error('找不到此股票');
      }
      
      const data = await response.json();
      const stock = data.price;
      const tech = data.technical;
      
      // 根據市場決定顏色：台灣紅漲綠跌，美國綠漲紅跌
      const isUS = stock.market === 'US';
      const isUp = stock.change >= 0;
      const changeClass = isUS 
        ? (isUp ? 'us-up' : 'us-down')   // 美股：綠漲紅跌
        : (isUp ? 'up' : 'down');         // 台股：紅漲綠跌
      const arrow = isUp ? '▲' : '▼';
      const marketFlag = isUS ? '🇺🇸' : '🇹🇼';
      const currencySymbol = isUS ? '$' : '';
      
      container.innerHTML = `
        <div class="stock-header">
          <div>
            <div class="stock-name">${marketFlag} ${stock.name}</div>
            <div class="stock-id">${stock.id} | ${stock.market} ${isUS ? '(綠漲紅跌)' : '(紅漲綠跌)'}</div>
          </div>
          <div style="display: flex; gap: 8px;">
            <button class="item-btn" onclick="app.speakStock('${stock.id}')">🔊</button>
            <button class="item-btn" onclick="app.addToWatchlist('${stock.id}', '${stock.name}')">
              + 監控
            </button>
          </div>
        </div>
        <div>
          <span class="stock-price">${currencySymbol}${stock.price}</span>
          <span class="stock-change ${changeClass}">${arrow} ${stock.change} (${stock.changePercent}%)</span>
        </div>
        <div class="stock-details">
          <div class="stock-detail">
            <span class="stock-detail-label">開盤</span>
            <span class="stock-detail-value">${stock.open}</span>
          </div>
          <div class="stock-detail">
            <span class="stock-detail-label">最高</span>
            <span class="stock-detail-value">${stock.high}</span>
          </div>
          <div class="stock-detail">
            <span class="stock-detail-label">最低</span>
            <span class="stock-detail-value">${stock.low}</span>
          </div>
          <div class="stock-detail">
            <span class="stock-detail-label">昨收</span>
            <span class="stock-detail-value">${stock.yesterday}</span>
          </div>
          ${tech ? `
          <div class="stock-detail">
            <span class="stock-detail-label">RSI(14)</span>
            <span class="stock-detail-value">${tech.rsi || 'N/A'}</span>
          </div>
          <div class="stock-detail">
            <span class="stock-detail-label">KD(9)</span>
            <span class="stock-detail-value">${tech.kd ? `${tech.kd.k}/${tech.kd.d}` : 'N/A'}</span>
          </div>
          ` : ''}
        </div>
      `;
      
    } catch (error) {
      container.innerHTML = `<div class="loading">${error.message}</div>`;
    }
  }

  // ==================== Watchlist ====================

  async loadWatchlist() {
    const container = document.getElementById('watchlistItems');
    container.innerHTML = '<div class="loading">載入中...</div>';
    
    try {
      const response = await fetch(`${API_BASE}/watchlist`);
      const items = await response.json();
      
      if (items.length === 0) {
        container.innerHTML = '<div class="loading">尚無監控股票<br>點擊右上角「新增」開始監控</div>';
        return;
      }
      
      // 取得即時股價
      const stockIds = items.map(i => i.stock_id);
      const priceResponse = await fetch(`${API_BASE}/stock/batch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stockIds })
      });
      const prices = await priceResponse.json();
      
      // 合併資料
      const priceMap = {};
      prices.forEach(p => priceMap[p.id] = p);
      
      container.innerHTML = items.map(item => {
        const price = priceMap[item.stock_id] || {};
        const changeClass = (price.change || 0) >= 0 ? 'up' : 'down';
        const arrow = (price.change || 0) >= 0 ? '▲' : '▼';
        
        return `
          <div class="watchlist-item">
            <div class="item-header">
              <div>
                <div class="item-name">${item.stock_name}</div>
                <div class="item-id">${item.stock_id}</div>
              </div>
              <div>
                <div class="item-price">${price.price || 'N/A'}</div>
                <div class="item-change ${changeClass}">${arrow} ${price.changePercent || 0}%</div>
              </div>
            </div>
            <div class="item-actions">
              <button class="item-btn" onclick="app.showStock('${item.stock_id}')">詳情</button>
              <button class="item-btn" onclick="app.addPriceAlert('${item.stock_id}', '${item.stock_name}')">設定提醒</button>
              <button class="item-btn danger" onclick="app.removeWatchlist(${item.id})">移除</button>
            </div>
          </div>
        `;
      }).join('');
      
    } catch (error) {
      container.innerHTML = '<div class="loading">載入失敗</div>';
    }
  }

  async addToWatchlist(stockId, stockName) {
    try {
      const response = await fetch(`${API_BASE}/watchlist`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stockId })
      });
      
      if (response.ok) {
        this.showToast(`已加入監控：${stockName}`);
      }
    } catch (error) {
      this.showToast('操作失敗');
    }
  }

  async speakStock(stockId) {
    // 直接呼叫手動播報
    await this.speakStockNow(stockId);
  }

  async getStockData(stockId) {
    try {
      const response = await fetch(`${API_BASE}/stock/${stockId}`);
      return await response.json();
    } catch {
      return null;
    }
  }

  async removeWatchlist(id) {
    if (!confirm('確定要移除此監控？')) return;
    
    try {
      await fetch(`${API_BASE}/watchlist/${id}`, { method: 'DELETE' });
      this.showToast('已移除');
      this.loadWatchlist();
    } catch (error) {
      this.showToast('操作失敗');
    }
  }

  openAddWatchlist() {
    this.openModal('新增監控', `
      <div class="form-group">
        <label class="form-label">股票代碼</label>
        <input type="text" class="form-input" id="addWatchlistId" placeholder="如 2330" maxlength="6">
      </div>
      <div class="form-group">
        <label class="form-label">自訂漲跌閾值 %（選填）</label>
        <input type="number" class="form-input" id="addWatchlistThreshold" placeholder="預設 3%">
      </div>
      <button class="form-btn" onclick="app.submitAddWatchlist()">新增</button>
    `);
  }

  async submitAddWatchlist() {
    const stockId = document.getElementById('addWatchlistId').value.trim();
    const threshold = document.getElementById('addWatchlistThreshold').value;
    
    if (!stockId) {
      this.showToast('請輸入股票代碼');
      return;
    }
    
    try {
      const response = await fetch(`${API_BASE}/watchlist`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          stockId, 
          customThreshold: threshold || null 
        })
      });
      
      if (response.ok) {
        this.showToast('新增成功');
        this.closeModal();
        this.loadWatchlist();
      }
    } catch (error) {
      this.showToast('新增失敗');
    }
  }

  // ==================== Portfolio ====================

  async loadPortfolio() {
    const summaryContainer = document.getElementById('portfolioSummary');
    const itemsContainer = document.getElementById('portfolioItems');
    
    summaryContainer.innerHTML = '<div class="loading">載入中...</div>';
    itemsContainer.innerHTML = '<div class="loading">載入中...</div>';
    
    try {
      const response = await fetch(`${API_BASE}/portfolio/performance`);
      const data = await response.json();
      
      const isProfit = data.totalProfit >= 0;
      
      summaryContainer.className = `portfolio-summary ${isProfit ? '' : 'loss'}`;
      summaryContainer.innerHTML = `
        <div class="portfolio-total-label">總市值</div>
        <div class="portfolio-total-value">$${Math.round(data.totalValue).toLocaleString()}</div>
        <div class="portfolio-profit">
          ${isProfit ? '📈' : '📉'} 
          ${isProfit ? '+' : ''}$${Math.round(data.totalProfit).toLocaleString()} 
          (${isProfit ? '+' : ''}${data.totalProfitPercent}%)
        </div>
      `;
      
      if (data.holdings.length === 0) {
        itemsContainer.innerHTML = '<div class="loading">尚無持股紀錄</div>';
        return;
      }
      
      itemsContainer.innerHTML = data.holdings.map(h => {
        const isUp = h.profit >= 0;
        const changeClass = isUp ? 'up' : 'down';
        
        return `
          <div class="portfolio-item">
            <div class="item-header">
              <div>
                <div class="item-name">${h.name}</div>
                <div class="item-id">${h.stockId} | ${h.shares}股 @ $${h.avgCost}</div>
              </div>
              <div>
                <div class="item-price">$${h.currentPrice}</div>
                <div class="item-change ${changeClass}">
                  ${isUp ? '+' : ''}$${Math.round(h.profit).toLocaleString()} (${h.profitPercent}%)
                </div>
              </div>
            </div>
            <div class="item-actions">
              <button class="item-btn" onclick="app.editPortfolio(${h.id})">編輯</button>
              <button class="item-btn danger" onclick="app.removePortfolio(${h.id})">刪除</button>
            </div>
          </div>
        `;
      }).join('');
      
    } catch (error) {
      summaryContainer.innerHTML = '<div class="loading">載入失敗</div>';
      itemsContainer.innerHTML = '';
    }
  }

  openAddPortfolio() {
    this.openModal('新增持股', `
      <div class="form-group">
        <label class="form-label">股票代碼</label>
        <input type="text" class="form-input" id="addPortfolioId" placeholder="如 2330" maxlength="6">
      </div>
      <div class="form-group">
        <label class="form-label">股數</label>
        <input type="number" class="form-input" id="addPortfolioShares" placeholder="1000">
      </div>
      <div class="form-group">
        <label class="form-label">成本價</label>
        <input type="number" class="form-input" id="addPortfolioCost" placeholder="100.5" step="0.01">
      </div>
      <button class="form-btn" onclick="app.submitAddPortfolio()">新增</button>
    `);
  }

  async submitAddPortfolio() {
    const stockId = document.getElementById('addPortfolioId').value.trim();
    const shares = document.getElementById('addPortfolioShares').value;
    const avgCost = document.getElementById('addPortfolioCost').value;
    
    if (!stockId || !shares || !avgCost) {
      this.showToast('請填寫完整資訊');
      return;
    }
    
    try {
      const response = await fetch(`${API_BASE}/portfolio`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stockId, shares: parseInt(shares), avgCost: parseFloat(avgCost) })
      });
      
      if (response.ok) {
        this.showToast('新增成功');
        this.closeModal();
        this.loadPortfolio();
      }
    } catch (error) {
      this.showToast('新增失敗');
    }
  }

  async removePortfolio(id) {
    if (!confirm('確定要刪除此持股？')) return;
    
    try {
      await fetch(`${API_BASE}/portfolio/${id}`, { method: 'DELETE' });
      this.showToast('已刪除');
      this.loadPortfolio();
    } catch (error) {
      this.showToast('操作失敗');
    }
  }

  // ==================== Alerts ====================

  async loadAlerts() {
    const container = document.getElementById('alertItems');
    container.innerHTML = '<div class="loading">載入中...</div>';
    
    try {
      const response = await fetch(`${API_BASE}/alert`);
      const items = await response.json();
      
      if (items.length === 0) {
        container.innerHTML = '<div class="loading">尚無到價提醒</div>';
        return;
      }
      
      container.innerHTML = items.map(item => `
        <div class="alert-item">
          <div class="item-header">
            <div>
              <div class="item-name">${item.stock_name}</div>
              <div class="item-id">${item.stock_id}</div>
            </div>
            <div>
              <div class="item-price">${item.condition === 'above' ? '高於' : '低於'} $${item.target_price}</div>
              <div class="item-change ${item.is_triggered ? 'up' : ''}">${item.is_triggered ? '✅ 已觸發' : '⏳ 等待中'}</div>
            </div>
          </div>
          <div class="item-actions">
            ${item.is_triggered ? `<button class="item-btn" onclick="app.resetAlert(${item.id})">重設</button>` : ''}
            <button class="item-btn danger" onclick="app.removeAlert(${item.id})">刪除</button>
          </div>
        </div>
      `).join('');
      
    } catch (error) {
      container.innerHTML = '<div class="loading">載入失敗</div>';
    }
  }

  openAddAlert() {
    this.openModal('新增到價提醒', `
      <div class="form-group">
        <label class="form-label">股票代碼</label>
        <input type="text" class="form-input" id="addAlertId" placeholder="如 2330" maxlength="6">
      </div>
      <div class="form-group">
        <label class="form-label">目標價</label>
        <input type="number" class="form-input" id="addAlertPrice" placeholder="1000" step="0.01">
      </div>
      <div class="form-group">
        <label class="form-label">條件</label>
        <select class="form-select" id="addAlertCondition">
          <option value="above">高於目標價</option>
          <option value="below">低於目標價</option>
        </select>
      </div>
      <button class="form-btn" onclick="app.submitAddAlert()">新增</button>
    `);
  }

  addPriceAlert(stockId, stockName) {
    this.openModal(`設定提醒：${stockName}`, `
      <div class="form-group">
        <label class="form-label">股票代碼</label>
        <input type="text" class="form-input" id="addAlertId" value="${stockId}" readonly>
      </div>
      <div class="form-group">
        <label class="form-label">目標價</label>
        <input type="number" class="form-input" id="addAlertPrice" placeholder="1000" step="0.01">
      </div>
      <div class="form-group">
        <label class="form-label">條件</label>
        <select class="form-select" id="addAlertCondition">
          <option value="above">高於目標價</option>
          <option value="below">低於目標價</option>
        </select>
      </div>
      <button class="form-btn" onclick="app.submitAddAlert()">新增</button>
    `);
  }

  async submitAddAlert() {
    const stockId = document.getElementById('addAlertId').value.trim();
    const targetPrice = document.getElementById('addAlertPrice').value;
    const condition = document.getElementById('addAlertCondition').value;
    
    if (!stockId || !targetPrice) {
      this.showToast('請填寫完整資訊');
      return;
    }
    
    try {
      const response = await fetch(`${API_BASE}/alert`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stockId, targetPrice: parseFloat(targetPrice), condition })
      });
      
      if (response.ok) {
        this.showToast('新增成功');
        this.closeModal();
        this.loadAlerts();
      }
    } catch (error) {
      this.showToast('新增失敗');
    }
  }

  async resetAlert(id) {
    try {
      await fetch(`${API_BASE}/alert/${id}/reset`, { method: 'POST' });
      this.showToast('已重設');
      this.loadAlerts();
    } catch (error) {
      this.showToast('操作失敗');
    }
  }

  async removeAlert(id) {
    if (!confirm('確定要刪除此提醒？')) return;
    
    try {
      await fetch(`${API_BASE}/alert/${id}`, { method: 'DELETE' });
      this.showToast('已刪除');
      this.loadAlerts();
    } catch (error) {
      this.showToast('操作失敗');
    }
  }

  // ==================== 語音播報控制 ====================

  voiceAutoPlay = false;  // 預設關閉，需手動開啟
  audioQueue = [];
  isPlaying = false;

  // 切換自動播報（網頁上的按鈕控制）
  toggleVoiceAutoPlay() {
    this.voiceAutoPlay = !this.voiceAutoPlay;
    
    if (this.voiceAutoPlay) {
      this.showToast('🔊 即時語音播報已開啟');
      this.updateVoiceButton(true);
      this.startAlertPolling();
    } else {
      this.showToast('🔇 即時語音播報已關閉');
      this.updateVoiceButton(false);
      // 清空佇列
      this.audioQueue = [];
      speechSynthesis.cancel();
    }
  }

  updateVoiceButton(isOn) {
    const btn = document.getElementById('voiceToggleBtn');
    if (btn) {
      btn.innerHTML = isOn ? '🔊' : '🔇';
      btn.title = isOn ? '關閉語音播報' : '開啟語音播報';
      btn.style.color = isOn ? '#00C851' : '#888';
    }
  }

  startAlertPolling() {
    if (this.alertPollInterval) return;
    
    // 每 30 秒檢查新警報
    this.alertPollInterval = setInterval(() => {
      if (this.voiceAutoPlay) {
        this.checkNewAlerts();
      }
    }, 30000);
  }

  async checkNewAlerts() {
    if (!this.voiceAutoPlay) return;
    
    try {
      const response = await fetch(`${API_BASE}/alert/logs?limit=1`);
      const logs = await response.json();
      
      if (logs.length > 0) {
        const latestAlert = logs[0];
        const lastAlertId = localStorage.getItem('lastAlertId');
        
        // 有新警報
        if (latestAlert.id !== parseInt(lastAlertId)) {
          localStorage.setItem('lastAlertId', latestAlert.id);
          this.autoPlayAlert(latestAlert);
        }
      }
    } catch (error) {
      // 忽略錯誤
    }
  }

  async autoPlayAlert(alert) {
    if (!this.voiceAutoPlay) return;
    
    const isUp = parseFloat(alert.change_percent) >= 0;
    const text = `${alert.stock_name}，${alert.alert_type}，` +
      `現價 ${alert.price} 元，` +
      `${isUp ? '上漲' : '下跌'} ${Math.abs(alert.change_percent)} 趴`;
    
    // 加入播放佇列
    this.audioQueue.push(text);
    this.processAudioQueue();
  }

  async processAudioQueue() {
    if (this.isPlaying || this.audioQueue.length === 0) return;
    if (!this.voiceAutoPlay) return;  // 再次確認
    
    this.isPlaying = true;
    const text = this.audioQueue.shift();
    
    try {
      const response = await fetch(`${API_BASE}/voice/speak`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text })
      });
      
      const data = await response.json();
      
      if (data.useBrowserTTS) {
        await this.speakWithBrowserAsync(text);
      } else if (data.dataUrl) {
        await this.playAudioAsync(data.dataUrl);
      }
    } catch (error) {
      // 備用：使用瀏覽器 TTS
      await this.speakWithBrowserAsync(text);
    }
    
    this.isPlaying = false;
    
    // 處理下一個
    if (this.audioQueue.length > 0 && this.voiceAutoPlay) {
      setTimeout(() => this.processAudioQueue(), 500);
    }
  }

  playAudioAsync(dataUrl) {
    return new Promise((resolve) => {
      const audio = new Audio(dataUrl);
      audio.onended = resolve;
      audio.onerror = resolve;
      audio.play().catch(resolve);
    });
  }

  speakWithBrowserAsync(text) {
    return new Promise((resolve) => {
      if ('speechSynthesis' in window) {
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.lang = 'zh-TW';
        utterance.rate = 1.0;
        utterance.onend = resolve;
        utterance.onerror = resolve;
        speechSynthesis.speak(utterance);
      } else {
        resolve();
      }
    });
  }

  // 手動播報股票（點擊 🔊 按鈕）
  async speakStockNow(stockId) {
    try {
      this.showToast('🔊 正在播報...');
      
      const response = await fetch(`${API_BASE}/stock/${stockId}`);
      const stock = await response.json();
      
      if (stock.error) {
        this.showToast('找不到股票');
        return;
      }
      
      const isUp = stock.change >= 0;
      const text = `${stock.name}，現價 ${stock.price} 元，` +
        `${isUp ? '上漲' : '下跌'} ${Math.abs(stock.changePercent).toFixed(2)} 趴`;
      
      // 直接播放，不用佇列
      this.speakWithBrowser(text);
      
    } catch (error) {
      this.showToast('播報失敗');
    }
  }

  // ==================== Settings ====================

  openSettings() {
    this.openModal('設定', `
      <div class="form-group">
        <label class="form-label">AI 評論風格</label>
        <select class="form-select" id="settingAiStyle">
          <option value="sarcastic">🔥 毒舌風格</option>
          <option value="professional">📊 專業風格</option>
        </select>
      </div>
      <div class="form-group">
        <label class="form-label">預設漲跌閾值 (%)</label>
        <input type="number" class="form-input" id="settingThreshold" value="3">
      </div>
      <div class="form-group">
        <label class="form-label">停損閾值 (%)</label>
        <input type="number" class="form-input" id="settingStopLoss" value="-10">
      </div>
      <div class="form-group">
        <label class="form-label">停利閾值 (%)</label>
        <input type="number" class="form-input" id="settingTakeProfit" value="20">
      </div>
      
      <hr style="border-color: rgba(255,255,255,0.1); margin: 20px 0;">
      <h4 style="margin-bottom: 15px;">🔊 語音播報設定</h4>
      
      <div class="form-group">
        <label class="form-label">啟用語音播報</label>
        <select class="form-select" id="settingVoiceEnabled">
          <option value="false">關閉</option>
          <option value="true">開啟</option>
        </select>
      </div>
      <div class="form-group">
        <label class="form-label">語音引擎</label>
        <select class="form-select" id="settingVoiceProvider" onchange="app.onVoiceProviderChange()">
          <option value="gemini">🤖 Google TTS（免費）</option>
          <option value="elevenlabs">🎙️ ElevenLabs（高品質）</option>
        </select>
      </div>
      <div class="form-group" id="voiceIdGroup" style="display:none;">
        <label class="form-label">ElevenLabs 聲音</label>
        <select class="form-select" id="settingVoiceId">
          <option value="pNInz6obpgDQGcFmaJgB">Adam（男聲，穩重）</option>
          <option value="EXAVITQu4vr4xnSDxMaL">Bella（女聲，溫柔）</option>
          <option value="21m00Tcm4TlvDq8ikWAM">Rachel（女聲，專業）</option>
          <option value="TxGEqnHWrfWFTfGW9XjX">Josh（男聲，年輕）</option>
          <option value="VR6AewLTigWG4xSOukaG">Arnold（男聲，深沉）</option>
        </select>
      </div>
      <div class="form-group">
        <button class="item-btn" onclick="app.testVoice()" style="width: 100%; padding: 12px;">
          🔊 測試語音
        </button>
      </div>
      
      <button class="form-btn" onclick="app.saveSettings()">儲存設定</button>
    `);
    
    // 載入現有設定
    this.loadSettings();
  }

  onVoiceProviderChange() {
    const provider = document.getElementById('settingVoiceProvider').value;
    const voiceIdGroup = document.getElementById('voiceIdGroup');
    voiceIdGroup.style.display = provider === 'elevenlabs' ? 'block' : 'none';
  }

  async testVoice() {
    const provider = document.getElementById('settingVoiceProvider').value;
    const voiceId = document.getElementById('settingVoiceId')?.value;
    
    this.showToast('🔊 正在生成語音...');
    
    try {
      const response = await fetch(`${API_BASE}/voice/test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider, voiceId })
      });
      
      const data = await response.json();
      
      if (data.error) {
        this.showToast('❌ ' + data.error);
        return;
      }
      
      // 播放語音
      if (data.useBrowserTTS) {
        // 使用瀏覽器 TTS
        this.speakWithBrowser(data.text);
      } else if (data.dataUrl) {
        const audio = new Audio(data.dataUrl);
        audio.play();
      }
      
      this.showToast('✅ 語音播放中');
      
    } catch (error) {
      this.showToast('❌ 測試失敗');
    }
  }

  speakWithBrowser(text) {
    if ('speechSynthesis' in window) {
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = 'zh-TW';
      utterance.rate = 1.0;
      speechSynthesis.speak(utterance);
    } else {
      this.showToast('瀏覽器不支援語音');
    }
  }

  async loadSettings() {
    try {
      const response = await fetch(`${API_BASE}/settings`);
      const settings = await response.json();
      
      if (settings.ai_style) {
        document.getElementById('settingAiStyle').value = settings.ai_style;
      }
      if (settings.price_threshold) {
        document.getElementById('settingThreshold').value = settings.price_threshold;
      }
      if (settings.stop_loss_percent) {
        document.getElementById('settingStopLoss').value = settings.stop_loss_percent;
      }
      if (settings.take_profit_percent) {
        document.getElementById('settingTakeProfit').value = settings.take_profit_percent;
      }
      // 語音設定
      if (settings.voice_enabled) {
        document.getElementById('settingVoiceEnabled').value = settings.voice_enabled;
      }
      if (settings.voice_provider) {
        document.getElementById('settingVoiceProvider').value = settings.voice_provider;
        this.onVoiceProviderChange();
      }
      if (settings.elevenlabs_voice_id) {
        const voiceIdSelect = document.getElementById('settingVoiceId');
        if (voiceIdSelect) {
          voiceIdSelect.value = settings.elevenlabs_voice_id;
        }
      }
    } catch (error) {
      console.error('載入設定失敗:', error);
    }
  }

  async saveSettings() {
    const settings = {
      ai_style: document.getElementById('settingAiStyle').value,
      price_threshold: document.getElementById('settingThreshold').value,
      stop_loss_percent: document.getElementById('settingStopLoss').value,
      take_profit_percent: document.getElementById('settingTakeProfit').value,
      voice_enabled: document.getElementById('settingVoiceEnabled').value,
      voice_provider: document.getElementById('settingVoiceProvider').value,
      elevenlabs_voice_id: document.getElementById('settingVoiceId')?.value || 'pNInz6obpgDQGcFmaJgB'
    };
    
    try {
      await fetch(`${API_BASE}/settings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings)
      });
      
      this.showToast('設定已儲存');
      this.closeModal();
    } catch (error) {
      this.showToast('儲存失敗');
    }
  }

  // ==================== Modal & Toast ====================

  openModal(title, content) {
    document.getElementById('modalTitle').textContent = title;
    document.getElementById('modalBody').innerHTML = content;
    document.getElementById('modal').classList.remove('hidden');
  }

  closeModal() {
    document.getElementById('modal').classList.add('hidden');
  }

  showToast(message) {
    const toast = document.getElementById('toast');
    toast.textContent = message;
    toast.classList.remove('hidden');
    
    setTimeout(() => {
      toast.classList.add('hidden');
    }, 3000);
  }
}

// 初始化應用程式
const app = new StockApp();
