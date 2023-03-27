const fs = require("fs");
const path = require("path");

function createFolder(path) {
  try {
    if (!fs.existsSync(path)) {
      fs.mkdirSync(path);
    }
  } catch (error) {
    console.log(error);
  }
}

function createFolders(relativePath) {
  createFolder(relativePath);
  createFolder(`${relativePath}/tests`);
  createFolder(`${relativePath}/text_parts`);
}

const errorCallback = (error) => {
  if (error) {
    console.log("An error occurred when creating the liquid testing file");
    console.log(error);
  }
};

async function createLiquidTestFiles(
  relativePath,
  testFilenameRoot,
  testContent
) {
  // Liquid Test: YAML
  if (
    !fs.existsSync(`${relativePath}/tests/${testFilenameRoot}_liquid_test.yml`)
  ) {
    fs.writeFile(
      `${relativePath}/tests/${testFilenameRoot}_liquid_test.yml`,
      testContent,
      (error) => {
        if (error) {
          errorCallback(error);
        } else {
          if (relativePath) {
            console.log(`Liquid testing YAML file created for ${relativePath}`);
          }
        }
      }
    );
  } else {
    console.log(
      `Liquid testing file ${testFilenameRoot}_liquid_test.yml already exists, so the file content was not overwritten`
    );
  }

  // Liquid Test: Readme
  if (!fs.existsSync(`${relativePath}/tests/README.md`)) {
    const readmeLiquidTests = fs.readFileSync(
      path.resolve(__dirname, "./resources/liquid_tests/README.md"),
      "UTF-8"
    );
    fs.writeFile(
      `${relativePath}/tests/README.md`,
      readmeLiquidTests,
      (error) => {
        errorCallback(error);
      }
    );
  }
}

async function createTemplateFiles(relativePath, textMain, textParts) {
  const emptyCallback = () => {};

  // Template: Main
  fs.writeFile(`${relativePath}/main.liquid`, textMain, emptyCallback);
  // Template: Parts
  Object.keys(textParts).forEach((textPartName) => {
    if (textPartName) {
      fs.writeFile(
        `${relativePath}/text_parts/${textPartName}.liquid`,
        textParts[textPartName],
        emptyCallback
      );
    }
  });

  if (relativePath) {
    console.log(`Liquid template file(s) created for ${relativePath}`);
  }
}

async function createLiquidFile(relativePath, fileName, textContent) {
  const emptyCallback = () => {};
  fs.writeFileSync(
    `${relativePath}/${fileName}.liquid`,
    textContent,
    emptyCallback
  );
  console.log(`${fileName} file created`);
}

function writeConfig(relativePath, config) {
  emptyCallback = () => {};
  fs.writeFileSync(
    `${relativePath}/config.json`,
    JSON.stringify(config, null, 2),
    emptyCallback
  );
}

function readConfig(relativePath) {
  const json = fs.readFileSync(`${relativePath}/config.json`).toString();
  const config = JSON.parse(json);
  return config;
}

function createConfigIfMissing(relativePath, templateType = undefined) {
  createFolder(relativePath);

  if (!fs.existsSync(`${relativePath}/config.json`)) {
    const config = { id: {} };
    if (templateType == "reconciliation_text") {
      config.text = "main.liquid";
      config.text_parts = {};
      config.auto_hide_formula = "";
      config.text_configuration = null;
      config.virtual_account_number = "";
    }
    writeConfig(relativePath, config);
  }
}

// Get an array with all the reconciliations or all shared parts
// Based on the existence of a config.json file
function getTemplatePaths(relativePath) {
  if (
    relativePath !== "shared_parts" &&
    relativePath !== "reconciliation_texts"
  ) {
    throw "relativePath should be shared_parts or reconciliation_texts";
  }
  let templatesArray = [];
  if (!fs.existsSync(`./${relativePath}`)) {
    return templatesArray;
  }
  let allTemplates = fs.readdirSync(`./${relativePath}`);
  for (templateDir of allTemplates) {
    let templatePath = `./${relativePath}/${templateDir}`;
    let dir = fs.statSync(templatePath, () => {});
    if (dir.isDirectory()) {
      let configPath = `${templatePath}/config.json`;
      if (fs.existsSync(configPath)) {
        templatesArray.push(templatePath);
      }
    }
  }
  return templatesArray;
}

// Get the handle/name of a reconciliation/shared part by it's ID
function findHandleByID(firmId, type, id) {
  if (type !== "shared_parts" && type !== "reconciliation_texts") {
    throw "type should be shared_parts or reconciliation_texts";
  }
  let templatesArray = getTemplatePaths(type);
  for (let templatePath of templatesArray) {
    let config = readConfig(templatePath);
    if (config.id[firmId] === id) {
      return config.handle || config.name;
    }
  }
}

// Get an array with all the shared parts (name) used in a specific reconciliation (handle)
function getSharedParts(firmId, handle) {
  const reconciliationConfig = readConfig(`reconciliation_texts/${handle}`);
  // TODO: reconciliationConfig.id is the old syntax, remove it when all configs are updated
  // We should only rely on the new syntax
  // Keep: const reconciliationId = reconciliationConfig.id[firmId];
  const reconciliationID = reconciliationConfig.id[firmId]
    ? reconciliationConfig.id[firmId]
    : reconciliationConfig.id;
  const allSharedPartsPaths = getTemplatePaths("shared_parts");
  const sharedPartsPresent = [];
  for (sharedPartPath of allSharedPartsPaths) {
    let sharedPartConfig = readConfig(sharedPartPath);
    function usedInReconciliation(reconciliation) {
      // Remove all syntax: reconciliation.id === reconciliationID;
      // Keep: return reconciliation.id[firmId] === reconciliationID;
      return reconciliation.id[firmId]
        ? reconciliation.id[firmId] === reconciliationID
        : reconciliation.id === reconciliationID;
    }
    // Find if it is used in the reconciliation
    let reconciliationIndex =
      sharedPartConfig.used_in.findIndex(usedInReconciliation);
    if (reconciliationIndex !== -1) {
      sharedPartsPresent.push(sharedPartConfig.name);
    }
  }
  return sharedPartsPresent;
}

module.exports = {
  readConfig,
  writeConfig,
  createConfigIfMissing,
  createTemplateFiles,
  createLiquidTestFiles,
  createLiquidFile,
  createFolder,
  createFolders,
  getTemplatePaths,
  findHandleByID,
  getSharedParts,
};
