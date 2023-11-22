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
      consola.error(`Reconciliation with id ${id} wasn't found`);
      process.exit(1);
    }

    ReconciliationText.save(type, envId, template.data);
    consola.success(
      `Reconciliation "${template.data.handle}" imported from ${type} ${envId}`
    );

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
  const templateConfig = fsUtils.readConfig("reconciliationText", handle);

  if (!templateConfig) {
    errorUtils.missingConfig(handle);
  }

  let id =
    type == "firm" ? templateConfig.id[envId] : templateConfig.partnerId[envId];
  let existingTemplate;

  if (!id) {
    existingTemplate = await SF.findReconciliationTextByHandle(
      type,
      envId,
      handle
    );

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
  type,
  envId,
  handle,
  message = "Updated with the Silverfin CLI"
) {
  try {
    const configPresent = fsUtils.configExists("reconciliationText", handle);

    if (!configPresent) {
      errorUtils.missingReconciliationId(handle);
      return false;
    }

    const templateConfig = fsUtils.readConfig("reconciliationText", handle);

    let templateId =
      type == "firm"
        ? templateConfig?.id?.[envId]
        : templateConfig?.partnerId?.[envId];

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
    }

    const response = await SF.updateReconciliationText(
      type,
      envId,
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
  type,
  envId,
  message = "updated through the Silverfin CLI"
) {
  let templates = fsUtils.getAllTemplatesOfAType("reconciliationText");
  for (let handle of templates) {
    if (!handle) continue;
    await publishReconciliationByHandle(type, envId, handle, message);
  }
}

async function newReconciliation(firmId, handle) {
  try {
    const existingTemplate = await SF.findReconciliationTextByHandle(
      "firm",
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
    template.version_comment = "Created with the Silverfin CLI";
    const response = await SF.createReconciliationText(
      "firm",
      firmId,
      template
    );

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

async function fetchExportFileByName(type, envId, name) {
  try {
    const template = await SF.findExportFileByName(type, envId, name);
    if (!template) {
      consola.error(`Export file "${name}" wasn't found`);
      process.exit(1);
    }
    ExportFile.save(type, envId, template);
    consola.success(`Export file "${name}" imported`);
  } catch (error) {
    consola.error(error);
    process.exit(1);
  }
}

async function fetchExportFileById(type, envId, id) {
  try {
    const template = await SF.readExportFileById(type, envId, id);

    if (!template) {
      consola.error(`Export file with id ${id} wasn't found`);
      process.exit(1);
    }

    ExportFile.save(type, envId, template);
    consola.success(`Export file "${template.name}" imported`);
  } catch (error) {
    consola.error(error);
    process.exit(1);
  }
}

async function fetchAllExportFiles(type, envId, page = 1) {
  const templates = await SF.readExportFiles(type, envId, page);
  if (templates.length == 0) {
    if (page == 1) {
      consola.error(`No export files found in firm ${firmId}`);
    }
    return;
  }
  templates.forEach(async (template) => {
    fetchExportFileById(type, envId, template.id);
  });
  fetchAllExportFiles(type, envId, page + 1);
}

async function fetchExistingExportFiles(firmId) {
  const templates = fsUtils.getAllTemplatesOfAType("exportFile");
  if (!templates) return;
  templates.forEach(async (name) => {
    templateConfig = fsUtils.readConfig("exportFile", name);
    if (!templateConfig || !templateConfig.id[firmId]) return;
    await fetchExportFileById(firmId, templateConfig.id[firmId]);
  });
}

async function publishExportFileByName(
  type,
  envId,
  name,
  message = "updated through the Silverfin CLI"
) {
  try {
    const configPresent = fsUtils.configExists("exportFile", name);

    if (!configPresent) {
      errorUtils.missingExportFileId(name);
      return false;
    }

    const templateConfig = fsUtils.readConfig("exportFile", name);

    let templateId =
      type == "firm"
        ? templateConfig?.id?.[envId]
        : templateConfig?.partnerId?.[envId];

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

    const response = await SF.updateExportFile(
      type,
      envId,
      templateId,
      template
    );

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
  type,
  envId,
  message = "updated through the Silverfin CLI"
) {
  let templates = fsUtils.getAllTemplatesOfAType("exportFile");
  for (let name of templates) {
    if (!name) continue;
    await publishExportFileByName(type, envId, name, message);
  }
}

async function newExportFile(firmId, name) {
  try {
    const existingTemplate = await SF.findExportFileByName(
      "firm",
      firmId,
      name
    );
    if (existingTemplate) {
      consola.info(
        `Export file "${name}" already exists. Skipping its creation`
      );
      return;
    }
    const template = await ExportFile.read(name);
    if (!template) return;
    template.version_comment = "Created through the Silverfin CLI";
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

async function fetchAccountTemplateByName(type, envId, name) {
  try {
    const template = await SF.findAccountTemplateByName(type, envId, name);

    if (!template) {
      consola.error(`Account template "${name}" wasn't found`);
      process.exit(1);
    }

    AccountTemplate.save(type, envId, template);
    consola.success(`Account template "${template?.name_nl}" imported`);
  } catch (error) {
    consola.error(error);
    process.exit(1);
  }
}

async function fetchAccountTemplateById(type, envId, id) {
  try {
    const template = await SF.readAccountTemplateById(type, envId, id);

    if (!template) {
      consola.error(`Account template ${id} wasn't found`);
      process.exit(1);
    }

    const saved = AccountTemplate.save(type, envId, template);
    if (saved) {
      consola.success(`Account template "${template?.name_nl}" imported`);
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
  fetchAllAccountTemplates(type, envId, page + 1);
}

async function fetchExistingAccountTemplates(firmId) {
  const templates = fsUtils.getAllTemplatesOfAType("accountTemplate");
  if (!templates) return;
  templates.forEach(async (name) => {
    templateConfig = fsUtils.readConfig("accountTemplate", name);
    if (!templateConfig || !templateConfig.id[firmId]) return;
    await fetchAccountTemplateById(firmId, templateConfig.id[firmId]);
  });
}

async function publishAccountTemplateByName(
  type,
  envId,
  name,
  message = "updated through the Silverfin CLI"
) {
  try {
    const configPresent = fsUtils.configExists("accountTemplate", name);

    if (!configPresent) {
      errorUtils.missingAccountTemplateId(name);
      return false;
    }

    const templateConfig = fsUtils.readConfig("accountTemplate", name);

    let templateId =
      type == "firm"
        ? templateConfig?.id?.[envId]
        : templateConfig?.partnerId?.[envId];

    if (!templateConfig || !templateId) {
      errorUtils.missingAccountTemplateId(name);
      return false;
    }

    consola.debug(`Updating account template ${name}...`);

    const template = await AccountTemplate.read(name);
    if (!template) return;

    // Add API-only required fields
    template.version_comment = message;

    if (type == "partner") {
      template.version_significant_change = false;
    }

    const response = await SF.updateAccountTemplate(
      type,
      envId,
      templateId,
      template
    );

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

async function publishAllAccountTemplates(
  type,
  envId,
  message = "updated through the Silverfin CLI"
) {
  let templates = fsUtils.getAllTemplatesOfAType("accountTemplate");
  for (let name of templates) {
    if (!name) continue;
    await publishAccountTemplateByName(type, envId, name, message);
  }
}

async function newAccountTemplate(firmId, name) {
  try {
    const existingTemplate = await SF.findAccountTemplateByName(
      "firm",
      firmId,
      name
    );
    if (existingTemplate) {
      consola.warn(
        `Account template "${name}" already exists. Skipping its creation`
      );
      return;
    }
    const template = await AccountTemplate.read(name);
    if (!template) return;
    template.version_comment = "Created through the Silverfin CLI";
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

async function fetchSharedPartById(type, envId, sharedPartId) {
  try {
    const template = await SF.readSharedPartById(type, envId, sharedPartId);
    if (!template || !template.data) {
      consola.error(`Shared part ${sharedPartId} wasn't found.`);
      process.exit(1);
    }
    await SharedPart.save(type, envId, template.data);
    consola.success(`Shared part "${template.data.name}" imported`);
    process.exit(0);
  } catch (error) {
    consola.error(error);
    process.exit(1);
  }
}

async function fetchSharedPartByName(type, envId, name) {
  const sharedPartByName = await SF.findSharedPartByName(type, envId, name);
  if (!sharedPartByName) {
    consola.error(`Shared part "${name}" wasn't found.`);
    process.exit(1);
  }

  fetchSharedPartById(type, envId, sharedPartByName.id);
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

async function fetchExistingSharedParts(firmId) {
  const templates = fsUtils.getAllTemplatesOfAType("sharedPart");
  if (!templates) return;
  templates.forEach(async (name) => {
    templateConfig = fsUtils.readConfig("sharedPart", name);
    if (!templateConfig || !templateConfig.id[firmId]) return;
    await fetchSharedPartById(firmId, templateConfig.id[firmId]);
  });
}

async function publishSharedPartByName(
  type,
  envId,
  name,
  message = "Updated through the Silverfin CLI"
) {
  try {
    const configPresent = fsUtils.configExists("sharedPart", name);
    if (!configPresent) {
      errorUtils.missingSharedPartId(name);
      return false;
    }
    const templateConfig = fsUtils.readConfig("sharedPart", name);

    let templateId =
      type == "firm"
        ? templateConfig?.id?.[envId]
        : templateConfig?.partnerId?.[envId];

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

    const response = await SF.updateSharedPart(
      type,
      envId,
      templateId,
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
  message = "updated through the Silverfin CLI"
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
  type,
  envId,
  sharedPartName,
  templateHandle,
  templateType
) {
  try {
    let templateConfig = await fsUtils.readConfig(templateType, templateHandle);
    let sharedPartConfig = await fsUtils.readConfig(
      "sharedPart",
      sharedPartName
    );

    let templateId =
      type == "firm"
        ? templateConfig?.id?.[envId]
        : templateConfig?.partnerId?.[envId];

    let sharedPartId =
      type == "firm"
        ? sharedPartConfig?.id?.[envId]
        : sharedPartConfig?.partnerId?.[envId];

    // Missing Reconciliation ID. Try to identify it based on the handle
    if (!templateId) {
      const updated = await getTemplateId(
        type,
        envId,
        templateType,
        templateHandle
      );
      if (!updated) return false;
      templateConfig = await fsUtils.readConfig(templateType, templateHandle);
      templateId =
        type == "firm"
          ? templateConfig?.id?.[envId]
          : templateConfig?.partnerId?.[envId];
    }

    // Missing Shared Part ID. Try to identify it based on the name
    if (!templateId) {
      const updated = await getTemplateId(
        type,
        envId,
        "sharedPart",
        sharedPartName
      );
      if (!updated) return false;
      sharedPartConfig = await fsUtils.readConfig("sharedPart", sharedPartName);
      sharedPartId =
        type == "firm"
          ? sharedPartConfig?.id?.[envId]
          : sharedPartConfig?.partnerId?.[envId];
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
    let response = await addSharedPart(type, envId, templateId, sharedPartId);

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
    if (!sharedPartConfig.used_in) {
      templateIndex = -1;
      sharedPartConfig.used_in = [];
    } else {
      // Previously stored ?
      templateIndex = sharedPartConfig.used_in.findIndex(
        (template) =>
          templateHandle === template.handle || templateHandle === template.name
      );
    }
    // Not stored yet
    if (templateIndex === -1) {
      sharedPartConfig.used_in.push({
        id: { [firmId]: templateConfig.id[firmId] },
        type: templateType,
        handle: templateHandle,
      });
    }
    // Previously stored
    if (templateIndex !== -1) {
      sharedPartConfig.used_in[templateIndex].id[firmId] =
        templateConfig.id[firmId];
    }
    // Save Configs
    fsUtils.writeConfig("sharedPart", sharedPartName, sharedPartConfig);
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
 * @param {boolean} force - If true, it will add the shared part to all templates, even if it's already present
 */
async function addAllSharedParts(firmId, force = false) {
  const sharedPartsArray = fsUtils.getAllTemplatesOfAType("sharedPart");
  for await (let sharedPartName of sharedPartsArray) {
    let configSharedPart = await fsUtils.readConfig(
      "sharedPart",
      sharedPartName
    );
    if (!configSharedPart?.id[firmId]) {
      consola.warn(
        `Shared part ${sharedPartName} has no id associated to firm ${firmId}. Skipping.`
      );
      continue;
    }
    let sharedPartData = await SF.readSharedPartById(
      firmId,
      configSharedPart.id[firmId]
    );
    if (!sharedPartData) {
      consola.warn(
        `Shared part ${sharedPartName} not found in firm ${firmId}. Skipping.`
      );
      continue;
    }
    const existingLinks = sharedPartData.data.used_in;

    for await (let template of configSharedPart.used_in) {
      template = SharedPart.checkTemplateType(template);
      if (!template.handle) {
        consola.warn(`Template has no handle or name. Skipping.`);
        continue;
      }
      const configPresent = fsUtils.configExists(
        template.type,
        template.handle
      );
      if (!configPresent) {
        consola.warn(
          `Template ${template.type} ${template.handle} not found in the repository. Skipping.`
        );
        continue;
      }
      // TODO: check also the template type, not only the id
      if (!force) {
        let alreadyAdded = await existingLinks.find(
          (existing) => existing.id === template.id[firmId]
        );
        if (alreadyAdded) {
          consola.info(
            `Template ${template.type} ${template.handle} already has this shared part. Skipping.`
          );
          continue;
        }
      }

      // add arbitrary delay to avoid rate limiting
      await new Promise((resolve) => setTimeout(resolve, 1000));

      addSharedPart(
        firmId,
        configSharedPart.name,
        template.handle,
        template.type
      );
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
async function getTemplateId(type, envId, templateType, handle) {
  consola.debug(`Getting ID for ${handle}...`);
  let templateText;
  switch (templateType) {
    case "reconciliationText":
      templateText = await SF.findReconciliationTextByHandle(
        type,
        envId,
        handle
      );
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

  if (typeof config.partnerId !== "object") {
    config.partnerId = {};
  }

  if (type == "firm") {
    config.id[envId] = templateText.id;
  } else {
    config.partnerId[envId] = templateText.id;
  }

  fsUtils.writeConfig(templateType, handle, config);
  consola.success(
    `Template ${handle}: ID updated from ${type} (${templateType})`
  );
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
      let handle =
        configTemplate.handle || configTemplate.name || configTemplate.name_nl;
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
