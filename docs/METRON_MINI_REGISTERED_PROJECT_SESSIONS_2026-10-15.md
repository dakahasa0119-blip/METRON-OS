# 登録プロジェクトの coding-agent セッション

村の仕事に、利用者がローカルで登録した Git プロジェクトの修復セッションを結び付ける。
対象のソース、公開再現テスト、独立した受入テスト、適用後テストを先に固定し、
作業者が報告した候補を別プロセスで実行して確認する。通常の村の仕事、外部ワーカーの
受け渡し、既存の二ファイル実験は引き続き別の実行経路として扱う。

この機能には Node.js 24 以降と Git が必要。依存パッケージのインストールは不要。
検証は Node の permission model と `--test-isolation=none` を使う。
信頼できる自作の小規模 Node/ESM プロジェクトを対象とし、悪意あるコードを安全に
実行する OS コンテナの代わりにはしない。

## ローカル登録

登録ファイルは次のオブジェクトの配列。HTTP からパスや任意のシェルコマンドを
登録する API はない。以下の七つのディレクトリはあらかじめ作成し、相互に重ならない
場所を指定する。先頭の四つは同じ Git リポジトリに属する別の checkout/worktree とする。

```json
[
  {
    "id": "my-project",
    "label": "My project",
    "repositoryRoot": "/absolute/project/repository",
    "baselineRoot": "/absolute/project/baseline",
    "candidateRoot": "/absolute/project/candidate-seed",
    "applyRoot": "/absolute/project/approved-target",
    "evidenceRoot": "/absolute/project/private-evidence",
    "tempRoot": "/absolute/project/private-temp",
    "acceptanceRoot": "/absolute/project/sealed-acceptance",
    "baseCommit": "FULL_40_CHARACTER_COMMIT_SHA",
    "allowedEdits": [{"path":"src/module.mjs","operations":["edit"]}],
    "publicTests": ["tests/public.test.mjs"],
    "acceptanceTests": ["tests/acceptance.test.mjs"],
    "postApplyTests": ["tests/smoke.test.mjs"]
  }
]
```

`baselineRoot` と `candidateRoot` は初期状態で clean にする。`applyRoot` も clean とし、
初回は `baseCommit` に置く。受入テストは Git のソースツリーに含めず、別の
`acceptanceRoot` に保存する。公開・適用後テストは基点の commit に含める。
編集許可はパスと `edit` / `add` / `delete` を指定する。適用後テストの編集は禁止。
追跡ファイルは Git blob と実ファイルのバイト一致も確認する。Windows の改行自動変換
などで異なる場合は、利用者が専用 checkout を準備する。既存の Git 設定は自動変更しない。
公開テストを編集許可しても、独立検証では利用者が固定した元のテストを実行する。
受入テストの内容、出力、ファイル名とホストの絶対パスはワーカーへの公開計画に含めない。

公開計画のハッシュに加え、台帳は登録ディレクトリの実体も固定する。
再起動時に同じプロジェクト ID の適用先を差し替えると、以前の承認は使用できない。
シンボリックリンク、特殊ファイル、範囲外変更、予期しない未追跡ファイルは拒否する。

## 起動と明示操作

```sh
node mini/project-worker-cli.mjs serve --registry registry.json --data-root private-mini-data --port 8877 --operator-token-file operator-cap.txt
```

サーバーは `127.0.0.1` に限定する。新しく作成する `operator-cap.txt` はこの製品の
操作権限であり、既存の ChatGPT/Codex 認証情報ではない。値をログ、Rumor、画面共有に
貼り付けない。同じデータ領域には一つのサーバーだけを起動する。

先に Gateway から村へ配達された観測メッセージを使い、通常の `/api/work/action`
`create` で仕事を作成する。`start.json` は次の形にする。

```json
{"villageId":"village-1","workId":"work_...","projectId":"my-project","symptom":"具体的な故障","evidence":["無害な再現手順"]}
```

```sh
node mini/project-worker-cli.mjs start --url http://127.0.0.1:8877 --input start.json --operator-token-file operator-cap.txt --confirm --output start-receipt.json
```

開始時に基点の公開テストを実行する。実際の assertion failure を確認できた場合だけ
ワーカーを割り当てられる。単なる起動失敗、skip、タイムアウトは故障再現の成功にしない。
返されたセッション ID とワーカー用 `dispatchToken` を限定した作業者へ渡す。
開始・検証・再開・適用・rollback はそれぞれ明示操作で、保存状態の GET や再起動では
モデル、テスト、適用、共有を開始しない。

`project-worker-cli.mjs` の `claim` / `heartbeat` / `report` / `ack-stop` は既存ワーカー用の
受け渡し経路で、モデルを起動しない。`state` は operator または worker のいずれかの
token ファイルを指定する。operator は独立検証の記録を読めるが、worker の状態には
受入テストの詳細を含めない。

## 公式 Codex CLI による一回の作業

`project-codex-cli.mjs` は利用者が明示した場合に、既にインストールされ通常ログイン
されている公式 CLI を起動する。新しい拡張、認証情報、API キーは作らない。
`--confirm-external-codex` が必要で、OpenAI の Codex に登録ソース、仕事の目的、
選択済みの村の文脈、症状、公開テストの失敗内容を送る。私的会話や機密データのある
仕事には使用しない。

```sh
node mini/project-codex-cli.mjs --registry registry.json --project-id my-project --url http://127.0.0.1:8877 --session-id agent_... --worker-token-file worker-cap.txt --codex-executable /absolute/path/to/codex --worker-id local-codex --claim-id attempt-one --confirm-external-codex --output worker-receipt.json
```

