const SF = require("./lib/api/sfApi");
const fsUtils = require("./lib/utils/fsUtils");
const path = require("path");
const fs = require("fs");
const chalk = require("chalk");
const { config } = require("./lib/api/auth");
const errorUtils = require("./lib/utils/errorUtils");
const templateUtils = require("./lib/utils/templateUtils");

function storeImportedReconciliation(firmId, reconciliationText) {
  if (!reconciliationText.handle) {
    console.log(
      `Reconciliation has no handle, add a handle before importing it. Skipped`
    );
    return;
  }

  const handle = reconciliationText.handle;

  if (!reconciliationText.text) {
    console.log(
      `This template's liquid code was empty or hidden so it was not imported: ${handle}`
    );
    return;
  }
  const relativePath = `./reconciliation_texts/${handle}`;
  fsUtils.createFolder(`./reconciliation_texts`);
  fsUtils.createFolders(relativePath);

  // Template
  textPartsReducer = (acc, part) => {
    acc[part.name] = part.content;
    return acc;
  };
  const textParts = reconciliationText.text_parts.reduce(textPartsReducer, {});
  const mainPart = reconciliationText.text;
  fsUtils.createTemplateFiles(relativePath, mainPart, textParts);

  // Liquid Test YAML
  const testFilenameRoot = handle;
  let testContent;
  if (reconciliationText.tests) {
    testContent = reconciliationText.tests;
  } else {
    testContent = "# Add your Liquid Tests here";
  }
  fsUtils.createLiquidTestFiles(relativePath, testFilenameRoot, testContent);

  // Config Json File
  const attributes = templateUtils.RECONCILIATION_FIELDS_TO_GET.reduce(
    (acc, attribute) => {
      acc[attribute] = reconciliationText[attribute];
      return acc;
    },
    {}
  );

  const configTextParts = Object.keys(textParts).reduce((acc, name) => {
    if (name) {
      acc[name] = `text_parts/${name}.liquid`;
    }
    return acc;
  }, {});

  // Check for existing ids in the config for other firms
  let existingConfig = {};

  if (fs.existsSync(`${relativePath}/config.json`)) {
    existingConfig = fsUtils.readConfig(relativePath);
  }

  const configContent = {
    ...attributes,
    id: {
      ...existingConfig?.id,
      [firmId]: reconciliationText.id,
    },
    text: "main.liquid",
    text_parts: configTextParts,
    test: `tests/${handle}_liquid_test.yml`,
  };
  fsUtils.writeConfig(relativePath, configContent);
}

async function importExistingReconciliationByHandle(firmId, handle) {
  const reconciliationText = await SF.findReconciliationText(firmId, handle);
  if (!reconciliationText) {
    throw `${handle} wasn't found`;
  }
  storeImportedReconciliation(firmId, reconciliationText);
}

async function importExistingReconciliationById(firmId, reconciliationId) {
  const reconciliationText = await SF.findReconciliationTextById(
    firmId,
    reconciliationId
  );
  if (!reconciliationText) {
    throw `${reconciliationId} wasn't found`;
  }
  storeImportedReconciliation(firmId, reconciliationText);
}

// Import all reconciliations
async function importExistingReconciliations(firmId, page = 1) {
  const response = await SF.fetchReconciliationTexts(firmId, page);
  const reconciliationsArray = response.data;
  if (reconciliationsArray.length == 0) {
    if (page == 1) {
      console.log("No reconciliations found");
    }
    return;
  }
  reconciliationsArray.forEach(async (reconciliation) => {
    storeImportedReconciliation(firmId, reconciliation);
  });
  importExistingReconciliations(firmId, page + 1);
}

// Look for the template in Silverfin with the handle/name and get it's ID
// Type has to be either "reconciliation_texts" or "shared_parts"
async function updateTemplateID(firmId, type, handle) {
  let relativePath;
  let templateText;
  if (type === "reconciliation_texts") {
    relativePath = `./reconciliation_texts/${handle}`;
    templateText = await SF.findReconciliationText(firmId, handle);
  }
  if (type === "shared_parts") {
    relativePath = `./shared_parts/${handle}`;
    templateText = await SF.findSharedPart(firmId, handle);
  }
  if (!templateText) {
    console.log(`${handle} wasn't found`);
    return;
  }
  const configPath = `${relativePath}/config.json`;
  if (!fs.existsSync(configPath)) {
    console.log(
      `There is no config.json file for ${handle}. You need to import or create it first.`
    );
    return;
  }
  const config = fsUtils.readConfig(relativePath);
  if (typeof config.id !== "object") {
    config.id = {};
  }
  config.id[firmId] = templateText.id;
  fsUtils.writeConfig(relativePath, config);
  console.log(`${handle}: ID updated`);
  return true;
}

