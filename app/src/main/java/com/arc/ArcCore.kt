package com.arc

// ※ ArcTask, ArcWorker, ArcTaskQueue, GatewayClient は
// それぞれ個別のファイルに定義されているため、ここでは
// それらを統合管理するための共通ロジックや、不足している定義のみを扱います。

import android.os.Handler
import android.os.Looper
import android.util.Log

/**
 * プロジェクト全体の共通設定や、システムレベルのユーティリティ (v18.5)
 */
object ArcCore {
    const val VERSION = "18.5-integrated"
    
    // システム全体で共有すべき状態があればここに定義
}
