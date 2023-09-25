const SF = require("./lib/api/sfApi");
const fsUtils = require("./lib/utils/fsUtils");
const fs = require("fs");
const chalk = require("chalk");
const errorUtils = require("./lib/utils/errorUtils");
const { ReconciliationText } = require("./lib/reconciliationText");
const { SharedPart } = require("./lib/sharedPart");
const { firmCredentials } = require("./lib/api/firmCredentials");
const { ExportFile } = require("./lib/exportFile");

async function fetchReconciliation(firmId, handle) {
  const templateConfig = fsUtils.readConfig("reconciliationText", handle);
  if (templateConfig && templateConfig.id[firmId]) {
    fetchReconciliationById(firmId, templateConfig.id[firmId]);
  } else {
    fetchReconciliationByHandle(firmId, handle);
  }
}

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

async function publishReconciliationByHandle(
  firmId,
  handle,
  message = "Updated through the API"
) {
  try {
    const templateConfig = fsUtils.readConfig("reconciliationText", handle);
    if (!templateConfig || !templateConfig.id[firmId]) {
      errorUtils.missingReconciliationId(handle);
    }
    let templateId = templateConfig.id[firmId];
    console.log(`Updating reconciliation ${handle}...`);
    const template = await ReconciliationText.read(handle);
    template.version_comment = message;
    const response = await SF.updateReconciliationText(
      firmId,
      templateId,
      template
    );
    if (response && response.data && response.data.handle) {
      console.log(`Reconciliation updated: ${response.data.handle}`);
      return true;
    } else {
      console.log(`Reconciliation update failed: ${handle}`);
      return false;
    }
  } catch (error) {
    errorUtils.errorHandler(error);
  }
}

