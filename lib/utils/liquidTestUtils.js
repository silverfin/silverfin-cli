const YAML = require("yaml");
const fs = require("fs");
const fsUtils = require("./fsUtils");
const { consola } = require("consola");

// Create base Liquid Test object
function createBaseLiquidTest(testName, templateType = "reconciliationText") {
  const baseStructure = {
    [testName]: {
      context: {
        period: "#Replace with period",
      },
      data: {
        periods: {
          replace_period_name: {
            reconciliations: {}, // Only for reconciliation texts
          },
        },
      },
      expectation: {
        reconciled: "#Replace with reconciled status",
        results: {},
        rollforward: {},
      },
    },
  };

  // Add current_account for account templates
  if (templateType === "accountTemplate") {
    baseStructure[testName].context.current_account = "#Replace with current account";
    delete baseStructure[testName].data.periods.replace_period_name.reconciliations; // Remove reconciliations
  }

  return baseStructure;
}

// Provide a link to reconciliation or account template in Silverfin
// Extract template type, firm id, company id, period id, template id
function extractURL(url) {
  try {
    const parts = url.split("?")[0].split("/f/")[1].split("/");
    let idType, templateType;
    if (parts.indexOf("reconciliation_texts") !== -1) {
      idType = "reconciliationId";
      templateType = "reconciliationText";
    } else if (parts.indexOf("account_entry") !== -1) {
      idType = "accountId";
      templateType = "accountTemplate";
    } else {
      consola.error("Not possible to identify if it's a reconciliation text or account entry.");
      process.exit(1);
    }
    return {
      templateType,
      firmId: parts[0],
      companyId: parts[1],
      ledgerId: parts[3],
      workflowId: parts[5],
      [idType]: parts[7],
    };
  } catch (err) {
    consola.error("The URL provided is not correct. Double check it and run the command again.");
    process.exit(1);
  }
}

function generateFileName(handle, templateType, counter = 0) {
  let fileName = `${handle}_liquid_test.yml`;
  if (counter != 0) {
    fileName = `${handle}_${counter}_liquid_test.yml`;
  }
  let filePath;
  switch (templateType) {
    case "reconciliationText":
      filePath = `./reconciliation_texts/${handle}/tests/${fileName}`;
      break;
    case "accountTemplate":
      filePath = `./account_templates/${handle}/tests/${fileName}`;
      break;
    default:
      consola.error("Invalid template type");
      process.exit(1);
  }
  if (fs.existsSync(filePath)) {
    return generateFileName(handle, templateType, counter + 1);
  }
  return filePath;
}

// Create YAML
function exportYAML(handle, liquidTestObject, templateType) {
  switch (templateType) {
    case "reconciliationText":
      fsUtils.createFolder(`./reconciliation_texts`);
      fsUtils.createTemplateFolders("reconciliationText", handle, true);
      break;
    case "accountTemplate":
      fsUtils.createFolder(`./account_templates`);
      fsUtils.createTemplateFolders("accountTemplate", handle, true);
      break;
    default:
      consola.error("Invalid template type");
      process.exit(1);
  }
  const filePath = generateFileName(handle, templateType);
  fs.writeFile(
    filePath,
    YAML.stringify(liquidTestObject, {
      toStringDefaults: {
        defaultKeyType: "PLAIN",
        defaultStringType: "QUOTE_DOUBLE",
        indent: 2,
        lineWidth: 0,
      },
    }),
    (err, _) => {
      if (err) {
        consola.error(err);
        process.exit(1);
      } else {
        consola.info(`File saved: ${filePath}`);
      }
    }
  );
}

/**
 * Format TextoProperties/Customs array to an Object
 *
 * Sorts the input array by namespace first, then by key within each namespace.
 * For keys with numeric suffixes (e.g., _1, _2, ..., _10), sorts numerically rather than alphabetically.
 *
 * @param {Array} customArray - Array of custom objects with namespace, key, and value properties
 * @param {string} customArray[].namespace - The namespace of the custom property
 * @param {string} customArray[].key - The key of the custom property
 * @param {*} customArray[].value - The value of the custom property (may have a .field property)
 * @returns {Object} Sorted object with keys in format "namespace.key"
 */
