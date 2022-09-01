const SF = require('./api/sf_api');
const fsUtils = require('./fs_utils');
const fs = require('fs');

const RECONCILIATION_FIELDS_TO_SYNC = [
  "id",
  "handle",
  "name_en", 
  "name_fr", 
  "name_nl", 
  "auto_hide_formula", 
  "text_configuration", 
  "virtual_account_number", 
  "reconciliation_type", 
  "public", 
  "allow_duplicate_reconciliations", 
  "is_active"
];

function storeImportedReconciliation(reconciliationText) {
  const handle = reconciliationText.handle;
  const relativePath = `./reconciliation_texts/${handle}`;
  fsUtils.createFolder(`./reconciliation_texts`);
  fsUtils.createFolders(relativePath);

  // Template
  textPartsReducer = (acc, part) => {
    acc[part.name] = part.content;
    return acc;
  };
  const textParts = reconciliationText.text_parts.reduce(textPartsReducer, {});
  const mainPart = reconciliationText.text;
  fsUtils.createTemplateFiles(relativePath, mainPart, textParts);

  // Liquid Test YAML
  const testFilenameRoot = handle;
  let testContent;
  if (reconciliationText.tests) {
    testContent = reconciliationText.tests
  } else {
    testContentt = "# Add your Liquid Tests here"
  };
  fsUtils.createLiquidTestFiles(relativePath, testFilenameRoot, testContent);

  // Config Json File
  const attributes = RECONCILIATION_FIELDS_TO_SYNC.reduce((acc, attribute) => {
    acc[attribute] = reconciliationText[attribute];
    return acc;
  }, {})

  const configTextParts = Object.keys(textParts).reduce((acc, name) => {
    if (name) {
      acc[name] = `text_parts/${name}.liquid`;
    };
    return acc;
  }, {});

  const configContent = {
    ...attributes,
    "text": "main.liquid",
    "text_parts": configTextParts,
    "test": `tests/${handle}_liquid_test.yml`,
  };
  fsUtils.writeConfig(relativePath, configContent);
};

async function importExistingReconciliationByHandle(handle) {
  reconciliationText = await SF.findReconciliationText(handle);
  if (!reconciliationText) {
    throw(`${handle} wasn't found`);
  };
  storeImportedReconciliation(reconciliationText);
};

async function importExistingReconciliations(page = 1) {
  const response = await SF.fetchReconciliationTexts(page);
  const reconciliationsArray = response.data;
  if (reconciliationsArray.length == 0) {
    if (page == 1) {
      console.log('No reconciliations found');
    }
    return;
  };
  reconciliationsArray.forEach(async (reconciliation) => {
    storeImportedReconciliation(reconciliation);
  });
  importExistingReconciliations(page + 1);
};

function constructReconciliationText(handle) {
  const relativePath = `./reconciliation_texts/${handle}`;
  const config = fsUtils.readConfig(relativePath);

  const attributes = RECONCILIATION_FIELDS_TO_SYNC.reduce((acc, attribute) => {
    acc[attribute] = config[attribute];
    return acc;
  }, {})
  attributes.text = fs.readFileSync(`${relativePath}/main.liquid`, 'utf-8');
  attributes.tests = fs.readFileSync(`${relativePath}/tests/${handle}_liquid_test.yml`, 'utf-8');

  const textParts = Object.keys(config.text_parts).reduce((array, name) => {
    let path = `${relativePath}/${config.text_parts[name]}`;
    let content = fs.readFileSync(path, 'utf-8');
    array.push({ name, content });
    return array;
  }, []);

  attributes.text_parts = textParts;

  const mainPartPath = `${relativePath}/${config.text}`;
  const mainPartContent = fs.readFileSync(mainPartPath, 'utf-8');
  attributes.text = mainPartContent;
  
  return attributes;
};

async function persistReconciliationText(handle) {
  reconciliationText = await SF.findReconciliationText(handle);
  if (!reconciliationText) {
    throw("Reconciliation not found");
  }; 
  SF.updateReconciliationText(reconciliationText.id, {...constructReconciliationText(handle), "version_comment": "Update published using the API"});
};

async function importExistingSharedPartById(id) {
  const sharedPart = await SF.fetchSharedPartById(id);

  if (!sharedPart) {
    throw(`Shared part ${id} wasn't found.`);
  }

  const relativePath = `./shared_parts/${sharedPart.data.name}`;

  fsUtils.createFolder(`./shared_parts`);
  fsUtils.createFolder(relativePath);

  fsUtils.createLiquidFile(relativePath, sharedPart.data.name, sharedPart.data.text);

  config = {
    "id": sharedPart.data.id,
    "name": sharedPart.data.name,
    "text": "main.liquid",
    "used_in": sharedPart.data.used_in
  };

  fsUtils.writeConfig(relativePath, config);
};

async function importExistingSharedPartByName(name) {
  const sharedPartByName = await SF.findSharedPart(name);
  if (!sharedPartByName) {
    throw(`Shared part with name ${name} wasn't found.`);
  };
  importExistingSharedPartById(sharedPartByName.id);
};

 async function importExistingSharedParts(page = 1) {
  const response = await SF.fetchSharedParts(page);
  const sharedParts = response.data;
  if (sharedParts.length == 0) {
    if (page == 1) {
    console.log(`No shared parts found`);
    }; 
    return;
  };
  sharedParts.forEach(async (sharedPart) => {
  await importExistingSharedPartById(sharedPart.id);
  });
  importExistingSharedParts(page + 1);
};

async function persistSharedPart(name) {
  const relativePath = `./shared_parts/${name}`;
  const config = fsUtils.readConfig(relativePath);
  const attributes = {};
  attributes.text = fs.readFileSync(`${relativePath}/${name}.liquid`, 'utf-8');
  SF.updateSharedPart(config.id, {...attributes, "version_comment": "Testing Cli"});
};

async function runTests(handle) {
  const relativePath = `./reconciliation_texts/${handle}`;
  const config = fsUtils.readConfig(relativePath);
  const testPath = `${relativePath}/${config.test}`;
  const testContent = fs.readFileSync(testPath, 'utf-8');

  const testParams = { 'template': constructReconciliationText(handle), 'tests': testContent };

  const testRunResponse = await SF.createTestRun(testParams);
  const testRunId = testRunResponse.data;
  let testRun = { 'status': 'started' };
  const pollingDelay = 2000;

  while (testRun.status === 'started') {
    await new Promise(resolve => setTimeout(resolve, pollingDelay));
    const response = await SF.fetchTestRun(testRunId);
    testRun = response.data;
  };

  if (testRun.status !== 'completed') {
    console.error(testRun.error_message);
    process.exit(1);
  };

  if (testRun.result.length !== 0) {
    console.error('Tests Failed');
    console.error(testRun.result);
    process.exit(1);
  };
};

function authorize() {
  SF.authorizeApp();
};

module.exports = {  
  importExistingReconciliationByHandle,
  importExistingReconciliations, 
  persistReconciliationText, 
  importExistingSharedPartByName, 
  importExistingSharedParts, 
  persistSharedPart, 
  runTests,
  authorize
};
