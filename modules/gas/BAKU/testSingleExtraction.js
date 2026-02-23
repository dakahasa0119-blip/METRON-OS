function testSingleExtraction() {
  // ▼▼▼ ここにリストにあるIDを1つだけ貼り付けてください ▼▼▼
  const TARGET_ID = "1Md0-AsJ-ZmY9pt_ClhXHPGBU_DgsAT7cOfAON6ZWwDM"; 
  // ▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲

  console.log(`💉 テスト吸引開始: ${TARGET_ID}`);
  const url = `https://script.googleapis.com/v1/projects/${TARGET_ID}/content`;
  const token = ScriptApp.getOAuthToken();
  
  // 生の通信結果を見る
  try {
    const response = UrlFetchApp.fetch(url, {
      "method": "get",
      "headers": { "Authorization": "Bearer " + token },
      "muteHttpExceptions": true // エラーでも止まらずに中身を表示させる
    });

    const code = response.getResponseCode();
    const text = response.getContentText();

    console.log(`📡 ステータスコード: ${code}`);
    console.log(`📄 レスポンス内容 (先頭500文字):`);
    console.log(text.substring(0, 500));

    if (code === 200) {
      const json = JSON.parse(text);
      if (json.files && json.files.length > 0) {
        console.log(`✅ 成功！ ${json.files.length} 個のファイルが含まれています。`);
        console.log(`内容例: ${json.files[0].source.substring(0, 100)}...`);
      } else {
        console.warn("⚠️ 成功しましたが、files が空です。プロジェクトが空っぽの可能性があります。");
      }
    } else {
      console.error("❌ 失敗！ このエラーメッセージが原因です↓");
    }

  } catch (e) {
    console.error("💀 通信以前のエラー: " + e.message);
  }
}