function processCustom(customArray) {
  const sortedArray = customArray.sort((a, b) => {
    if (a.namespace !== b.namespace) {
      return a.namespace.localeCompare(b.namespace);
    }

    const getNumericPart = (key) => {
      const match = key.match(/_(\d+)$/);
      return match ? parseInt(match[1], 10) : 0;
    };

    const numA = getNumericPart(a.key);
    const numB = getNumericPart(b.key);

    if (numA && numB) {
      return numA - numB;
    }

    return a.key.localeCompare(b.key);
  });

  const obj = {};
  for (const item of sortedArray) {
    const element = `${item.namespace}.${item.key}`;
    // Fori
    if (item.value && item.value.field) {
      obj[element] = item.value.field;
    } else {
      obj[element] = item.value;
    }
  }

  return obj;
}

// Company Drop used
function getCompanyDependencies(templateCode, templateHandle) {
  const reCompanySearch = RegExp(/company\.\w+(?:\.\w+\.\w+)?/g); // company.foo or company.custom.foo.bar

  // No main part ?
  if (!templateCode || !templateCode.text) {
    consola.warn(`Template "${templateHandle}": no liquid code found`);
    return { standardDropElements: [], customDropElements: [] };
  }

  // Main Part
  let companyFound = templateCode.text.match(reCompanySearch) || [];

  // Parts
  for (const part of templateCode.text_parts) {
    const companyPart = part.content.match(reCompanySearch) || [];
    if (companyPart) {
      companyFound = companyFound.concat(companyPart);
    }
  }

  // Filter repeated elements
  companyFound = companyFound.filter((tag, index) => {
    return companyFound.indexOf(tag) === index;
  });

  // Separate custom drop from standard drop
  const customDropElements = companyFound.filter((tag) => tag.includes("custom")); // [ 'company.custom.foo.bar', ...]

  // Get only standard drop elements
  const standardDropElements = companyFound.filter((tag) => !customDropElements.includes(tag)); // [ 'company.foo´, ...]

  return { standardDropElements, customDropElements };
}

// Do we need to get results from other templates? Check Liquid Code (handle & result names)
// We can pass an existing collection {handle:[results]} from a previous call
function searchForResultsFromDependenciesInLiquid(reconcilationObject, reconciliationHandle, resultsCollection = {}) {
  // Normal Scenario
  const reResultsFetched = RegExp(/period\.reconciliations\.\w+\.results\.\w+/g); // period.reconciliations.handle.results.result_name

  // No main part ?
  if (!reconcilationObject || !reconcilationObject.text) {
    consola.warn(`Reconciliation "${reconciliationHandle}": no liquid code found`);
    return resultsCollection;
  }

  // Main Part (or shared part)
  let resultsFound = reconcilationObject.text.match(reResultsFetched) || [];

  // Parts
  if (reconcilationObject.text_parts) {
    for (const part of reconcilationObject.text_parts) {
      const resultsPart = part.content.match(reResultsFetched) || [];
      if (resultsPart) {
        resultsFound = resultsFound.concat(resultsPart);
      }
    }
  }

  // Process Results.
  for (const result of resultsFound) {
    const [_a, _b, handle, _c, resultName] = result.split("."); // period;reconciliation;handle;results;result_name
    // Check if handle is already there. Empty array
    if (!Object.hasOwn(resultsCollection, handle)) {
      resultsCollection[handle] = [];
    }
    // Check if result is already there.
    if (resultsCollection[handle].indexOf(resultName) == -1) {
      resultsCollection[handle].push(resultName);
    }
  }

  // Assign: Scenarios
  // {% assign variable_name = period.reconciliations.handle %} && {{ variable_name.results.result_name }}
  // {% assign variable_name = period.reconciliations.handle.results %} && {{ variable_name.result_name }}
  const reAssign = RegExp(/\w+( )?=( )?period\.reconciliations\.\w+(\.results)?( |%)/g); // period.reconciliations.handle or period.reconciliations.handle.results
  const resultsFoundAssign = reconcilationObject.text.match(reAssign) || [];
  const variables = resultsFoundAssign.map((element) => {
    const parts = element.split("="); // variable, period.reconciliation.handle...
    return [parts[0].trim(), parts[1].split(".")[2].trim()]; // [variable name, handle]
  });
  for (const [variableName, handle] of variables) {
    // eslint-disable-next-line
    const expression = `(\ |\%|\{)${variableName}(\.results)?\.\\w+(\ |\%|\})`; // variable.result_name or variable.results.result_name
    const reAssignResults = new RegExp(expression, "g");
    // Main
    let assignResultsFound = reconcilationObject.text.match(reAssignResults) || [];
    // Parts
    if (reconcilationObject.text_parts) {
      for (const part of reconcilationObject.text_parts) {
        const assignResultsPart = part.content.match(reAssignResults) || [];
        if (assignResultsPart) {
          assignResultsFound = assignResultsFound.concat(assignResultsPart);
        }
      }
    }
    // Process
    for (const result of assignResultsFound) {
      const parts = result.split(".");
      if (parts.length > 1) {
        const resultName = parts[parts.length - 1].trim();
        // Check if handle is already there. Empty array
        if (!Object.hasOwn(resultsCollection, handle)) {
          resultsCollection[handle] = [];
        }
        // Check if result is already there.
        if (resultsCollection[handle].indexOf(resultName) == -1) {
          resultsCollection[handle].push(resultName);
        }
      }
    }
  }

  // Capture: Scenarios
  // period.reconcilations.handle.results.[result_name_capture] ?
  // period.reconciliations.[handle_capture].results.[result_name_capture] ?
  // TO DO

  return resultsCollection; // { handle: [result_1, result_2], ...}
}

