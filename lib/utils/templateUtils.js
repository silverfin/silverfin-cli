const fsUtils = require("./fsUtils");
const fs = require("fs");

const RECONCILIATION_TYPE_OPTIONS = [
  "reconciliation_not_necessary",
  "can_be_reconciled_without_data",
  "only_reconciled_with_data",
];

const RECONCILIATION_FIELDS_TO_GET = [
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
const RECONCILIATION_FIELDS_TO_PUSH_ALWAYS = [
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

const RECONCILIATION_FIELDS_TO_PUSH_EXTERNALLY_MANAGED = [];

// Recreate reconciliation (main and text parts)
function constructReconciliationText(handle) {
  const relativePath = `./reconciliation_texts/${handle}`;
  const config = fsUtils.readConfig(relativePath);

  // Config.json fields
  let FIELDS = RECONCILIATION_FIELDS_TO_PUSH_ALWAYS;
  if (config && config.externally_managed) {
    FIELDS = RECONCILIATION_FIELDS_TO_PUSH_ALWAYS.concat(
      RECONCILIATION_FIELDS_TO_PUSH_EXTERNALLY_MANAGED
    );
  }
  const attributes = FIELDS.reduce((acc, attribute) => {
    acc[attribute] = config[attribute];
    return acc;
  }, {});

  if (!RECONCILIATION_TYPE_OPTIONS.includes(attributes.reconciliation_type)) {
    console.log(
      `Wrong reconciliation type. It must be one of the following: ${RECONCILIATION_TYPE_OPTIONS.join(
        ", "
      )}. Skipping it's definition.`
    );
    delete attributes.reconciliation_type;
  }

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
  RECONCILIATION_FIELDS_TO_GET,
};
