# METRON Mini — 村の仕事とBAKUの継続契約（2026-10-15）

Miniの一つの村で、**配送済みGateway本文・仕事の目的・選択した採用済み知識**を固定保存し、同じ仕事・修復実行IDのままBAKUへ渡す経路です。実装は [village-work.mjs](../mini/village-work.mjs)、[server.mjs](../mini/server.mjs)、[agentic-runner.mjs](../mini/agentic-runner.mjs) にあります。Gatewayの `done` は本文の配送完了を示し、仕事や修復の完了ではありません。

対象は引き続き、同梱の請求計算教材 `src/pricing.mjs` と `src/invoice.mjs` の隔離コピーだけです。保存した本文や知識はモデルの参考資料になりますが、修復範囲・許可・実行コマンドを変更する権限を持ちません。任意の実プロジェクトへの適用、完全自律修復、外部サービスへのexactly-once実行は提供しません。

## 画面から使う

`node mini/start.mjs` で起動し、`http://127.0.0.1:8766/experience` の第10章を開きます。コアMiniにはNode.js 20以上、実テストを子プロセスで実行するBAKU経路にはNode.js 22以上が必要です。

1. 保存先の村を選び、同じ村に配送済みのGateway本文を選択します。実ARCの回答を使う場合も、まず明示的な転送と配送を確認します。
2. 目的を入力し、その村の採用済み知識を必要な分だけ選び、仕事を保存します。作成時点で仕事IDと修復実行IDが割り当てられます。
3. 保存内容と出所を読み返してAIを選び、必要な外部送信許可をその回だけ与え、実行ボタンを押します。通常は一回の明示実行につき修正候補を一回、仕事全体で最大四回までです。接続失敗や未設定は候補成功として数えません。
4. 再起動後は同じ村の保存済み仕事を開き、段階・候補・失敗履歴・次の操作を確認してから明示的に再開します。ページ表示、保存状態の読み直し、AIの選択だけではモデルを呼びません。
5. 確認検査まで通った候補には共有候補が手元に作られます。本文を確認・編集して保存できますが、この操作はVillage Squareへの公開や他村での採用を行いません。

公開検査に通った候補が確認検査の前に中断された場合、次の明示実行は保存候補の検証だけを続けます。モデルを呼ばず、候補回数も増やしません。この検証待ちは四回の候補予算を使い切った場合も処理できます。

## 固定する内容と、実行ごとに選ぶ内容

仕事の目的、村ID、仕事ID、修復実行ID、Gateway本文と封筒のSHA-256、選択した知識の本文・出所・親Rumor・採用先を固定します。元のジョブが `done` であることに加え、受信母艦の保存記録との一致を確認します。知識はその村の初期知識または採用済みRumorに限り、未採用・隔離中の情報は渡しません。作成後に元の本文や採用知識との対応が変わると、同じ仕事として実行を続けません。

ランナーの `incidentContext` はJSONオブジェクトの固定コピーで、キー順を正規化したSHA-256を保存します。上限はUTF-8で12,288バイトです。目的・教材のダイジェスト・文脈が変わった再開は拒否します。ハッシュは保存内容の照合用であり、人間・外部AI・Rumor発信者の認証ではありません。ARCの `selectorsChecked` もローカルな申告です。

AIの選択、設定済みモデル名、実行方式、外部送信許可は固定文脈と分けて記録します。現在の修復アダプターはOllamaとOpenAIで、モデル名は `METRON_LOCAL_MODEL` または `METRON_REPAIR_MODEL` から解決します。OpenAIには別途認証設定が必要です。HTTP本文からモデルの秘密鍵や任意のアダプターを登録する経路はありません。

