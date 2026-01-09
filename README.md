# 📊 股海秘書 LINE 秘書

> 台股即時監控 × AI 毒舌評論 × LINE 推播通知 × 手機 PWA

![Node.js](https://img.shields.io/badge/Node.js-18+-green)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-15+-blue)
![License](https://img.shields.io/badge/License-MIT-yellow)

---

## ✨ 功能特色

| 功能 | 說明 |
|------|------|
| 📈 即時股價 | 台股/上櫃即時報價（證交所 API）|
| 🚨 智慧警報 | 漲跌幅、均線突破、N日高低點 |
| 🤖 AI 評論 | Gemini 毒舌/專業風格可切換 |
| 💬 LINE 推播 | Flex Message 精美圖文卡片 |
| 📊 技術分析 | RSI、KD、MACD、布林通道 |
| 💰 籌碼追蹤 | 三大法人買賣超 |
| 💼 持股管理 | 損益追蹤、停損停利警報 |
| 🎯 到價提醒 | 目標價自動通知 |
| 📱 手機優化 | PWA 支援，可加到主畫面 |

---

## 🏗️ 系統架構

```
┌─────────────────────────────────────────────────────────┐
│                   📱 手機 / 電腦瀏覽器                    │
│                    PWA 響應式 Web App                    │
└─────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────┐
│                    Render.com 雲端                       │
├─────────────────────────────────────────────────────────┤
│  ┌─────────────┐   ┌─────────────┐   ┌─────────────┐   │
│  │  Frontend   │   │   Backend   │   │ PostgreSQL  │   │
│  │ Static HTML │◄─►│  Express.js │◄─►│  Database   │   │
│  └─────────────┘   └─────────────┘   └─────────────┘   │
│                           │                             │
│         ┌─────────────────┼─────────────────┐          │
│         ▼                 ▼                 ▼          │
│  ┌───────────┐    ┌───────────┐     ┌───────────┐     │
│  │ 證交所API │    │ Gemini AI │     │ LINE Bot  │     │
│  └───────────┘    └───────────┘     └───────────┘     │
│                                                        │
│  ┌────────────────────────────────────────────────┐   │
│  │              ⏰ Cron Jobs 排程                  │   │
│  │  • 盤中監控 09:00-13:30 每 5 分鐘              │   │
│  │  • 收盤日報 13:35                              │   │
│  │  • 籌碼更新 15:00                              │   │
│  └────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
```

---

## 🚀 部署教學（GitHub + Render）

### 📋 事前準備

1. **GitHub 帳號** - https://github.com
2. **Render 帳號** - https://render.com（可用 GitHub 登入）
3. **LINE 開發者帳號** - https://developers.line.biz
4. **Google AI Studio** - https://aistudio.google.com

---

### Step 1️⃣：上傳到 GitHub

```bash
# 1. 建立新的 Repository
# 前往 https://github.com/new
# Repository name: stock-assistant
# 選擇 Private（私人）

# 2. 在本地初始化 Git
cd stock-assistant
git init
git add .
git commit -m "Initial commit"

# 3. 連接到 GitHub
git remote add origin https://github.com/你的帳號/stock-assistant.git
git branch -M main
git push -u origin main
```

---

### Step 2️⃣：建立 LINE Messaging API

1. 前往 [LINE Developers Console](https://developers.line.biz/console/)

2. **建立 Provider**
   - 點擊「Create」
   - 輸入名稱（如：股海秘書）

3. **建立 Messaging API Channel**
   - 選擇剛建立的 Provider
   - 點擊「Create a new channel」
   - 選擇「Messaging API」
   - 填寫資訊：
     - Channel name: 股海秘書
     - Channel description: 台股監控助理
     - Category: 金融
     - Subcategory: 投資

4. **取得必要資訊**
   - **Channel secret**: Basic settings → Channel secret
   - **Channel access token**: Messaging API → Issue (長期)
   
5. **設定 Webhook**
   - Messaging API → Webhook settings
   - Webhook URL: `https://你的app.onrender.com/webhook`
   - Use webhook: 開啟
   - 關閉「Auto-reply messages」和「Greeting messages」

6. **取得 User ID**
   - 加入你的 LINE Bot 好友
   - 傳送任意訊息
   - 部署後會自動記錄到資料庫

---

### Step 3️⃣：取得 Gemini API Key

1. 前往 [Google AI Studio](https://aistudio.google.com/)
2. 點擊「Get API key」
3. 建立新的 API Key
4. 複製保存

---

### Step 4️⃣：部署到 Render

#### 方法一：使用 render.yaml（推薦）

1. 前往 [Render Dashboard](https://dashboard.render.com/)
2. 點擊「New +」→「Blueprint」
3. 連接你的 GitHub Repository
4. Render 會自動讀取 `render.yaml` 並建立：
   - Web Service（Node.js 應用）
   - PostgreSQL 資料庫

5. 設定環境變數：
   - 點擊 Web Service → Environment
   - 新增以下變數：

| Key | Value |
|-----|-------|
| `LINE_CHANNEL_TOKEN` | 你的 Channel Access Token |
| `LINE_CHANNEL_SECRET` | 你的 Channel Secret |
| `GEMINI_API_KEY` | 你的 Gemini API Key |

6. 等待部署完成（約 3-5 分鐘）

#### 方法二：手動建立

**1. 建立 PostgreSQL**
- New + → PostgreSQL
- Name: `stock-assistant-db`
- Region: Singapore
- Plan: Free
- 建立後複製 Internal Database URL

**2. 建立 Web Service**
- New + → Web Service
- 連接 GitHub Repository
- 設定：
  - Name: `stock-assistant`
  - Region: Singapore
  - Branch: main
  - Runtime: Node
  - Build Command: `npm install`
  - Start Command: `npm start`
  - Plan: Free

**3. 設定環境變數**
- Environment → Add Environment Variable
- 加入上述所有變數
- `DATABASE_URL` 填入 PostgreSQL 的 Internal URL

---

### Step 5️⃣：初始化資料庫

部署完成後，需要初始化資料庫：

#### 方法一：使用 Render Shell

1. 在 Render Dashboard 點擊你的 Web Service
2. 點擊「Shell」標籤
3. 執行：

```bash
npm run db:init
```

#### 方法二：訪問初始化 API

在瀏覽器打開：
```
https://你的app.onrender.com/api/health
```

首次訪問時會自動初始化資料庫。

---

### Step 6️⃣：設定 LINE Webhook

1. 回到 LINE Developers Console
2. Messaging API → Webhook settings
3. Webhook URL 填入：
   ```
   https://你的app.onrender.com/webhook
   ```
4. 點擊「Verify」確認連接成功
5. 開啟「Use webhook」

---

### Step 7️⃣：測試

1. **網頁測試**
   - 打開 `https://你的app.onrender.com`
   - 應該看到開機動畫和主畫面

2. **LINE 測試**
   - 對 Bot 傳送「2330」
   - 應該收到台積電的股價資訊

3. **推播測試**
   - 在網頁加入監控股票
   - 等待盤中觸發警報

---

## 📱 手機安裝 PWA

### iOS (Safari)
1. 用 Safari 打開網站
2. 點擊「分享」按鈕
3. 選擇「加入主畫面」

### Android (Chrome)
1. 用 Chrome 打開網站
2. 點擊右上角「⋮」選單
3. 選擇「加入主畫面」

---

## 📁 專案結構

```
stock-assistant/
├── client/                 # 前端
│   ├── index.html         # 主頁面
│   ├── manifest.json      # PWA 設定
│   ├── css/
│   │   └── style.css      # 樣式
│   └── js/
│       └── app.js         # 前端邏輯
│
├── server/                 # 後端
│   ├── index.js           # Express 主程式
│   ├── db/
│   │   ├── index.js       # 資料庫連接
│   │   └── init.js        # 初始化腳本
│   ├── routes/
│   │   ├── stock.js       # 股票 API
│   │   ├── watchlist.js   # 監控清單 API
│   │   ├── portfolio.js   # 持股 API
│   │   ├── alert.js       # 提醒 API
│   │   ├── line.js        # LINE Webhook
│   │   └── settings.js    # 設定 API
│   ├── services/
│   │   ├── stockService.js      # 股價服務
│   │   ├── technicalService.js  # 技術分析
│   │   ├── aiService.js         # AI 評論
│   │   └── lineService.js       # LINE 推播
│   └── cron/
│       └── scheduler.js   # 排程任務
│
├── .env.example           # 環境變數範本
├── .gitignore
├── package.json
├── render.yaml            # Render 部署設定
└── README.md
```

---

## 🔧 API 端點

| Method | Endpoint | 說明 |
|--------|----------|------|
| GET | `/api/health` | 健康檢查 |
| GET | `/api/stock/list` | 股票清單 |
| GET | `/api/stock/:id` | 即時股價 |
| GET | `/api/stock/:id/full` | 完整資訊（股價+技術+籌碼）|
| GET | `/api/stock/:id/technical` | 技術指標 |
| GET | `/api/stock/:id/chip` | 籌碼資料 |
| POST | `/api/stock/batch` | 批次查詢 |
| GET | `/api/watchlist` | 監控清單 |
| POST | `/api/watchlist` | 新增監控 |
| DELETE | `/api/watchlist/:id` | 移除監控 |
| GET | `/api/portfolio` | 持股列表 |
| GET | `/api/portfolio/performance` | 持股損益 |
| POST | `/api/portfolio` | 新增持股 |
| GET | `/api/alert` | 到價提醒 |
| POST | `/api/alert` | 新增提醒 |
| GET | `/api/settings` | 取得設定 |
| PUT | `/api/settings` | 更新設定 |
| POST | `/webhook` | LINE Webhook |

---

## ⏰ 自動排程

| 排程 | 時間 | 說明 |
|------|------|------|
| 盤中監控 | 09:00-13:30 每 5 分鐘 | 檢查股價、觸發警報 |
| 收盤日報 | 13:35 | 發送每日總結 |
| 籌碼更新 | 15:00 | 抓取三大法人 |
| 資料清理 | 03:00 | 清除舊資料 |

---

## 🗃️ 資料庫結構

```sql
-- 股票清單
stocks (id, name, market)

-- 監控清單
watchlist (id, stock_id, user_id, custom_threshold, is_active)

-- 持股組合
portfolio (id, stock_id, user_id, shares, avg_cost)

-- 到價提醒
price_alerts (id, stock_id, target_price, condition, is_triggered)

-- 價格歷史
price_history (id, stock_id, date, open, high, low, close, volume)

-- 籌碼資料
chip_data (id, stock_id, date, foreign_buy, investment_buy, dealer_buy)

-- 推播紀錄
alert_logs (id, stock_id, alert_type, price, ai_comment)

-- 系統設定
settings (key, value)
```

---

## 🔐 安全注意事項

1. **環境變數**：絕對不要將 `.env` 上傳到 GitHub
2. **API Key**：定期更換，監控使用量
3. **Rate Limit**：已內建 API 限流保護
4. **HTTPS**：Render 自動提供 SSL 憑證

---

## 🐛 疑難排解

### Render 部署失敗
- 檢查 `package.json` 的 Node 版本
- 查看 Deploy logs 找錯誤訊息

### 資料庫連不上
- 確認 `DATABASE_URL` 格式正確
- 使用 Internal URL（不是 External）

### LINE Webhook 失敗
- 確認 URL 是 HTTPS
- 檢查 Channel Token 是否正確
- Verify 按鈕測試連接

### 股價抓不到
- 證交所 API 有時會限流
- 非交易時間可能無資料

### 排程沒執行
- 免費版 Render 會休眠
- 可用 UptimeRobot 保持喚醒

---

## 📈 效能優化建議

1. **升級 Render 方案**：避免休眠
2. **加入快取**：Redis 快取股價
3. **CDN**：靜態資源用 CloudFlare
4. **監控**：設定 UptimeRobot

---

## 📜 授權

MIT License

---

## 🤝 貢獻

歡迎 Pull Request！

---

## ⚠️ 免責聲明

本工具僅供學習研究，不構成投資建議。投資有風險，請謹慎評估。

---

Made with ❤️ by 股海秘書團隊
