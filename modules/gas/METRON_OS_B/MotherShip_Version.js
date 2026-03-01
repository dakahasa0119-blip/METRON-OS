function getMotherShipVersion() {
  const props = PropertiesService.getScriptProperties();
  return props.getProperty("MOTHERSHIP_VERSION") || "1.0.0";
}

function setMotherShipVersion(v) {
  const props = PropertiesService.getScriptProperties();
  props.setProperty("MOTHERSHIP_VERSION", v);
}

