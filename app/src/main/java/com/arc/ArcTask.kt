package com.arc

/* ============================================================
   ArcTask (統合タスク定義)
============================================================ */
sealed class ArcTask {
    data class AI(
        val qid: String, 
        val target: String, 
        val prompt: String,
        val missionId: String = "AUTO",
        val slotId: String = "",
        val isSelfHealing: Boolean = false,
        val forceReload: Boolean = false
    ) : ArcTask()
    
    data class Pipeline(val prompt: String, val missionId: String = "AUTO") : ArcTask()
    
    data class VisionRequest(val action: String, val onResult: (Int, Int) -> Unit) : ArcTask()
}
