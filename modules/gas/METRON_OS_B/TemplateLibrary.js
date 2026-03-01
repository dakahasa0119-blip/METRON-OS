/**
 * TemplateLibrary.gs
 * 母艦が保持するテンプレートの保管庫
 */

function getTemplate(name) {
  const props = PropertiesService.getScriptProperties();
  return props.getProperty(name);
}

function updateTemplate(name, content) {
  const props = PropertiesService.getScriptProperties();
  props.setProperty(name, content);

  // バージョン番号を自動更新
  const version = Number(props.getProperty("TEMPLATE_VERSION") || 1);
  props.setProperty("TEMPLATE_VERSION", version + 1);
}

function getTemplateVersion() {
  const props = PropertiesService.getScriptProperties();
  return Number(props.getProperty("TEMPLATE_VERSION") || 1);
}