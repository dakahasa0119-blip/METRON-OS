// Read-only startup status; opening help never invokes a worker or model.
(async()=>{
  const title=document.getElementById('setup-title'),detail=document.getElementById('setup-detail');
  try{
    const response=await fetch('/api/project/availability',{cache:'no-store'});
    if(!response.ok)throw Error('unavailable');
    const value=await response.json();
    if(value.registeredProjectsConfigured===true){
      title.textContent='選べる対象は所有者が準備済みです';
      detail.textContent=value.workerConfigured===true?
        '作業画面の起動用リンクから対象と範囲を確認してください。workerの設定はありますが、認証や実応答の成功を保証する表示ではありません。':
        '対象の確認はできます。候補を作るworkerは未設定なので、実行するには所有者による設定が必要です。';
    }else{
      title.textContent='この起動では、修理対象の初期準備がまだありません';
      detail.textContent='所有者に対象の準備と起動用リンクを依頼してください。下の初期設定の案内に、まだ必要な準備を記しています。';
    }
  }catch{
    title.textContent='準備状況を読み取れませんでした';
    detail.textContent='Miniが起動しているか確認してください。この案内からAIや修理を自動で再実行することはありません。';
  }
})();
