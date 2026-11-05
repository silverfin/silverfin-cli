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

/** The reasons a name cannot be used, so callers can tell a missing name from a malformed one. Reported by fileNameProblem */
const FILE_NAME_PROBLEMS = {
  BLANK: "blank",
  UNSAFE: "unsafe",
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

/**
 * Report why a name provided by the user cannot be used as a file or folder name.
 * Handles are interpolated into paths (e.g. ./workflows/<handle>.json), so a name which
 * resolves to another folder would read or write files outside the repository.
 * This only covers path safety: the characters a template name may hold are checked by
 * checkValidName, since those rules differ per template type.
 * It is up to the caller to decide how severe a problem is. The CLI stops on one, while
 * code which works through several names warns and carries on with the rest
 * @param {string} name The name to check
 * @returns {string|null} A FILE_NAME_PROBLEMS value, or null when the name can be used
 */
function fileNameProblem(name) {
  if (typeof name !== "string" || name.trim() === "") {
    return FILE_NAME_PROBLEMS.BLANK;
  }
  // Separators (both kinds, whatever the OS) and null bytes would point at another folder
  if (/[/\\\0]/.test(name)) {
    return FILE_NAME_PROBLEMS.UNSAFE;
  }
  // "." is the folder itself and ".." its parent. A leading dot also hides the file
  if (name.startsWith(".") || name.includes("..")) {
    return FILE_NAME_PROBLEMS.UNSAFE;
  }
  return null;
}

/**
 * Check that a name provided by the user is safe to use as a file or folder name.
 * For callers which only need to know whether the name can be used. Use fileNameProblem
 * when the reason matters, for example to word an error message
 * @param {string} name The name to check
 * @returns {boolean} True when the name stays within the folder it is joined to
 */
function isSafeName(name) {
  return fileNameProblem(name) === null;
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
        template?.name_en || template?.name_fr || template?.name_da || template?.name_de || template?.name_se || template?.name_fi
      }". Skipping. NL must be enabled in "Advanced Settings" in Silverfin because the NL name is the only required field for a template name.`
    );
    return true;
  }
  return false;
}

module.exports = {
  TEMPLATES_NAME_ATTRIBUTE,
  TEMPLATE_TYPE_NAMES,
  TEMPLATE_MAP_TYPES,
  FILE_NAME_PROBLEMS,
  getTemplateName,
  checkValidName,
  fileNameProblem,
  isSafeName,
  filterParts,
  missingLiquidCode,
  missingNameNL,
};
