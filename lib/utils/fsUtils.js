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

function logErrorLiquidTestFile(error) {
  consola.error(`An error occurred when creating the liquid testing file.`, "\n", error);
}

function logErrorLiquidFile(error) {
  consola.error(`An error occurred when creating the liquid template files.`, "\n", error);
}

function logErrorConfig(error) {
  consola.error(`An error occurred when writing the template's config file.`, "\n", error);
}

function createLiquidTestFiles(templateType, handle, testContent) {
  createLiquidTestYaml(templateType, handle, testContent);
  createLiquidTestReadme(templateType, handle);
}

function createLiquidTestYaml(templateType, handle, testContent) {
  try {
    const liquidTestPath = path.join(process.cwd(), `${FOLDERS[templateType]}`, `${handle}`, "tests", `${handle}_liquid_test.yml`);
    const existingFile = fs.existsSync(liquidTestPath);
    if (existingFile) {
      consola.debug(`Liquid testing file ${handle}_liquid_test.yml already exists, so the file content was not overwritten`);
      return;
    }
    fs.writeFileSync(liquidTestPath, testContent);
    consola.debug(`Liquid testing YAML file created for ${handle}`);
  } catch (error) {
    logErrorLiquidTestFile(error);
  }
}

function createLiquidTestReadme(templateType, handle) {
  try {
    const readmePath = path.join(process.cwd(), `${FOLDERS[templateType]}`, `${handle}`, "tests", "README.md");
    if (fs.existsSync(readmePath)) {
      return;
    }
    const readmeLiquidTests = fs.readFileSync(path.resolve(__dirname, "../../resources/liquidTests/README.md"), "UTF-8");
    fs.writeFileSync(readmePath, readmeLiquidTests);
    consola.debug(`Liquid testing README file created for ${handle}`);
  } catch (error) {
    logErrorLiquidTestFile(error);
  }
}

function createTemplateFiles(templateType, handle, textMain, textParts) {
  try {
    // Template: Main
    const mainPath = path.join(process.cwd(), `${FOLDERS[templateType]}`, `${handle}`, "main.liquid");
    fs.writeFileSync(mainPath, textMain);
    // Template: Parts
    Object.keys(textParts).forEach((textPartName) => {
      if (!textPartName) return;
      const partPath = path.join(process.cwd(), `${FOLDERS[templateType]}`, `${handle}`, "text_parts", `${textPartName}.liquid`);
      fs.writeFileSync(partPath, textParts[textPartName]);
    });
    consola.debug(`Liquid template file(s) created for ${handle}`);
  } catch (error) {
    logErrorLiquidFile(error);
  }
}

function createLiquidFile(relativePath, fileName, textContent) {
  try {
    fs.writeFileSync(`${relativePath}/${fileName}.liquid`, textContent);
    consola.debug(`${fileName} file created`);
  } catch (error) {
    logErrorLiquidFile(error);
  }
}

function writeConfig(templateType, handle, config) {
  try {
    consola.debug(`Writing config for ${handle} (${templateType})`);
    const configPath = path.join(process.cwd(), `${FOLDERS[templateType]}`, `${handle}`, "config.json");
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
  } catch (error) {
    logErrorConfig(error);
  }
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
  config.hide_code = true;
  config.published = true;
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
      config.text = "main.liquid";
      config.text_parts = {};
      break;
    case "sharedPart":
      config.name = `${handle}`;
      config.text = `${handle}.liquid`;
      config.used_in = [];
      break;
    case "exportFile":
      config.name_nl = `${handle}`;
      config.name_fr = `${handle}`;
      config.name_en = `${handle}`;
      config.file_name = "export_file.sxbrl";
      config.download_warning = "";
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
  const templatesArray = [];
  if (!fs.existsSync(`./${relativePath}`)) {
    return templatesArray;
  }
  const allTemplates = fs.readdirSync(`./${relativePath}`);
  for (const templateDir of allTemplates) {
    const templatePath = `./${relativePath}/${templateDir}`;
    const dir = fs.statSync(templatePath, () => {});
    if (dir.isDirectory()) {
      const configPath = `${templatePath}/config.json`;
      if (fs.existsSync(configPath)) {
        const pathParts = path.resolve(templatePath).split(path.sep);
        const handle = pathParts[pathParts.length - 1];
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
    const templatesArray = getAllTemplatesOfAType(templateType);
    for (const templateHandle of templatesArray) {
      const templateConfig = readConfig(templateType, templateHandle);
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

  for (const sharedPartName of allSharedPartsNames) {
    const sharedPartConfig = readConfig("sharedPart", sharedPartName);
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

// List all liquid files related to a specific template
// Main, parts and shared parts used
// Return an array with their full paths
function listExistingRelatedLiquidFiles(firmId, handle, templateType) {
  if (templateType !== "reconciliationText" && templateType !== "accountTemplate") {
    consola.error(`Template type is missing or invalid`);
    process.exit(1);
  }

  const relatedSharedParts = listSharedPartsUsedInTemplate(firmId, templateType, handle);
  const allLiquidFiles = listExistingFiles("liquid");
  const folderPath = `${FOLDERS[templateType]}/${handle}/`;
  const templateRegExp = new RegExp(folderPath, "g");
  const relatedLiquidFiles = allLiquidFiles.filter((filePath) => {
    let match = false;
    if (filePath.match(templateRegExp)) {
      match = true;
    } else {
      for (const sharedPart of relatedSharedParts) {
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
    const fullPath = path.resolve(basePath, filePath);
    const fileStats = fs.statSync(fullPath, () => {});

    if (fileStats.isDirectory()) {
      const directory = fs.readdirSync(fullPath);
      recursiveInspectDirectory({
        basePath: fullPath,
        collection: directory,
        pathsArray: pathsArray,
        typeCheck: typeCheck,
      });
    }
    const pathParts = path.resolve(fullPath).split(path.sep);
    const fileName = pathParts[pathParts.length - 1];
    const fileType = fileName.split(".")[fileName.split.length - 1];
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
