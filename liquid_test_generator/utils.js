const YAML = require('yaml');
const fs = require('fs');
const fsUtils = require('../fs_utils');

// Create base Liquid Test object
function createBaseLiquidTest(testName) {
  return {
    [testName]: {
      context: {
        period: "#Replace with period"
      },
      data: {
        periods: {
          replace_period_name: {
            reconciliations: {}
          }
        }
      },
      expectation: {
        reconciled: "#Replace with reconciled status",
        results: {}
      }
    }
  };
};
 
// Provide a link to reconciliation in Silverfin
// Extract firm id, company id, period id, reconciliation id
function extractURL(url) {
  try {
      let parts = url.split('?')[0].split('/f/')[1].split('/');
      let type;
      if ( parts.indexOf('reconciliation_texts') !== -1 ) {
          type = 'reconciliationId';
      } else if ( parts.indexOf('account_entry') !== -1 ) {
          type = 'accountId';
      } else {
          throw "Not possible to identify if it's a reconciliation text or account entry."
      };
      return {
          firmId: parts[0],
          companyId: parts[1],
          ledgerId: parts[3],
          workflowId: parts[5],
          [type]: parts[7]
      };
  } catch (err) {
      console.error(err);
  };
};

function generateFileName(handle, counter = 0) {
  let fileName = `${handle}_liquid_test.yml`;
  if (counter != 0) {
    fileName = `${handle}_${counter}_liquid_test.yml`;
  };
  const filePath = `./reconciliation_texts/${handle}/tests/${fileName}`;
  if (fs.existsSync(filePath)) {
    return generateFileName(handle, counter + 1);
  }
    return filePath;
};

// Create YAML
function exportYAML(handle, liquidTestObject) {
  const relativePath = `./reconciliation_texts/${handle}`;
  fsUtils.createFolder(`./reconciliation_texts`);
  fsUtils.createFolders(relativePath);
  const filePath = generateFileName(handle); 
  fs.writeFile(filePath, YAML.stringify(liquidTestObject, {
    toStringDefaults:{
      defaultKeyType: 'PLAIN',
      defaultStringType:'QUOTE_DOUBLE',
      indent: 2,
      lineWidth: 0
    }}), (err, data) => {
      if (err) { 
        console.error(err);
      } else {
        console.log(`File saved: ${filePath}`);
      };
    });
};

// Format TextoProperties/Customs to an Object
function processCustom(customArray) {
  const obj = {};
  for (item of customArray) {
    let element = `${item.namespace}.${item.key}`;
    // Fori
    if (item.value && item.value.field) {
      obj[element] = item.value.field;
    } else {
      obj[element] = item.value;
    };
  };
  return obj;
};

// Company Drop used
function getCompanyDependencies(reconcilationObject, reconciliationHandle) {
  const reCompanySearch = RegExp(/company\.\w+(?:\.\w+\.\w+)?/g); // company.foo or company.custom.foo.bar

  // No main part ?
  if (!reconcilationObject.text) {
    console.log(`Reconciliation "${reconciliationHandle}": no liquid code found`);
    return { standardDropElements: [], customDropElements: [] };
  }; 

  // Main Part
  let companyFound = reconcilationObject.text.match(reCompanySearch) || [];

  // Parts
  for (part of reconcilationObject.text_parts) {
    let companyPart = part.content.match(reCompanySearch) || [];
    if (companyPart) {
      companyFound = companyFound.concat(companyPart);
    };
  };
    
  // Filter repeated elements
  companyFound = companyFound.filter((tag, index) => {
    return companyFound.indexOf(tag) === index;
  });

  // Separate custom drop from standard drop
  const customDropElements = companyFound.filter(tag => tag.includes('custom')); // [ 'company.custom.foo.bar', ...]
    
  // Get only standard drop elements
  const standardDropElements = companyFound.filter(tag => !customDropElements.includes(tag)); // [ 'company.foo´, ...]

  return { standardDropElements, customDropElements };
};

