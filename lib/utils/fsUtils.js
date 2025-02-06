const fs = require("fs");
const path = require("path");
const { consola } = require("consola");

const FOLDERS = {
  reconciliationText: "reconciliation_texts",
  sharedPart: "shared_parts",
  exportFile: "export_files",
  accountTemplate: "account_templates",
};

const TEMPLATE_TYPES = Object.keys(FOLDERS);

const SILVERFIN_URL_PATHS = {
  reconciliationText: "reconciliation_texts",
  sharedPart: "shared_parts",
  exportFile: "export_files",
  accountTemplate: "account_detail_templates",
};

function createFolder(path) {
  if (!fs.existsSync(path)) {
    fs.mkdirSync(path, { recursive: true });
  }
}

function createTemplateFolders(templateType, handle, testFolder = true) {
  createFolder(path.join(process.cwd(), `${FOLDERS[templateType]}`, `${handle}`));
  createFolder(path.join(process.cwd(), `${FOLDERS[templateType]}`, `${handle}`, "text_parts"));
  if (testFolder) {
    createFolder(path.join(process.cwd(), `${FOLDERS[templateType]}`, `${handle}`, "tests"));
  }
}

function createSharedPartFolders(handle) {
  createFolder(path.join(process.cwd(), `${FOLDERS.sharedPart}`, `${handle}`));
}

const errorCallbackLiquidTest = (error) => {
  if (error) {
    consola.error("An error occurred when creating the liquid testing file", "\n", error);
  }
};

async function createLiquidTestFiles(templateType, handle, testContent) {
  await createLiquidTestYaml(templateType, handle, testContent);
  await createLiquidTestReadme(templateType, handle);
}

async function createLiquidTestYaml(templateType, handle, testContent) {
  const liquidTestPath = path.join(process.cwd(), `${FOLDERS[templateType]}`, `${handle}`, "tests", `${handle}_liquid_test.yml`);
  const existingFile = fs.existsSync(liquidTestPath);
  if (existingFile) {
    consola.debug(`Liquid testing file ${handle}_liquid_test.yml already exists, so the file content was not overwritten`);
    return;
  }
  fs.writeFile(liquidTestPath, testContent, (error) => {
    if (error) {
      errorCallbackLiquidTest(error);
    } else {
      consola.debug(`Liquid testing YAML file created for ${handle}`);
    }
  });
}

async function createLiquidTestReadme(templateType, handle) {
  const readmePath = path.join(process.cwd(), `${FOLDERS[templateType]}`, `${handle}`, "tests", "README.md");
  if (fs.existsSync(readmePath)) {
    return;
  }
  const readmeLiquidTests = fs.readFileSync(path.resolve(__dirname, "../../resources/liquidTests/README.md"), "UTF-8");
  fs.writeFile(readmePath, readmeLiquidTests, (error) => {
    errorCallbackLiquidTest(error);
  });
}

async function createTemplateFiles(templateType, handle, textMain, textParts) {
  const emptyCallback = () => {};

  // Template: Main
  const mainPath = path.join(process.cwd(), `${FOLDERS[templateType]}`, `${handle}`, "main.liquid");
  fs.writeFile(mainPath, textMain, emptyCallback);
  // Template: Parts
  Object.keys(textParts).forEach((textPartName) => {
    if (!textPartName) return;
    const partPath = path.join(process.cwd(), `${FOLDERS[templateType]}`, `${handle}`, "text_parts", `${textPartName}.liquid`);
    fs.writeFile(partPath, textParts[textPartName], emptyCallback);
  });
  consola.debug(`Liquid template file(s) created for ${handle}`);
}

async function createLiquidFile(relativePath, fileName, textContent) {
  const emptyCallback = () => {};
  fs.writeFileSync(`${relativePath}/${fileName}.liquid`, textContent, emptyCallback);
  consola.debug(`${fileName} file created`);
}

function writeConfig(templateType, handle, config) {
  consola.debug(`Writing config for ${handle} (${templateType})`);
  const configPath = path.join(process.cwd(), `${FOLDERS[templateType]}`, `${handle}`, "config.json");
  const emptyCallback = () => {};
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), emptyCallback);
}