async function publishAllReconciliations(
  firmId,
  message = "Updated through the API"
) {
  let templates = fsUtils.getAllTemplatesOfAType("reconciliationText");
  for (let handle of templates) {
    if (!handle) continue;
    await publishReconciliationByHandle(firmId, handle, message);
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
    template.version_comment = "Created through the API";
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

async function fetchExportFileByHandle(firmId, name) {
  const template = await SF.findExportFileByName(firmId, name);
  if (!template) {
    throw `Export file ${name} wasn't found`;
  }
  ExportFile.save(firmId, template);
}

async function fetchExportFileById(firmId, id) {
  const template = await SF.readExportFileById(firmId, id);
  if (!template) {
    throw `Export file with id ${id} wasn't found`;
  }
  ExportFile.save(firmId, template);
}

async function fetchAllExportFiles(firmId, page = 1) {
  const templates = await SF.readExportFiles(firmId, page);
  if (templates.length == 0) {
    if (page == 1) {
      console.log("No export files found");
    }
    return;
  }
  templates.forEach(async (template) => {
    fetchExportFileById(firmId, template.id);
  });
  fetchAllExportFiles(firmId, page + 1);
}

async function publishExportFileByName(
  firmId,
  name,
  message = "Updated through the API"
) {
  try {
    const templateConfig = fsUtils.readConfig("exportFile", name);
    if (!templateConfig || !templateConfig.id[firmId]) {
      errorUtils.missingExportFileId(name);
    }
    let templateId = templateConfig.id[firmId];
    console.log(`Updating export file ${name}...`);
    const template = await ExportFile.read(name);
    template.version_comment = message;
    const response = await SF.updateExportFile(firmId, templateId, template);
    if (response && response.data && response.data.name) {
      console.log(`Export file updated: ${response.data.name}`);
      return true;
    } else {
      console.log(`Export file update failed: ${name}`);
      return false;
    }
  } catch (error) {
    errorUtils.errorHandler(error);
  }
}

async function publishAllExportFiles(
  firmId,
  message = "Updated through the API"
) {
  let templates = fsUtils.getAllTemplatesOfAType("exportFile");
  for (let name of templates) {
    if (!name) continue;
    await publishExportFileByName(firmId, name, message);
  }
}

async function newExportFile(firmId, name) {
  try {
    const existingTemplate = await SF.findExportFileByName(firmId, name);
    if (existingTemplate) {
      console.log(
        `Reconciliation ${name} already exists. Skipping its creation`
      );
      return;
    }
    const template = await ExportFile.read(name);
    template.version_comment = "Created through the API";
    const response = await SF.createExportFile(firmId, template);

    // Store new id
    if (response && response.status == 201) {
      ExportFile.updateTemplateId(firmId, name, response.data.id);
    }
  } catch (error) {
    errorUtils.errorHandler(error);
  }
}

async function newAllExportFiles(firmId) {
  const templates = fsUtils.getAllTemplatesOfAType("exportFile");
  for (let name of templates) {
    await newExportFile(firmId, name);
  }
}

async function fetchAccountDetailByHandle(firmId, name) {}
async function fetchAccountDetailById(firmId, id) {}
async function fetchAllAccountDetails(firmId) {}
async function publishAccountDetailByName(firmId, name) {}
async function publishAllAccountDetails(firmId) {}
async function newAccountDetail(firmId, name) {}
async function newAllAccountDetails(firmId) {}

async function fetchSharedPart(firmId, name) {
  const templateConfig = fsUtils.readConfig("sharedPart", name);
  if (templateConfig && templateConfig.id[firmId]) {
    fetchSharedPartById(firmId, templateConfig.id[firmId]);
  } else {
    fetchSharedPartByName(firmId, name);
  }
}

async function fetchSharedPartById(firmId, id) {
  const sharedPart = await SF.readSharedPartById(firmId, id);

  if (!sharedPart) {
    throw `Shared part ${id} wasn't found.`;
  }
}

async function fetchSharedPartByName(firmId, name) {
  const sharedPartByName = await SF.findSharedPartByName(firmId, name);
  if (!sharedPartByName) {
    throw `Shared part with name ${name} wasn't found.`;
  }
  return fetchSharedPartById(firmId, sharedPartByName.id);
}

async function fetchSharedPartById(firmId, id) {
  const sharedPart = await SF.readSharedPartById(firmId, id);

  if (!sharedPart) {
    throw `Shared part ${id} wasn't found.`;
  }
  await SharedPart.save(firmId, sharedPart.data);
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
    await fetchSharedPartById(firmId, sharedPart.id);
  });
  await fetchAllSharedParts(firmId, page + 1);
}

async function publishSharedPartByName(
  firmId,
  name,
  message = "Updated through the API"
) {
  try {
    const templateConfig = fsUtils.readConfig("sharedPart", name);
    if (!templateConfig || !templateConfig.id[firmId]) {
      errorUtils.missingSharedPartId(name);
    }
    console.log(`Updating shared part ${name}...`);
    const template = await SharedPart.read(name);
    template.version_comment = message;
    const response = await SF.updateSharedPart(
      firmId,
      templateConfig.id[firmId],
      template
    );
    if (response && response.data && response.data.name) {
      console.log(`Shared part updated: ${response.data.name}`);
      return true;
    } else {
      console.log(`Shared part update failed: ${name}`);
      return false;
    }
  } catch (error) {
    errorUtils.errorHandler(error);
  }
}

