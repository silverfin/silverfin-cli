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

async function fetchReconciliationById(type, envId, id) {
  try {
    const template = await SF.readReconciliationTextById(type, envId, id);
    if (!template || !template.data) {
      consola.error(`Reconciliation with id ${id} wasn't found in ${type} ${envId}`);
      process.exit(1);
    }

    const saved = await ReconciliationText.save(type, envId, template.data);

    if (saved) {
      consola.success(`Reconciliation "${template.data.handle}" imported from ${type} ${envId}`);
    }

    return {
      type,
      envId,
      template,
    };
  } catch (error) {
    consola.error(error);
    process.exit(1);
  }
}

async function fetchReconciliationByHandle(type, envId, handle) {
  try {
    const configPresent = fsUtils.configExists("reconciliationText", handle);

    let id;
    let existingTemplate;

    if (configPresent) {
      const templateConfig = fsUtils.readConfig("reconciliationText", handle);

      id = fsUtils.getTemplateId(type, envId, templateConfig);
    }

    if (!id) {
      existingTemplate = await SF.findReconciliationTextByHandle(type, envId, handle);

      if (!existingTemplate) {
        consola.error(
          `Reconciliation not found inside the reconciliation_texts folder or in the ${type} ${envId}. Please run create-reconciliation if you still need to create it.`
        );
        process.exit(1);
      } else {
        id = existingTemplate.id;
      }
    }

    fetchReconciliationById(type, envId, id);
  } catch (error) {
    consola.error(error);
    process.exit(1);
  }
}

async function fetchAllReconciliations(type, envId, page = 1) {
  const templates = await SF.readReconciliationTexts(type, envId, page);
  if (templates.length == 0) {
    if (page == 1) {
      consola.error(`No reconciliations found in ${type} ${envId}`);
    }
    return;
  }

  for (let template of templates) {
    try {
      const saved = await ReconciliationText.save(type, envId, template);

      if (saved) consola.success(`Reconciliation "${template.handle}" imported from ${type} ${envId}`);
    } catch (error) {
      consola.error(error);
    }
  }

  fetchAllReconciliations(type, envId, page + 1);
}

async function fetchExistingReconciliations(type, envId) {
  const templates = fsUtils.getAllTemplatesOfAType("reconciliationText");

  if (!templates || templates.length == 0) {
    consola.warn(`No reconciliation templates with a valid config found in ${type} ${envId}`);
    return;
  }

  for (let handle of templates) {
    try {
      const configPresent = fsUtils.configExists("reconciliationText", handle);

      if (!configPresent) {
        consola.error(`Config file for reconciliationText "${handle}" not found`);
      }

      const templateConfig = fsUtils.readConfig("reconciliationText", handle);
      let templateId = fsUtils.getTemplateId(type, envId, templateConfig);

      if (!templateId) {
        errorUtils.missingReconciliationId(handle);
      } else {
        await fetchReconciliationById(type, envId, templateId);
      }
    } catch (error) {
      consola.error(error);
    }
  }
}

