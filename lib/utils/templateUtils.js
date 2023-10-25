/** Check if the name is valid. If not, log it and return false. Valid names are alphanumeric and underscore */
function checkValidName(name) {
  const nameCheck = /^[a-zA-Z0-9_]*$/.test(name);
  if (!nameCheck) {
    console.log(
      `Template name contains invalid characters. Skipping. Valid template names only include alphanumeric characters and underscores. Current name: ${name}`
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
  if (!template.text) {
    console.log(
      `Template ${
        template.handle || template.name || ""
      }: this template's liquid code was empty or hidden so it was not imported.`
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
