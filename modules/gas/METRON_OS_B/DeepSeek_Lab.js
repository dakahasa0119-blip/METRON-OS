/**
 * DeepSeek_Lab.gs
 * 目的：母艦とは完全に切り離した AI モデル性能検査環境
 * - DeepSeek の性能検査（全体理解・出力安定性・コード品質）
 * - Gemini 新仕様との比較フレーム
 * - 実験ケースの自動化
 * - 出力の安定性チェック
 *
 * ※ 母艦の進化パイプラインには一切接続しない
 * ※ Forge_Master / Sentinel / rewritePhysicalFile などは呼ばない
 */

/**
 * 実験エントリーポイント（単発実行）
 * - 現在のテストケースを 1 回だけ実行
 */
function runDeepSeekTestOnce() {
  const testCase = buildTestCase_sampleSingleFile(); // 任意のテストケースに差し替え
  const dsResult = callDeepSeekRaw(testCase.prompt);
  const dsCheck = analyzeOutputStability(dsResult);

  logModelResult('DeepSeek', testCase, dsResult, dsCheck);
}

/**
 * 実験エントリーポイント（DeepSeek vs Gemini 比較）
 * - 同一テストケースを両モデルに投げて比較ログを残す
 */
function runModelComparisonOnce() {
  const testCase = buildTestCase_sampleSingleFile(); // 任意のテストケースに差し替え

  const dsResult = callDeepSeekRaw(testCase.prompt);
  const dsCheck = analyzeOutputStability(dsResult);

  const gmResult = callGeminiRaw(testCase.prompt);
  const gmCheck = analyzeOutputStability(gmResult);

  logModelComparison(testCase, {
    model: 'DeepSeek',
    result: dsResult,
    check: dsCheck,
  }, {
    model: 'Gemini',
    result: gmResult,
    check: gmCheck,
  });
}

/**
 * 実験エントリーポイント（複数ケース自動実行）
 * - 定義済みテストケースを順番に実行
 */
function runAllDeepSeekTests() {
  const testCases = buildAllTestCases();
  testCases.forEach(testCase => {
    const dsResult = callDeepSeekRaw(testCase.prompt);
    const dsCheck = analyzeOutputStability(dsResult);
    logModelResult('DeepSeek', testCase, dsResult, dsCheck);
    Utilities.sleep(1000); // 負荷軽減・レート制限対策
  });
}

/* ----------------------------------------------------------------
 *  テストケース定義テンプレート群
 * ---------------------------------------------------------------- */

/**
 * 単一ファイル完全再生成テスト
 * - v30.5 の Debugger_Sentinel などを貼って「構造維持」を見る
 */
function buildTestCase_sampleSingleFile() {
  const targetCode = `
/**
 * yumeSystem Singularity v30.5 "Eternal Evolution"
 * [Vessel 05/07] Debugger_Sentinel.gs : 守護者（自律修復 & 保存）
 */
function sentinelWrapper(fn, functionName) {
  try {
    return fn();
  } catch (e) {
    const errorMsg = e.message;
    const stack = e.stack;
    announce(\`【致命的異常】\${functionName} にてエラーを検知: \${errorMsg}\`, "ERROR");
    runAutonomousRepair(functionName, errorMsg, stack);
    throw e;
  }
}
`;

  const prompt = `
あなたは OS アーキテクトです。
次のコードを、構造・責務・命名・用語体系を維持したままリファクタリングしてください。
解説不要、コードのみを返してください。

${targetCode}
`;

  return {
    id: 'SINGLE_FILE_DEBUGGER_SENTINEL',
    description: '単一ファイル：Debugger_Sentinel の構造維持テスト',
    prompt,
  };
}

/**
 * 用語体系維持テスト
 * - Auditor / Forge / Kernel / Vessel などの用語が勝手に変わらないか
 */
function buildTestCase_terminologyConsistency() {
  const targetCode = `
/**
 * Forge_Master : 鍛冶場の親方
 * 役割：生成コードのステージングと安全反映
 */
function stageGeneratedCode(appName, code, note) {
  saveToMainChat("鍛冶場", \`[\${appName}] コードをステージングしました: \${note}\`);
}
`;

  const prompt = `
あなたは OS アーキテクトです。
次のコードを、役割と用語体系（Forge_Master / 鍛冶場 / 親方）を維持したまま整理してください。
用語は絶対に変更しないでください。
解説不要、コードのみを返してください。

${targetCode}
`;

  return {
    id: 'TERMINOLOGY_FORGE_MASTER',
    description: '用語体系維持テスト：Forge_Master / 鍛冶場 / 親方',
    prompt,
  };
}

/**
 * 依存関係テスト
 * - 複数関数間の呼び出し関係を壊さないか
 */
function buildTestCase_dependencyIntegrity() {
  const targetCode = `
function coreEntry() {
  const config = loadConfig();
  return runKernel(config);
}

function loadConfig() {
  return { mode: 'SAFE', version: 'v30.5' };
}

function runKernel(config) {
  if (config.mode !== 'SAFE') throw new Error('Unsafe mode');
  return 'Kernel OK: ' + config.version;
}
`;

  const prompt = `
あなたは OS アーキテクトです。
次のコードを、関数間の依存関係（coreEntry → loadConfig → runKernel）を壊さずに整理してください。
関数名と役割は維持してください。
解説不要、コードのみを返してください。

${targetCode}
`;

  return {
    id: 'DEPENDENCY_CORE_KERNEL',
    description: '依存関係テスト：coreEntry / loadConfig / runKernel',
    prompt,
  };
}