// For all existing reconciliations in the repository, find their IDs
async function getAllTemplatesId(firmId, type) {
  try {
    let templatesArray = fsUtils.getTemplatePaths(type); // shared_parts or reconciliation_texts
    for (let configPath of templatesArray) {
      let configTemplate = fsUtils.readConfig(configPath);
      let handle = configTemplate.handle || configTemplate.name;
      if (!handle) {
        continue;
      }
      console.log(`Getting ID for ${handle}...`);
      await updateTemplateID(firmId, type, handle);
    }
  } catch (error) {
    errorUtils.errorHandler(error);
  }
}

async function persistReconciliationText(firmId, handle) {
  try {
    const relativePath = `./reconciliation_texts/${handle}`;
    const config = fsUtils.readConfig(relativePath);
    if (!config || !config.id[firmId]) {
      console.log(`Reconciliation ${handle}: ID is missing. Aborted`);
      console.log(
        `Try running: ${chalk.bold(
          `silverfin get-reconciliation-id --handle ${handle}`
        )} or ${chalk.bold(`silverfin get-reconciliation-id --all`)}`
      );
      process.exit(1);
    }
    let reconciliationTextId = config.id[firmId];
    console.log(`Updating ${handle}...`);
    await SF.updateReconciliationText(firmId, reconciliationTextId, {
      ...templateUtils.constructReconciliationText(handle),
      version_comment: "Update published using the API",
    });
  } catch (error) {
    errorUtils.errorHandler(error);
  }
}

async function persistReconciliationTexts(firmId) {
  let templatesArray = fsUtils.getTemplatePaths("reconciliation_texts");
  for (let templatePath of templatesArray) {
    let pathParts = path.resolve(templatePath).split(path.sep);
    let handle = pathParts[pathParts.length - 1];
    if (!handle) continue;
    await persistReconciliationText(firmId, handle);
  }
}

async function newReconciliation(firmId, handle) {
  try {
    const existingReconciliation = await SF.findReconciliationText(
      firmId,
      handle
    );
    if (existingReconciliation) {
      console.log(
        `Reconciliation ${handle} already exists. Skipping its creation`
      );
      return;
    }
    const relativePath = `./reconciliation_texts/${handle}`;
    fsUtils.createFolder(`./reconciliation_texts`);
    fsUtils.createFolders(relativePath);
    fsUtils.createConfigIfMissing(relativePath, "reconciliation_text");
    const config = fsUtils.readConfig(relativePath);

    if (!fs.existsSync(`${relativePath}/main.liquid`)) {
      fsUtils.createLiquidFile(
        relativePath,
        "main",
        "{% comment %}NEW RECONCILIATION - MAIN PART{% endcomment %}"
      );
    }

    // Write handle & names
    const attributes = templateUtils.constructReconciliationText(handle);
    const items = ["handle", "name_nl", "name_en", "name_fr"];
    items.forEach((item) => {
      if (!attributes[item]) {
        attributes[item] = handle;
        config[item] = handle;
      }
    });

    // Liquid Test YAML
    const testFilenameRoot = handle;
    let testContent = "# Add your Liquid Tests here";
    fsUtils.createLiquidTestFiles(relativePath, testFilenameRoot, testContent);
    config.test = `tests/${handle}_liquid_test.yml`;

    // Write config
    fsUtils.writeConfig(relativePath, config);

    const response = await SF.createReconciliationText(firmId, {
      ...attributes,
      version_comment: "Created using the API",
    });

    // Store new firm id
    if (response && response.status == 201) {
      config.id[firmId] = response.data.id;
      fsUtils.writeConfig(relativePath, config);
    }
  } catch (error) {
    errorUtils.errorHandler(error);
  }
}

async function newReconciliationsAll(firmId) {
  const reconciliationsArray = fsUtils.getTemplatePaths("reconciliation_texts");
  for (let reconciliationPath of reconciliationsArray) {
    const reconciliationHandle = reconciliationPath.split("/")[2];
    await newReconciliation(firmId, reconciliationHandle);
  }
}