// Do we need to get custom drops from other templates? Check Liquid Code (handle & custom names)
// We can pass an existing collection {handle:[drop]} from a previous call
function searchForCustomsFromDependenciesInLiquid(reconcilationObject, reconciliationHandle, customCollection = {}) {
  // Normal Scenario
  const reCustomsFetched = RegExp(/period\.reconciliations\.\w+\.custom\.\w+\.\w+/g); // period.reconciliations.handle.custom.namespace.key

  // No main part ?
  if (!reconcilationObject || !reconcilationObject.text) {
    consola.warn(`Reconciliation "${reconciliationHandle}": no liquid code found`);
    return customCollection;
  }

  // Main Part (or shared part)
  let customsFound = reconcilationObject.text.match(reCustomsFetched) || [];

  // Parts
  if (reconcilationObject.text_parts) {
    for (const part of reconcilationObject.text_parts) {
      const customsPart = part.content.match(reCustomsFetched) || [];
      if (customsPart) {
        customsFound = customsFound.concat(customsPart);
      }
    }
  }

  // Process Customs.
  for (const custom of customsFound) {
    const [_a, _b, handle, _c, namespace, key] = custom.split("."); // handle;custom;namespace;key
    const customNamespaceKey = `${namespace}.${key}`;
    // Check if handle is already there. Empty array
    if (!Object.hasOwn(customCollection, handle)) {
      customCollection[handle] = [];
    }
    // Check if custom is already there.
    if (customCollection[handle].indexOf(customNamespaceKey) == -1) {
      customCollection[handle].push(customNamespaceKey);
    }
  }

  // Assign: Scenarios
  // assign variable = period.reconciliations && variable.custom.namespace.key ?
  // assign variable = period.reconciliations.handle && varaible.custom.namespace.key ?
  // TO DO

  // Capture: Scenarios
  // TO DO

  return customCollection; // { handle: [result_1, result_2], ...}
}

// Look for Shared Parts used
function lookForSharedPartsInLiquid(reconcilationObject, reconciliationHandle) {
  const sharedPartsNamesArray = [];
  const reSharedParts = RegExp(/shared\/\w+/g); // shared/shared_part_name

  // No main part ?
  if (!reconcilationObject || !reconcilationObject.text) {
    consola.warn(`Reconciliation "${reconciliationHandle}": no liquid code found`);
    return;
  }

  // Main Part (or other shared parts)
  let sharedPartsFound = reconcilationObject.text.match(reSharedParts) || [];

  // Parts
  if (reconcilationObject.text_parts) {
    for (const part of reconcilationObject.text_parts) {
      const eachPart = part.content.match(reSharedParts) || [];
      if (eachPart) {
        sharedPartsFound = sharedPartsFound.concat(eachPart);
      }
    }
  }

  // Process
  for (const sharedPart of sharedPartsFound) {
    const [_, name] = sharedPart.split("/"); // shared/shared_part_name
    if (!sharedPartsNamesArray.includes(name)) {
      sharedPartsNamesArray.push(name);
    }
  }

  return sharedPartsNamesArray; // [ shared_part_name_1, shared_part_name_2 ...]
}

// Look for Account IDs in customs
function lookForAccountsIDs(obj) {
  const reAccountID = RegExp(/#[0-9]+/g); // #1234567890
  const stringified = JSON.stringify(obj);
  const array = stringified.match(reAccountID) || [];
  const uniqueArray = [...new Set(array)];
  return uniqueArray; // [ #12345678, ...]
}

module.exports = {
  createBaseLiquidTest,
  extractURL,
  exportYAML,
  processCustom,
  getCompanyDependencies,
  searchForResultsFromDependenciesInLiquid,
  searchForCustomsFromDependenciesInLiquid,
  lookForSharedPartsInLiquid,
  lookForAccountsIDs,
};