一回の呼び出しは一つの実行。公式 CLI は `exec --sandbox workspace-write --json` と
構造化した最終結果を使う。危険な sandbox 解除や認証ファイルのコピーは行わない。
作業者は履歴・複数ファイルを調査し、登録されたソースを編集し、公開テストを実行する。
Git の候補 commit はホストが実際の変更範囲を検査して作成する。
CLI の JSONL と実行ファイルのハッシュ・バージョンは、Git 外の非公開証拠へ保存する。
ワーカーの自己申告だけではモデルの認証や修復成功を証明しない。

公式の [非対話実行](https://learn.chatgpt.com/docs/non-interactive-mode) と
[安全設定](https://learn.chatgpt.com/docs/security) も参照。
CLI の起動やログイン確認は、推論の成功、利用枠、Windows sandbox 動作の証明ではない。

## 独立検証、再試行、適用

1. `review` で実際の commit 差分と SHA-256 を読む。
2. `validate --confirm` に確認済み差分ハッシュと検証者名を渡す。元の公開テストと、
   固定済みの受入テストを、候補 commit から作った別のディレクトリで実行する。
3. 公開テストが実際に失敗した場合は、その出力を次の作業に引き継ぐ。新しい作業領域は
   直前の候補 commit と同じ仕事・文脈を引き継ぐ。最大三回。受入テストの失敗内容は
   ワーカーに戻さず、その候補は終了扱いにする。
4. 検証成功後も適用は保留。`apply --confirm` は候補 commit、差分ハッシュ、検証 ID、
   適用先の期待 HEAD、承認者をすべて指定する。clean な登録適用先だけを切り替え、
   実際の適用先で固定した smoke test と読み戻しを行う。
5. `rollback --confirm` も現在の候補 HEAD と承認者を指定する。自動 rollback はしない。

POST の入力 JSON は各コマンドの必要フィールドだけを渡し、`action` や `allow*` は
CLI が付ける。登録プロジェクトの入力上限は 32 KiB、既存 Mini API は 16 KiB。
検証・適用権限は worker capability とは別にする。コマンドはリダイレクトや環境の
HTTP proxy を経由せず、固定した loopback 宛に直接接続する。

停止は lease を取り消し、所有する検証プロセスに終了を要求する。lease の取消だけで
既存ワーカーの OS プロセス停止を証明できないため、再開では古い作業領域を再利用しない。
検証の終了が未確認の場合は隔離を保持し、自動再開しない。適用の intent は書込み前に
永続化し、適用先のロックを適用後検証まで保持する。再起動後は HEAD を読み戻して
未確認状態を表示する。勝手な再適用・再試行・rollback は行わない。
このロックは協調する METRON プロセス同士の保護で、利用者の同時 Git 操作を禁止する
OS レベルのロックではない。

検証済み候補の要約は、従来と同じ prepare-share → 明示 publish → 別村の receive /
adopt を通じて共有する。共有対象は選択した診断、適用条件、限界と証拠ハッシュのみ。
登録プロジェクトの prepare-share / publish-share にも `X-Metron-Project-Operator`
ヘッダーが必要で、worker capability だけでは公開できない。
登録された隔離適用先の変更と、公開リポジトリの main への公開は区別する。

実サービスでの ARC E2E、実際のモデル推論、制御経路の模擬試験、ローカル Git 適用、
PC 再起動は別々に結果を記録する。この機能のテスト通過だけで METRON 全体の完成と
呼ばない。完成条件は [元の目的文書](METRON_MINI_COMPLETION_CRITERIA_2026-10-14.md) に従う。

## この PC で確認した範囲（2026-10-15）

別担当が修正前に固定した二つの試験専用 Git/Node プロジェクトを、公式 Codex CLI
`0.162.0-alpha.17.2` の実プロセスで各一回修復した。模擬モデルの結果はこの表に含めない。

| プロジェクト | 修正前の公開テスト | 候補の公開テスト | 独立受入テスト | 適用後 |
| --- | --- | --- | --- | --- |
| prefix-gateway | 3 成功 / 1 失敗 | 4 / 4 成功 | 4 / 4 成功 | 1 / 1 成功 |
| delivery-envelope | 4 成功 / 1 失敗 | 5 / 5 成功 | 6 / 6 成功 | 1 / 1 成功 |

各候補は別担当の差分レビューを受け、固定した commit からの独立検証に成功した。
試験実行者が候補・差分・検証 ID・期待 HEAD を指定して、専用の隔離適用先へ適用した。
公開 main と元の基点 checkout は変更していない。ローカル Rumor の明示公開・別村での
採用・次の仕事への証拠継承と、別 PID のサーバープロセスによる再起動後の読み戻しも確認。
再起動で試行数やモデル実行カウンターは増えていない。

Windows / Node.js 24.18.0 の全回帰試験は **334 成功、失敗・cancel・skip・todo 0**。
実 Git の検査を追加したため、CI ジョブの制限時間を 12 分から 20 分へ広げた。
試験専用データ、CLI の実行記録、証拠ハッシュと読み戻し記録は Git 外へ保存した。

実 AI の両候補は初回で検証に成功したため、修正後の失敗を AI に戻して再修正させる
実例は未検証。失敗出力を次の作業へ渡す制御は、実 Git/Node と試験用候補で検証した。
通常ログイン済み ChatGPT の ARC E2E、異なる実 AI 間の切替、PC 全体の再起動、
利用者の本番プロジェクトへの適用は、この検証の成功範囲には含めない。

その後の要件追加と同じ仕事 ID での実 Codex 改訂は、
[要件改訂の検証記録](METRON_MINI_PROJECT_REQUIREMENTS_REVISIONS_2026-10-15.md)を参照。
上記の初回成功と、追加要件で新たに生じた失敗は区別して記録する。
