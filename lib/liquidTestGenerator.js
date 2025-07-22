const { SilverfinApi } = require("./api/silverfinApi");
const sfApi = new SilverfinApi();
const { firmCredentials } = require("../lib/api/firmCredentials");
const Utils = require("./utils/liquidTestUtils");
const { consola } = require("consola");

// MainProcess
async function testGenerator(url, testName, reconciledStatus = true) {
  // Liquid Test Object
  const liquidTestObject = Utils.createBaseLiquidTest(testName);

  // Get parameters from URL provided
  const parameters = Utils.extractURL(url);

  // Check if firm is authorized
  if (!Object.hasOwn(firmCredentials.data, parameters.firmId)) {
    consola.error(`You have no authorization to access firm id ${parameters.firmId}`);
    process.exit(1);
  }

  // Reconciled Status (CLI argument. True by default)
  liquidTestObject[testName].expectation.reconciled = reconciledStatus;

  // Get Reconciliation Details
  const responseDetails = await sfApi.reconciliationTexts.readDetails("firm", parameters.firmId, parameters.companyId, parameters.ledgerId, parameters.reconciliationId);
  const reconciliationHandle = responseDetails.handle;

  // Get Workflow Information
  const starredStatus = {
    ...sfApi.companyData.findReconciliationInWorkflow(parameters.firmId, reconciliationHandle, parameters.companyId, parameters.ledgerId, parameters.workflowId),
  }.starred;

  // Get period data
  const responsePeriods = await sfApi.companyData.getPeriods(parameters.firmId, parameters.companyId);
  const currentPeriodData = sfApi.companyData.findPeriod(parameters.ledgerId, responsePeriods.data);

  // Set Current Period
  liquidTestObject[testName].context.period = String(currentPeriodData.fiscal_year.end_date);
  liquidTestObject[testName].data.periods[currentPeriodData.fiscal_year.end_date] = liquidTestObject[testName].data.periods["replace_period_name"];
  delete liquidTestObject[testName].data.periods["replace_period_name"];

  // Check Previous Period
  const currentPeriodIndex = responsePeriods.indexOf(currentPeriodData);
  const periodsMaxIndex = responsePeriods.length - 1;
  if (currentPeriodIndex < periodsMaxIndex) {
    const previousPeriodData = responsePeriods[currentPeriodIndex + 1];
    if (previousPeriodData && previousPeriodData.fiscal_year.end_date != currentPeriodData.fiscal_year.end_date) {
      // Add empty previous period to Liquid Test
      liquidTestObject[testName].data.periods[previousPeriodData.fiscal_year.end_date] = null;
    }
  }

  // Get all the text properties (Customs from current template)
  const responseCustom = await sfApi.reconciliationTexts.getCustom("firm", parameters.firmId, parameters.companyId, parameters.ledgerId, parameters.reconciliationId);
  const currentReconCustom = Utils.processCustom(responseCustom.data);
  liquidTestObject[testName].data.periods[currentPeriodData.fiscal_year.end_date].reconciliations[reconciliationHandle] = {
    starred: starredStatus,
    custom: currentReconCustom,
  };

  // Get all the results generated in current template
  const responseResults = await sfApi.reconciliationTexts.getResults("firm", parameters.firmId, parameters.companyId, parameters.ledgerId, parameters.reconciliationId);
  liquidTestObject[testName].expectation.results = responseResults.data;

  // Get the code of the template
  const reconciliationCode = await sfApi.reconciliationTexts.findByHandle("firm", parameters.firmId, reconciliationHandle);
  if (!reconciliationCode) {
    consola.warn(`Reconciliation "${reconciliationHandle}" wasn't found`);
    process.exit();
  }

  // Search for results from other reconciliations used in the liquid code (main and text_parts)
  let resultsObj;
  resultsObj = Utils.searchForResultsFromDependenciesInLiquid(reconciliationCode, reconciliationHandle);

  // Search for custom drops from other reconcilations used in the liquid code (main and text_parts)
  let customsObj;
  customsObj = Utils.searchForCustomsFromDependenciesInLiquid(reconciliationCode, reconciliationHandle);

  // Search for shared parts in the liquid code (main and text_parts)
  const sharedPartsUsed = Utils.lookForSharedPartsInLiquid(reconciliationCode, reconciliationHandle);
  if (sharedPartsUsed && sharedPartsUsed.length != 0) {
    for (const sharedPartName of sharedPartsUsed) {
      // Look for shared part id
      const sharedPartResponse = await sfApi.sharedParts.findByName("firm", parameters.firmId, sharedPartName);
      const sharedPartId = sharedPartResponse.id;
      // Get shared part details
      const sharedPartDetails = await sfApi.sharedParts.readById("firm", parameters.firmId, sharedPartId);
      // Look for nested shared parts (in that case, add them to this same loop)
      const nestedSharedParts = Utils.lookForSharedPartsInLiquid(sharedPartDetails.data);
      for (const nested of nestedSharedParts) {
        if (!sharedPartsUsed.includes(nested)) {
          sharedPartsUsed.push(nested);
        }
      }
      // Search for results from other reconciliations in shared part (we append to existing collection)
      resultsObj = Utils.searchForResultsFromDependenciesInLiquid(sharedPartDetails, sharedPartDetails.name, resultsObj);

      // Search for custom drops from other reconcilations in shared parts (we append to existing collection)
      customsObj = Utils.searchForCustomsFromDependenciesInLiquid(sharedPartDetails, sharedPartDetails.name, customsObj);
    }
  }

  // Get results from dependencies reconciliations
  if (Object.keys(resultsObj).length !== 0) {
    // Search in each reconciliation
    for (const [handle, resultsArray] of Object.entries(resultsObj)) {
      try {
        // Find reconciliation in Workflow to get id (depdeency template can be in a different Workflow)
        const reconciliation = await sfApi.companyData.findReconciliationInWorkflows(parameters.firmId, handle, parameters.companyId, parameters.ledgerId);
        if (reconciliation) {
          // Fetch results
          const reconciliationResults = await sfApi.reconciliationTexts.getResults("firm", parameters.firmId, parameters.companyId, parameters.ledgerId, reconciliation.id);
          // Add handle and results block to Liquid Test
          liquidTestObject[testName].data.periods[currentPeriodData.fiscal_year.end_date].reconciliations[handle] =
            liquidTestObject[testName].data.periods[currentPeriodData.fiscal_year.end_date].reconciliations[handle] || {};
          liquidTestObject[testName].data.periods[currentPeriodData.fiscal_year.end_date].reconciliations[handle].results =
            liquidTestObject[testName].data.periods[currentPeriodData.fiscal_year.end_date].reconciliations[handle].results || {};
          // Search for results
          for (const resultTag of resultsArray) {
            // Add result to Liquid Test
            liquidTestObject[testName].data.periods[currentPeriodData.fiscal_year.end_date].reconciliations[handle].results[resultTag] = reconciliationResults[resultTag];
          }
        }
      } catch (err) {
        consola.error(err);
      }
    }
  }

  // We already got the text properties from current reconciliation
  if (Object.hasOwn(customsObj, reconciliationHandle)) {
    delete customsObj[reconciliationHandle];
  }

  // Get custom drops from dependency reconciliations
  if (Object.keys(customsObj).length !== 0) {
    // Search in each reconciliation
    for (const [handle, customsArray] of Object.entries(customsObj)) {
      try {
        // Find reconciliation in Workflow to get id (depdeency template can be in a different Workflow)
        const reconciliation = await sfApi.companyData.findReconciliationInWorkflows(parameters.firmId, handle, parameters.companyId, parameters.ledgerId);
        if (reconciliation) {
          // Fetch test properties
          const reconciliationCustomResponse = await sfApi.reconciliationTexts.getCustom("firm", parameters.firmId, parameters.companyId, parameters.ledgerId, reconciliation.id);
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

  // Get company drop used in the liquid code (main and text_parts)
  const companyObj = Utils.getCompanyDependencies(reconciliationCode, reconciliationHandle);

  if (companyObj.standardDropElements.length !== 0 || companyObj.customDropElements.length !== 0) {
    liquidTestObject[testName].data.company = {};
  }

  // Get Company Data - company drop
  if (companyObj.standardDropElements.length !== 0) {
    const responseCompanyDrop = await sfApi.companyData.getCompanyDrop(parameters.firmId, parameters.companyId);
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
    const responseCompanyCustom = await sfApi.companyData.getCompanyCustom(parameters.firmId, parameters.companyId);
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
        const accountResponse = await sfApi.companyData.getAccountDetails(parameters.firmId, parameters.companyId, parameters.ledgerId, accountId);
        // If value is zero it won't be found ?
        if (accountResponse) {
          liquidTestObject[testName].data.periods[currentPeriodData.fiscal_year.end_date].accounts[accountResponse.account.number] = {
            id: accountResponse.account.id,
            name: accountResponse.account.name,
            value: Number(accountResponse.value),
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
  Utils.exportYAML(reconciliationHandle, liquidTestObject);
}

module.exports = {
  testGenerator,
};
