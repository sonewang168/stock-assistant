/**
 * 📱 股海秘書 Rich Menu 設定腳本
 * 
 * 使用方式：
 * 1. 設定環境變數 LINE_CHANNEL_ACCESS_TOKEN
 * 2. 執行 node setup-rich-menu.js
 */

const fs = require('fs');
const path = require('path');

const LINE_API = 'https://api.line.me/v2/bot';
const TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN;

if (!TOKEN) {
  console.error('❌ 請設定 LINE_CHANNEL_ACCESS_TOKEN 環境變數');
  process.exit(1);
}

const headers = {
  'Authorization': `Bearer ${TOKEN}`,
  'Content-Type': 'application/json'
};

// Rich Menu 設定
const richMenuData = {
  size: {
    width: 2500,
    height: 1686
  },
  selected: true,
  name: "股海秘書主選單",
  chatBarText: "📊 功能選單",
  areas: [
    {
      bounds: { x: 0, y: 0, width: 833, height: 843 },
      action: { type: "message", text: "大盤" }
    },
    {
      bounds: { x: 833, y: 0, width: 834, height: 843 },
      action: { type: "message", text: "查 " }
    },
    {
      bounds: { x: 1667, y: 0, width: 833, height: 843 },
      action: { type: "message", text: "監控" }
    },
    {
      bounds: { x: 0, y: 843, width: 833, height: 843 },
      action: { type: "message", text: "持股" }
    },
    {
      bounds: { x: 833, y: 843, width: 834, height: 843 },
      action: { type: "message", text: "熱門" }
    },
    {
      bounds: { x: 1667, y: 843, width: 833, height: 843 },
      action: { type: "message", text: "說明" }
    }
  ]
};

async function setupRichMenu() {
  console.log('📱 開始設定 Rich Menu...\n');

  try {
    // 1. 刪除舊的 Rich Menu
    console.log('🗑️ 清除舊的 Rich Menu...');
    const listRes = await fetch(`${LINE_API}/richmenu/list`, { headers });
    const listData = await listRes.json();
    
    if (listData.richmenus && listData.richmenus.length > 0) {
      for (const menu of listData.richmenus) {
        await fetch(`${LINE_API}/richmenu/${menu.richMenuId}`, {
          method: 'DELETE',
          headers
        });
        console.log(`   已刪除: ${menu.richMenuId}`);
      }
    }

    // 2. 建立新的 Rich Menu
    console.log('\n📝 建立新的 Rich Menu...');
    const createRes = await fetch(`${LINE_API}/richmenu`, {
      method: 'POST',
      headers,
      body: JSON.stringify(richMenuData)
    });
    
    const createData = await createRes.json();
    
    if (!createData.richMenuId) {
      console.error('❌ 建立失敗:', createData);
      return;
    }
    
    const richMenuId = createData.richMenuId;
    console.log(`   ✅ Rich Menu ID: ${richMenuId}`);

    // 3. 上傳圖片
    console.log('\n🖼️ 上傳圖片...');
    const imagePath = path.join(__dirname, 'rich-menu.jpg');
    
    if (!fs.existsSync(imagePath)) {
      console.error('❌ 找不到圖片: rich-menu.jpg');
      console.log('   請將 rich-menu-compressed.jpg 重新命名為 rich-menu.jpg 放在同目錄');
      return;
    }
    
    const imageBuffer = fs.readFileSync(imagePath);
    
    const uploadRes = await fetch(`https://api-data.line.me/v2/bot/richmenu/${richMenuId}/content`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${TOKEN}`,
        'Content-Type': 'image/jpeg'
      },
      body: imageBuffer
    });
    
    if (uploadRes.ok) {
      console.log('   ✅ 圖片上傳成功');
    } else {
      const err = await uploadRes.json();
      console.error('❌ 圖片上傳失敗:', err);
      return;
    }

    // 4. 設為預設 Rich Menu
    console.log('\n⚙️ 設為預設選單...');
    const defaultRes = await fetch(`${LINE_API}/user/all/richmenu/${richMenuId}`, {
      method: 'POST',
      headers
    });
    
    if (defaultRes.ok) {
      console.log('   ✅ 已設為預設選單');
    } else {
      const err = await defaultRes.json();
      console.error('❌ 設定預設失敗:', err);
    }

    console.log('\n🎉 Rich Menu 設定完成！');
    console.log('   請在 LINE 中重新開啟對話確認');

  } catch (error) {
    console.error('❌ 錯誤:', error.message);
  }
}

setupRichMenu();
