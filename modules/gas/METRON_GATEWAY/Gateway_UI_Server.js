/**
 * METRON Gateway UI Server Logic
 * ユーザープロファイルの保存と取得を管理する
 */

const PROFILE_PROP_KEY = "ARC_GATEWAY_PROFILE_JSON";

/**
 * プロファイル情報の取得
 */
function getGatewayProfile() {
    try {
        const props = PropertiesService.getScriptProperties();
        const json = props.getProperty(PROFILE_PROP_KEY);
        if (!json) {
            return {
                identity: "",
                environment: "",
                rules: "",
                tone: ""
            };
        }
        return JSON.parse(json);
    } catch (e) {
        console.error("getGatewayProfile error:", e);
        return { error: String(e) };
    }
}

/**
 * プロファイル情報の保存
 */
function saveGatewayProfile(data) {
    try {
        if (!data || typeof data !== 'object') throw new Error("Invalid data");

        const profile = {
            identity: String(data.identity || "").trim(),
            environment: String(data.environment || "").trim(),
            rules: String(data.rules || "").trim(),
            tone: String(data.tone || "").trim(),
            updated_at: new Date().toISOString()
        };

        PropertiesService.getScriptProperties().setProperty(PROFILE_PROP_KEY, JSON.stringify(profile));

        return { status: "ok", message: "プロファイルを保存しました。" };
    } catch (e) {
        console.error("saveGatewayProfile error:", e);
        return { status: "error", error: String(e) };
    }
}