async function publishReconciliationByHandle(type, envId, handle, message = "Updated with the Silverfin CLI") {
  try {
    const configPresent = fsUtils.configExists("reconciliationText", handle);

    if (!configPresent) {
      errorUtils.missingReconciliationId(handle);
      return false;
    }

    const templateConfig = fsUtils.readConfig("reconciliationText", handle);
    let templateId = fsUtils.getTemplateId(type, envId, templateConfig);

    if (!templateId) {
      errorUtils.missingReconciliationId(handle);
      return false;
    }

    consola.debug(`Updating reconciliation ${handle}...`);

    const template = await ReconciliationText.read(handle);
    if (!template) return;

    // Add API-only required fields
    template.version_comment = message;

    if (type == "partner") {
      template.version_significant_change = false;
      delete template.is_active;
    }

    const response = await SF.updateReconciliationText(type, envId, templateId, template);

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

async function publishAllReconciliations(type, envId, message = "updated through the Silverfin CLI") {
  let templates = fsUtils.getAllTemplatesOfAType("reconciliationText");
  for (let handle of templates) {
    if (!handle) continue;
    await publishReconciliationByHandle(type, envId, handle, message);
  }
}

async function newReconciliation(type, envId, handle) {
  try {
    const existingTemplate = await SF.findReconciliationTextByHandle(type, envId, handle);
    if (existingTemplate) {
      consola.warn(`Reconciliation "${handle}" already exists on ${type} ${envId}. Skipping its creation`);
      return;
    }

    const template = await ReconciliationText.read(handle);
    if (!template) return;
    template.version_comment = "Created with the Silverfin CLI";
    const response = await SF.createReconciliationText(type, envId, template);
    // Store new id
    if (response && response.status == 201) {
      ReconciliationText.updateTemplateId(type, envId, handle, response.data.id);
      consola.success(`Reconciliation "${handle}" created on ${type} ${envId}`);
    }
  } catch (error) {
    errorUtils.errorHandler(error);
  }
}

async function newAllReconciliations(type, envId) {
  const templates = fsUtils.getAllTemplatesOfAType("reconciliationText");
  for (let handle of templates) {
    await newReconciliation(type, envId, handle);
  }
}

async function fetchExportFileByName(type, envId, name) {
  try {
    const template = await SF.findExportFileByName(type, envId, name);

    if (!template) {
      consola.error(`Export file "${name}" wasn't found in ${type} ${envId}`);
      process.exit(1);
    }

    const saved = ExportFile.save(type, envId, template);
    if (saved) {
      consola.success(`Export file "${template?.name}" imported from ${type} ${envId}`);
    }
  } catch (error) {
    consola.error(error);
    process.exit(1);
  }
}

async function fetchExportFileById(type, envId, id) {
  try {
    const template = await SF.readExportFileById(type, envId, id);

    if (!template) {
      consola.error(`Export file with id ${id} wasn't found in ${type} ${envId}`);
      process.exit(1);
    }

    const saved = ExportFile.save(type, envId, template);
    if (saved) {
      consola.success(`Export file "${template.name}" imported from ${type} ${envId}`);
    }

    return {
      type,
      envId,
      template,
    };
  } catch (error) {
    consola.error(error);
    process.exit(1);
  }
}

async function fetchAllExportFiles(type, envId, page = 1) {
  const templates = await SF.readExportFiles(type, envId, page);

  if (templates.length == 0) {
    if (page == 1) {
      consola.error(`No export files found in ${type} ${envId}`);
    }
    return;
  }

  templates.forEach(async (template) => {
    const saved = ExportFile.save(type, envId, template);

    if (saved) {
      consola.success(`Export file "${template?.name}" imported from ${type} ${envId}`);
    }
  });
  fetchAllExportFiles(type, envId, page + 1);
}

async function fetchExistingExportFiles(type, envId) {
  const templates = fsUtils.getAllTemplatesOfAType("exportFile");
  if (!templates) {
    consola.warn(`No export files found in ${type} ${envId}`);
    return;
  }

  templates.forEach(async (name) => {
    const templateConfig = fsUtils.readConfig("exportFile", name);
    let templateId = fsUtils.getTemplateId(type, envId, templateConfig);

    if (!templateId) {
      errorUtils.missingExportFileId(name);
      return false;
    }

    await fetchExportFileById(type, envId, templateId);
  });
}

async function publishExportFileByName(type, envId, name, message = "updated through the Silverfin CLI") {
  try {
    const configPresent = fsUtils.configExists("exportFile", name);

    if (!configPresent) {
      errorUtils.missingExportFileId(name);
      return false;
    }

    const templateConfig = fsUtils.readConfig("exportFile", name);
    let templateId = fsUtils.getTemplateId(type, envId, templateConfig);

    if (!templateConfig || !templateId) {
      errorUtils.missingExportFileId(name);
      return false;
    }

    consola.debug(`Updating export file ${name}...`);

    const template = await ExportFile.read(name);
    if (!template) return;

    // Add API-only required fields
    template.version_comment = message;

    if (type == "partner") {
      template.version_significant_change = false;
    }

    const response = await SF.updateExportFile(type, envId, templateId, template);

    if (response && response.data && response.data.name_nl) {
      consola.success(`Export file updated: ${response.data.name_nl}`);
      return true;
    } else {
      consola.error(`Export file update failed: ${name}`);
      return false;
    }
  } catch (error) {
    errorUtils.errorHandler(error);
  }
}

async function publishAllExportFiles(type, envId, message = "updated through the Silverfin CLI") {
  let templates = fsUtils.getAllTemplatesOfAType("exportFile");
  for (let name of templates) {
    if (!name) continue;
    await publishExportFileByName(type, envId, name, message);
  }
}

async function newExportFile(type, envId, name) {
  try {
    const existingTemplate = await SF.findExportFileByName(type, envId, name);
    if (existingTemplate) {
      consola.warn(`Export file "${name}" already exists on ${type} ${envId}. Skipping its creation`);
      return;
    }
    const template = await ExportFile.read(name);
    if (!template) return;
    template.version_comment = "Created through the Silverfin CLI";
    const response = await SF.createExportFile(type, envId, template);
    const handle = response.data.name_nl;
    // Store new id
    if (response && response.status == 201) {
      ExportFile.updateTemplateId(type, envId, handle, response.data.id);
      consola.success(`Export file "${handle}" created on ${type} ${envId}`);
    }
  } catch (error) {
    errorUtils.errorHandler(error);
  }
}

async function newAllExportFiles(type, envId) {
  const templates = fsUtils.getAllTemplatesOfAType("exportFile");
  for (let name of templates) {
    await newExportFile(type, envId, name);
  }
}

async function fetchAccountTemplateByName(type, envId, name) {
  try {
    const template = await SF.findAccountTemplateByName(type, envId, name);

    if (!template) {
      consola.error(`Account template "${name}" wasn't found in ${type} ${envId}`);
      process.exit(1);
    }

    const saved = AccountTemplate.save(type, envId, template);
    if (saved) {
      consola.success(`Account template "${template?.name_nl}" imported from ${type} ${envId}`);
    }
  } catch (error) {
    consola.error(error);
    process.exit(1);
  }
}

async function fetchAccountTemplateById(type, envId, id) {
  try {
    const template = await SF.readAccountTemplateById(type, envId, id);

    if (!template) {
      consola.error(`Account template ${id} wasn't found in ${type} ${envId}`);
      process.exit(1);
    }

    const saved = AccountTemplate.save(type, envId, template);
    if (saved) {
      consola.success(`Account template "${template?.name_nl}" imported from ${type} ${envId}`);
    }
  } catch (error) {
    consola.error(error);
    process.exit(1);
  }
}

async function fetchAllAccountTemplates(type, envId, page = 1) {
  const templates = await SF.readAccountTemplates(type, envId, page);

  if (templates.length == 0) {
    if (page == 1) {
      consola.warn(`No account templates found in ${type} ${envId}`);
    }
    return;
  }

  templates.forEach(async (template) => {
    const saved = AccountTemplate.save(type, envId, template);

    if (saved) consola.success(`Account template "${template?.name_nl}" imported from ${type} ${envId}`);
  });
  fetchAllAccountTemplates(type, envId, page + 1);
}

async function fetchExistingAccountTemplates(type, envId) {
  const templates = fsUtils.getAllTemplatesOfAType("accountTemplate");
  if (!templates) {
    consola.warn(`No account templates found in ${type} ${envId}`);
    return;
  }

  templates.forEach(async (name) => {
    const templateConfig = fsUtils.readConfig("accountTemplate", name);
    let templateId = fsUtils.getTemplateId(type, envId, templateConfig);

    if (!templateId) {
      errorUtils.missingAccountTemplateId(name);
      return false;
    }

    await fetchAccountTemplateById(type, envId, templateId);
  });
}

async function publishAccountTemplateByName(type, envId, name, message = "updated through the Silverfin CLI") {
  try {
    const configPresent = fsUtils.configExists("accountTemplate", name);

    if (!configPresent) {
      errorUtils.missingAccountTemplateId(name);
      return false;
    }

    const templateConfig = fsUtils.readConfig("accountTemplate", name);
    let templateId = fsUtils.getTemplateId(type, envId, templateConfig);

    if (!templateConfig || !templateId) {
      errorUtils.missingAccountTemplateId(name);
      return false;
    }

    consola.debug(`Updating account template ${name}...`);

    const template = await AccountTemplate.read(name);
    if (!template) return;

    // Add API-only required fields
    template.version_comment = message;

    // Filter out the mapping_list_ranges that do not have this "type" and "envId"
    template.mapping_list_ranges =
      template.mapping_list_ranges?.filter((range) => {
        return range.type === type && range.env_id === envId;
      }) || [];

    if (type == "partner") {
      template.version_significant_change = false;
    }

    const response = await SF.updateAccountTemplate(type, envId, templateId, template);

    if (response && response.data && response.data.name_nl) {
      consola.success(`Account template updated: ${response.data.name_nl}`);
      return true;
    } else {
      consola.error(`Account template update failed: ${name}`);
      return false;
    }
  } catch (error) {
    errorUtils.errorHandler(error);
  }
}

async function publishAllAccountTemplates(type, envId, message = "updated through the Silverfin CLI") {
  let templates = fsUtils.getAllTemplatesOfAType("accountTemplate");
  for (let name of templates) {
    if (!name) continue;
    await publishAccountTemplateByName(type, envId, name, message);
  }
}

async function newAccountTemplate(type, envId, name) {
  try {
    const existingTemplate = await SF.findAccountTemplateByName(type, envId, name);

    if (existingTemplate) {
      consola.warn(`Account template "${name}" already exists on ${type} ${envId}. Skipping its creation`);
      return;
    }
    const template = await AccountTemplate.read(name);
    if (!template) return;
    template.version_comment = "Created through the Silverfin CLI";

    // Only keep the mapping_list_ranges that belong to this firm or partner for the request
    template.mapping_list_ranges = template.mapping_list_ranges.filter((range) => {
      return range.type === "firm" && range.env_id === firmId;
    });

    const response = await SF.createAccountTemplate(type, envId, template);
    const handle = response.data.name_nl;

    // Store new id
    if (response && response.status == 201) {
      AccountTemplate.updateTemplateId(type, envId, handle, response.data.id);
      consola.success(`Account template "${handle}" created on on ${type} ${envId}.`);
    }
  } catch (error) {
    errorUtils.errorHandler(error);
  }
}

async function newAllAccountTemplates(type, envId) {
  const templates = fsUtils.getAllTemplatesOfAType("accountTemplate");
  for (let name of templates) {
    await newAccountTemplate(type, envId, name);
  }
}

async function fetchSharedPartById(type, envId, sharedPartId) {
  try {
    const template = await SF.readSharedPartById(type, envId, sharedPartId);
    if (!template || !template.data) {
      consola.error(`Shared part ${sharedPartId} wasn't found in ${type} ${envId}`);
      process.exit(1);
    }

    await SharedPart.save(type, envId, template.data);
    consola.success(`Shared part "${template.data.name}" imported from ${type} ${envId}`);

    return template.data;
  } catch (error) {
    consola.error(error);
    process.exit(1);
  }
}

async function fetchSharedPartByName(type, envId, name) {
  const sharedPartByName = await SF.findSharedPartByName(type, envId, name);
  if (!sharedPartByName) {
    consola.error(`Shared part "${name}" wasn't found in ${type} ${envId}`);
    process.exit(1);
  }

  const template = await fetchSharedPartById(type, envId, sharedPartByName.id);

  return template;
}

async function fetchAllSharedParts(type, envId, page = 1) {
  const response = await SF.readSharedParts(type, envId, page);
  const sharedParts = response.data;
  if (sharedParts.length == 0) {
    if (page == 1) {
      consola.error(`No shared parts found in ${type} ${envId}`);
    }
    return;
  }

  for (let sharedPart of sharedParts) {
    try {
      await fetchSharedPartById(type, envId, sharedPart.id);
    } catch (error) {
      consola.error(error);
    }
  }

  await fetchAllSharedParts(type, envId, page + 1);
}

async function fetchExistingSharedParts(type, envId) {
  const templates = fsUtils.getAllTemplatesOfAType("sharedPart");
  if (!templates) return;

  for (let name of templates) {
    try {
      const configPresent = fsUtils.configExists("sharedPart", name);

      if (!configPresent) {
        consola.error(`Config file for shared part "${name}" not found`);

        return;
      }

      const templateConfig = fsUtils.readConfig("sharedPart", name);
      let templateId = fsUtils.getTemplateId(type, envId, templateConfig);

      if (!templateId) {
        errorUtils.missingSharedPartId(name);
      } else {
        await fetchSharedPartById(type, envId, templateId);
      }
    } catch (error) {
      consola.error(error);
    }
  }
}

async function publishSharedPartByName(type, envId, name, message = "Updated through the Silverfin CLI") {
  try {
    const configPresent = fsUtils.configExists("sharedPart", name);
    if (!configPresent) {
      errorUtils.missingSharedPartId(name);
      return false;
    }
    const templateConfig = fsUtils.readConfig("sharedPart", name);
    let templateId = fsUtils.getTemplateId(type, envId, templateConfig);

    if (!templateConfig || !templateId) {
      errorUtils.missingSharedPartId(name);
      return false;
    }
    consola.debug(`Updating shared part ${name}...`);

    const template = await SharedPart.read(name);
    if (!template) return;

    // Add API-only required fields
    template.version_comment = message;

    if (type == "partner") {
      template.version_significant_change = false;
    }

    const response = await SF.updateSharedPart(type, envId, templateId, template);

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

async function publishAllSharedParts(type, envId, message = "updated through the Silverfin CLI") {
  let templates = fsUtils.getAllTemplatesOfAType("sharedPart");
  for (let name of templates) {
    if (!name) continue;
    await publishSharedPartByName(type, envId, name, message);
  }
}

async function newSharedPart(type, envId, name) {
  try {
    const existingSharedPart = await SF.findSharedPartByName(type, envId, name);

    if (existingSharedPart) {
      consola.warn(`Shared part "${name}" already exists on ${type} ${envId}. Skipping its creation`);
      return;
    }
    const template = await SharedPart.read(name);
    if (!template) return;
    template.version_comment = "Created through the API";
    const response = await SF.createSharedPart(type, envId, template);

    // Store new firm id
    if (response && response.status == 201) {
      SharedPart.updateTemplateId(type, envId, name, response.data.id);
      consola.success(`Shared part "${name}" created on ${type} ${envId}`);
    }
  } catch (error) {
    errorUtils.errorHandler(error);
  }
}

async function newAllSharedParts(type, envId) {
  const templates = fsUtils.getAllTemplatesOfAType("sharedPart");
  for (let name of templates) {
    await newSharedPart(type, envId, name);
  }
}

/** This function adds a shared part to a template. It will make a POST request to the API. If the ID of one of the templates is missing, it will try to fetch it first by making a GET request. In case of success, it will store the details in the corresponding config files.
 * @param {String} type - Options: `firm` or `partner`
 * @param {Number} envId
 * @param {string} sharedPartName
 * @param {string} templateHandle
 * @param {string} templateType has to be either `reconciliationText`, `exportFile`or `accountTemplate`
 * @returns {boolean} - Returns true if the shared part was added successfully
 */
async function addSharedPart(type, envId, sharedPartName, templateHandle, templateType) {
  try {
    let templateConfig = await fsUtils.readConfig(templateType, templateHandle);
    let sharedPartConfig = await fsUtils.readConfig("sharedPart", sharedPartName);

    let templateId = fsUtils.getTemplateId(type, envId, templateConfig);

    let sharedPartId = type == "firm" ? sharedPartConfig?.id?.[envId] : sharedPartConfig?.partner_id?.[envId];

    // Missing Reconciliation ID. Try to identify it based on the handle
    if (!templateId) {
      const updated = await getTemplateId(type, envId, templateType, templateHandle);
      if (!updated) return false;
      templateConfig = await fsUtils.readConfig(templateType, templateHandle);
      templateId = fsUtils.getTemplateId(type, envId, templateConfig);
    }

    // Missing Shared Part ID. Try to identify it based on the name
    if (!sharedPartId) {
      const updated = await getTemplateId(type, envId, "sharedPart", sharedPartName);
      if (!updated) return false;
      sharedPartConfig = await fsUtils.readConfig("sharedPart", sharedPartName);
      sharedPartId = type == "firm" ? sharedPartConfig?.id?.[envId] : sharedPartConfig?.partner_id?.[envId];
    }

    // Add shared part to template
    let addSharedPartOnPlatform;
    switch (templateType) {
      case "reconciliationText":
        addSharedPartOnPlatform = SF.addSharedPartToReconciliation;
        break;
      case "exportFile":
        addSharedPartOnPlatform = SF.addSharedPartToExportFile;
        break;
      case "accountTemplate":
        addSharedPartOnPlatform = SF.addSharedPartToAccountTemplate;
        break;
    }

    let response = await addSharedPartOnPlatform(type, envId, sharedPartId, templateId);

    // Success or failure
    if (!response || !response.status || !response.status === 201) {
      consola.warn(`Adding shared part "${sharedPartName}" to "${templateHandle}" failed (${templateType}).`);
      return false;
    }

    // Store details in config files
    let templateIndex;
    if (!sharedPartConfig.used_in) {
      templateIndex = -1;
      sharedPartConfig.used_in = [];
    } else {
      // Previously stored ?
      templateIndex = sharedPartConfig.used_in.findIndex((template) => templateHandle === template.handle || templateHandle === template.name);
    }

    if (templateIndex === -1) {
      // Not stored yet
      sharedPartConfig.used_in.push({
        id: type == "firm" ? templateConfig?.id : {},
        partner_id: type == "partner" ? templateConfig?.partner_id : {},
        type: templateType,
        handle: templateHandle,
      });
    } else {
      // Previously stored
      const usedInTemplateConfig = sharedPartConfig.used_in[templateIndex];

      if (type == "firm") {
        if (!usedInTemplateConfig.id) {
          usedInTemplateConfig.id = {};
        }

        usedInTemplateConfig.id[envId] = templateConfig.id[envId];
      }

      if (type == "partner") {
        if (!usedInTemplateConfig.partner_id) {
          usedInTemplateConfig.partner_id = {};
        }

        usedInTemplateConfig.partner_id[envId] = templateConfig?.partner_id[envId];
      }

      sharedPartConfig.used_in[templateIndex] = usedInTemplateConfig;
    }

    // Save Configs
    fsUtils.writeConfig(templateType, templateHandle, templateConfig);
    fsUtils.writeConfig("sharedPart", sharedPartName, sharedPartConfig);

    consola.success(`Shared part "${sharedPartName}" added to "${templateHandle}" (${templateType}).`);

    return sharedPartConfig;
  } catch (error) {
    errorUtils.errorHandler(error);
    return false;
  }
}

/**
 * This function loops through all shared parts (config files) and tries to add the shared part to each template listed in 'used_in'. It will make a POST request to the API. If the ID of one of the templates is missing, it will try to fetch it first by making a GET request. In case of success, it will store the details in the corresponding config files.
 * @param {String} type - Options: `firm` or `partner`
 * @param {Number} envId
 * @param {boolean} force - If true, it will add the shared part to all templates, even if it's already present
 */
async function addAllSharedParts(type, envId, force = false) {
  const envConfigKey = type === "partner" ? "partner_id" : "id";
  const sharedPartsArray = fsUtils.getAllTemplatesOfAType("sharedPart");

  for await (let sharedPartName of sharedPartsArray) {
    let sharedPartConfig = await fsUtils.readConfig("sharedPart", sharedPartName);

    if (!sharedPartConfig.used_in) {
      consola.warn(`Shared part ${sharedPartName} has no used_in array. Skipping.`);
      continue;
    }

    if (!sharedPartConfig?.[envConfigKey][envId]) {
      consola.warn(`Shared part ${sharedPartName} has no id associated to ${type} ${envId}. Skipping.`);
      continue;
    }

    // Fetch shared part from the platform
    const sharedPartId = sharedPartConfig[envConfigKey][envId];
    const sharedPartData = await SF.readSharedPartById(type, envId, sharedPartId);
    if (!sharedPartData) {
      consola.warn(`Shared part ${sharedPartName} not found in ${type} ${envId}. Skipping.`);
      continue;
    }
    const existingLinks = sharedPartData.data.used_in;

    for await (let template of sharedPartConfig.used_in) {
      template = SharedPart.checkTemplateType(template);
      if (!template.handle && !template.name) {
        consola.warn(`Template stored in used_in has no handle or name. Skipping.`);
        continue;
      }

      const configPresent = fsUtils.configExists(template.type, template.handle);
      if (!configPresent) {
        consola.warn(`Template ${template.type} ${template.handle} not found in local repository. Skipping.`);
        continue;
      }

      // When the template is already linked to the shared part, skip unless force is true
      if (!force) {
        let alreadyAdded = await existingLinks.find((existing) => {
          existing = SharedPart.checkTemplateType(existing);
          // we check both id and type to avoid (rare) false positives
          return existing.id === template[envConfigKey][envId] && existing.type === template.type;
        });
        if (alreadyAdded) {
          consola.info(`Template ${template.type} ${template.handle} already has this shared part. Skipping.`);
          continue;
        }
      }

      // add arbitrary delay to avoid rate limiting
      await new Promise((resolve) => setTimeout(resolve, 500));

      addSharedPart(type, envId, sharedPartConfig.name, template.handle, template.type);
    }
  }
}

async function removeSharedPart(type, envId, sharedPartHandle, templateHandle, templateType) {
  try {
    const templateConfig = fsUtils.readConfig(templateType, templateHandle);
    const sharedPartConfig = fsUtils.readConfig("sharedPart", sharedPartHandle);
    let templateId = fsUtils.getTemplateId(type, envId, templateConfig);

    if (!templateConfig || !templateId) {
      consola.warn(`Template id not found for ${templateHandle} (${templateType}). Skipping.`);
      return false;
    }

    const sharedPartId = type == "firm" ? sharedPartConfig?.id?.[envId] : sharedPartConfig?.partner_id?.[envId];

    if (!sharedPartId) {
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
    let response = await removeSharedPart(type, envId, sharedPartId, templateId);

    if (response && response?.status === 200) {
      consola.debug(`Remove shared part with id ${sharedPartId} removed from ${templateType} with id ${templateId} on the platform.`);
    }

    // Remove reference from shared part config
    const templateIndex = sharedPartConfig.used_in.findIndex((template) => templateHandle === template.handle || templateHandle === template.name);

    if (templateIndex === -1) {
      consola.debug(`${templateType} with id ${templateId} not found in shared part config. No update in local shared part config occured.`);
    } else {
      const usedInTemplateConfig = sharedPartConfig.used_in[templateIndex];

      // In case there's only one id & partner_id in the template config, remove the whole template config
      const totalIds = Object.keys(usedInTemplateConfig?.id || []).length + Object.keys(usedInTemplateConfig?.partner_id || []).length;
      const targetId = type == "firm" ? usedInTemplateConfig?.id[envId] : usedInTemplateConfig?.partner_id[envId];

      // Remove reference of specific firm or partner id in the template config in the shared part used in array
      if (targetId) {
        if (totalIds <= 1 && templateId.toString() === targetId.toString()) {
          sharedPartConfig.used_in.splice(templateIndex, 1);
        } else {
          // Only delete the specific id or partner_id if other ids exist in the template config
          if (type == "firm") {
            delete usedInTemplateConfig.id[envId];
          } else {
            delete usedInTemplateConfig.partner_id[envId];
          }

          sharedPartConfig.used_in[templateIndex] = usedInTemplateConfig;
        }
      }

      fsUtils.writeConfig("sharedPart", sharedPartHandle, sharedPartConfig);
    }

    consola.success(`Shared part "${sharedPartHandle}" removed from template "${templateHandle}" (${templateType}).`);
  } catch (error) {
    errorUtils.errorHandler(error);
  }
}

// Look for the template in Silverfin with the handle/name and get it's ID
// Type has to be either "reconciliationText", "exportFile". "accountTemplate" or "sharedPart"
async function getTemplateId(type, envId, templateType, handle) {
  consola.debug(`Getting ID for ${handle}...`);
  let templateText;
  switch (templateType) {
    case "reconciliationText":
      templateText = await SF.findReconciliationTextByHandle(type, envId, handle);
      break;
    case "exportFile":
      templateText = await SF.findExportFileByName(type, envId, handle);
      break;
    case "sharedPart":
      templateText = await SF.findSharedPartByName(type, envId, handle);
      break;
    case "accountTemplate":
      templateText = await SF.findAccountTemplateByName(type, envId, handle);
      break;
  }

  if (!templateText) {
    consola.warn(`Template ${handle} wasn't found (${type})`);
    return false;
  }
  const config = fsUtils.readConfig(templateType, handle);

  if (typeof config.id !== "object") {
    config.id = {};
  }

  if (typeof config.partner_id !== "object") {
    config.partner_id = {};
  }

  if (type == "firm") {
    config.id[envId] = templateText.id;
  } else {
    config.partner_id[envId] = templateText.id;
  }

  fsUtils.writeConfig(templateType, handle, config);
  consola.success(`Template ${handle}: ID updated from ${type} (${templateType})`);
  return true;
}

/**
 * Fetch the ID of all templates of a certain type
 * @param {Number} firmId
 * @param {String} type Options: `reconciliationText`, `accountTemplate`, `exportFile` or `sharedPart`
 */
async function getAllTemplatesId(type, envId, templateType) {
  try {
    let templates = fsUtils.getAllTemplatesOfAType(templateType);
    for (let templateName of templates) {
      let configTemplate = fsUtils.readConfig(templateType, templateName);
      let handle = configTemplate.handle || configTemplate.name || configTemplate.name_nl;
      if (!handle) {
        continue;
      }
      await getTemplateId(type, envId, templateType, handle);
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
  fetchReconciliationByHandle,
  fetchReconciliationById,
  fetchAllReconciliations,
  fetchExistingReconciliations,
  publishReconciliationByHandle,
  publishAllReconciliations,
  newReconciliation,
  newAllReconciliations,
  fetchExportFileByName,
  fetchExportFileById,
  fetchAllExportFiles,
  fetchExistingExportFiles,
  publishExportFileByName,
  publishAllExportFiles,
  newExportFile,
  newAllExportFiles,
  fetchAccountTemplateByName,
  fetchAccountTemplateById,
  fetchAllAccountTemplates,
  publishAccountTemplateByName,
  publishAllAccountTemplates,
  fetchExistingAccountTemplates,
  newAccountTemplate,
  newAllAccountTemplates,
  fetchSharedPartByName,
  fetchSharedPartById,
  fetchAllSharedParts,
  fetchExistingSharedParts,
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