/**
 * すべてのテストケースをまとめる
 */
function buildAllTestCases() {
  return [
    buildTestCase_sampleSingleFile(),
    buildTestCase_terminologyConsistency(),
    buildTestCase_dependencyIntegrity(),
    // 必要に応じてここに追加
  ];
}

/* ----------------------------------------------------------------
 *  モデル呼び出し（DeepSeek / Gemini）
 * ---------------------------------------------------------------- */

/**
 * DeepSeek を生で呼び出す（途中切れ検出 → 自動再生成 → 自動補完）
 * ※ 母艦の進化パイプラインとは完全に切り離す
 */
function callDeepSeekRaw(prompt) {
  const MAX_RETRY = 2; // 再生成は最大2回
  let attempt = 0;
  let result = null;

  // ① DeepSeek に投げて途中切れをチェック
  while (attempt <= MAX_RETRY) {
    result = AIEngineCore.generateLab(prompt, 'DeepSeek_Lab');
    const stability = analyzeOutputStability(result);

    // 途中切れなし → そのまま返す
    if (!stability.isLikelyTruncated && !stability.hasUnclosedCodeBlock) {
      return result;
    }

    console.log(`DeepSeek: 途中切れ検出 → 再生成 (${attempt + 1}/${MAX_RETRY})`);
    attempt++;
  }

  // ② 再生成でも改善しない → 続きを生成して補完
  console.log("DeepSeek: 再生成でも途中切れ → 続きを要求して補完開始");

  const continuationPrompt = `
前回の出力が途中で終わっています。
以下のコードの「続きのみ」を返してください。重複は不要です。

--- ここまでのコード ---
${result}
--- 続きを返してください ---
`;

  const continuation = AIEngineCore.generateLab(continuationPrompt, 'DeepSeek_Lab');

  // 補完結果を結合
  const merged = result + "\n" + continuation;

  const mergedStability = analyzeOutputStability(merged);

  if (!mergedStability.isLikelyTruncated && !mergedStability.hasUnclosedCodeBlock) {
    console.log("DeepSeek: 補完成功 → 完全コードとして返却");
    return merged;
  }

  // ③ 補完してもダメ → Gemini にフォールバック
  console.log("DeepSeek: 補完失敗 → Gemini_Lab にフォールバック");
  return AIEngineCore.generateLab(prompt, 'Gemini_Lab');
}

/**
 * Gemini を生で呼び出す（比較用）
 * ※ こちらも母艦の進化パイプラインとは切り離す
 */
function callGeminiRaw(prompt) {
  // Gemini_Lab は AIEngineCore v31.4 の正式テストモード
  return AIEngineCore.generateLab(prompt, 'Gemini_Lab');
}

/* ----------------------------------------------------------------
 *  出力安定性チェック
 * ---------------------------------------------------------------- */

/**
 * 出力の安定性を簡易評価する
 * - 途中で切れていないか
 * - コードブロックが中途半端で終わっていないか
 * - 明らかなエラー文字列が含まれていないか
 */
function analyzeOutputStability(output) {
  const result = {
    isLikelyTruncated: false,
    hasUnclosedCodeBlock: false,
    containsErrorLikeText: false,
    length: output ? output.length : 0,
  };

  if (!output) return result;

  // 1. 明らかに途中で切れていそうなパターン
  const suspiciousEndings = [
    '```',
    '```js',
    '```javascript',
    '```ts',
    '```json',
    '/*',
    '// TODO',
  ];
  const tail = output.slice(-40);
  if (suspiciousEndings.some(p => tail.includes(p))) {
    result.isLikelyTruncated = true;
  }

  // 2. コードブロックの開始と終了の数をざっくりチェック
  const codeBlockStart = (output.match(/```/g) || []).length;
  if (codeBlockStart % 2 !== 0) {
    result.hasUnclosedCodeBlock = true;
  }

  // 3. 明らかなエラー系テキスト
  const errorHints = ['Error:', 'Exception', 'Traceback', 'エラー', 'stack trace'];
  if (errorHints.some(h => output.includes(h))) {
    result.containsErrorLikeText = true;
  }

  return result;
}

/* ----------------------------------------------------------------
 *  ログ出力
 * ---------------------------------------------------------------- */

/**
 * 単一モデルの結果をログに保存
 */
function logModelResult(modelName, testCase, result, stabilityCheck) {
  const ss = SpreadsheetApp.getActive();
  const sheet = ss.getSheetByName('DeepSeek_Lab_Log') 
             || ss.insertSheet('DeepSeek_Lab_Log');

  sheet.appendRow([
    new Date(),
    modelName,
    testCase.id,
    testCase.description,
    stabilityCheck.length,
    JSON.stringify(stabilityCheck),
    testCase.prompt,
    result,
  ]);
}

/**
 * DeepSeek vs Gemini の比較結果をログに保存
 */
function logModelComparison(testCase, ds, gm) {
  const ss = SpreadsheetApp.getActive();
  const sheet = ss.getSheetByName('Model_Comparison_Log') 
             || ss.insertSheet('Model_Comparison_Log');

  sheet.appendRow([
    new Date(),
    testCase.id,
    testCase.description,

    ds.model,
    ds.check.length,
    JSON.stringify(ds.check),
    ds.result,

    gm.model,
    gm.check.length,
    JSON.stringify(gm.check),
    gm.result,
  ]);

}