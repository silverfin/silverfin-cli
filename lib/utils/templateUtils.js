const { consola } = require("consola");

const TEMPLATES_NAME_ATTRIBUTE = {
  reconciliationText: "handle",
  accountTemplate: "name_nl",
  exportFile: "name_nl",
  sharedPart: "name",
};

const TEMPLATE_TYPE_NAMES = {
  reconciliationText: "Reconciliation text",
  sharedPart: "Shared part",
  exportFile: "Export file",
  accountTemplate: "Account template",
};

const TEMPLATE_MAP_TYPES = {
  reconciliation: "reconciliationText",
  reconciliation_text: "reconciliationText",
  shared_part: "sharedPart",
  export_file: "exportFile",
  account_detail_template: "accountTemplate",
  account_template: "accountTemplate",
};

/** Get the name of the template from the template or config object (based on it's type) */
function getTemplateName(template, templateType) {
  return template[TEMPLATES_NAME_ATTRIBUTE[templateType]];
}

/** Check if the name is valid. If not, log it and return false. Valid names are alphanumeric and underscore */
function checkValidName(name, templateType) {
  // Reconciliation handle names can only contain alphanumeric characters and underscores
  let nameCheck = /^[a-zA-Z0-9_]*$/.test(name);
  // Account template and export file names can't contain back- or forward slashes
  if (templateType === "accountTemplate" || templateType === "exportFile") {
    nameCheck = /^[^\\/]*$/.test(name);
  }

  if (!nameCheck) {
    consola.warn(
      `Template name "${name}" contains invalid characters. Skipping. ${
        templateType === "accountTemplate" || templateType === "exportFile"
          ? `Valid ${templateType} names can't include back- or forward slashes`
          : `Valid ${templateType} names only include alphanumeric characters and underscores`
      }.`
    );
    return false;
  }
  return true;
}

/** Process response provided by the Silverfin API and return an object with the text parts */
function filterParts(template) {
  const textPartsReducer = (acc, part) => {
    acc[part.name] = part.content;
    return acc;
  };
  return template.text_parts.reduce(textPartsReducer, {});
}

function missingLiquidCode(template) {
  if (!template?.text) {
    consola.warn(`Template "${template?.handle || template?.name || template?.name_nl}": this template's liquid code was empty or hidden so it was not imported.`);
    return true;
  }
  return false;
}

function missingNameNL(template) {
  if (!template?.name_nl) {
    consola.warn(
      `Template name_nl is missing "${
        template?.name_en || template?.name_fr || template?.name_da || template?.name_de
      }". Skipping. NL must be enabled in "Advanced Settings" in Silverfin because the NL name is the only required field for a template name.`
    );
    return false;
  }
}

module.exports = {
  TEMPLATES_NAME_ATTRIBUTE,
  TEMPLATE_TYPE_NAMES,
  TEMPLATE_MAP_TYPES,
  getTemplateName,
  checkValidName,
  filterParts,
  missingLiquidCode,
  missingNameNL,
};
