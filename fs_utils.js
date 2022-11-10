const fs = require("fs");
const path = require("path");

function createFolder(path) {
  if (!fs.existsSync(path)) {
    fs.mkdirSync(path);
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
  fs.writeFile(
    `${relativePath}/${fileName}.liquid`,
    textContent,
    emptyCallback
  );
  console.log(`${fileName} file created`);
}

function writeConfig(relativePath, config) {
  emptyCallback = () => {};
  fs.writeFile(
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

// Get an array with all the reconciliations or all shared parts
function getTemplatePaths(relativePath) {
  if (
    relativePath !== "shared_parts" &&
    relativePath !== "reconciliation_texts"
  ) {
    throw "relativePath should be shared_parts or reconciliation_texts";
  }
  let templatesArray = [];
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

// Get an array with all the shared parts (name) used in a specific reconciliation (handle)
function getSharedParts(handle) {
  const reconciliationConfig = readConfig(`reconciliation_texts/${handle}`);
  const reconciliationID = reconciliationConfig.id;
  const allSharedPartsPaths = getTemplatePaths("shared_parts");
  const sharedPartsPresent = [];
  for (sharedPartPath of allSharedPartsPaths) {
    let sharedPartConfig = readConfig(sharedPartPath);
    const usedInReconciliation = (reconciliation) =>
      reconciliation.id === reconciliationID;
    let reconciliationIndex =
      sharedPartConfig.used_in.findIndex(usedInReconciliation);
    if (reconciliationIndex !== -1) {
      sharedPartsPresent.push(sharedPartConfig.name);
    }
  }
  return sharedPartsPresent;
}

module.exports = {
  writeConfig,
  createTemplateFiles,
  createLiquidTestFiles,
  createLiquidFile,
  createFolder,
  createFolders,
  readConfig,
  getTemplatePaths,
  getSharedParts,
};
