const fs = require('fs');
let content = fs.readFileSync('server/routes/line.js', 'utf8');

const oldCode = `    // 語音指令：語音 2330
    if (msg.startsWith('語音') || msg.startsWith('播報')) {
      const stockId = msg.replace(/^(語音|播報)\\s*/, '').trim();
      if (/^\\d{4,6}$/.test(stockId)) {
        return await sendVoiceReport(stockId, userId);
      }
      return { type: 'text', text: '請輸入：語音 股票代碼\\n例如：語音 2330' };
    }`;

const newCode = `    // 語音開關指令
    if (msg === '語音開' || msg === '開啟語音') {
      await pool.query("INSERT INTO settings (key, value) VALUES ('voice_enabled', 'true') ON CONFLICT (key) DO UPDATE SET value = 'true'");
      return { type: 'text', text: '🔊 語音播報已開啟！\\n\\n輸入「語音 2330」即可聽取報價' };
    }
    if (msg === '語音關' || msg === '關閉語音') {
      await pool.query("INSERT INTO settings (key, value) VALUES ('voice_enabled', 'false') ON CONFLICT (key) DO UPDATE SET value = 'false'");
      return { type: 'text', text: '🔇 語音播報已關閉' };
    }

    // 語音指令：語音 2330
    if (msg.startsWith('語音') || msg.startsWith('播報')) {
      const stockId = msg.replace(/^(語音|播報)\\s*/, '').trim();
      if (/^\\d{4,6}$/.test(stockId)) {
        return await sendVoiceReport(stockId, userId);
      }
      return { type: 'text', text: '請輸入：語音 股票代碼\\n例如：語音 2330' };
    }`;

if (content.includes(oldCode)) {
  content = content.replace(oldCode, newCode);
  fs.writeFileSync('server/routes/line.js', content, 'utf8');
  console.log('修改完成！');
} else {
  console.log('找不到要替換的程式碼，可能縮進不同');
}