async function importExistingSharedPartById(firmId, id) {
  const sharedPart = await SF.fetchSharedPartById(firmId, id);

  if (!sharedPart) {
    throw `Shared part ${id} wasn't found.`;
  }
  const sharedPartNameCheck = /^[a-zA-Z0-9_]*$/.test(sharedPart.data.name);
  if (!sharedPartNameCheck) {
    console.log(
      `Shared part name contains invalid characters. Skipping. Current name: ${sharedPart.data.name}`
    );
    return;
  }

  const relativePath = `./shared_parts/${sharedPart.data.name}`;

  fsUtils.createFolder(`./shared_parts`);
  fsUtils.createFolder(relativePath);

  fsUtils.createLiquidFile(
    relativePath,
    sharedPart.data.name,
    sharedPart.data.text
  );

  let existingConfig;

  if (!fs.existsSync(`${relativePath}/config.json`)) {
    existingConfig = fsUtils.createConfigIfMissing(
      relativePath,
      "shared_part",
      sharedPart.data.name
    );
  }
  existingConfig = fsUtils.readConfig(relativePath);

  // Adjust ID and find reconciliation handle
  let used_in = existingConfig.used_in ? existingConfig.used_in : [];
  // Remove old format IDs
  // OLD: "id": 1234
  // NEW: "id": { "100": 1234 }
  used_in = used_in.filter(
    (reconcilation) => typeof reconcilation.id !== "number"
  );

  for (let reconciliation of sharedPart.data.used_in) {
    // Search in repository
    let reconHandle = await fsUtils.findHandleByID(
      firmId,
      "reconciliation_texts",
      reconciliation.id
    );
    if (reconHandle) {
      reconciliation.handle = reconHandle;
      // Search through the API
    } else {
      let reconciliationText = await SF.findReconciliationTextById(
        firmId,
        reconciliation.id
      );
      if (reconciliationText) {
        reconciliation.handle = reconciliationText.handle;
      }
    }
    reconId = reconciliation.id;
    // Check if there's already an existing used_in configuration for other firms
    const existingReconciliationConfig = used_in.findIndex(
      (existingUsedRecon) => existingUsedRecon.handle == reconciliation.handle
    );

    if (existingReconciliationConfig !== -1) {
      reconciliation.id = {
        ...used_in[existingReconciliationConfig].id,
        [firmId]: reconciliation.id,
      };
      used_in[existingReconciliationConfig] = reconciliation;
    } else {
      reconciliation.id = { [firmId]: reconciliation.id };
      used_in.push(reconciliation);
    }
  }

  const config = {
    id: { ...existingConfig.id, [firmId]: sharedPart.data.id },
    name: sharedPart.data.name,
    text: `${sharedPart.data.name}.liquid`,
    used_in: used_in,
  };

  fsUtils.writeConfig(relativePath, config);
}

async function importExistingSharedPartByName(firmId, name) {
  const sharedPartByName = await SF.findSharedPart(firmId, name);
  if (!sharedPartByName) {
    throw `Shared part with name ${name} wasn't found.`;
  }
  return importExistingSharedPartById(firmId, sharedPartByName.id);
}

async function importExistingSharedParts(firmId, page = 1) {
  const response = await SF.fetchSharedParts(firmId, page);
  const sharedParts = response.data;
  if (sharedParts.length == 0) {
    if (page == 1) {
      console.log(`No shared parts found`);
    }
    return;
  }
  sharedParts.forEach(async (sharedPart) => {
    await importExistingSharedPartById(firmId, sharedPart.id);
  });
  await importExistingSharedParts(firmId, page + 1);
}

async function persistSharedPart(firmId, name) {
  try {
    const relativePath = `./shared_parts/${name}`;
    const config = fsUtils.readConfig(relativePath);
    if (!config || !config.id[firmId]) {
      console.log(`Shared part ${name}: ID is missing. Aborted`);
      console.log(
        `Try running: ${chalk.bold(
          `silverfin get-shared-part-id --shared-part ${name}`
        )} or ${chalk.bold(`silverfin get-shared-part-id --all`)}`
      );
      process.exit(1);
    }
    const attributes = {};
    attributes.text = fs.readFileSync(
      `${relativePath}/${name}.liquid`,
      "utf-8"
    );
    console.log(`Updating shared part ${name}...`);
    await SF.updateSharedPart(firmId, config.id[firmId], {
      ...attributes,
      version_comment: "Update published using the API",
    });
  } catch (error) {
    errorUtils.errorHandler(error);
  }
}

