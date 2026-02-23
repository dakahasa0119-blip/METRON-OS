/**
 * 🔐 METRON_PROPS (v2.0)
 * METRON OS の設定・APIキー管理モジュール
 * - Gemini API Key
 * - OpenAI API Key
 * - Registry Spreadsheet ID
 * - その他の設定値
 */

var METRON_PROPS = METRON_PROPS || {

  /** ============================
   *  Script Properties 取得
   * ============================ */
  getProps_: function() {
    return PropertiesService.getScriptProperties();
  },

  /** ============================
   *  Gemini API Key
   * ============================ */
  getGeminiKey: function() {
    return this.getProps_().getProperty("GEMINI_API_KEY") || "";
  },

  setGeminiKey: function(key) {
    this.getProps_().setProperty("GEMINI_API_KEY", key);
  },

  /** ============================
   *  OpenAI API Key
   * ============================ */
  getOpenAiKey: function() {
    return this.getProps_().getProperty("OPENAI_API_KEY") || "";
  },

  setOpenAiKey: function(key) {
    this.getProps_().setProperty("OPENAI_API_KEY", key);
  },

  /** ============================
   *  Registry Spreadsheet ID
   * ============================ */
  get REGISTRY_ID() {
    return this.getProps_().getProperty("REGISTRY_SPREADSHEET_ID") || "";
  },

  setRegistryId: function(id) {
    this.getProps_().setProperty("REGISTRY_SPREADSHEET_ID", id);
  },

  /** ============================
   *  任意の設定値
   * ============================ */
  set: function(key, value) {
    this.getProps_().setProperty(key, value);
  },

  get: function(key) {
    return this.getProps_().getProperty(key);
  }
};