// Do we need to get results from other templates? Check Liquid Code (handle & result names)
// We can pass an existing collection {handle:[results]} from a previous call
function searchForResultsFromDependenciesInLiquid(reconcilationObject, reconciliationHandle, resultsCollection = {}) {
  // Normal Scenario
  const reResultsFetched = RegExp(/period\.reconciliations\.\w+\.results\.\w+/g); // period.reconciliations.handle.results.result_name
  
  // No main part ?
  if (!reconcilationObject.text) {
    console.log(`Reconciliation "${reconciliationHandle}": no liquid code found`);
    return resultsCollection;
  }; 
  
  // Main Part (or shared part)
  let resultsFound = reconcilationObject.text.match(reResultsFetched) || [];
  
  // Parts
  if (reconcilationObject.text_parts) {
    for (part of reconcilationObject.text_parts) {
      let resultsPart = part.content.match(reResultsFetched) || [];
      if (resultsPart) {
        resultsFound = resultsFound.concat(resultsPart);
      };
    };
  };
  
  // Process Results. 
  for (result of resultsFound) {
    let [a, b, handle, c, resultName] = result.split('.'); // period;reconciliation;handle;results;result_name
    // Check if handle is already there. Empty array
    if (!resultsCollection.hasOwnProperty(handle)) {
      resultsCollection[handle] = [];
    };
    // Check if result is already there.
    if (resultsCollection[handle].indexOf(resultName) == -1) {
      resultsCollection[handle].push(resultName);
    };
  };
  
  // Assign: Scenarios
  // {% assign variable_name = period.reconciliations.handle %} && {{ variable_name.results.result_name }}
  // {% assign variable_name = period.reconciliations.handle.results %} && {{ variable_name.result_name }}
  const reAssign = RegExp(/\w+(\ )?=(\ )?period\.reconciliations\.\w+(\.results)?(\ |\%)/g); // period.reconciliations.handle or period.reconciliations.handle.results
  let resultsFoundAssign = reconcilationObject.text.match(reAssign) || [];
  const variables = resultsFoundAssign.map((element)=>{
    let parts = element.split("="); // variable, period.reconciliation.handle...
    return [parts[0].trim(), parts[1].split(".")[2].trim()]; // [variable name, handle]
  });
  for ([variableName, handle] of variables) {
    let expression = `(\ |\%|\{)${variableName}(\.results)?\.\\w+(\ |\%|\})`; // variable.result_name or variable.results.result_name 
    let reAssignResults = new RegExp(expression, 'g');
    // Main
    let assignResultsFound = reconcilationObject.text.match(reAssignResults) || [];
    // Parts
    if (reconcilationObject.text_parts) {
      for (part of reconcilationObject.text_parts) {
        let assignResultsPart = part.content.match(reAssignResults) || [];
        if (assignResultsPart) {
          assignResultsFound = assignResultsFound.concat(assignResultsPart);
        };
      };
    };    
    // Process
    for (result of assignResultsFound) {
      let parts = result.split('.');
      if (parts.length > 1){
        let resultName = parts[parts.length-1].trim();
        // Check if handle is already there. Empty array
        if (!resultsCollection.hasOwnProperty(handle)) {
          resultsCollection[handle] = [];
        };
        // Check if result is already there.
        if (resultsCollection[handle].indexOf(resultName) == -1) {
          resultsCollection[handle].push(resultName);
        };
      };
    };
  };
  
  // Capture: Scenarios
  // period.reconcilations.handle.results.[result_name_capture] ?
  // period.reconciliations.[handle_capture].results.[result_name_capture] ?
  // TO DO

  return resultsCollection; // { handle: [result_1, result_2], ...}
};