function configExists(templateType, handle) {
  const configPath = path.join(process.cwd(), `${FOLDERS[templateType]}`, `${handle}`, "config.json");

  return fs.existsSync(configPath);
}

function readConfig(templateType, handle) {
  try {
    createConfigIfMissing(templateType, handle);
    const configPath = path.join(process.cwd(), `${FOLDERS[templateType]}`, `${handle}`, "config.json");

    const configData = fs.readFileSync(configPath).toString();

    return JSON.parse(configData);
  } catch (error) {
    consola.error(`An error occurred when trying to read the config for "${handle}"`);

    consola.error(error);
    process.exit(1);
  }
}

/**
 * Create a `config.json` file if it does not exist yet
 * @param {string} templateType Options: `reconciliationText`, `sharedPart`, `accountTemplate` or `exportFile`
 * @param {string} handle Handle or name of the template
 */
function createConfigIfMissing(templateType, handle) {
  const templatePath = path.join(process.cwd(), `${FOLDERS[templateType]}`, `${handle}`);
  createFolder(templatePath);
  const configPath = path.join(templatePath, "config.json");
  const existingConfig = fs.existsSync(configPath);
  if (existingConfig) return;

  const config = {};
  config.id = {};
  config.partner_id = {};
  config.externally_managed = true;
  switch (templateType) {
    case "reconciliationText":
      config.handle = handle;
      config.name_nl = `${handle}`;
      config.name_fr = `${handle}`;
      config.name_en = `${handle}`;
      config.auto_hide_formula = "";
      config.virtual_account_number = "";
      config.reconciliation_type = "only_reconciled_with_data";
      config.public = false;
      config.allow_duplicate_reconciliation = false;
      config.is_active = true;
      config.use_full_width = true;
      config.downloadable_as_docx = false;
      config.hide_code = true;
      config.published = true;
      config.text = "main.liquid";
      config.text_parts = {};
      break;
    case "sharedPart":
      config.name = `${handle}`;
      config.text = `${handle}.liquid`;
      config.hide_code = true;
      config.published = true;
      config.used_in = [];
      break;
    case "exportFile":
      config.name_nl = `${handle}`;
      config.name_fr = `${handle}`;
      config.name_en = `${handle}`;
      config.file_name = "export_file.sxbrl";
      config.text = "main.liquid";
      config.encoding = "UTF-8";
      config.text_parts = {};
      break;
    case "accountTemplate":
      config.name_nl = `${handle}`;
      config.name_fr = `${handle}`;
      config.name_en = `${handle}`;
      config.account_range = null;
      config.mapping_list_ranges = [];
      config.text = "main.liquid";
      config.text_parts = {};
      config.hide_code = true;
      config.published = true;
      break;
  }
  writeConfig(templateType, handle, config);
}

/**
 * List all existing templates of a given type. Based on the existence of a `config.json` file
 * @param {string} type Options: `reconciliationText`, `accountTemplate`, `exportFile` or `sharedPart`
 * @returns {Array<string>} Array with all the handles of the templates of the given type
 */
function getAllTemplatesOfAType(templateType) {
  if (!TEMPLATE_TYPES.includes(templateType)) {
    throw `Template type should be one of ${TEMPLATE_TYPES.join(", ")}`;
  }
  const relativePath = FOLDERS[templateType];
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
        let pathParts = path.resolve(templatePath).split(path.sep);
        let handle = pathParts[pathParts.length - 1];
        if (!handle) continue;
        templatesArray.push(handle);
      }
    }
  }
  return templatesArray;
}

/**
 * Try to identify a template by it's ID
 * @param {string} type firm or partner
 * @param {number} envId  The id of the firm or partner environment where the template is going to be imported from
 * @param {string} type Options: `reconciliationText`, `accountTemplate`, `exportFile` or `sharedPart`
 * @param {number} id Template ID
 * @returns {string|undefined} `handle` or `name` of the template
 */
