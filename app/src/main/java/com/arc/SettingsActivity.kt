package com.arc

import android.content.Intent
import android.os.Bundle
import android.widget.AdapterView
import android.widget.ArrayAdapter
import android.widget.Toast
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import com.arc.databinding.ActivitySettingsBinding
import org.json.JSONObject

/**
 * ARC 統合設定ハブ (v23.0 - Fully Synchronized)
 */
class SettingsActivity : AppCompatActivity() {

    private lateinit var binding: ActivitySettingsBinding
    private lateinit var prefs: Prefs
    private var lastSlotIndex = 0

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivitySettingsBinding.inflate(layoutInflater)
        setContentView(binding.root)

        prefs = Prefs(this)
        prefs.runStartupMigrations()

        setupSlotSpinner()
        setupButtons()
        setupLockSwitches()
        setupPickerButtons()
        setupAutoProvisioning()
    }

    override fun onResume() {
        super.onResume()
        loadCommonPrefs()
        updateLockSwitchesUI()
    }

    override fun onPause() {
        super.onPause()
        saveCommonPrefs()
    }

    /**
     * 🚀 Zero-Touch Setup (全自動環境構築) の UI ロジック
     */
    private fun setupAutoProvisioning() {
        setupTestConnectionButton()
        setupAutoSetupButton()
        setupLoginGuideButton()
        setupPresetButtons()
        setupSyncSlotRegistryButton()
    }

    private fun setupTestConnectionButton() {
        // 🌐 接続テストボタン (Handshake)
        binding.btnTestConnection.setOnClickListener {
            val url = binding.gasUrl.text.toString().trim()
            if (url.isEmpty()) {
                Toast.makeText(this, getString(R.string.toast_enter_url), Toast.LENGTH_SHORT).show()
                return@setOnClickListener
            }

            prefs.gasUrl = url
            // 🚀 [整合] Prefsを渡してクライアント初期化
            val gateway = GatewayClient(prefs)

            binding.btnTestConnection.isEnabled = false
            Toast.makeText(this, getString(R.string.toast_handshake_start), Toast.LENGTH_SHORT).show()

            gateway.performHandshake { success ->
                runOnUiThread {
                    binding.btnTestConnection.isEnabled = true
                    if (success) {
                        Toast.makeText(this, getString(R.string.toast_handshake_ok), Toast.LENGTH_SHORT).show()
                    } else {
                        Toast.makeText(this, getString(R.string.toast_handshake_fail), Toast.LENGTH_LONG).show()
                    }
                }
            }
        }
    }

    private fun setupAutoSetupButton() {
        // 🛠️ 全自動セットアップボタン
        binding.btnAutoSetup.setOnClickListener {
            val url = binding.gasUrl.text.toString().trim()
            val sheetId = binding.sheetId.text.toString().trim()

            if (url.isEmpty()) {
                Toast.makeText(this, getString(R.string.toast_enter_gas_url_first), Toast.LENGTH_SHORT).show()
                return@setOnClickListener
            }

            prefs.gasUrl = url
            prefs.sheetId = sheetId
            val gateway = GatewayClient(prefs)

            binding.btnAutoSetup.isEnabled = false
            binding.btnAutoSetup.text = getString(R.string.btn_auto_setup_running)

            // 🚀 [整合] 司令部のポート情報を添えてインフラ構築依頼
            gateway.sendSetupRequest(MainActivity.serverPort) { success, message ->
                runOnUiThread {
                    binding.btnAutoSetup.isEnabled = true
                    binding.btnAutoSetup.text = getString(R.string.btn_auto_setup)
                    
                    if (success) {
                        Toast.makeText(this@SettingsActivity, getString(R.string.toast_setup_ok, message), Toast.LENGTH_LONG).show()
                        saveCommonPrefs()
                    } else {
                        Toast.makeText(this@SettingsActivity, getString(R.string.toast_setup_fail, message), Toast.LENGTH_LONG).show()
                    }
                }
            }
        }
    }

    private fun setupLoginGuideButton() {
        binding.btnLoginGuide.setOnClickListener {
            saveCommonPrefs()
            AlertDialog.Builder(this)
                .setTitle(getString(R.string.title_login_guide))
                .setMessage("動的セットアップを開始します。\n各AIでログイン/認証状態を判定し、短文送信テストに通過したら次へ進みます。")
                .setNegativeButton(getString(R.string.btn_guide_close), null)
                .setPositiveButton(getString(R.string.btn_guide_start)) { _, _ ->
                    val intent = Intent(this, MainActivity::class.java).apply {
                        putExtra("ARC_DYNAMIC_SETUP", true)
                        addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)
                    }
                    startActivity(intent)
                    finish()
                }
                .show()
        }
    }

    private fun setupPresetButtons() {
        binding.btnApplyRecommended.setOnClickListener {
            applyRecommendedPresetToForm()
            saveCommonPrefs()
            Toast.makeText(this, getString(R.string.toast_recommended_applied), Toast.LENGTH_SHORT).show()
        }
        binding.btnApplyClaudePreset.setOnClickListener {
            applyClaudePresetToForm()
            saveCommonPrefs()
            Toast.makeText(this, getString(R.string.toast_claude_preset_applied), Toast.LENGTH_SHORT).show()
        }
    }

    private fun setupSyncSlotRegistryButton() {
        binding.btnSyncSlotRegistry.setOnClickListener {
            saveCommonPrefs()
            val notes = prefs.runStartupMigrations()
            prefs.syncLegacyTargetsToSlotRegistry()
            prefs.applySlotRegistryToLegacyTargets()
            loadCommonPrefs()
            val detail = if (notes.isEmpty()) "no-op" else notes.joinToString(",")
            Toast.makeText(
                this,
                getString(R.string.toast_slot_sync_done, detail),
                Toast.LENGTH_SHORT
            ).show()
        }
    }

    private fun applyRecommendedPresetToForm() {
        with(binding) {
            if (geminiUrl.text.isNullOrBlank()) {
                geminiUrl.setText("https://gemini.google.com/")
            }
            if (chatGptUrl.text.isNullOrBlank()) {
                chatGptUrl.setText("https://chatgpt.com/")
            }
            if (copilotUrl.text.isNullOrBlank()) {
                copilotUrl.setText("https://claude.ai/")
            }

            if (geminiInput.text.isNullOrBlank()) {
                geminiInput.setText("div[contenteditable=true][role=textbox]")
            }
            if (geminiSend.text.isNullOrBlank()) {
                geminiSend.setText("button[aria-label*='送信']")
            }
            if (geminiResp.text.isNullOrBlank()) {
                geminiResp.setText("div.markdown.markdown-main-panel.stronger.enable-updated-hr-color.preserve-whitespaces-in-response")
            }

            if (chatGptInput.text.isNullOrBlank()) {
                chatGptInput.setText("#prompt-textarea")
            }
            if (chatGptSend.text.isNullOrBlank()) {
                chatGptSend.setText("#composer-submit-button")
            }
            if (chatGptResp.text.isNullOrBlank()) {
                chatGptResp.setText("article[data-testid=\"conversation-turn-1\"]")
            }

            applyClaudePresetToForm()
        }
    }

    private fun applyClaudePresetToForm() {
        with(binding) {
            if (copilotUrl.text.isNullOrBlank()) {
                copilotUrl.setText("https://claude.ai/new")
            }
            if (copilotInput.text.isNullOrBlank()) {
                copilotInput.setText("div[contenteditable='true'][role='textbox']")
            }
            if (copilotSend.text.isNullOrBlank()) {
                copilotSend.setText("button[aria-label*='Send'],button[type='submit']")
            }
            if (copilotResp.text.isNullOrBlank()) {
                copilotResp.setText("div[data-is-streaming],article,.prose")
            }
        }
    }

    private fun setupPickerButtons() {
        val pickerMap = mapOf(
            binding.pickGeminiInput to "gemini_input",
            binding.pickGeminiSend  to "gemini_send",
            binding.pickGeminiResp  to "gemini_resp",
            binding.pickChatgptInput to "chatgpt_input",
            binding.pickChatgptSend  to "chatgpt_send",
            binding.pickChatgptResp  to "chatgpt_resp",
            binding.pickCopilotInput to "copilot_input",
            binding.pickCopilotSend  to "copilot_send",
            binding.pickCopilotResp  to "copilot_resp"
        )

        pickerMap.forEach { (button, mode) ->
            button.setOnClickListener {
                saveCommonPrefs()
                val intent = Intent().apply { putExtra("PICKER_MODE", mode) }
                setResult(RESULT_OK, intent)
                finish()
            }
        }
    }

    private fun setupLockSwitches() {
        updateLockSwitchesUI()
        binding.lockGemini.setOnCheckedChangeListener { _, isChecked -> prefs.isGeminiLocked = isChecked }
        binding.lockChatGPT.setOnCheckedChangeListener { _, isChecked -> prefs.isChatGptLocked = isChecked }
        binding.lockCopilot.setOnCheckedChangeListener { _, isChecked -> prefs.isCopilotLocked = isChecked }
    }

    private fun updateLockSwitchesUI() {
        with(binding) {
            lockGemini.isChecked = prefs.isGeminiLocked
            lockChatGPT.isChecked = prefs.isChatGptLocked
            lockCopilot.isChecked = prefs.isCopilotLocked
        }
    }

    private fun setupSlotSpinner() {
        val slots = resources.getStringArray(R.array.profile_slots)
        val adapter = ArrayAdapter(this, android.R.layout.simple_spinner_item, slots)
        adapter.setDropDownViewResource(android.R.layout.simple_spinner_dropdown_item)
        binding.profileSpinner.adapter = adapter
        binding.profileSpinner.setSelection(prefs.selectedSlotIndex)
        lastSlotIndex = prefs.selectedSlotIndex

        binding.profileSpinner.onItemSelectedListener = object : AdapterView.OnItemSelectedListener {
            override fun onItemSelected(parent: AdapterView<*>?, view: android.view.View?, position: Int, id: Long) {
                if (position != lastSlotIndex) {
                    val currentJson = binding.experimentalJson.text.toString()
                    if (isValidJson(currentJson)) saveSlotData(lastSlotIndex, currentJson)
                    prefs.selectedSlotIndex = position
                    lastSlotIndex = position
                    refreshJsonEditor(position)
                }
            }
            override fun onNothingSelected(parent: AdapterView<*>?) {}
        }
    }

    private fun refreshJsonEditor(position: Int) {
        val json = when (position) { 0 -> prefs.profileSlot1; 1 -> prefs.profileSlot2; else -> prefs.profileSlot3 }
        binding.experimentalJson.setText(json)
    }

    private fun loadCommonPrefs() {
        with(binding) {
            gasUrl.setText(prefs.gasUrl)
            sheetId.setText(prefs.sheetId)
            geminiUrl.setText(prefs.geminiUrl)
            geminiInput.setText(prefs.geminiInputSelector)
            geminiSend.setText(prefs.geminiSendSelector)
            geminiResp.setText(prefs.geminiResponseSelector)
            chatGptUrl.setText(prefs.chatGptUrl)
            chatGptInput.setText(prefs.chatGptInputSelector)
            chatGptSend.setText(prefs.chatGptSendSelector)
            chatGptResp.setText(prefs.chatGptResponseSelector)
            copilotUrl.setText(prefs.copilotUrl)
            copilotInput.setText(prefs.copilotInputSelector)
            copilotSend.setText(prefs.copilotSendSelector)
            copilotResp.setText(prefs.copilotResponseSelector)
            refreshJsonEditor(prefs.selectedSlotIndex)
        }
    }

    private fun saveCommonPrefs() {
        with(binding) {
            prefs.gasUrl = gasUrl.text.toString().trim()
            prefs.sheetId = sheetId.text.toString().trim()
            prefs.geminiUrl = geminiUrl.text.toString().trim()
            prefs.geminiInputSelector = geminiInput.text.toString().trim()
            prefs.geminiSendSelector = geminiSend.text.toString().trim()
            prefs.geminiResponseSelector = geminiResp.text.toString().trim()
            prefs.chatGptUrl = chatGptUrl.text.toString().trim()
            prefs.chatGptInputSelector = chatGptInput.text.toString().trim()
            prefs.chatGptSendSelector = chatGptSend.text.toString().trim()
            prefs.chatGptResponseSelector = chatGptResp.text.toString().trim()
            prefs.copilotUrl = copilotUrl.text.toString().trim()
            prefs.copilotInputSelector = copilotInput.text.toString().trim()
            prefs.copilotSendSelector = copilotSend.text.toString().trim()
            prefs.copilotResponseSelector = copilotResp.text.toString().trim()
        }
        prefs.syncLegacyTargetsToSlotRegistry()
    }

    private fun saveSlotData(slot: Int, json: String) {
        when (slot) { 0 -> prefs.profileSlot1 = json; 1 -> prefs.profileSlot2 = json; else -> prefs.profileSlot3 = json }
    }

    private fun isValidJson(json: String): Boolean = try { JSONObject(json); true } catch (_: Exception) { false }

    private fun setupButtons() {
        binding.importButton.setOnClickListener {
            val json = binding.experimentalJson.text.toString()
            if (isValidJson(json)) {
                saveSlotData(prefs.selectedSlotIndex, json)
                Toast.makeText(this, getString(R.string.toast_profile_updated), Toast.LENGTH_SHORT).show()
            } else {
                Toast.makeText(this, getString(R.string.toast_json_invalid), Toast.LENGTH_SHORT).show()
            }
        }
        binding.exportButton.setOnClickListener { refreshJsonEditor(prefs.selectedSlotIndex) }
        binding.saveButton.setOnClickListener {
            saveCommonPrefs()
            val currentJson = binding.experimentalJson.text.toString()
            if (isValidJson(currentJson)) saveSlotData(prefs.selectedSlotIndex, currentJson)
            prefs.applyProfile()
            Toast.makeText(this, getString(R.string.toast_all_settings_applied), Toast.LENGTH_SHORT).show()
            finish()
        }
    }
}
