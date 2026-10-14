# METRON Mini OS — 起動できる最小の4系統統合

## 最初に見てほしいのは「構想の体験」

`node mini/start.mjs` で起動したら、まず
**http://127.0.0.1:8766/experience** を開いてください。

- 独立した母艦A/Bが、それぞれ違う知識や方針を持っています。
- Village Squareで知識を提案し、実際のGateway配送と配達確認を見ます。
- 受け取った村が「採用」か「隔離」を判断するまで、知識は上書きされません。
- 採用した知識から規則ベースで継承案を返し、出自をたどります。
- BAKUが失敗したコードの断片を隔離し、Gatewayが再送を復旧する様子を確認できます。

知識の判断は体験者が行い、継承案は**固定規則による教材**です。
独立したAI人格が既に自律的に推論しているという意味ではありません。
詳細は[METRON構想の体験設計](../docs/METRON_CIVILIZATION_EXPERIENCE_2026-10-14.md)を参照してください。


**これは実際に起動して操作できるローカルWebアプリです。** これまで
個別に実証した母艦A/B・Gateway・BAKU・ARCの機能を、1つの画面から
試せるようにしています。外部AI・Google Apps Script・Android端末・
クラウドAPIへの接続は行いません。

## 起動する

Node.js 20以上が必要です（追加パッケージは不要）。

```sh
git clone https://github.com/dakahasa0119-blip/METRON-OS.git
cd METRON-OS
node mini/start.mjs
```

Windowsなら、[**START_WINDOWS.cmd**](START_WINDOWS.cmd) をダブルクリックする方法もあります。Node.jsが利用可能な場合、ローカルサーバーを別ウィンドウで起動して標準ブラウザを開きます。終了時はサーバーのコマンドウィンドウを閉じてください。

ブラウザで **http://127.0.0.1:8766/** を開いてください。

1. 母艦Aから母艦Bへメッセージを送ります。
2. Gatewayがジョブを永続化し、Bの独立保存ファイルへ配送します。
3. BからAへのACK（配達確認）が自動的に発行され、A側に記録されます。
4. BAKUが同じリクエストに入っているコード断片を静的検査し、関数名・注意候補を表示します（コード自体は**実行・保存しません**）。
5. ARCがこのローカル画面上の入力欄・送信ボタン・受信欄のDOMを探索します。「入力欄を選択」などで手動ピッカーも操作できます。
6. プログラムを停止・再起動し、保存されたメッセージとGateway状態が残っていることを確認できます。

**注意:** 母艦A/BはローカルJSONファイルで、過去のGoogle Sheetsの
2母艦が通信したことを証明するものではありません。ARCは
このページだけで動き、外部AIサイトの操作を行いません。BAKUは
未知の不具合を自動修復せず、コード断片の**検査**だけを行います。

## 使われる構成

| 領域 | 実体 | 状態 |
| --- | --- | --- |
| MotherShip A | `.metron-mini-data/mother-A.json` | 独立した受信履歴 |
| MotherShip B | `.metron-mini-data/mother-B.json` | 独立した受信履歴 |
| Gateway | `.metron-mini-data/gateway.json` | ジョブ・ACK・リース・再起動復旧 |
| BAKU | `reusable/baku-dna/code-cards.mjs` | 非実行の関数抽出と注意候補 |
| ARC | `reusable/arc-dom/selector-kit.mjs` | この画面のDOM探索と手動ピッカー |
| 母艦ワークフロー | `reusable/mothership/workflow.mjs` | 指示の分類補助 |

## 制限・安全境界

- HTTPサーバーは**127.0.0.1のみにバインド**。認証・遠隔接続・
  システム権限委譲はありません。信頼できる自分のPCだけで使用してください。
- メッセージはローカルJSONに保存されます。機密情報を入力しないでください。
  コード本文は保存しませんが、検出した関数名・静的検査結果は記録されます。
- **同じ保存ディレクトリに対して同時に2つ起動しないでください。**
  ファイルの単一書き込みプロセスを前提にしています。
- メッセージ再送時の重複抑止はJSON受信記録が基準です。外部の
  副作用をexactly-onceにする保証はありません。
- ブラウザ操作は利用者の明示的なクリックに限定。ログインや
  第三者AIの画面・CAPTCHA操作は提供しません。
- このプロトタイプは**本番用の認証、暗号化、長期バックアップ、
  完全自動AI推論、自己修復、4系統の歴史的な全統合**を実証しません。

## オプションとテスト

別のデータ場所・ポートで起動できます。

```sh
# Linux/macOS
METRON_MINI_DATA=/path/to/my-private-data METRON_MINI_PORT=8877 node mini/start.mjs

# Windows PowerShell
$env:METRON_MINI_DATA="C:\\MyPrivateData\\MetronMini"
$env:METRON_MINI_PORT="8877"
node mini/start.mjs
```

テスト:

```sh
node --test reusable/tests/mini-runtime.test.mjs
node --test reusable/tests/*.test.mjs
```

使用するオープンソースライセンス: 新規Webアプリ本体は
[Apache-2.0](../LICENSE)、`reusable/`の各コンポーネントは
[MIT](../reusable/LICENSE)です。

## 追加の復旧検証

自動試験では、母艦A/Bの逆方向配送、配達保存直後にGatewayが停止してACKを受け取れなかった状況、再起動後の再送・重複抑止、コードの一時検査、実ChromiumによるARCのDOM探索を扱います。
