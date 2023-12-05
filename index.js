const SF = require("./lib/api/sfApi");
const fsUtils = require("./lib/utils/fsUtils");
const fs = require("fs");
const errorUtils = require("./lib/utils/errorUtils");
const { ReconciliationText } = require("./lib/templates/reconciliationText");
const { SharedPart } = require("./lib/templates/sharedPart");
const { firmCredentials } = require("./lib/api/firmCredentials");
const { ExportFile } = require("./lib/templates/exportFile");
const { AccountTemplate } = require("./lib/templates/accountTemplate");
const { consola } = require("consola");

async function fetchReconciliation(firmId, handle) {
  const configPresent = fsUtils.configExists("reconciliationText", handle);
  let templateConfig;
  if (configPresent) {
    templateConfig = fsUtils.readConfig("reconciliationText", handle);
  }
  if (templateConfig?.id[firmId]) {
    await fetchReconciliationById(firmId, templateConfig.id[firmId]);
  } else {
    await fetchReconciliationByHandle(firmId, handle);
  }
}

async function fetchReconciliationByHandle(firmId, handle) {
  const template = await SF.findReconciliationTextByHandle(firmId, handle);
  if (!template) {
    consola.error(`Reconciliation "${handle}" wasn't found`);
    process.exit(1);
  }
  const saved = ReconciliationText.save(firmId, template);
  if (saved) {
    consola.success(`Reconciliation "${handle}" imported`);
  }
}

async function fetchReconciliationById(firmId, id) {
  const template = await SF.readReconciliationTextById(firmId, id);
  if (!template || !template.data) {
    consola.error(`Reconciliation with id ${id} wasn't found`);
    process.exit(1);
  }
  const saved = ReconciliationText.save(firmId, template.data);
  if (saved) {
    consola.success(`Reconciliation "${template.data.handle}" imported`);
  }
}

async function fetchAllReconciliations(firmId, page = 1) {
  const templates = await SF.readReconciliationTexts(firmId, page);
  if (templates.length == 0) {
    if (page == 1) {
      consola.error(`No reconciliations found in firm ${firmId}`);
    }
    return;
  }
  templates.forEach(async (template) => {
    const saved = await ReconciliationText.save(firmId, template);
    if (saved) {
      consola.success(`Reconciliation "${template.handle}" imported`);
    }
  });
  fetchAllReconciliations(firmId, page + 1);
}

async function fetchExistingReconciliations(firmId) {
  const templates = fsUtils.getAllTemplatesOfAType("reconciliationText");
  if (!templates) return;
  templates.forEach(async (handle) => {
    templateConfig = fsUtils.readConfig("reconciliationText", handle);
    if (!templateConfig || !templateConfig.id[firmId]) return;
    await fetchReconciliationById(firmId, templateConfig.id[firmId]);
  });
}

