const SF = require("./lib/api/sfApi");
const fsUtils = require("./lib/utils/fsUtils");
const fs = require("fs");
const chalk = require("chalk");
const errorUtils = require("./lib/utils/errorUtils");
const { ReconciliationText } = require("./lib/reconciliationText");
const { SharedPart } = require("./lib/sharedPart");

async function fetchReconciliationByHandle(firmId, handle) {
  const template = await SF.findReconciliationTextByHandle(firmId, handle);
  if (!template) {
    throw `Reconciliation ${handle} wasn't found`;
  }
  ReconciliationText.save(firmId, template);
}

async function fetchReconciliationById(firmId, id) {
  const template = await SF.readReconciliationTextById(firmId, id);

  if (!template || !template.data) {
    throw `Reconciliation with id ${id} wasn't found`;
  }
  ReconciliationText.save(firmId, template.data);
}

// Import all reconciliations
async function fetchAllReconciliations(firmId, page = 1) {
  const templates = await SF.readReconciliationTexts(firmId, page);
  if (templates.length == 0) {
    if (page == 1) {
      console.log("No reconciliations found");
    }
    return;
  }
  templates.forEach(async (template) => {
    await ReconciliationText.save(firmId, template);
  });
  fetchAllReconciliations(firmId, page + 1);
}

async function publishReconciliationByHandle(firmId, handle) {
  try {
    const templateConfig = fsUtils.readConfig("reconciliationText", handle);
    if (!templateConfig || !templateConfig.id[firmId]) {
      console.log(`Reconciliation ${handle}: ID is missing. Aborted`);
      console.log(
        `Try running: ${chalk.bold(
          `silverfin get-reconciliation-id --handle ${handle}`
        )} or ${chalk.bold(`silverfin get-reconciliation-id --all`)}`
      );
      process.exit(1);
    }
    let templateId = templateConfig.id[firmId];
    console.log(`Updating ${handle}...`);
    const template = await ReconciliationText.read(handle);
    template.version_comment = "Updated through the CLI";
    await SF.updateReconciliationText(firmId, templateId, template);
  } catch (error) {
    errorUtils.errorHandler(error);
  }
}

async function publishAllReconciliations(firmId) {
  let templates = fsUtils.getAllTemplatesOfAType("reconciliationText");
  for (let handle of templates) {
    if (!handle) continue;
    await publishReconciliationByHandle(firmId, handle);
  }
}

async function newReconciliation(firmId, handle) {
  try {
    const existingTemplate = await SF.findReconciliationTextByHandle(
      firmId,
      handle
    );
    if (existingTemplate) {
      console.log(
        `Reconciliation ${handle} already exists. Skipping its creation`
      );
      return;
    }
    const template = await ReconciliationText.read(handle);
    template.version_comment = "Updated through the CLI";
    const response = await SF.createReconciliationText(firmId, template);

    // Store new id
    if (response && response.status == 201) {
      ReconciliationText.updateTemplateId(firmId, handle, response.data.id);
    }
  } catch (error) {
    errorUtils.errorHandler(error);
  }
}

async function newAllReconciliations(firmId) {
  const templates = fsUtils.getAllTemplatesOfAType("reconciliationText");
  for (let handle of templates) {
    await newReconciliation(firmId, handle);
  }
}

async function importExistingSharedPartById(firmId, id) {
  const sharedPart = await SF.readSharedPartById(firmId, id);

  if (!sharedPart) {
    throw `Shared part ${id} wasn't found.`;
  }
  await SharedPart.save(firmId, sharedPart.data);
}

async function fetchSharedPartByName(firmId, name) {
  const sharedPartByName = await SF.findSharedPartByName(firmId, name);
  if (!sharedPartByName) {
    throw `Shared part with name ${name} wasn't found.`;
  }
  return importExistingSharedPartById(firmId, sharedPartByName.id);
}

async function fetchAllSharedParts(firmId, page = 1) {
  const response = await SF.readSharedParts(firmId, page);
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
  await fetchAllSharedParts(firmId, page + 1);
}

async function publishSharedPartByName(firmId, name) {
  try {
    const templateConfig = fsUtils.readConfig("sharedPart", name);
    if (!templateConfig || !templateConfig.id[firmId]) {
      console.log(`Shared part ${name}: ID is missing. Aborted`);
      console.log(
        `Try running: ${chalk.bold(
          `silverfin get-shared-part-id --shared-part ${name}`
        )} or ${chalk.bold(`silverfin get-shared-part-id --all`)}`
      );
      process.exit(1);
    }
    console.log(`Updating shared part ${name}...`);
    const template = await SharedPart.read(name);
    template.version_comment = "Updated through the CLI";
    await SF.updateSharedPart(firmId, templateConfig.id[firmId], template);
  } catch (error) {
    errorUtils.errorHandler(error);
  }
}

async function publishAllSharedParts(firmId) {
  let templates = fsUtils.getAllTemplatesOfAType("sharedPart");
  for (let name of templates) {
    if (!name) continue;
    await publishSharedPartByName(firmId, name);
  }
}

