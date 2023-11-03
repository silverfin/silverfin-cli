const { consola } = require("consola");

/** Check if the name is valid. If not, log it and return false. Valid names are alphanumeric and underscore */
function checkValidName(name, templateType) {
  // Reconciliation handle names can only contain alphanumeric characters and underscores
  let nameCheck;

  if (templateType === "accountTemplate" || templateType === "exportFile") {
    nameCheck = /^[^\\/]*$/.test(name);
  } else {
    nameCheck = /^[a-zA-Z0-9_]*$/.test(name);
  }

  if (!nameCheck) {
    consola.warn(
      `Template name "${name}" contains invalid characters. Skipping. ${templateType === "accountTemplate" || templateType === "exportFile" ? `Valid ${templateType} names can't include back- or forward slashes` : `Valid ${templateType} names only include alphanumeric characters and underscores`}.`
    );
    return false;
  }
  return true;
}

/** Process response provided by the Silverfin API and return an object with the text parts */
function filterParts(template) {
  textPartsReducer = (acc, part) => {
    acc[part.name] = part.content;
    return acc;
  };
  return template.text_parts.reduce(textPartsReducer, {});
}

function missingLiquidCode(template) {
  if (!template?.text) {
    consola.warn(
      `Template "${
        template?.handle || template?.name || template?.name_nl
      }": this template's liquid code was empty or hidden so it was not imported.`
    );
    return true;
  }
  return false;
}

module.exports = {
  checkValidName,
  filterParts,
  missingLiquidCode,
};
