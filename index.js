const api = require("./sf_api");
const fsUtils = require("./fs_utils");
const fs = require("fs");

createNewTemplateFolder = async function (handle) {
  const relativePath = `./${handle}`;
  const emptyCallback = () => {};

  fsUtils.createFolders(relativePath);
  testFile = { name: "test", content: "" };
  textParts = { part_1: "" };
  text = "";
  fsUtils.createFiles({ relativePath, testFile, textParts, text });

  config = {
    text: "text.liquid",
    text_parts: {
      part_1: "text_parts/part_1.liquid",
    },
    test: "tests/test.yml",
    name_en: "",
  };
  writeConfig(relativePath, config);
};

importNewTemplateFolder = async function (handle) {
  reconciliationText = await api.findReconciliationText(handle);
  if (!reconciliationText) {
    throw `${handle} wasn't found`;
  }

  const relativePath = `./${handle}`;
  fsUtils.createFolders(relativePath);
  testFile = { name: "test", content: "" };
  textPartsReducer = (acc, part) => {
    acc[part.name] = part.content;
    return acc;
  };

  textParts = reconciliationText.text_parts.reduce(textPartsReducer, {});
  fsUtils.createFiles({
    relativePath,
    testFile,
    textParts,
    text: reconciliationText.text,
  });

  attributes = [
    "name",
    "name_nl",
    "name_fr",
    "name_en",
    "auto_hide_formula",
    "text_configuration",
  ].reduce((acc, attribute) => {
    acc[attribute] = reconciliationText[attribute];
    return acc;
  }, {});

  configTextParts = Object.keys(textParts).reduce((acc, name) => {
    if (name) {
      acc[name] = `text_parts/${name}.liquid`;
    }

    return acc;
  }, {});

  config = {
    ...attributes,
    text: "text.liquid",
    text_parts: configTextParts,
    test: "tests/test.yml",
  };
  writeConfig(relativePath, config);
};

constructReconciliationText = function (handle) {
  const relativePath = `./${handle}`;
  const config = fsUtils.readConfig(relativePath);

  const attributes = [
    "name",
    "name_nl",
    "name_fr",
    "name_en",
    "auto_hide_formula",
    "text_configuration",
  ].reduce((acc, attribute) => {
    acc[attribute] = config[attribute];
    return acc;
  }, {});

  const textParts = Object.keys(config.text_parts).reduce((array, name) => {
    let path = `${relativePath}/${config.text_parts[name]}`;
    let content = fs.readFileSync(path, "utf-8");

    array.push({ name, content });
    return array;
  }, []);

  attributes.text_parts = textParts;

  return attributes;
};

persistReconciliationText = async function (handle) {
  reconciliationText = await api.findReconciliationText(handle);

  if (reconciliationText) {
    api.updateReconciliationText(reconciliationText.id, {
      ...constructReconciliationText(handle),
      version_comment: "Testing Cli",
    });
  } else {
    throw "Creation of reconcilaition texts isn't yet support by API";
  }
};

module.exports = {
  createNewTemplateFolder,
  importNewTemplateFolder,
  constructReconciliationText,
  persistReconciliationText,
};
