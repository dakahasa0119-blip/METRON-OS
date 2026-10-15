# 村の仕事継続経路 — Windows実行記録（2026-10-15）

今回の変更は、公開main `d10e87c80c0aa5dfcfa01ac1a8b2a5aea02b97f3` を基にした
ARC修正と村の仕事継続の統合である。この文書はローカルWindowsで観測した結果を
記録する。GitHub CIの結果とは区別し、実外部AIへの送信は行っていない。

実装契約・保存先・HTTPの使い方は
[村の仕事とBAKUの継続契約](METRON_MINI_WORK_CONTINUITY_2026-10-15.md)を参照。
ここでは実際に観測した結果と未検証事項を記録する。

## 検証した一連の経路

実Gatewayと母艦受信ファイルに保存した本文を選び、同じ村の採用済み知識を
利用者が選択して仕事を作成する。目的・元本文とハッシュ・知識と由来は、
同じ仕事ID・BAKU案件IDに固定され、修復プロンプトへ実際に入る。
修正候補は隔離された教材ソースへ適用され、別Nodeプロセスの公開・確認テストで
検査される。候補・失敗・実行先と承認履歴・結果は同じ村へ保存される。

Gatewayの`done`は元本文の配送完了であり、仕事を完了扱いする条件ではない。
検証を通った修復候補も、本番未適用・人の確認待ちである。

モデル応答には、**注入した試験reasonerまたはfetch模擬**を用いた。
実AIの推論成功を証明する試験ではない。ファイル保存、HTTP、Gateway、
修正ソースの検査子プロセス、以下のChromium操作と停止試験は実行した。

## 試験結果

Windows、開発用Node.js `v24.18.0`で実行。
通常Windows実行の承認審査を経て、サンドボックス内の既知のrename・
loopback制約とは区別して検証した。既存運用データ・
利用者のブラウザプロファイルは使用していない。

| 試験 | 結果 | 記録 |
| --- | --- | --- |
| 修復・仕事・UI局所試験 | 40成功、失敗0、skip 0 | `task/metron-work-targeted-final.tap` |
| 実Chromiumのローカル操作 | 1成功、失敗0、skip 0 | `task/metron-work-browser.tap` |
| 全回帰試験 | **229成功、失敗0、skip 0**、49.3秒 | `task/metron-work-full.tap` |

全体試験の実行コマンド:

```powershell
$metronTestRoot=Join-Path $env:TEMP ("metron-validation-"+[guid]::NewGuid())
New-Item -ItemType Directory -Path $metronTestRoot | Out-Null
$env:TEMP=$metronTestRoot
$env:TMP=$env:TEMP
$env:METRON_WORK_EVIDENCE_DIR=Join-Path $metronTestRoot "evidence"
node --test --test-concurrency=1 --test-reporter=tap --test-reporter-destination=../metron-work-full.tap reusable/tests/*.test.mjs
```

`METRON_WORK_EVIDENCE_DIR`は今回の試験専用設定で、人工データと証拠を
Gitコピー外へ残す。未指定時は試験の一時データを削除する。
試験子プロセス・HTTPサーバーは終了済み。アプリ終了・OS設定変更は行っていない。

## 実Chromiumでの操作と読み戻し

`mini-work-browser.test.mjs`は、新規一時プロファイルの既存Chromiumを使い、
実画面の入力・選択・ボタンクリックで処理を行った。テスト用の別loopback
プロキシが同一Originの外部ドライバースクリプトを挿入する。
そのテスト内のHost/Origin変換は明示した模擬輸送であり、
ARC拡張のOriginや通常ログイン済みChatGPTの動作を証明しない。
製品側のHost/Origin検査とCSPは緩和していない。

全体試験時の識別子:

```text
workId: work_86bd944e53a1404ebf372a1f98c17b54
runId: case_548faacf02d347b0ba5087b42e5cdc91
sourceMessageId: browser_source
sourceBodySha256: 6b5f10dc7d3c69f4c203ed8ddb60af3f695e69fe8fbba18f372d462005b3b6b1
knowledgeId: knowledge_r_1a676e213a95419a845d8e6c37076a82
sourceVillage: village-2 / adoptedIn: village-1
rumorSha256: 9781ea3741100137791575e9ebfab05acef5a9aec6daf8a8e08aaf38318806b1
```

