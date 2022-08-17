const YAML = require('yaml');
const fs = require('fs');
const fsUtils = require('../fs_utils')

// Create base Liquid Test object
function createBaseLiquidTest() {
  return {
    test_name: {
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
    obj[element] = item.value;
  };
  return { custom: obj };
};

// Company Drop used
function getCompanyDependencies(reconcilationObject) {
  const reCompanySearch = RegExp(/company\.\w*(?:\.\w*\.\w*)?/g); // company.foo or company.custom.foo.bar

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
function searchForResultsFromDependenciesInLiquid(reconcilationObject, resultsCollection = {}) {
  const reResultsFetched = RegExp(/\w*\.results\.\w*/g); // handle.results.variable
    
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
    const [handle, _, resultName] = result.split('.'); // handle;results;variable
    // Check if handle is already there. Empty array
    if (!resultsCollection.hasOwnProperty(handle)) {
      resultsCollection[handle] = [];
    };
    // Check if result is already there.
    if (resultsCollection[handle].indexOf(resultName) == -1) {
      resultsCollection[handle].push(resultName)
    };
  };

  return resultsCollection; // { handle: [result_1, result_2], ...}
};

// Look for Shared Parts used
function lookForSharedPartsInLiquid(reconcilationObject) {
  const sharedPartsNamesArray = [];
  const reSharedParts = RegExp(/shared\/\w*/g); // shared/shared_part_name

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
function lookForAccounts(obj){
  const reAccountID = RegExp(/#[0-9]{8}/g);
  const stringified = JSON.stringify(obj);
  const array = stringified.match(reAccountID) || [];
  const uniqueArray = [...new Set(array)];
  return uniqueArray; // [ #12345678, ...]
};

module.exports = {
  createBaseLiquidTest,
  extractURL,
  exportYAML,
  processCustom,
  getCompanyDependencies,
  searchForResultsFromDependenciesInLiquid,
  lookForSharedPartsInLiquid,
  lookForAccounts
};
