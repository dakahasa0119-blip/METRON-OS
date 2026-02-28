# ARC 配布先セットアップ（Linux）

## 1. 初回導入
```bash
/home/dakahasa0119/ARC/scripts/install_and_launch_arc.sh
/home/dakahasa0119/ARC/scripts/install_arc_window_daemon_service.sh
```

## 2. 常駐確認
```bash
systemctl --user status arc-window-mode-daemon.service --no-pager
```

`active (running)` ならOK。

## 3. Gatewayからの運用
- 通常は Gateway UI の `OPSへ切替` / `DEBUGへ切替` で操作
- 代替としてチャットタグでも可
  - `#arc #ui_ops`
  - `#arc #ui_debug`

## 4. 動作確認
```bash
cd /home/dakahasa0119/my-gas-project
./scripts/e2e_gateway_arc.sh
```

## 5. トラブル時
daemon の再起動:
```bash
systemctl --user restart arc-window-mode-daemon.service
systemctl --user status arc-window-mode-daemon.service --no-pager
```

service を外す:
```bash
/home/dakahasa0119/ARC/scripts/uninstall_arc_window_daemon_service.sh
```