async function publishReconciliationByHandle(
  firmId,
  handle,
  message = "Updated through the API"
) {
  try {
    const configPresent = fsUtils.configExists("reconciliationText", handle);
    if (!configPresent) {
      errorUtils.missingReconciliationId(handle);
    }
    const templateConfig = fsUtils.readConfig("reconciliationText", handle);
    if (!templateConfig || !templateConfig.id[firmId]) {
      errorUtils.missingReconciliationId(handle);
    }
    let templateId = templateConfig.id[firmId];
    consola.debug(`Updating reconciliation ${handle}...`);
    const template = await ReconciliationText.read(handle);
    if (!template) return;
    template.version_comment = message;
    const response = await SF.updateReconciliationText(
      firmId,
      templateId,
      template
    );
    if (response && response.data && response.data.handle) {
      consola.success(`Reconciliation updated: ${response.data.handle}`);
      return true;
    } else {
      consola.error(`Reconciliation update failed: ${handle}`);
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
      consola.warn(
        `Reconciliation "${handle}" already exists. Skipping its creation`
      );
      return;
    }
    const template = await ReconciliationText.read(handle);
    if (!template) return;
    template.version_comment = "Created through the API";
    const response = await SF.createReconciliationText(firmId, template);

    // Store new id
    if (response && response.status == 201) {
      ReconciliationText.updateTemplateId(firmId, handle, response.data.id);
      consola.success(`Reconciliation "${handle}" created`);
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

async function fetchExportFile(firmId, name) {
  const configPresent = fsUtils.configExists("exportFile", name);
  let templateConfig;
  if (configPresent) {
    templateConfig = fsUtils.readConfig("exportFile", name);
  }
  if (templateConfig?.id[firmId]) {
    await fetchExportFileById(firmId, templateConfig.id[firmId]);
  } else {
    await fetchExportFileByName(firmId, name);
  }
}

async function fetchExportFileByName(firmId, name) {
  const template = await SF.findExportFileByName(firmId, name);
  if (!template) {
    consola.error(`Export file "${name}" wasn't found`);
    process.exit(1);
  }
  const saved = ExportFile.save(firmId, template);
  if (saved) {
    consola.success(`Export file "${name}" imported`);
  }
}

async function fetchExportFileById(firmId, id) {
  const template = await SF.readExportFileById(firmId, id);
  if (!template) {
    consola.error(`Export file with id ${id} wasn't found`);
    process.exit(1);
  }
  const saved = ExportFile.save(firmId, template);
  if (saved) {
    consola.success(`Export file "${template.name}" imported`);
  }
}

async function fetchAllExportFiles(firmId, page = 1) {
  const templates = await SF.readExportFiles(firmId, page);
  if (templates.length == 0) {
    if (page == 1) {
      consola.error(`No export files found in firm ${firmId}`);
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
    const configPresent = fsUtils.configExists("exportFile", name);
    if (!configPresent) {
      errorUtils.missingExportFileId(name);
    }
    const templateConfig = fsUtils.readConfig("exportFile", name);
    if (!templateConfig || !templateConfig.id[firmId]) {
      errorUtils.missingExportFileId(name);
    }
    let templateId = templateConfig.id[firmId];
    consola.debug(`Updating export file ${name}...`);
    const template = await ExportFile.read(name);
    if (!template) return;
    template.version_comment = message;
    const response = await SF.updateExportFile(firmId, templateId, template);
    if (response && response.data && response.data.name) {
      consola.success(`Export file updated: ${response.data.name}`);
      return true;
    } else {
      consola.error(`Export file update failed: ${name}`);
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
      consola.info(
        `Export file "${name}" already exists. Skipping its creation`
      );
      return;
    }
    const template = await ExportFile.read(name);
    if (!template) return;
    template.version_comment = "Created through the API";
    const response = await SF.createExportFile(firmId, template);

    // Store new id
    if (response && response.status == 201) {
      ExportFile.updateTemplateId(firmId, name, response.data.id);
      consola.success(`Export file "${name}" created`);
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

async function fetchAccountTemplate(firmId, name) {
  const configPresent = fsUtils.configExists("accountTemplate", name);
  let templateConfig;
  if (configPresent) {
    templateConfig = fsUtils.readConfig("accountTemplate", name);
  }
  if (templateConfig?.id[firmId]) {
    await fetchAccountTemplateById(firmId, templateConfig.id[firmId]);
  } else {
    await fetchAccountTemplateByName(firmId, name);
  }
}

async function fetchAccountTemplateByName(firmId, name) {
  const template = await SF.findAccountTemplateByName(firmId, name);
  if (!template) {
    consola.error(`Account template "${name}" wasn't found`);
    process.exit(1);
  }
  const saved = AccountTemplate.save(firmId, template);
  if (saved) {
    consola.success(`Account template "${template?.name_nl}" imported`);
  }
}

async function fetchAccountTemplateById(firmId, id) {
  const template = await SF.readAccountTemplateById(firmId, id);

  if (!template) {
    consola.error(`Account template ${id} wasn't found`);
    process.exit(1);
  }

  const saved = AccountTemplate.save(firmId, template);
  if (saved) {
    consola.success(`Account template "${template?.name_nl}" imported`);
  }
}

async function fetchAllAccountTemplates(firmId, page = 1) {
  const templates = await SF.readAccountTemplates(firmId, page);
  if (templates.length == 0) {
    if (page == 1) {
      consola.warn("No account templates found");
    }
    return;
  }
  templates.forEach(async (template) => {
    const saved = AccountTemplate.save(firmId, template);
    if (saved) {
      consola.success(`Account template "${template?.name_nl}" imported`);
    }
  });
  fetchAllAccountTemplates(firmId, page + 1);
}

async function publishAccountTemplateByName(
  firmId,
  name,
  message = "Updated through the API"
) {
  try {
    const configPresent = fsUtils.configExists("accountTemplate", name);
    if (!configPresent) {
      errorUtils.missingAccountTemplateId(name);
    }
    const templateConfig = fsUtils.readConfig("accountTemplate", name);
    if (!templateConfig || !templateConfig.id[firmId]) {
      errorUtils.missingAccountTemplateId(name);
    }
    let templateId = templateConfig.id[firmId];
    consola.debug(`Updating account template ${name}...`);
    const template = await AccountTemplate.read(name);
    if (!template) return;
    template.version_comment = message;
    const response = await SF.updateAccountTemplate(
      firmId,
      templateId,
      template
    );
    if (response && response.data && response.data.name_nl) {
      consola.success(`Account template updated: ${response.data.name_nl}`);
      return true;
    } else {
      consola.error(`Account template update failed: ${handle}`);
      return false;
    }
  } catch (error) {
    errorUtils.errorHandler(error);
  }
}

async function publishAllAccountTemplates(
  firmId,
  message = "Updated through the API"
) {
  let templates = fsUtils.getAllTemplatesOfAType("accountTemplate");
  for (let name of templates) {
    if (!name) continue;
    await publishAccountTemplateByName(firmId, name, message);
  }
}

async function newAccountTemplate(firmId, name) {
  try {
    const existingTemplate = await SF.findAccountTemplateByName(firmId, name);
    if (existingTemplate) {
      consola.warn(
        `Account template "${name}" already exists. Skipping its creation`
      );
      return;
    }
    const template = await AccountTemplate.read(name);
    if (!template) return;
    template.version_comment = "Created through the API";
    const response = await SF.createAccountTemplate(firmId, template);
    const handle = response.data.name_nl;

    // Store new id
    if (response && response.status == 201) {
      AccountTemplate.updateTemplateId(firmId, handle, response.data.id);
      consola.success(`Account template "${handle}" created`);
    }
  } catch (error) {
    errorUtils.errorHandler(error);
  }
}

async function newAllAccountTemplates(firmId) {
  const templates = fsUtils.getAllTemplatesOfAType("accountTemplate");
  for (let name of templates) {
    await newAccountTemplate(firmId, name);
  }
}

async function fetchSharedPart(firmId, name) {
  const configPresent = fsUtils.configExists("sharedPart", name);
  let templateConfig;
  if (configPresent) {
    templateConfig = fsUtils.readConfig("sharedPart", name);
  }
  if (templateConfig?.id[firmId]) {
    await fetchSharedPartById(firmId, templateConfig.id[firmId]);
  } else {
    await fetchSharedPartByName(firmId, name);
  }
}

async function fetchSharedPartById(firmId, id) {
  const template = await SF.readSharedPartById(firmId, id);
  if (!template || !template.data) {
    consola.error(`Shared part ${id} wasn't found.`);
    process.exit(1);
  }
  const saved = await SharedPart.save(firmId, template.data);
  if (saved) {
    consola.success(`Shared part "${template.data.name}" imported`);
  }
}

async function fetchSharedPartByName(firmId, name) {
  const sharedPartByName = await SF.findSharedPartByName(firmId, name);
  if (!sharedPartByName) {
    consola.error(`Shared part "${name}" wasn't found.`);
    process.exit(1);
  }
  return fetchSharedPartById(firmId, sharedPartByName.id);
}

async function fetchSharedPartById(firmId, id) {
  const sharedPart = await SF.readSharedPartById(firmId, id);

  if (!sharedPart) {
    consola.error(`Shared part ${id} wasn't found.`);
    process.exit(1);
  }
  const saved = await SharedPart.save(firmId, sharedPart.data);
  if (saved) {
    consola.success(`Shared part "${sharedPart.data.name}" imported`);
  }
}

async function fetchAllSharedParts(firmId, page = 1) {
  const response = await SF.readSharedParts(firmId, page);
  const sharedParts = response.data;
  if (sharedParts.length == 0) {
    if (page == 1) {
      consola.error(`No shared parts found in firm ${firmId}`);
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
    const configPresent = fsUtils.configExists("sharedPart", name);
    if (!configPresent) {
      errorUtils.missingSharedPartId(name);
    }
    const templateConfig = fsUtils.readConfig("sharedPart", name);
    if (!templateConfig || !templateConfig.id[firmId]) {
      errorUtils.missingSharedPartId(name);
    }
    consola.debug(`Updating shared part ${name}...`);
    const template = await SharedPart.read(name);
    if (!template) return;
    template.version_comment = message;
    const response = await SF.updateSharedPart(
      firmId,
      templateConfig.id[firmId],
      template
    );
    if (response && response.data && response.data.name) {
      consola.success(`Shared part updated: ${response.data.name}`);
      return true;
    } else {
      consola.error(`Shared part update failed: ${name}`);
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
      consola.warn(
        `Shared part "${name}" already exists. Skipping its creation`
      );
      return;
    }
    const template = await SharedPart.read(name);
    if (!template) return;
    template.version_comment = "Created through the API";
    const response = await SF.createSharedPart(firmId, template);

    // Store new firm id
    if (response && response.status == 201) {
      SharedPart.updateTemplateId(firmId, name, response.data.id);
      consola.success(`Shared part "${name}" created`);
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

/** This function adds a shared part to a template. It will make a POST request to the API. If the ID of one of the templates is missing, it will try to fetch it first by making a GET request. In case of success, it will store the details in the corresponding config files.
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
        addSharedPart = SF.addSharedPartToAccountTemplate;
        break;
    }
    let response = await addSharedPart(
      firmId,
      configSharedPart.id[firmId],
      configTemplate.id[firmId]
    );

    // Success or failure
    if (!response || !response.status || !response.status === 201) {
      consola.warn(
        `Adding shared part "${sharedPartName}" to "${templateHandle}" failed (${templateType}).`
      );
      return false;
    }
    consola.success(
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
 * This function loops through all shared parts (config files) and tries to add the shared part to each template listed in 'used_in'. It will make a POST request to the API. If the ID of one of the templates is missing, it will try to fetch it first by making a GET request. In case of success, it will store the details in the corresponding config files.
 * @param {Number} firmId
 */
async function addAllSharedParts(firmId) {
  const sharedPartsArray = fsUtils.getAllTemplatesOfAType("sharedPart");
  for (let sharedPartName of sharedPartsArray) {
    let configSharedPart = fsUtils.readConfig("sharedPart", sharedPartName);
    for (let template of configSharedPart.used_in) {
      template = SharedPart.checkReconciliationType(template);
      if (!template.handle && !template.name) {
        consola.warn(`Template has no handle or name. Skipping.`);
        continue;
      }
      const folder = fsUtils.FOLDERS[template.type];
      const handle = template.handle || template.name;
      if (!fs.existsSync(`./${folder}/${handle}`)) {
        consola.warn(
          `Template ${template.type} ${handle} not found. Skipping.`
        );
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
      consola.warn(
        `Template id not found for ${templateHandle} (${templateType}). Skipping.`
      );
      return false;
    }
    if (!configSharedPart.id[firmId]) {
      consola.warn(`Shared part id not found for ${templateHandle}. Skipping.`);
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
        removeSharedPart = SF.removeSharedPartFromAccountTemplate;
        break;
    }
    let response = await removeSharedPart(
      firmId,
      configSharedPart.id[firmId],
      configTemplate.id[firmId]
    );

    if (response.status === 200) {
      consola.success(
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
  consola.debug(`Getting ID for ${handle}...`);
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
      templateText = await SF.findAccountTemplateByName(firmId, handle);
      break;
  }
  if (!templateText) {
    consola.warn(`Template ${handle} wasn't found (${type})`);
    return false;
  }
  const config = fsUtils.readConfig(type, handle);
  if (typeof config.id !== "object") {
    config.id = {};
  }
  config.id[firmId] = templateText.id;
  fsUtils.writeConfig(type, handle, config);
  consola.success(`Template ${handle}: ID updated (${type})`);
  return true;
}

/**
 * Fetch the ID of all templates of a certain type
 * @param {Number} firmId
 * @param {String} type Options: `reconciliationText`, `accountTemplate`, `exportFile` or `sharedPart`
 */
async function getAllTemplatesId(firmId, type) {
  try {
    let templates = fsUtils.getAllTemplatesOfAType(type);
    for (let templateName of templates) {
      let configTemplate = fsUtils.readConfig(type, templateName);
      let handle =
        configTemplate.handle || configTemplate.name || configTemplate.name_nl;
      if (!handle) {
        continue;
      }
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
      consola.warn(`Firm ${firmId} not found.`);
      return false;
    }
    firmCredentials.storeFirmName(firmId, firmDetails.name);
    consola.info(`Firm ${firmId} name set to ${firmDetails.name}`);
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
  fetchExistingReconciliations,
  publishReconciliationByHandle,
  publishAllReconciliations,
  newReconciliation,
  newAllReconciliations,
  fetchExportFile,
  fetchExportFileByName,
  fetchExportFileById,
  fetchAllExportFiles,
  publishExportFileByName,
  publishAllExportFiles,
  newExportFile,
  newAllExportFiles,
  fetchAccountTemplate,
  fetchAccountTemplateByName,
  fetchAccountTemplateById,
  fetchAllAccountTemplates,
  publishAccountTemplateByName,
  publishAllAccountTemplates,
  newAccountTemplate,
  newAllAccountTemplates,
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