| 実画面で行った操作 | 注入reasoner呼出回数 |
| --- | --- |
| 本文・目的・採用知識を選び、仕事を保存 | 0 |
| 明示実行で最初の候補を検査し、公開テスト失敗を保存 | 1 |
| 画面を再読込みし、同じ仕事と失敗を読み戻し | 1 |
| 別のプロバイダー選択と今回の承認を行い、明示再開 | 2 |
| 検証済み候補の共有下書きを編集・保存して再読込み | 2 |

両プロンプトには元の目的・保存本文・選択した採用知識とRumorハッシュが入り、
再開プロンプトには前の修正ソース・診断・実際の公開テスト失敗が入っていた。
仕事台帳、修復ジャーナル、画面の結果、モデルに渡した内容を照合した。
元本文ハッシュと知識の由来も保存記録と一致した。

共有候補は人の確認待ちのローカル下書きとして読み戻せた。
Rumor本体は従来の九項目・320文字・チェックサム契約のままであり、
Village Squareと別村の保存状態は変化していなかった。

証拠（このPCの作業フォルダ内、公開していない）:

```text
task/metron-evidence/village-work-full/metron-work-browser-LKGncY/browser-work-evidence.json
task/metron-evidence/village-work-full/metron-work-browser-LKGncY/browser-dom.html
task/metron-evidence/village-work-full/metron-work-browser-LKGncY/data/work-ledger/<workId>.json
task/metron-evidence/village-work-full/metron-work-browser-LKGncY/data/work-repair/<workId>/baku-agent-journal/<runId>.json
```

## 実プロセス停止と、検証境界の試験

別試験では、注入reasonerが応答待ちになったNode子プロセスを実際に停止した。
同じ永続ファイルから再構築すると、仕事は`running`から`interrupted`へ変わり、
呼出結果は未確認として残った。再構築・状態取得時の新しい呼出回数は0、
利用者の明示再開後に1回となり、同じ仕事・案件IDで候補を検証した。

```text
workId: work_df5af21c5338435ebc00f3134fc8e3ef
runId: case_fa5146c3d9e643cd820f6d8118fc5d5d
explicitStop: {"code":null,"signal":"SIGTERM"}
task/metron-evidence/process-stop-review-0bcaa38d70464b6499c9878a22ba9bc6/evidence/metron-work-pjh7yG/actual-stop-evidence.json
```

HTTPサーバーを閉じて再構築し、別の明示AI選択で失敗候補と文脈を継承した証拠は
`task/metron-evidence/village-work-full/metron-work-r0aw2o/test-context-evidence.json`にある。

公開検査通過直後・確認検査前の窓は、その状態を表すチェックポイントを
人工的に作る別試験で検証した。4回目の候補でも、明示再開で保存候補の検査だけを
続け、追加モデル呼出しは0、候補回数は4のまま完了した。
この境界そのものを実停止したという証拠とは区別する。

## 停止試験の公開前再確認

未解決Promiseだけでは子プロセスが先に終了し得る試験の競合を修正した。
生存ハンドルを保持し、spawn直後から終了を監視して、明示停止前の生存と
killの成功を検査する。上記の停止試験IDは補強後の再実行で、対象1件成功・失敗0。
全229件のローカル記録とは区別し、最新HEADの全体確認はGitHub CIで行う。

## 独立レビューで修正した点

- 公開検査通過後の停止で、保存候補の確認検査を続けずにモデルへ
  再提案させる隙間を修正した。候補予算を使い切っていても検証だけを明示再開できる。
- ESM再exportによる確認テストの読込みを拒否し、公開テストの実行領域から
  確認テストを物理的に分離した。確認失敗は次の修正プロンプトへ渡さない。
- 別の村操作中に仕事選択がずれるUI競合を修正し、送信直前の村・仕事IDも照合する。
- 中断した呼出先・モデル・結果未確認の記録を、画面でも読み返せるようにした。

最終ソースの再確認では、独立レビュアーの具体的な残存指摘はなかった。
ハッシュは保存内容の照合であり、外部AIや利用者の認証ではない。

## 未検証・対象外

実外部AI、通常ログイン済みChatGPTとARC拡張、異なるPC間のP2P、
本番ソースへの適用、汎用的な未知故障の修復能力は今回証明していない。
修復対象は同梱の教材二ファイルに限られる。単一書込みのローカルJSONを使い、
外部副作用のexactly-onceや複数プロセス間ロックを提供しない。

今回の成果は、村の文脈・知識・同じ仕事を実行経路へ渡して明示継続する
制御経路の統合であり、METRON全体の完成ではない。