// Do we need to get custom drops from other templates? Check Liquid Code (handle & custom names)
// We can pass an existing collection {handle:[drop]} from a previous call
function searchForCustomsFromDependenciesInLiquid(reconcilationObject, reconciliationHandle, customCollection = {}) {
  // Normal Scenario
  const reCustomsFetched = RegExp(/period\.reconciliations\.\w+\.custom\.\w+\.\w+/g); // period.reconciliations.handle.custom.namespace.key

  // No main part ?
  if (!reconcilationObject.text) {
    console.log(`Reconciliation "${reconciliationHandle}": no liquid code found`);
    return customCollection;
  }; 

  // Main Part (or shared part)
  let customsFound = reconcilationObject.text.match(reCustomsFetched) || [];

  // Parts
  if (reconcilationObject.text_parts) {
    for (part of reconcilationObject.text_parts) {
      let customsPart = part.content.match(reCustomsFetched) || [];
      if (customsPart) {
        customsFound = customsFound.concat(customsPart);
      };
    };
  };

  // Process Customs. 
  for (custom of customsFound) {
    let [a, b, handle, c, namespace, key] = custom.split('.'); // handle;custom;namespace;key
    let customNamespaceKey = `${namespace}.${key}`;
    // Check if handle is already there. Empty array
    if (!customCollection.hasOwnProperty(handle)) {
      customCollection[handle] = [];
    };
    // Check if custom is already there.
    if (customCollection[handle].indexOf(customNamespaceKey) == -1) {
      customCollection[handle].push(customNamespaceKey)
    };
  };

  // Assign: Scenarios
  // assign variable = period.reconciliations && variable.custom.namespace.key ?
  // assign variable = period.reconciliations.handle && varaible.custom.namespace.key ?
  // TO DO

  // Capture: Scenarios
  // TO DO

  return customCollection; // { handle: [result_1, result_2], ...}
};

// Look for Shared Parts used
function lookForSharedPartsInLiquid(reconcilationObject, reconciliationHandle) {
  const sharedPartsNamesArray = [];
  const reSharedParts = RegExp(/shared\/\w+/g); // shared/shared_part_name

  // No main part ?
  if (!reconcilationObject.text) {
    console.log(`Reconciliation "${reconciliationHandle}": no liquid code found`);
    return;
  }; 

  // Main Part (or other shared parts)
  let sharedPartsFound = reconcilationObject.text.match(reSharedParts) || [];

  // Parts
  if (reconcilationObject.text_parts) {
    for (part of reconcilationObject.text_parts) {
      let eachPart = part.content.match(reSharedParts) || [];
      if (eachPart) {
        sharedPartsFound = sharedPartsFound.concat(eachPart);
      };
    };
  };
    
  // Process
  for (sharedPart of sharedPartsFound) {
    const [shared, name] = sharedPart.split('/'); // shared/shared_part_name
    if (!sharedPartsNamesArray.includes(name)) {
      sharedPartsNamesArray.push(name);
    };
  };

  return sharedPartsNamesArray; // [ shared_part_name_1, shared_part_name_2 ...]
};

// Look for Account IDs in customs
function lookForAccountsIDs(obj){
  const reAccountID = RegExp(/#[0-9]+/g); // #1234567890
  const stringified = JSON.stringify(obj);
  const array = stringified.match(reAccountID) || [];
  const uniqueArray = [...new Set(array)];
  return uniqueArray; // [ #12345678, ...]
};

// Search for account_collections that have defaults defined
/*
function lookForDefaultAccounts(reconcilationObject) {
  // No main part ?
  if (!reconcilationObject.text) {
    console.log(`Reconciliation "${reconciliationHandle}": no liquid code found`);
    return;
  };
  // Main
  const inputFields = liquidUtils.lookForInputFields(reconcilationObject.text,'account_collection');
  const defaultVariables = liquidUtils.lookForDefault(inputFields);
  const accountsArray = [];
  for (variable of defaultVariables){
    accountsArray.push(liquidUtils.lookForAssign(reconcilationObject.text, variable));
  };
  // ??
  // We cannot search accounts by it's number, we need the id
};
*/

module.exports = {
  createBaseLiquidTest,
  extractURL,
  exportYAML,
  processCustom,
  getCompanyDependencies,
  searchForResultsFromDependenciesInLiquid,
  searchForCustomsFromDependenciesInLiquid,
  lookForSharedPartsInLiquid,
  lookForAccountsIDs
};
