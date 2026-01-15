const fs = require('fs');
let content = fs.readFileSync('server/routes/line.js', 'utf8');

const oldCode = `  // 語音開關指令
  if (msg === '語音開' || msg === '開啟語音') {`;

const newCode = `  // 語音男女聲切換
  if (msg === '語音男' || msg === '男聲') {
    await pool.query("INSERT INTO settings (key, value) VALUES ('elevenlabs_voice_id', 'pNInz6obpgDQGcFmaJgB') ON CONFLICT (key) DO UPDATE SET value = 'pNInz6obpgDQGcFmaJgB'");
    return { type: 'text', text: '🎤 已切換為男聲（Adam）' };
  }
  if (msg === '語音女' || msg === '女聲') {
    await pool.query("INSERT INTO settings (key, value) VALUES ('elevenlabs_voice_id', '21m00Tcm4TlvDq8ikWAM') ON CONFLICT (key) DO UPDATE SET value = '21m00Tcm4TlvDq8ikWAM'");
    return { type: 'text', text: '🎤 已切換為女聲（Rachel）' };
  }

  // 語音開關指令
  if (msg === '語音開' || msg === '開啟語音') {`;

content = content.replace(oldCode, newCode);
fs.writeFileSync('server/routes/line.js', content, 'utf8');
console.log('男女聲切換功能已新增！');