仕事の明示実行では、AIや設定済みモデルを変更しても同じ候補ソース・診断・公開検査の失敗履歴を継承します。ランナー単体では変更時に `allowProviderChange:true` が必要です。外部送信の許可は過去の履歴から再利用せず、OpenAIの呼び出しにはその回の `allowExternalCalls:true` が必要です。明示的なOpenAI選択は、許可がなければ呼び出す前に拒否します。`auto` は許可なしでも設定されたOllamaを試せますが、外部候補は除外します。Ollamaの失敗や未設定によって外部送信の許可を補うことはありません。外部fallbackを使う場合だけ、その回の許可が必要です。検証待ち候補のローカル検証にはモデル呼び出しがないため、モデル接続や外部送信許可を必要としません。

`invocationHistory` には各明示要求の選択・モデル名・試験注入か実アダプターか・その回の許可・結果を記録し、呼び出し開始を実際のアダプター呼び出しより前に保存します。候補の各試行は対応する要求ID・呼び出しID・実際に使ったプロバイダーとモデル名に結びつきます。APIキーは記録しません。旧ジャーナルで記録されていなかったモデル名は遡って補完せず、`legacyModelNameUnknown` として区別します。モデル名の記録自体はモデルによる修復成功の証明ではありません。

## 保存場所と再起動

`DATA` は `METRON_MINI_DATA`、未指定ならリポジトリ直下の `.metron-mini-data` です。第一の村の保存ルートは `DATA`、第二の村は `DATA/village-2` です。以下の `VROOT` は対象村の保存ルートを指します。

| 保存内容 | パス |
| --- | --- |
| 村の仕事台帳 | `VROOT/work-ledger/<workId>.json` |
| 同じ仕事の修復ジャーナル・候補ソース | `VROOT/work-repair/<workId>/baku-agent-journal/<runId>.json` |
| Gateway・母艦受信履歴 | `VROOT/gateway.json`、`VROOT/mother-A.json`、`VROOT/mother-B.json` |
| 採用済み知識と受信判断 | `DATA/village-1-knowledge.json`、`DATA/village-2-knowledge.json` |

仕事台帳と修復ジャーナルは別ファイルです。再構築時には保存したIDと文脈を照合し、記録済みの結果や実行中だった意図を整合させます。仕事のモデル呼出し・修復テスト・外部送信の再試行を自動起動しません。既存Gatewayのローカル配送・ACKのキュー処理は別経路です。実行中に停止した仕事は結果未確認の中断として扱います。後の明示再開では、完了記録のない呼び出しを `outcome_unconfirmed` とし、応答が成功した・失敗した・課金されなかったとは推測しません。

各保存領域は単一書き込みプロセスを前提とします。同じデータディレクトリで複数のMiniを同時起動しないでください。JSONの原子的置換は複数ファイルをまたぐトランザクションや分散ロックではありません。

## ローカルHTTP契約

ホストは `127.0.0.1:<port>` または同じポートの `localhost` です。POSTには `Content-Type: application/json` と `X-Metron-Mini: 1` が必要です。Originを付ける場合は同じMiniのローカルOriginに限ります。以下は形の例であり、IDは実際に保存・選択した値に置き換えます。

| 要求 | 内容 |
| --- | --- |
| `GET /api/work/state?villageId=village-1` | 選択可能な配送本文・採用済み知識・保存済み仕事と最新の仕事を読む。モデルは呼ばない |
| `GET /api/work/state?villageId=village-1&workId=<workId>` | 同じ村の指定した仕事を読む |
| `POST /api/work/action` | `{"action":"create","villageId":"village-1","goal":"目的","sourceMessageId":"実際の配送ID","knowledgeIds":[]}` |
| `POST /api/agent/run` | `{"villageId":"village-1","workId":"実際の仕事ID","provider":"ollama","allowExternalCalls":false}` |
| `POST /api/work/action` | `{"action":"prepare-share","villageId":"village-1","workId":"実際の仕事ID","body":"確認した共有候補"}` |

村IDは `village-1` または `village-2`。目的は500文字以内、知識選択は最大五件、共有候補本文は320文字以内です。仕事の実行要求では保存済み目的・本文・知識を使い、要求本文で別の目的や文脈へ差し替えません。村をまたぐ仕事ID・本文IDの指定も拒否します。

