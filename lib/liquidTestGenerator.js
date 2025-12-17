const SF = require("./api/sfApi");
const { firmCredentials } = require("../lib/api/firmCredentials");
const Utils = require("./utils/liquidTestUtils");
const { consola } = require("consola");
const { ReconciliationText } = require("./templates/reconciliationText");
const { AccountTemplate } = require("./templates/accountTemplate");
const { SharedPart } = require("./templates/sharedPart");

// MainProcess
async function testGenerator(url, testName, reconciledStatus = true) {
  // Get parameters from URL provided and determine template type
  const parameters = Utils.extractURL(url);
  const templateType = parameters.templateType;

  // Create appropriate base test structure
  const liquidTestObject = Utils.createBaseLiquidTest(testName, templateType);

  // Check if firm is authorized
  if (!Object.hasOwn(firmCredentials.data, parameters.firmId)) {
    consola.error(`You have no authorization to access firm id ${parameters.firmId}`);
    process.exit(1);
  }

  // Reconciled Status (CLI argument. True by default)
  liquidTestObject[testName].expectation.reconciled = reconciledStatus;

  let responseDetails, templateHandle;
  switch (templateType) {
    case "reconciliationText": {
      // Get Reconciliation Details
      responseDetails = await SF.readReconciliationTextDetails("firm", parameters.firmId, parameters.companyId, parameters.ledgerId, parameters.reconciliationId);
      templateHandle = responseDetails.data.handle;
      break;
    }
    case "accountTemplate": {
      try {
        // Get account data (includes template ID reference)
        responseDetails = await SF.findAccountByNumber(parameters.firmId, parameters.companyId, parameters.ledgerId, parameters.accountId);

        // Extract the template ID from the account data
        const accountTemplateId = responseDetails.account_reconciliation_template?.id;
        if (!accountTemplateId) {
          throw new Error(`No account template associated with account ${parameters.accountId}`);
        }

        // Get the actual template details using the ID
        const templateDetails = await SF.readAccountTemplateById("firm", parameters.firmId, accountTemplateId);
        templateHandle = templateDetails.name_nl;

        liquidTestObject[testName].context.current_account = responseDetails.account.number;
      } catch (error) {
        consola.error(`Failed to get account template details: ${error.message}`);
        process.exit(1);
      }
      break;
    }
  }

  // Get Workflow Information
  let starredStatus;
  switch (templateType) {
    case "reconciliationText":
      starredStatus = {
        ...SF.findReconciliationInWorkflow(parameters.firmId, templateHandle, parameters.companyId, parameters.ledgerId, parameters.workflowId),
      }.starred;
      break;
    case "accountTemplate":
      starredStatus = responseDetails.starred; // Already present in the response of the Account
      break;
  }

  // Get period data
  const responsePeriods = await SF.getPeriods(parameters.firmId, parameters.companyId);
  const currentPeriodData = SF.findPeriod(parameters.ledgerId, responsePeriods.data);

  // Set Current Period
  liquidTestObject[testName].context.period = String(currentPeriodData.fiscal_year.end_date);
  liquidTestObject[testName].data.periods[currentPeriodData.fiscal_year.end_date] = liquidTestObject[testName].data.periods["replace_period_name"];
  delete liquidTestObject[testName].data.periods["replace_period_name"];

  // Check Previous Period
  const currentPeriodIndex = responsePeriods.data.indexOf(currentPeriodData);
  const periodsMaxIndex = responsePeriods.data.length - 1;
  if (currentPeriodIndex < periodsMaxIndex) {
    const previousPeriodData = responsePeriods.data[currentPeriodIndex + 1];
    if (previousPeriodData && previousPeriodData.fiscal_year.end_date != currentPeriodData.fiscal_year.end_date) {
      // Add empty previous period to Liquid Test
      liquidTestObject[testName].data.periods[previousPeriodData.fiscal_year.end_date] = null;
    }
  }

  // Add period custom data to the test object
  const allPeriodCustoms = (await SF.getAllPeriodCustom(parameters.firmId, parameters.companyId, parameters.ledgerId)) || [];
  if (allPeriodCustoms && allPeriodCustoms.length != 0) {
    const periodCustoms = Utils.processCustom(allPeriodCustoms);
    liquidTestObject[testName].data.periods[currentPeriodData.fiscal_year.end_date].custom = periodCustoms;
  }
  process.exit;

  // Get all the text properties (customs) and results from current template
  switch (templateType) {
    case "reconciliationText": {
      const responseCustom = await SF.getReconciliationCustom("firm", parameters.firmId, parameters.companyId, parameters.ledgerId, parameters.reconciliationId);
      const currentReconCustom = Utils.processCustom(responseCustom.data);
      liquidTestObject[testName].data.periods[currentPeriodData.fiscal_year.end_date].reconciliations[templateHandle] = {
        starred: starredStatus,
        custom: currentReconCustom,
      };

      // Get all the results generated in current template
      const responseResults = await SF.getReconciliationResults("firm", parameters.firmId, parameters.companyId, parameters.ledgerId, parameters.reconciliationId);
      liquidTestObject[testName].expectation.results = responseResults.data;

      break;
    }
    case "accountTemplate": {
      const responseCustom = await SF.getAccountTemplateCustom("firm", parameters.firmId, parameters.companyId, parameters.ledgerId, responseDetails.account.id);
      const currentAccountTemplateCustom = Utils.processCustom(responseCustom.data);
      liquidTestObject[testName].data.periods[currentPeriodData.fiscal_year.end_date].accounts = {
        [responseDetails.account.number]: {
          name: responseDetails.account.name,
          value: Number(responseDetails.value),
          custom: currentAccountTemplateCustom,
        },
      };

      // Get all the results generated in current template
      const responseResults = await SF.getAccountTemplateResults("firm", parameters.firmId, parameters.companyId, parameters.ledgerId, responseDetails.account.id);
      liquidTestObject[testName].expectation.results = responseResults.data;

      break;
    }
  }

  // Get the code of the template
  let templateCode;
  switch (templateType) {
    case "reconciliationText":
      templateCode = await ReconciliationText.read(templateHandle);
      break;
    case "accountTemplate":
      templateCode = await AccountTemplate.read(templateHandle);
      break;
  }

  if (!templateCode) {
    consola.warn(`Template "${templateHandle}" wasn't found`);
    process.exit();
  }

  if (templateType === "reconciliationText") {
    // Search for results from other reconciliations used in the liquid code (main and text_parts)
    let resultsObj;
    resultsObj = Utils.searchForResultsFromDependenciesInLiquid(templateCode, templateHandle);

    // Search for custom drops from other reconcilations used in the liquid code (main and text_parts)
    let customsObj;
    customsObj = Utils.searchForCustomsFromDependenciesInLiquid(templateCode, templateHandle);

    // Search for shared parts in the liquid code (main and text_parts)
    const sharedPartsUsed = Utils.lookForSharedPartsInLiquid(templateCode, templateHandle);
    if (sharedPartsUsed && sharedPartsUsed.length != 0) {
      for (const sharedPartName of sharedPartsUsed) {
        const sharedPartCode = await SharedPart.read(sharedPartName);
        if (!sharedPartCode) {
          consola.warn(`Shared part "${sharedPartName}" wasn't found`);
          return;
        }

        // Look for nested shared parts (in that case, add them to this same loop)
        const nestedSharedParts = Utils.lookForSharedPartsInLiquid(sharedPartCode);
        for (const nested of nestedSharedParts) {
          if (!sharedPartsUsed.includes(nested)) {
            sharedPartsUsed.push(nested);
          }
        }

        // Search for results from other reconciliations in shared part (we append to existing collection)
        resultsObj = Utils.searchForResultsFromDependenciesInLiquid(sharedPartCode, sharedPartCode.name, resultsObj);

        // Search for custom drops from other reconcilations in shared parts (we append to existing collection)
        customsObj = Utils.searchForCustomsFromDependenciesInLiquid(sharedPartCode, sharedPartCode.name, customsObj);
      }
    }

    // Get results from dependencies reconciliations
    if (Object.keys(resultsObj).length !== 0) {
      // Search in each reconciliation
      for (const [handle, resultsArray] of Object.entries(resultsObj)) {
        try {
          // Find reconciliation in Workflow to get id (depdeency template can be in a different Workflow)
          const reconciliation = await SF.findReconciliationInWorkflows(parameters.firmId, handle, parameters.companyId, parameters.ledgerId);
          if (reconciliation) {
            // Fetch results
            const reconciliationResults = await SF.getReconciliationResults("firm", parameters.firmId, parameters.companyId, parameters.ledgerId, reconciliation.id);
            // Add handle and results block to Liquid Test
            liquidTestObject[testName].data.periods[currentPeriodData.fiscal_year.end_date].reconciliations[handle] =
              liquidTestObject[testName].data.periods[currentPeriodData.fiscal_year.end_date].reconciliations[handle] || {};
            liquidTestObject[testName].data.periods[currentPeriodData.fiscal_year.end_date].reconciliations[handle].results =
              liquidTestObject[testName].data.periods[currentPeriodData.fiscal_year.end_date].reconciliations[handle].results || {};
            // Search for results
            for (const resultTag of resultsArray) {
              // Add result to Liquid Test
              liquidTestObject[testName].data.periods[currentPeriodData.fiscal_year.end_date].reconciliations[handle].results[resultTag] = reconciliationResults.data[resultTag];
            }
          }
        } catch (err) {
          consola.error(err);
        }
      }
    }

    // We already got the text properties from current reconciliation
    if (Object.hasOwn(customsObj, templateHandle)) {
      delete customsObj[templateHandle];
    }

    // Get custom drops from dependency reconciliations
    if (Object.keys(customsObj).length !== 0) {
      // Search in each reconciliation
      for (const [handle, customsArray] of Object.entries(customsObj)) {
        try {
          // Find reconciliation in Workflow to get id (depdeency template can be in a different Workflow)
          const reconciliation = await SF.findReconciliationInWorkflows(parameters.firmId, handle, parameters.companyId, parameters.ledgerId);
          if (reconciliation) {
            // Fetch test properties
            const reconciliationCustomResponse = await SF.getReconciliationCustom("firm", parameters.firmId, parameters.companyId, parameters.ledgerId, reconciliation.id);
            const reconciliationCustomDrops = Utils.processCustom(reconciliationCustomResponse.data);
            // Filter Customs
            const dropsKeys = Object.keys(reconciliationCustomDrops);
            const matchingKeys = dropsKeys.filter((key) => customsArray.indexOf(key) !== -1);
            const filteredCustomDrops = {};
            for (const key of matchingKeys) {
              filteredCustomDrops[key] = reconciliationCustomDrops[key];
            }
            // Add handle to Liquid Test
            liquidTestObject[testName].data.periods[currentPeriodData.fiscal_year.end_date].reconciliations[handle] =
              liquidTestObject[testName].data.periods[currentPeriodData.fiscal_year.end_date].reconciliations[handle] || {};
            // Add custom drops
            liquidTestObject[testName].data.periods[currentPeriodData.fiscal_year.end_date].reconciliations[handle].custom = filteredCustomDrops;
          }
        } catch (err) {
          consola.error(err);
        }
      }
    }
  }

  // Get company drop used in the liquid code (main and text_parts)
  const companyObj = Utils.getCompanyDependencies(templateCode, templateHandle);

  if (companyObj.standardDropElements.length !== 0 || companyObj.customDropElements.length !== 0) {
    liquidTestObject[testName].data.company = {};
  }

  // Get Company Data - company drop
  if (companyObj.standardDropElements.length !== 0) {
    const responseCompanyDrop = await SF.getCompanyDrop(parameters.firmId, parameters.companyId);
    const companyData = responseCompanyDrop.data; // { foo: bar, baz: bat ... }

    for (const drop of companyObj.standardDropElements) {
      const [_, key] = drop.split("."); // company.foo
      if (key in companyData) {
        // Add to Liquid Test
        liquidTestObject[testName].data.company[key] = companyData[key];
      }
    }
  }

  // Get Company Data - custom drop
  if (companyObj.customDropElements.length !== 0) {
    const responseCompanyCustom = await SF.getCompanyCustom(parameters.firmId, parameters.companyId);
    const companyCustom = responseCompanyCustom.data; // [ { namespace: foo, key: bar, value: baz }... ]
    liquidTestObject[testName].data.company.custom = {};

    for (const drop of companyObj.customDropElements) {
      const [_a, _b, namespace, key] = drop.split("."); // company.custom.namespace.key
      const foundItem = companyCustom.find((element, _) => {
        if (element.namespace == namespace && element.key == key) {
          return true;
        }
      });
      if (foundItem) {
        const namespaceKey = `${namespace}.${key}`;
        // Add to Liquid Test
        liquidTestObject[testName].data.company.custom[namespaceKey] = foundItem.value;
      }
    }
  }

  // Search for account ids in customs
  const accountIds = Utils.lookForAccountsIDs(liquidTestObject);
  if (accountIds.length != 0) {
    liquidTestObject[testName].data.periods[currentPeriodData.fiscal_year.end_date].accounts = {};
    for (let accountId of accountIds) {
      accountId = accountId.replace("#", "");
      // Current Period
      try {
        const accountResponse = await SF.getAccountDetails(parameters.firmId, parameters.companyId, parameters.ledgerId, accountId);
        // If value is zero it won't be found ?
        if (accountResponse) {
          liquidTestObject[testName].data.periods[currentPeriodData.fiscal_year.end_date].accounts[accountResponse.data.account.number] = {
            id: accountResponse.data.account.id,
            name: accountResponse.data.account.name,
            value: Number(accountResponse.data.value),
          };
        }
      } catch (error) {
        consola.error(error);
        // Previous Period
        // Should we include this ?
      }
    }
  }

  // Save YAML
  Utils.exportYAML(templateHandle, liquidTestObject, templateType);
}

module.exports = {
  testGenerator,
};