async function newSharedPart(firmId, name) {
  try {
    const existingSharedPart = await SF.findSharedPartByName(firmId, name);
    if (existingSharedPart) {
      console.log(`Shared part ${name} already exists. Skipping its creation`);
      return;
    }
    const template = await SharedPart.read(name);
    template.version_comment = "Updated through the CLI";
    const response = await SF.createSharedPart(firmId, template);

    // Store new firm id
    if (response && response.status == 201) {
      SharedPart.updateTemplateId(firmId, name, response.data.id);
    }
  } catch (error) {
    errorUtils.errorHandler(error);
  }
}

async function newAllSharedParts(firmId) {
  const templates = fsUtils.getAllTemplatesOfAType("sharedPart");
  for (let name of templates) {
    await newSharedPart(firmId, name);
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
    let configReconciliation = await fsUtils.readConfig(
      "reconciliationText",
      reconciliationHandle
    );
    let configSharedPart = await fsUtils.readConfig(
      "sharedPart",
      sharedPartHandle
    );

    // Missing Reconciliation ID
    if (!configReconciliation.id[firmId]) {
      const updated = await getTemplateId(
        firmId,
        "reconciliationText",
        reconciliationHandle
      );
      if (!updated) {
        console.error(`Reconciliation ${reconciliationHandle}: ID not found.`);
        return false;
      }
      configReconciliation = await fsUtils.readConfig(
        "reconciliationText",
        reconciliationHandle
      );
    }

    // Missing Shared Part ID
    if (!configSharedPart.id[firmId]) {
      const updated = await getTemplateId(
        firmId,
        "sharedPart",
        sharedPartHandle
      );
      if (!updated) {
        console.error(`Shared part ${sharedPartHandle}: ID not found.`);
        return false;
      }
      configSharedPart = await fsUtils.readConfig(
        "sharedPart",
        sharedPartHandle
      );
    }

    // Add shared part to reconciliation
    const response = await SF.addSharedPartToReconciliation(
      firmId,
      configSharedPart.id[firmId],
      configReconciliation.id[firmId]
    );

    if (!response || !response.status || !response.status === 201) {
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
    fsUtils.writeConfig("sharedPart", sharedPartHandle, configSharedPart);
    fsUtils.writeConfig(
      "reconciliationText",
      reconciliationHandle,
      configReconciliation
    );
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
  const sharedPartsArray = fsUtils.getAllTemplatesOfAType("sharedPart");
  for (let sharedPartName of sharedPartsArray) {
    let configSharedPart = fsUtils.readConfig("sharedPart", sharedPartName);
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
    const configReconciliation = fsUtils.readConfig(
      "reconciliationText",
      reconciliationHandle
    );
    const configSharedPart = fsUtils.readConfig("sharedPart", sharedPartHandle);

    const response = await SF.removeSharedPartFromReconciliation(
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
      fsUtils.writeConfig("sharedPart", sharedPartHandle, configSharedPart);
    }
  } catch (error) {
    errorUtils.errorHandler(error);
  }
}

// Look for the template in Silverfin with the handle/name and get it's ID
// Type has to be either "reconciliationText", "exportFile" or "sharedPart"
async function getTemplateId(firmId, type, handle) {
  let templateText;
  switch (type) {
    case "reconciliationText":
      templateText = await SF.findReconciliationTextByHandle(firmId, handle);
      break;
    case "sharedPart":
      templateText = await SF.findSharedPartByName(firmId, handle);
      break;
  }
  if (!templateText) {
    console.log(`${handle} wasn't found`);
    return false;
  }
  const config = fsUtils.readConfig(type, handle);
  if (typeof config.id !== "object") {
    config.id = {};
  }
  config.id[firmId] = templateText.id;
  fsUtils.writeConfig(type, handle, config);
  console.log(`${handle}: ID updated`);
  return true;
}

// For all existing reconciliations in the repository, find their IDs
async function getAllTemplatesId(firmId, type) {
  try {
    let templates = fsUtils.getAllTemplatesOfAType(type); // sharedPart or reconciliationText
    for (let templateName of templates) {
      let configTemplate = fsUtils.readConfig(type, templateName);
      let handle = configTemplate.handle || configTemplate.name;
      if (!handle) {
        continue;
      }
      console.log(`Getting ID for ${handle}...`);
      await getTemplateId(firmId, type, handle);
    }
  } catch (error) {
    errorUtils.errorHandler(error);
  }
}

module.exports = {
  fetchReconciliationByHandle,
  fetchReconciliationById,
  fetchAllReconciliations,
  publishReconciliationByHandle,
  publishAllReconciliations,
  newReconciliation,
  newAllReconciliations,
  fetchSharedPartByName,
  fetchAllSharedParts,
  publishSharedPartByName,
  publishAllSharedParts,
  newSharedPart,
  newAllSharedParts,
  addSharedPartToReconciliation,
  removeSharedPartFromReconciliation,
  addAllSharedPartsToAllReconciliation,
  getTemplateId,
  getAllTemplatesId,
};
