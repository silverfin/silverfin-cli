const fs = require("fs");
const path = require("path");
const CWD = process.cwd();

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
      path.resolve(__dirname, "../../resources/liquidTests/README.md"),
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

function createConfigIfMissing(
  relativePath,
  templateType = undefined,
  handle = undefined
) {
  createFolder(relativePath);

  if (!fs.existsSync(`${relativePath}/config.json`)) {
    const config = {};
    if (templateType == "reconciliation_text") {
      config.auto_hide_formula = "";
      config.text_configuration = null;
      config.virtual_account_number = "";
      config.reconciliation_type = "only_reconciled_with_data";
      config.public = false;
      config.allow_duplicate_reconciliation = false;
      config.is_active = true;
      config.externally_managed = true;
      config.id = {};
      config.text = "main.liquid";
      config.text_parts = {};
    } else if (templateType == "shared_part") {
      handle = handle || "main";
      config.id = {};
      config.name = "";
      config.text = `${handle}.liquid`;
      config.externally_managed = true;
      config.used_in = [];
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
  for (let templateDir of allTemplates) {
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
  for (let sharedPartPath of allSharedPartsPaths) {
    let sharedPartConfig = readConfig(sharedPartPath);
    // Find if it is used in the reconciliation
    const reconciliationUsed = sharedPartConfig.used_in?.some(
      (reconciliation) => {
        const usedReconciliationID = reconciliation.id[firmId]
          ? reconciliation.id[firmId]
          : reconciliation.id;
        return usedReconciliationID === reconciliationID ? true : false;
      }
    );

    if (reconciliationUsed) {
      sharedPartsPresent.push(sharedPartConfig.name);
    }
  }
  return sharedPartsPresent;
}

// List all files of a specific type (recursive search)
// Return an array with their full paths
function listExistingFiles(typeCheck = "liquid") {
  const baseDirectory = fs.readdirSync(CWD);
  const basePath = path.resolve(CWD);
  const array = recursiveInspectDirectory({
    basePath: basePath,
    collection: baseDirectory,
    pathsArray: undefined,
    typeCheck: typeCheck,
  });
  return array;
}

// List all liquid files related to a specific reconciliation
// Main, parts and shared parts used
// Return an array with their full paths
function listExistingRelatedLiquidFiles(firmId, handle) {
  const relatedSharedParts = getSharedParts(firmId, handle);
  const allLiquidFiles = listExistingFiles("liquid");
  const patternReconciliation = `reconciliation_texts/${handle}/`;
  const reconciliationRegExp = new RegExp(patternReconciliation, "g");
  const relatedLiquidFiles = allLiquidFiles.filter((filePath) => {
    let match = false;
    if (filePath.match(reconciliationRegExp)) {
      match = true;
    } else {
      for (let sharedPart of relatedSharedParts) {
        const patternSharedPart = `shared_parts/${sharedPart}/`;
        const sharedPartRegExp = new RegExp(patternSharedPart, "g");
        if (filePath.match(sharedPartRegExp)) {
          match = true;
        }
      }
    }
    return match;
  });
  return relatedLiquidFiles;
}

// Recursive option for fs.watch is not available in every OS (e.g. Linux)
function recursiveInspectDirectory({
  basePath,
  collection,
  pathsArray = [],
  typeCheck = "liquid",
}) {
  collection.forEach((filePath) => {
    let fullPath = path.resolve(basePath, filePath);
    let fileStats = fs.statSync(fullPath, () => {});

    if (fileStats.isDirectory()) {
      let directory = fs.readdirSync(fullPath);
      recursiveInspectDirectory({
        basePath: fullPath,
        collection: directory,
        pathsArray: pathsArray,
        typeCheck: typeCheck,
      });
    }
    const pathParts = path.resolve(fullPath).split(path.sep);
    const fileName = pathParts[pathParts.length - 1];
    let fileType = fileName.split(".")[fileName.split.length - 1];
    if (fileType === typeCheck) {
      pathsArray.push(fullPath);
    }
  });
  return pathsArray;
}

// Return {type, handle} of a template
// type: reconciliationText | sharedPart
function identifyTypeAndHandle(filePath) {
  let index;
  const pathParts = path.resolve(filePath).split(path.sep);
  const sharedPartCheck = (element) => element === "shared_parts";
  const reconciliationCheck = (element) => element === "reconciliation_texts";
  index = pathParts.findIndex(sharedPartCheck);
  if (index !== -1) {
    return { type: "sharedPart", handle: pathParts[index + 1] };
  }
  index = pathParts.findIndex(reconciliationCheck);
  if (index !== -1) {
    return { type: "reconciliationText", handle: pathParts[index + 1] };
  }
  return false;
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
  listExistingFiles,
  listExistingRelatedLiquidFiles,
  identifyTypeAndHandle,
};
