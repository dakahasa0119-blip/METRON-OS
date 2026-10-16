# 登録プロジェクトの要件追加と同じ仕事での再修復

2026-10-15。登録プロジェクトの既存契約は
[coding-agent セッション](METRON_MINI_REGISTERED_PROJECT_SESSIONS_2026-10-15.md)を参照。
この文書は、検証済みの修復後に利用者が要件を追加する `requirements_added` の契約を記す。

## 保持するものと上限

要件追加は同じ `workId` と `runId` に新しいセッションを結び付ける。
元の goal、配達元、採用知識、incidentContext、identityDigest は変更しない。
初回成功を後から失敗に書き換えず、旧版の `projectRepair`、`result`、
`sharingCandidate`、`publication`、`scope` を `projectHistory` に凍結する。
各履歴には版番号とダイジェストを付け、読み取り時に保存済みサービス台帳の検証証拠とも照合する。
公開済み Rumor と旧セッションの記録は更新しない。

保存できる旧版は最大 **2 版**、現在版を含む系列全体の worker attempt は最大 **3 回**。
改訂で回数をリセットしない。operator の `workAttemptCount`、worker の `budget.used`、
仕事の `projectRepair.attemptCount` は現在セッションと祖先の合計を表す。
旧セッションに後継ができた後は、その旧セッションの変更操作を拒否する。

## 新しい登録の条件

利用者が新しい project ID と専用 checkout・証拠・一時・適用先を登録する。
旧版と新版は同じ Git common repository に属し、新しい base commit はレビュー済みの
旧候補 commit の子孫であることを実 Git で確認する。編集許可のパスと操作も同一にする。

旧候補から新基点までの追跡ツリーで変更できるのは、`README.md` と、登録された
公開テスト・適用後 smoke test のパスだけ。ソースは旧候補と同一に保ち、要件変更が
一つ以上必要となる。差分の SHA-256 を `requirementDiffSha256` として保存する。
受入テストは別の非公開登録領域に固定し、ワーカー向けソースへ混入させない。
再起動後の証拠照合にも旧版・新版両方の元の登録が必要になる。

## 明示的な改訂操作

`POST /api/project/action` の `action:"revise"` は operator 専用。
入力は次のフィールドだけを受け付ける。

```json
{
  "action": "revise",
  "villageId": "village-1",
  "workId": "work_...",
  "previousSessionId": "agent_...",
  "reviewedPreviousCandidate": "旧検証候補の完全な40文字commit SHA",
  "projectId": "prefix-gateway-v2",
  "requirements": "追加した要件",
  "symptom": "新要件で観測した不具合",
  "evidence": ["公開してよい再現情報"],
  "allowRevision": true
}
```

上の ID と SHA は説明用。`requirements` は前後の空白を除いた非空文字列で最大2000文字。
operator capability と `allowRevision:true` を両方要求する。前セッション、旧候補の完全な
SHA、新登録、既存の仕事の結び付きが一致しなければ拒否する。
未確定の公開 intent、実行中・終了未確認の旧セッション、競合する候補・改訂も拒否する。
HTTP から任意のパス、シェルコマンド、モデル設定を登録する機能はない。
worker 用の `claim` / `heartbeat` / `report` / `ack-stop` capability では改訂できない。

CLI の入力 JSON には `action` と `allowRevision` を含めない。

```sh
node mini/project-worker-cli.mjs revise --url http://127.0.0.1:8877 --input revise.json --operator-token-file operator-cap.txt --confirm --output revision-receipt.json
```

`--confirm` が `allowRevision:true` を付ける。通信先は固定 loopback で、operator token は
この製品専用の操作権限。Codex のログイン情報とは別で、返される worker token とともに
非公開で保管する。この操作は新基点の公開失敗を再現するが、モデルは起動しない。
同一の旧セッション・旧候補・新登録・要件・症状・証拠で再送した場合は同じ後継を返す。
競合する再送や分岐は作らない。

## 改訂後の検証・適用・共有

1. 新要件の baseline で実際の assertion failure を確認してから、新しい作業領域を割り当てる。
   起動失敗、skip、タイムアウトを故障再現の成功にしない。
2. worker 報告後、`review` で候補と差分ハッシュを確認し、`validate --confirm` で
   固定した公開テストと非公開の独立受入テストを候補 commit の別コピーで実行する。
3. 成功しても適用は別操作。`apply --confirm` に候補、差分、検証 ID、期待 HEAD、承認者を
   指定し、登録された隔離適用先へ適用して smoke test と読み戻しを行う。
   `rollback --confirm` も期待 HEAD と承認者を要する。公開 main への反映は行わない。
4. 診断・適用条件・限界を人が確認し、prepare-share と明示 publish を行う。
   新しい Rumor の親は、存在すれば履歴中の直近の公開 Rumor ID とする。
   旧公開は残り、受信・採用は別村の明示操作となる。