async function persistSharedParts(firmId) {
  let templatesArray = fsUtils.getTemplatePaths("shared_parts");
  for (let templatePath of templatesArray) {
    let pathParts = path.resolve(templatePath).split(path.sep);
    let name = pathParts[pathParts.length - 1];
    if (!name) continue;
    await persistSharedPart(firmId, name);
  }
}

async function newSharedPart(firmId, name) {
  try {
    const existingSharedPart = await SF.findSharedPart(firmId, name);
    if (existingSharedPart) {
      console.log(`Shared part ${name} already exists. Skipping its creation`);
      return;
    }
    const relativePath = `./shared_parts/${name}`;

    fsUtils.createFolder(`./shared_parts`);

    fsUtils.createConfigIfMissing(relativePath, "shared_part", name);
    const config = fsUtils.readConfig(relativePath);

    if (!fs.existsSync(`${relativePath}/${name}.liquid`)) {
      fsUtils.createLiquidFile(
        relativePath,
        name,
        "{% comment %}SHARED PART CONTENT{% endcomment %}"
      );
    }

    const attributes = {
      name,
      text: fs.readFileSync(`${relativePath}/${name}.liquid`, "utf-8"),
    };

    const response = await SF.createSharedPart(firmId, {
      ...attributes,
      version_comment: "Created using the API",
    });

    // Store new firm id
    if (response && response.status == 201) {
      config.id[firmId] = response.data.id;
      fsUtils.writeConfig(relativePath, config);
    }
  } catch (error) {
    errorUtils.errorHandler(error);
  }
}

async function newSharedPartsAll(firmId) {
  const sharedPartsArray = fsUtils.getTemplatePaths("shared_parts");
  for (let sharedPartPath of sharedPartsArray) {
    const sharedPartName = sharedPartPath.split("/")[2];
    await newSharedPart(firmId, sharedPartName);
  }
}

/** This function adds a shared part to a reconciliation text. It will make a POST request to the API. If the ID of one of the templates it missing, it will try to fetch it first by making a GET request. In case of success, it will store the details in the corresponding config files.
 *
 * @param {Number} firmId
 * @param {string} sharedPartHandle
 * @param {string} reconciliationHandle
 * @returns {boolean} - Returns true if the shared part was added successfully
 */
async function addSharedPartToReconciliation(
  firmId,
  sharedPartHandle,
  reconciliationHandle
) {
  try {
    const relativePathReconciliation = `./reconciliation_texts/${reconciliationHandle}`;
    let configReconciliation = await fsUtils.readConfig(
      relativePathReconciliation
    );
    const relativePathSharedPart = `./shared_parts/${sharedPartHandle}`;
    let configSharedPart = await fsUtils.readConfig(relativePathSharedPart);

    // Missing Reconciliation ID
    if (!configReconciliation.id[firmId]) {
      const updated = await updateTemplateID(
        firmId,
        "reconciliation_texts",
        reconciliationHandle
      );
      if (!updated) {
        console.error(`Reconciliation ${reconciliationHandle}: ID not found.`);
        return false;
      }
      configReconciliation = await fsUtils.readConfig(
        relativePathReconciliation
      );
    }

    // Missing Shared Part ID
    if (!configSharedPart.id[firmId]) {
      const updated = await updateTemplateID(
        firmId,
        "shared_parts",
        sharedPartHandle
      );
      if (!updated) {
        console.error(`Shared part ${sharedPartHandle}: ID not found.`);
        return false;
      }
      configSharedPart = await fsUtils.readConfig(relativePathSharedPart);
    }

    // Add shared part to reconciliation
    const response = await SF.addSharedPart(
      firmId,
      configSharedPart.id[firmId],
      configReconciliation.id[firmId]
    );

    if (!response.status === 201) {
      console.log(
        `Adding shared part "${sharedPartHandle}" to "${reconciliationHandle}" reconciliation text failed.`
      );
      return false;
    }
    console.log(
      `Shared part "${sharedPartHandle}" added to "${reconciliationHandle}" reconciliation text.`
    );

    // Store details in config files
    let reconciliationIndex;

    if (!configSharedPart.used_in) {
      reconciliationIndex = -1;
      configSharedPart.used_in = [];
    } else {
      reconciliationIndex = configSharedPart.used_in.findIndex(
        (reconciliationText) =>
          reconciliationHandle === reconciliationText.handle
      );
    }

    // Not stored yet
    if (reconciliationIndex === -1) {
      configSharedPart.used_in.push({
        id: { [firmId]: configReconciliation.id[firmId] },
        type: "reconciliation",
        handle: reconciliationHandle,
      });
    }

    // Previously stored
    if (reconciliationIndex !== -1) {
      configSharedPart.used_in[reconciliationIndex].id[firmId] =
        configReconciliation.id[firmId];
    }

    // Save Configs
    fsUtils.writeConfig(relativePathSharedPart, configSharedPart);
    fsUtils.writeConfig(relativePathReconciliation, configReconciliation);
    return true;
  } catch (error) {
    errorUtils.errorHandler(error);
    return false;
  }
}