function findHandleByID(type, envId, templateType, id) {
  try {
    if (!TEMPLATE_TYPES.includes(templateType)) {
      throw `Error on id ${id} with template type ${templateType}: template type should be one of ${TEMPLATE_TYPES.join(", ")}`;
    }
    let templatesArray = getAllTemplatesOfAType(templateType);
    for (let templateHandle of templatesArray) {
      let templateConfig = readConfig(templateType, templateHandle);

      const checkId = type == "firm" ? templateConfig.id && templateConfig.id[envId] : templateConfig.partner_id && templateConfig.partner_id[envId];

      if (checkId == id) {
        const handle = templateConfig.handle || templateConfig.name || templateConfig.name_nl;
        return handle;
      }
    }
    return undefined;
  } catch (error) {
    consola.error(error);
  }
}

/**
 * List all the shared parts used in a specific template
 * @param {number} firmId Firm ID where the template is used
 * @param {string} type Options: `reconciliationText`, `accountTemplate` or `exportFile`
 * @param {string} handle `handle` or `name` of the template
 * @returns {Array<string>} Array with all the shared parts used in the template
 */
function listSharedPartsUsedInTemplate(firmId, type, handle) {
  if (!TEMPLATE_TYPES.includes(type)) {
    throw `Template type should be one of ${TEMPLATE_TYPES.join(", ")}`;
  }
  const templateConfig = readConfig(type, handle);
  const templateId = templateConfig.id[firmId];
  const sharedPartsPresent = [];

  if (!templateId) {
    return sharedPartsPresent;
  }

  const allSharedPartsNames = getAllTemplatesOfAType("sharedPart");

  for (let sharedPartName of allSharedPartsNames) {
    let sharedPartConfig = readConfig("sharedPart", sharedPartName);
    // Find if it is used in the template
    const templateUsed = sharedPartConfig.used_in?.some((template) => {
      const usedTemplateId = template.id[firmId];
      return usedTemplateId === templateId ? true : false;
    });

    if (templateUsed) {
      sharedPartsPresent.push(sharedPartConfig.name);
    }
  }

  return sharedPartsPresent;
}

// List all files of a specific type (recursive search)
// Return an array with their full paths
function listExistingFiles(typeCheck = "liquid") {
  const baseDirectory = fs.readdirSync(process.cwd());
  const basePath = path.resolve(process.cwd());
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
  const relatedSharedParts = listSharedPartsUsedInTemplate(firmId, "reconciliationText", handle);
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
function recursiveInspectDirectory({ basePath, collection, pathsArray = [], typeCheck = "liquid" }) {
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
// type: reconciliationText | sharedPart | exportFile | accountTemplate
function identifyTypeAndHandle(filePath) {
  const pathParts = path.resolve(filePath).split(path.sep);
  for (const templateType in FOLDERS) {
    const index = pathParts.indexOf(FOLDERS[templateType]);
    if (index !== -1) {
      return { type: templateType, handle: pathParts[index + 1] };
    }
  }

  return false;
}

function getTemplateId(type, envId, templateConfig) {
  switch (type) {
    case "firm":
      return templateConfig?.id?.[envId];
    case "partner":
      return templateConfig?.partner_id?.[envId];
    default:
      throw "Invalid template type: ${type}";
  }
}

function setTemplateId(type, envId, templateConfig, templateId) {
  switch (type) {
    case "firm":
      templateConfig.id[envId] = templateId;
      return templateConfig.id[envId];
    case "partner":
      templateConfig.partner_id[envId] = templateId;
      return templateConfig.partner_id[envId];
    default:
      throw "Invalid template type: ${type}";
  }
}

module.exports = {
  FOLDERS,
  TEMPLATE_TYPES,
  SILVERFIN_URL_PATHS,
  configExists,
  readConfig,
  writeConfig,
  createConfigIfMissing,
  createTemplateFiles,
  createLiquidTestFiles,
  createLiquidFile,
  createFolder,
  createTemplateFolders,
  createSharedPartFolders,
  getAllTemplatesOfAType,
  findHandleByID,
  listSharedPartsUsedInTemplate,
  listExistingFiles,
  listExistingRelatedLiquidFiles,
  identifyTypeAndHandle,
  getTemplateId,
  setTemplateId,
};
