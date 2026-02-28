# ARC Runtime Policy Checklist

## 目的
- ユーザーは Gateway 経由で ARC を利用する。
- ARC は Linux 上の実行ワーカーとして動作し、UI はデバッグ用途を基本とする。
- 配布先の運用では「人が見えるか」ではなく「PC が実行状態を維持できるか」を優先する。

## 合意した運用方針
1. ARC は Gateway 制御下で実行し、内部状態は ARC から宣言する。
2. 通常運用は極小ウィンドウ + 右下固定を前提とする。
3. 最前面は常時固定しない（必要時のみ前面復帰）。
4. 最小化は避ける（最小化禁止/抑止を推奨）。
5. 省電力対策は常時強制ではなく、モードで切り替える。

## 実行モード
- interactive:
  - 通常ユーザー操作時のモード。
  - 最前面復帰は原則しない。
  - 省電力抑止は必要最小限。
- autonomous:
  - 自律実行時のモード。
  - 必要に応じて前面復帰を許可。
  - 省電力抑止を有効化し、実行継続を優先。

## 連携契約（ARC -> Gateway）
- runtime_mode
- bring_to_front_on_execution
- effective_keep_screen_awake
- capabilities

## 実装上の優先事項
1. モード切替 API の提供（runtime status / set）。
2. Gateway instruction で runtime_mode を切替可能にする。
3. heartbeat telemetry に runtime/capabilities を同梱する。
4. 既存運用を壊さないデフォルト値（interactive + bring_to_front_off）。

## 次フェーズ（スロット化）
1. slot_id と provider を分離。
2. target 固定分岐を capability/profile 駆動に置換。
3. 合議ポリシーを Gateway 側設定として分離。