async function publishAllSharedParts(
  firmId,
  message = "Updated through the API"
) {
  let templates = fsUtils.getAllTemplatesOfAType("sharedPart");
  for (let name of templates) {
    if (!name) continue;
    await publishSharedPartByName(firmId, name, message);
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
    template.version_comment = "Created through the API";
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

/** This function adds a shared part to a template. It will make a POST request to the API. If the ID of one of the templates it missing, it will try to fetch it first by making a GET request. In case of success, it will store the details in the corresponding config files.
 *
 * @param {Number} firmId
 * @param {string} sharedPartName
 * @param {string} templateHandle
 * @param {string} templateType has to be either `reconciliationText`, `exportFile`or `accountTemplate`
 * @returns {boolean} - Returns true if the shared part was added successfully
 */
async function addSharedPart(
  firmId,
  sharedPartName,
  templateHandle,
  templateType
) {
  try {
    let configTemplate = await fsUtils.readConfig(templateType, templateHandle);
    let configSharedPart = await fsUtils.readConfig(
      "sharedPart",
      sharedPartName
    );

    // Missing Reconciliation ID. Try to identify it based on the handle
    if (!configTemplate.id[firmId]) {
      const updated = await getTemplateId(firmId, templateType, templateHandle);
      if (!updated) return false;
      configTemplate = await fsUtils.readConfig(templateType, templateHandle);
    }
    // Missing Shared Part ID. Try to identify it based on the name
    if (!configSharedPart.id[firmId]) {
      const updated = await getTemplateId(firmId, "sharedPart", sharedPartName);
      if (!updated) return false;
      configSharedPart = await fsUtils.readConfig("sharedPart", sharedPartName);
    }

    // Add shared part to template
    let addSharedPart;
    switch (templateType) {
      case "reconciliationText":
        addSharedPart = SF.addSharedPartToReconciliation;
        break;
      case "exportFile":
        addSharedPart = SF.addSharedPartToExportFile;
        break;
      case "accountTemplate":
        // To be implemented
        // addFunction = SF.addSharedPartToAccountTemplate;
        break;
    }
    let response = await addSharedPart(
      firmId,
      configSharedPart.id[firmId],
      configTemplate.id[firmId]
    );

    // Success or failure
    if (!response || !response.status || !response.status === 201) {
      console.log(
        `Adding shared part "${sharedPartName}" to "${templateHandle}" failed (${templateType}).`
      );
      return false;
    }
    console.log(
      `Shared part "${sharedPartName}" added to "${templateHandle}" (${templateType}).`
    );

    // Store details in config files
    let templateIndex;
    if (!configSharedPart.used_in) {
      templateIndex = -1;
      configSharedPart.used_in = [];
    } else {
      // Previously stored ?
      templateIndex = configSharedPart.used_in.findIndex(
        (template) =>
          templateHandle === template.handle || templateHandle === template.name
      );
    }
    // Not stored yet
    if (templateIndex === -1) {
      configSharedPart.used_in.push({
        id: { [firmId]: configTemplate.id[firmId] },
        type: templateType,
        handle: templateHandle,
      });
    }
    // Previously stored
    if (templateIndex !== -1) {
      configSharedPart.used_in[templateIndex].id[firmId] =
        configTemplate.id[firmId];
    }
    // Save Configs
    fsUtils.writeConfig("sharedPart", sharedPartName, configSharedPart);
    fsUtils.writeConfig(templateType, templateHandle, configTemplate);
    return true;
  } catch (error) {
    errorUtils.errorHandler(error);
    return false;
  }
}

/**
 * This function loops through all shared parts (config files) and tries to add the shared part to each template listed in 'used_in'. It will make a POST request to the API. If the ID of one of the templates it missing, it will try to fetch it first by making a GET request. In case of success, it will store the details in the corresponding config files.
 * @param {Number} firmId
 */
async function addAllSharedParts(firmId) {
  const sharedPartsArray = fsUtils.getAllTemplatesOfAType("sharedPart");
  for await (let sharedPartName of sharedPartsArray) {
    let configSharedPart = fsUtils.readConfig("sharedPart", sharedPartName);
    for await (let template of configSharedPart.used_in) {
      template = SharedPart.checkReconciliationType(template);
      if (!template.handle && !template.name) {
        console.log(`Template has no handle or name. Skipping.`);
        continue;
      }
      const folder = fsUtils.FOLDERS[template.type];
      const handle = template.handle || template.name;
      if (!fs.existsSync(`./${folder}/${handle}`)) {
        console.log(`Template ${template.type} ${handle} not found. Skipping.`);
        continue;
      }
      addSharedPart(firmId, configSharedPart.name, handle, template.type);
    }
  }
}

async function removeSharedPart(
  firmId,
  sharedPartHandle,
  templateHandle,
  templateType
) {
  try {
    const configTemplate = fsUtils.readConfig(templateType, templateHandle);
    const configSharedPart = fsUtils.readConfig("sharedPart", sharedPartHandle);
    if (!configTemplate.id[firmId]) {
      console.log(
        `Template id not found for ${templateHandle} (${templateType}). Skipping.`
      );
      return false;
    }
    if (!configSharedPart.id[firmId]) {
      console.log(`Shared part id not found for ${templateHandle}. Skipping.`);
      return false;
    }
    // Remove shared part from template
    let removeSharedPart;
    switch (templateType) {
      case "reconciliationText":
        removeSharedPart = SF.removeSharedPartFromReconciliation;

        break;
      case "exportFile":
        removeSharedPart = SF.removeSharedPartFromExportFile;
        break;
      case "accountTemplate":
        // To be implemented
        // removeSharedPart = SF.removeSharedPartFromAccountTemplate;
        break;
    }
    let response = await removeSharedPart(
      firmId,
      configSharedPart.id[firmId],
      configTemplate.id[firmId]
    );

    if (response.status === 200) {
      console.log(
        `Shared part "${sharedPartHandle}" removed from template "${templateHandle}" (${templateType}).`
      );
    }

    // Remove reference from shared part config
    const templateIndex = configSharedPart.used_in.findIndex(
      (reconciliationText) =>
        reconciliationText.id[firmId] === configTemplate.id[firmId]
    );
    if (templateIndex !== -1) {
      const reconciliationText = configSharedPart.used_in[templateIndex];

      if (Object.keys(reconciliationText.id).length === 1) {
        configSharedPart.used_in.splice(templateIndex, 1);
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
// Type has to be either "reconciliationText", "exportFile". "accountTemplate" or "sharedPart"
async function getTemplateId(firmId, type, handle) {
  let templateText;
  switch (type) {
    case "reconciliationText":
      templateText = await SF.findReconciliationTextByHandle(firmId, handle);
      break;
    case "exportFile":
      templateText = await SF.findExportFileByName(firmId, handle);
      break;
    case "sharedPart":
      templateText = await SF.findSharedPartByName(firmId, handle);
      break;
    case "accountTemplate":
      // To be implemented
      break;
  }
  if (!templateText) {
    console.log(`Template ${handle} wasn't found (${type})`);
    return false;
  }
  const config = fsUtils.readConfig(type, handle);
  if (typeof config.id !== "object") {
    config.id = {};
  }
  config.id[firmId] = templateText.id;
  fsUtils.writeConfig(type, handle, config);
  console.log(`Template ${handle}: ID updated (${type})`);
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

async function updateFirmName(firmId) {
  try {
    const firmDetails = await SF.getFirmDetails(firmId);
    if (!firmDetails) {
      console.log(`Firm ${firmId} not found.`);
      return false;
    }
    firmCredentials.storeFirmName(firmId, firmDetails.name);
    console.log(`Firm ${firmId} name set to ${firmDetails.name}`);
    return true;
  } catch (error) {
    errorUtils.errorHandler(error);
  }
}

module.exports = {
  fetchReconciliation,
  fetchReconciliationByHandle,
  fetchReconciliationById,
  fetchAllReconciliations,
  publishReconciliationByHandle,
  publishAllReconciliations,
  newReconciliation,
  newAllReconciliations,
  fetchExportFileByHandle,
  fetchExportFileById,
  fetchAllExportFiles,
  publishExportFileByName,
  publishAllExportFiles,
  newExportFile,
  newAllExportFiles,
  fetchAccountDetailByHandle,
  fetchAccountDetailById,
  fetchAllAccountDetails,
  publishAccountDetailByName,
  publishAllAccountDetails,
  newAccountDetail,
  newAllAccountDetails,
  fetchSharedPart,
  fetchSharedPartByName,
  fetchSharedPartById,
  fetchAllSharedParts,
  publishSharedPartByName,
  publishAllSharedParts,
  newSharedPart,
  newAllSharedParts,
  addSharedPart,
  removeSharedPart,
  addAllSharedParts,
  getTemplateId,
  getAllTemplatesId,
  updateFirmName,
};