/**
 * This function loops through all shared parts (config files) and tries to add the shared part to each reconciliation listed in 'used_in'. It will make a POST request to the API. If the ID of one of the templates it missing, it will try to fetch it first by making a GET request. In case of success, it will store the details in the corresponding config files.
 * @param {Number} firmId
 */
async function addAllSharedPartsToAllReconciliation(firmId) {
  const sharedPartsArray = fsUtils.getTemplatePaths("shared_parts");
  for (let sharedPartPath of sharedPartsArray) {
    let configSharedPart = fsUtils.readConfig(sharedPartPath);
    for (let reconciliation of configSharedPart.used_in) {
      if (!reconciliation.handle) {
        console.log(`Reconciliation has no handle. Skipping.`);
        continue;
      }
      if (!fs.existsSync(`./reconciliation_texts/${reconciliation.handle}`)) {
        console.log(
          `Reconciliation ${reconciliation.handle} not found. Skipping.`
        );
        continue;
      }
      await addSharedPartToReconciliation(
        firmId,
        configSharedPart.name,
        reconciliation.handle
      );
    }
  }
}

async function removeSharedPartFromReconciliation(
  firmId,
  sharedPartHandle,
  reconciliationHandle
) {
  try {
    const relativePathReconciliation = `./reconciliation_texts/${reconciliationHandle}`;
    const configReconciliation = fsUtils.readConfig(relativePathReconciliation);

    const relativePathSharedPart = `./shared_parts/${sharedPartHandle}`;
    const configSharedPart = fsUtils.readConfig(relativePathSharedPart);

    const response = await SF.removeSharedPart(
      firmId,
      configSharedPart.id[firmId],
      configReconciliation.id[firmId]
    );
    if (response.status === 200) {
      console.log(
        `Shared part "${sharedPartHandle}" removed from "${reconciliationHandle}" reconciliation text.`
      );
    }

    const reconciliationIndex = configSharedPart.used_in.findIndex(
      (reconciliationText) =>
        reconciliationText.id[firmId] === configReconciliation.id[firmId]
    );
    if (reconciliationIndex !== -1) {
      const reconciliationText = configSharedPart.used_in[reconciliationIndex];

      if (Object.keys(reconciliationText.id).length === 1) {
        configSharedPart.used_in.splice(reconciliationIndex, 1);
      } else {
        delete reconciliationText.id[firmId];
      }
      fsUtils.writeConfig(relativePathSharedPart, configSharedPart);
    }
  } catch (error) {
    errorUtils.errorHandler(error);
  }
}

function authorize(firmId = undefined) {
  SF.authorizeApp(firmId);
}

function setDefaultFirmID(firmId) {
  config.setFirmId(firmId);
  console.log(`Set firm id to: ${firmId}`);
}

function getDefaultFirmID() {
  const firmId = config.getFirmId();
  return firmId;
}

function listStoredIds() {
  return config.storedIds();
}

module.exports = {
  importExistingReconciliationByHandle,
  importExistingReconciliationById,
  importExistingReconciliations,
  persistReconciliationText,
  persistReconciliationTexts,
  newReconciliation,
  newReconciliationsAll,
  importExistingSharedPartByName,
  importExistingSharedParts,
  persistSharedPart,
  persistSharedParts,
  newSharedPart,
  newSharedPartsAll,
  addSharedPartToReconciliation,
  removeSharedPartFromReconciliation,
  addAllSharedPartsToAllReconciliation,
  authorize,
  updateTemplateID,
  getAllTemplatesId,
  setDefaultFirmID,
  getDefaultFirmID,
  listStoredIds,
};
