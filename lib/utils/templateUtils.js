const fsUtils = require("./fsUtils");
const fs = require("fs");

const RECONCILIATION_FIELDS_TO_SYNC = [
  "handle",
  "name_en",
  "name_fr",
  "name_nl",
  "auto_hide_formula",
  "text_configuration",
  "virtual_account_number",
  "reconciliation_type",
  "public",
  "allow_duplicate_reconciliations",
  "is_active",
  "externally_managed",
];
const RECONCILIATION_FIELDS_TO_PUSH = [
  "handle",
  "name_en",
  "name_fr",
  "name_nl",
  "auto_hide_formula",
  "text_configuration",
  "externally_managed",
];

// Recreate reconciliation (main and text parts)
function constructReconciliationText(handle) {
  const relativePath = `./reconciliation_texts/${handle}`;
  const config = fsUtils.readConfig(relativePath);

  const attributes = RECONCILIATION_FIELDS_TO_PUSH.reduce((acc, attribute) => {
    acc[attribute] = config[attribute];
    return acc;
  }, {});
  attributes.text = fs.readFileSync(`${relativePath}/main.liquid`, "utf-8");

  const textParts = Object.keys(config.text_parts).reduce((array, name) => {
    let path = `${relativePath}/${config.text_parts[name]}`;
    let content = fs.readFileSync(path, "utf-8");
    array.push({ name, content });
    return array;
  }, []);

  attributes.text_parts = textParts;

  const mainPartPath = `${relativePath}/${config.text}`;
  const mainPartContent = fs.readFileSync(mainPartPath, "utf-8");
  attributes.text = mainPartContent;

  return attributes;
}

module.exports = {
  constructReconciliationText,
  RECONCILIATION_FIELDS_TO_SYNC,
};