`provider` は `ollama`、`openai`、`auto` を使います。仕事の `auto` は明示されたOllama/OpenAI順だけを対象とし、他の修復アダプターへ勝手に広げません。未実装アダプターや未接続モデルは、履歴を残して未完了として止まります。

仕事ID・村IDを付けない従来の `POST /api/agent/run` も残ります。これは `DATA/agentic-baku/` を使う単体教材経路で、村の仕事台帳へ自動登録されません。

## 公開検査・確認検査と共有候補

公開検査の実行領域には教材ソース二件と公開テストだけを置きます。許可するモジュール読込みは請求ソースの `import { unitPrice } from "./pricing.mjs"` だけで、他のimportやESM再exportを拒否します。この指定importの末尾はセミコロン、またはJavaScriptの自動セミコロン挿入が成立する行末・EOFを認めます。同一行で不正に続く構文や別のbinding・パスは許可しません。公開検査を通った候補のソースをダイジェストで照合してから、別の検証領域へコピーし、そこで初めて固定の確認テストを配置・実行します。確認テストの出力はモデルへ渡しません。

確認前の中断は `awaiting_holdout` として保存します。旧 `testing` 記録でも、最後の候補が公開検査済み・確認結果未記録なら同じ検証待ちとして扱います。明示再開時に保存候補のダイジェストが違えば検証成功を主張せず停止します。確認検査による拒否、検証成功、読み戻し失敗、再現できない結果は終端であり、確認検査の失敗を次のモデル修正へのフィードバックに使いません。

検証成功後の `sharingCandidate` は `human_review_required` のローカルな包みで、仕事ID・実行ID・元の本文ハッシュ・知識ID・候補ダイジェストを持ちます。その中の `rumor` は従来どおり九項目だけです。

`schemaVersion`, `id`, `originVillage`, `originCore`, `kind`, `body`, `createdAt`, `parentRumorId`, `sha256`

仕事用の証拠をRumor本体へ追加せず、[rumor-protocol.mjs](../mini/rumor-protocol.mjs) の契約を維持します。共有候補の生成・編集・保存は手元の下書きだけで、公開・受信・採用は自動実行しません。

## 検証証拠の種類

- [mini-agentic-context.test.mjs](../reusable/tests/mini-agentic-context.test.mjs)：参考文脈の固定、明示的なプロバイダー／モデル変更、事前ジャーナル、許可、候補・公開失敗の継承を検証。プロバイダー通信はfetch模擬または注入された試験応答であり、実AIの推論ではありません。公開・確認テストは実Node子プロセスです。
- 同ファイルの検証待ち再開テスト：公開検査通過直後を表すチェックポイントを人工的に作り、候補回数を増やさずモデルを呼ばないことを確認します。この試験自体は、その検証境界でプロセスを実停止した証拠ではありません。再export拒否と確認失敗後の再修正拒否も検証します。
- [mini-village-work.test.mjs](../reusable/tests/mini-village-work.test.mjs)：Gateway受信本文、採用済みRumorの出所、同じ仕事の再開、村の分離、許可を検証。別の試験では注入された応答待ちのNodeプロセスを実際に停止し、再構築・状態取得で呼び出しが増えず、明示再開後にだけ進むことを確認します。
- 既存の [mini-agentic-runner.test.mjs](../reusable/tests/mini-agentic-runner.test.mjs) と [mini-agentic-failover.test.mjs](../reusable/tests/mini-agentic-failover.test.mjs) も教材修復・再開・アダプター経路の境界を扱います。

これらは本物のAIによる未知障害修復、認証済みChatGPT画面からARCを通した一連の操作、または本番ソースへの適用を実証しません。実モデルと通常ログインしたブラウザによる検証は別途必要です。テスト総数・最終実行結果は対象コミットと実行記録を併記して報告し、この文書では固定しません。