共有証拠は送信者の検証記録であり、受信者による再検証や認証済みモデルの証明ではない。
チェックサムも認証ではない。コード、非公開文脈、受入テスト、token、絶対パスを
Rumor に含めない。隔離適用先での成功と公開 main・利用者の本番適用を混同しない。

## 再起動と確認済みの範囲

改訂開始の intent を呼出前に保存する。再起動時は仕事・project ID・plan digest と
前セッションの系列を照合して保存済み後継を読み戻す。AI、テスト、適用、rollback、
公開を自動実行しない。登録がない場合は履歴と結果を保持した参照状態とし、操作を止める。
途中の worker や検証の終了が未確認なら隔離し、明示的な確認・再開を要する。

今回の新しい統合試験
[`mini-project-revision-work.test.mjs`](../reusable/tests/mini-project-revision-work.test.mjs) は
実 Git・Node・loopback HTTP・CLI を使い **1 成功、失敗・cancel・skip・todo 0**
（約202秒）。候補は試験コードで明示的に作成し、モデルは呼んでいない。
初回の検証・隔離適用・公開、要件追加の失敗、同じ仕事での新セッション、二度目の検証・適用・
親付き公開、旧セッションのバイト不変、再送・再起動で検査ログが増えないこと、
履歴の検証証拠改変の拒否、登録なしの読み戻しを確認した。

## 実 PC 上の要件追加試験の結果

利用者が承認した試験用のソース・要件・公開失敗ログを、既存ログインの公式 Codex CLI
`0.162.0-alpha.17.2` に渡し、次の二件を改訂した。利用者の私的会話や資格情報、勤務表は
使っていない。実 CLI のプロセスと `turn.completed` を観測したものであり、応答モデルの
暗号学的な認証や、外部 RPC の呼出回数を証明するものではない。

| 試験用プロジェクト | 旧候補に新要件を追加した公開判定 | 改訂後の公開判定 | 非公開判定 | 隔離先適用後 |
| --- | --- | --- | --- | --- |
| prefix-gateway-v2 | 5 成功 / 3 失敗 | 8 / 8 成功 | 4 / 4 成功 | 2 / 2 成功 |
| delivery-envelope-v2 | 5 成功 / 4 失敗 | 9 / 9 成功 | 5 / 5 成功 | 2 / 2 成功 |

前者は HEAD の明示経路優先・GET へのフォールバックと本文省略、後者はヘッダー継続行の
要件を追加した。新基点のソースは前回の実 AI 候補と同一であり、要件追加による失敗を
実テストで再現してから実 Codex に渡した。各改訂候補は別担当の差分レビューを受け、
固定した commit に対する独立判定を経て、登録済みの使い捨て隔離先だけへ適用した。

両件で `workId`・`runId`・元の文脈を保持し、前回成功したセッションの保存バイトと
過去の公開を変更していない。新しい Rumor は旧公開を親に持ち、別村での採用と次の仕事の
由来を読み戻した。実サーバープロセスを終了し、異なる PID で起動して適用 commit・
履歴・共有・次の仕事を再確認した。再起動で worker attempt や実 AI 呼出は増えなかった。

最初の v2 試験は `project_request_timeout` によりモデル起動前に停止した。
サーバーには応答の間に作業枠が残ったため、モデル未起動と正確な枠を照合して明示的に
取り消し、失敗記録を保全した。重複していた Git 照合を、登録済みの同じ不変 commit 対に
限って再利用する修正を行った。毎回の repository・object store の実体確認と、可変な台帳・
系譜の照合は継続する。試験環境では繰り返し照合が Git 30 回・約 2.9 秒から 2 回・約 0.2 秒に
減り、object store の置換による再検証も確認した。

取消後は元の成功データの新しい隔離コピーで二件を実施した。この段階全体は adapter 呼出
**3 回**、実モデルプロセス **2 回**、保全したモデル起動前エラー **1 件**。
成功した各コピー内の系譜は累積 worker attempt **2 回**であり、異なるデータコピー間まで
この上限で一括管理したとは主張しない。初回成功を元の要件で失敗した候補として数えず、
`requirements_added` の試験として区別する。

独立レビューで、不正な改訂を拒否する前に旧成功を退避してしまう回復上の問題も修正した。
現在は保存前に登録・ソース・要件差分を検証し、拒否時の仕事・旧セッション・公開内容の
バイト不変と、修正した登録からの続行を回帰試験で確認している。

Windows / Node.js 24.18.0 の全回帰は **338 成功、失敗・cancel・skip・todo 0**
（約 16 分 48 秒）。完全な仕事 ID、候補・差分・証拠ハッシュ、判定出力、読み戻し、
実 CLI 記録と停止記録は Git 外に保全した。

通常ログイン済み ChatGPT の ARC E2E はブラウザー操作ツールの起動障害で未実施。
現在の Linux CI、別の実 provider、PC 全体の再起動、利用者の本番プロジェクトや実運用故障の
BAKU 修復も未確認である。今回の試験だけで METRON 全体の完成とは扱わない。
