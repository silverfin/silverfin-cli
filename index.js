const SF = require("./api/sfApi");
const fsUtils = require("./lib/utils/fsUtils");
const fs = require("fs");
const { spinner } = require("./lib/cli/spinner");
const chalk = require("chalk");
const pkg = require("./package.json");
const { config } = require("./api/auth");
const yaml = require("yaml");
const axios = require("axios");
const open = require("open");
const path = require("path");
const { exec, execSync } = require("child_process");
const isWsl = require("is-wsl");
const commandExistsSync = require("command-exists").sync;
const errorUtils = require("../lib/utils/errorUtils");

const RECONCILIATION_FIELDS_TO_SYNC = [
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
  "is_active",
  "externally_managed",
];
const RECONCILIATION_FIELDS_TO_PUSH = [
  "handle",
  "name_en",
  "name_fr",
  "name_nl",
  "auto_hide_formula",
  "text_configuration",
  "externally_managed",
];

function storeImportedReconciliation(firmId, reconciliationText) {
  if (!reconciliationText.handle) {
    console.log(
      `Reconciliation has no handle, add a handle before importing it. Skipped`
    );
    return;
  }

  const handle = reconciliationText.handle;

  if (!reconciliationText.text) {
    console.log(
      `This template's liquid code was empty or hidden so it was not imported: ${handle}`
    );
    return;
  }
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
    testContent = reconciliationText.tests;
  } else {
    testContent = "# Add your Liquid Tests here";
  }
  fsUtils.createLiquidTestFiles(relativePath, testFilenameRoot, testContent);

  // Config Json File
  const attributes = RECONCILIATION_FIELDS_TO_SYNC.reduce((acc, attribute) => {
    acc[attribute] = reconciliationText[attribute];
    return acc;
  }, {});

  const configTextParts = Object.keys(textParts).reduce((acc, name) => {
    if (name) {
      acc[name] = `text_parts/${name}.liquid`;
    }
    return acc;
  }, {});

  // Check for existing ids in the config for other firms
  let existingConfig = {};

  if (fs.existsSync(`${relativePath}/config.json`)) {
    existingConfig = fsUtils.readConfig(relativePath);
  }

  const configContent = {
    ...attributes,
    id: {
      ...existingConfig?.id,
      [firmId]: reconciliationText.id,
    },
    text: "main.liquid",
    text_parts: configTextParts,
    test: `tests/${handle}_liquid_test.yml`,
  };
  fsUtils.writeConfig(relativePath, configContent);
}

async function importExistingReconciliationByHandle(firmId, handle) {
  const reconciliationText = await SF.findReconciliationText(firmId, handle);
  if (!reconciliationText) {
    throw `${handle} wasn't found`;
  }
  storeImportedReconciliation(firmId, reconciliationText);
}

async function importExistingReconciliationById(firmId, reconciliationId) {
  const reconciliationText = await SF.findReconciliationTextById(
    firmId,
    reconciliationId
  );
  if (!reconciliationText) {
    throw `${reconciliationId} wasn't found`;
  }
  storeImportedReconciliation(firmId, reconciliationText);
}

// Import all reconciliations
async function importExistingReconciliations(firmId, page = 1) {
  const response = await SF.fetchReconciliationTexts(firmId, page);
  const reconciliationsArray = response.data;
  if (reconciliationsArray.length == 0) {
    if (page == 1) {
      console.log("No reconciliations found");
    }
    return;
  }
  reconciliationsArray.forEach(async (reconciliation) => {
    storeImportedReconciliation(firmId, reconciliation);
  });
  importExistingReconciliations(firmId, page + 1);
}

// Look for the template in Silverfin with the handle/name and get it's ID
// Type has to be either "reconciliation_texts" or "shared_parts"
async function updateTemplateID(firmId, type, handle) {
  let relativePath;
  let templateText;
  if (type === "reconciliation_texts") {
    relativePath = `./reconciliation_texts/${handle}`;
    templateText = await SF.findReconciliationText(firmId, handle);
  }
  if (type === "shared_parts") {
    relativePath = `./shared_parts/${handle}`;
    templateText = await SF.findSharedPart(firmId, handle);
  }
  if (!templateText) {
    console.log(`${handle} wasn't found`);
    return;
  }
  const configPath = `${relativePath}/config.json`;
  if (!fs.existsSync(configPath)) {
    console.log(
      `There is no config.json file for ${handle}. You need to import or create it first.`
    );
    return;
  }
  const config = fsUtils.readConfig(relativePath);
  if (typeof config.id !== "object") {
    config.id = {};
  }
  config.id[firmId] = templateText.id;
  fsUtils.writeConfig(relativePath, config);
  console.log(`${handle}: ID updated`);
}

// For all existing reconciliations in the repository, find their IDs
async function getAllTemplatesId(firmId, type) {
  try {
    let templatesArray = fsUtils.getTemplatePaths(type); // shared_parts or reconciliation_texts
    for (let configPath of templatesArray) {
      let configTemplate = fsUtils.readConfig(configPath);
      let handle = configTemplate.handle || configTemplate.name;
      if (!handle) {
        continue;
      }
      console.log(`Getting ID for ${handle}...`);
      await updateTemplateID(firmId, type, handle);
    }
  } catch (error) {
    errorUtils.errorHandler(error);
  }
}

// Recreate reconciliation (main and text parts)
function constructReconciliationText(handle) {
  const relativePath = `./reconciliation_texts/${handle}`;
  const config = fsUtils.readConfig(relativePath);

  const attributes = RECONCILIATION_FIELDS_TO_PUSH.reduce((acc, attribute) => {
    acc[attribute] = config[attribute];
    return acc;
  }, {});
  attributes.text = fs.readFileSync(`${relativePath}/main.liquid`, "utf-8");

  const textParts = Object.keys(config.text_parts).reduce((array, name) => {
    let path = `${relativePath}/${config.text_parts[name]}`;
    let content = fs.readFileSync(path, "utf-8");
    array.push({ name, content });
    return array;
  }, []);

  attributes.text_parts = textParts;

  const mainPartPath = `${relativePath}/${config.text}`;
  const mainPartContent = fs.readFileSync(mainPartPath, "utf-8");
  attributes.text = mainPartContent;

  return attributes;
}

async function persistReconciliationText(firmId, handle) {
  try {
    const relativePath = `./reconciliation_texts/${handle}`;
    const config = fsUtils.readConfig(relativePath);
    if (!config || !config.id[firmId]) {
      console.log(`Reconciliation ${handle}: ID is missing. Aborted`);
      console.log(
        `Try running: ${chalk.bold(
          `silverfin get-reconciliation-id --handle ${handle}`
        )} or ${chalk.bold(`silverfin get-reconciliation-id --all`)}`
      );
      process.exit(1);
    }
    let reconciliationTextId = config.id[firmId];
    SF.updateReconciliationText(firmId, reconciliationTextId, {
      ...constructReconciliationText(handle),
      version_comment: "Update published using the API",
    });
  } catch (error) {
    errorUtils.errorHandler(error);
  }
}

async function newReconciliation(firmId, handle) {
  try {
    const existingReconciliation = await SF.findReconciliationText(
      firmId,
      handle
    );
    if (existingReconciliation) {
      console.log(
        `Reconciliation ${handle} already exists. Skipping its creation`
      );
      return;
    }
    const relativePath = `./reconciliation_texts/${handle}`;
    fsUtils.createFolder(`./reconciliation_texts`);
    fsUtils.createFolders(relativePath);
    fsUtils.createConfigIfMissing(relativePath, "reconciliation_text");
    const config = fsUtils.readConfig(relativePath);

    if (!fs.existsSync(`${relativePath}/main.liquid`)) {
      fsUtils.createLiquidFile(
        relativePath,
        "main",
        "{% comment %}NEW RECONCILIATION - MAIN PART{% endcomment %}"
      );
    }

    // Write handle & names 
    const attributes = constructReconciliationText(handle);
    const items = ["handle", "name_nl", "name_en", "name_fr"];
    items.forEach((item) => {
      if (!attributes[item]) {
        attributes[item] = handle;
        config[item] = handle;
      }
    });

    // Liquid Test YAML
    const testFilenameRoot = handle;
    let testContent = "# Add your Liquid Tests here";
    fsUtils.createLiquidTestFiles(relativePath, testFilenameRoot, testContent);
    config.tests = 'tests/${handle}_liquid_test.yml';

    // Write config
    fsUtils.writeConfig(relativePath, config);

    const response = await SF.createReconciliationText(firmId, {
      ...attributes,
      version_comment: "Created using the API",
    });

    // Store new firm id
    if (response && response.status == 201) {
      config.id[firmId] = response.data.id;
      fsUtils.writeConfig(relativePath, config);
    }
  } catch (error) {
    errorUtils.errorHandler(error);
  }
}

async function newReconciliationsAll(firmId) {
  const reconciliationsArray = fsUtils.getTemplatePaths("reconciliation_texts");
  for (let reconciliationPath of reconciliationsArray) {
    const reconciliationHandle = reconciliationPath.split("/")[2];
    await newReconciliation(firmId, reconciliationHandle);
  }
}

async function importExistingSharedPartById(firmId, id) {
  const sharedPart = await SF.fetchSharedPartById(firmId, id);

  if (!sharedPart) {
    throw `Shared part ${id} wasn't found.`;
  }
  const sharedPartNameCheck = /^[a-zA-Z0-9_]*$/.test(sharedPart.data.name);
  if (!sharedPartNameCheck) {
    console.log(
      `Shared part name contains invalid characters. Skipping. Current name: ${sharedPart.data.name}`
    );
    return;
  }

  const relativePath = `./shared_parts/${sharedPart.data.name}`;

  fsUtils.createFolder(`./shared_parts`);
  fsUtils.createFolder(relativePath);

  fsUtils.createLiquidFile(
    relativePath,
    sharedPart.data.name,
    sharedPart.data.text
  );

  let existingConfig;

  if (!fs.existsSync(`${relativePath}/config.json`)) {
    existingConfig = fsUtils.createConfigIfMissing(relativePath);
  }
  existingConfig = fsUtils.readConfig(relativePath);

  // Adjust ID and find reconciliation handle
  let used_in = existingConfig.used_in ? existingConfig.used_in : [];
  // Remove old format IDs
  // OLD: "id": 1234
  // NEW: "id": { "100": 1234 }
  used_in = used_in.filter(
    (reconcilation) => typeof reconcilation.id !== "number"
  );

  for (let reconciliation of sharedPart.data.used_in) {
    // Search in repository
    let reconHandle = await fsUtils.findHandleByID(
      firmId,
      "reconciliation_texts",
      reconciliation.id
    );
    if (reconHandle) {
      reconciliation.handle = reconHandle;
      // Search through the API
    } else {
      let reconciliationText = await SF.findReconciliationTextById(
        firmId,
        reconciliation.id
      );
      if (reconciliationText) {
        reconciliation.handle = reconciliationText.handle;
      }
    }
    reconId = reconciliation.id;
    // Check if there's already an existing used_in configuration for other firms
    const existingReconciliationConfig = used_in.findIndex(
      (existingUsedRecon) => existingUsedRecon.handle == reconciliation.handle
    );

    if (existingReconciliationConfig !== -1) {
      reconciliation.id = {
        ...used_in[existingReconciliationConfig].id,
        [firmId]: reconciliation.id,
      };
      used_in[existingReconciliationConfig] = reconciliation;
    } else {
      reconciliation.id = { [firmId]: reconciliation.id };
      used_in.push(reconciliation);
    }
  }

  const config = {
    id: { ...existingConfig.id, [firmId]: sharedPart.data.id },
    name: sharedPart.data.name,
    text: "main.liquid",
    used_in: used_in,
  };

  fsUtils.writeConfig(relativePath, config);
}

async function importExistingSharedPartByName(firmId, name) {
  const sharedPartByName = await SF.findSharedPart(firmId, name);
  if (!sharedPartByName) {
    throw `Shared part with name ${name} wasn't found.`;
  }
  return importExistingSharedPartById(firmId, sharedPartByName.id);
}

async function importExistingSharedParts(firmId, page = 1) {
  const response = await SF.fetchSharedParts(firmId, page);
  const sharedParts = response.data;
  if (sharedParts.length == 0) {
    if (page == 1) {
      console.log(`No shared parts found`);
    }
    return;
  }
  sharedParts.forEach(async (sharedPart) => {
    await importExistingSharedPartById(firmId, sharedPart.id);
  });
  await importExistingSharedParts(firmId, page + 1);
}

async function persistSharedPart(firmId, name) {
  try {
    const relativePath = `./shared_parts/${name}`;
    const config = fsUtils.readConfig(relativePath);
    if (!config || !config.id[firmId]) {
      console.log(`Shared part ${name}: ID is missing. Aborted`);
      console.log(
        `Try running: ${chalk.bold(
          `silverfin get-shared-part-id --shared-part ${name}`
        )} or ${chalk.bold(`silverfin get-shared-part-id --all`)}`
      );
      process.exit(1);
    }
    const attributes = {};
    attributes.text = fs.readFileSync(
      `${relativePath}/${name}.liquid`,
      "utf-8"
    );
    SF.updateSharedPart(firmId, config.id[firmId], {
      ...attributes,
      version_comment: "Update published using the API",
    });
  } catch (error) {
    errorUtils.errorHandler(error);
  }
}

async function newSharedPart(firmId, name) {
  try {
    const existingSharedPart = await SF.findSharedPart(firmId, name);
    if (existingSharedPart) {
      console.log(`Shared part ${name} already exists. Skipping its creation`);
      return;
    }
    const relativePath = `./shared_parts/${name}`;

    fsUtils.createFolder(`./shared_parts`);

    fsUtils.createConfigIfMissing(relativePath);
    const config = fsUtils.readConfig(relativePath);

    if (!fs.existsSync(`${relativePath}/${name}.liquid`)) {
      fsUtils.createLiquidFile(
        relativePath,
        name,
        "{% comment %}SHARED PART CONTENT{% endcomment %}"
      );
    }

    const attributes = {
      name,
      text: fs.readFileSync(`${relativePath}/${name}.liquid`, "utf-8"),
    };

    const response = await SF.createSharedPart(firmId, {
      ...attributes,
      version_comment: "Created using the API",
    });

    // Store new firm id
    if (response && response.status == 201) {
      config.id[firmId] = response.data.id;
      fsUtils.writeConfig(relativePath, config);
    }
  } catch (error) {
    errorUtils.errorHandler(error);
  }
}

async function newSharedPartsAll(firmId) {
  const sharedPartsArray = fsUtils.getTemplatePaths("shared_parts");
  for (let sharedPartPath of sharedPartsArray) {
    const sharedPartName = sharedPartPath.split("/")[2];
    await newSharedPart(firmId, sharedPartName);
  }
}

// Link a shared part to a reconciliation
async function addSharedPartToReconciliation(
  firmId,
  sharedPartHandle,
  reconciliationHandle
) {
  try {
    const relativePathReconciliation = `./reconciliation_texts/${reconciliationHandle}`;
    const configReconciliation = await fsUtils.readConfig(
      relativePathReconciliation
    );

    const relativePathSharedPart = `./shared_parts/${sharedPartHandle}`;
    const configSharedPart = await fsUtils.readConfig(relativePathSharedPart);

    if (!configReconciliation.id[firmId] || !configSharedPart.id[firmId]) {
      console.log(
        `ID missing for reconciliation and/or shared part (${reconciliationHandle} & ${sharedPartHandle})`
      );
      return;
    }

    const response = await SF.addSharedPart(
      firmId,
      configSharedPart.id[firmId],
      configReconciliation.id[firmId]
    );

    if (response.status === 201) {
      console.log(
        `Shared part "${sharedPartHandle}" added to "${reconciliationHandle}" reconciliation text.`
      );

      let reconciliationIndex;

      if (!configSharedPart.used_in) {
        reconciliationIndex = -1;
        configSharedPart.used_in = [];
      } else {
        reconciliationIndex = configSharedPart.used_in.findIndex(
          (reconciliationText) =>
            reconciliationHandle === reconciliationText.handle
        );
      }

      // Not stored yet
      if (reconciliationIndex === -1) {
        configSharedPart.used_in.push({
          id: { [firmId]: configReconciliation.id[firmId] },
          type: "reconciliation",
          handle: reconciliationHandle,
        });
      }

      // Previously stored
      if (reconciliationIndex !== -1) {
        configSharedPart.used_in[reconciliationIndex].id[firmId] =
          configReconciliation.id[firmId];
      }

      // Save Configs
      fsUtils.writeConfig(relativePathSharedPart, configSharedPart);
      fsUtils.writeConfig(relativePathReconciliation, configReconciliation);
    }
  } catch (error) {
    errorUtils.errorHandler(error);
  }
}

// Loop through all shared parts (config files)
// Try to add the shared part to each reconciliation listed in 'used_in'
async function addAllSharedPartsToAllReconciliation(firmId) {
  const sharedPartsArray = fsUtils.getTemplatePaths("shared_parts");
  for (let sharedPartPath of sharedPartsArray) {
    let configSharedPart = fsUtils.readConfig(sharedPartPath);
    for (let reconciliation of configSharedPart.used_in) {
      if (reconciliation.handle) {
        if (fs.existsSync(`./reconciliation_texts/${reconciliation.handle}`)) {
          await addSharedPartToReconciliation(
            firmId,
            configSharedPart.name,
            reconciliation.handle
          );
        }
      }
    }
  }
}

async function removeSharedPartFromReconciliation(
  firmId,
  sharedPartHandle,
  reconciliationHandle
) {
  try {
    const relativePathReconciliation = `./reconciliation_texts/${reconciliationHandle}`;
    const configReconciliation = fsUtils.readConfig(relativePathReconciliation);

    const relativePathSharedPart = `./shared_parts/${sharedPartHandle}`;
    const configSharedPart = fsUtils.readConfig(relativePathSharedPart);

    const response = await SF.removeSharedPart(
      firmId,
      configSharedPart.id[firmId],
      configReconciliation.id[firmId]
    );
    if (response.status === 200) {
      console.log(
        `Shared part "${sharedPartHandle}" removed from "${reconciliationHandle}" reconciliation text.`
      );
    }

    const reconciliationIndex = configSharedPart.used_in.findIndex(
      (reconciliationText) =>
        reconciliationText.id[firmId] === configReconciliation.id[firmId]
    );
    if (reconciliationIndex !== -1) {
      const reconciliationText = configSharedPart.used_in[reconciliationIndex];

      if (Object.keys(reconciliationText.id).length === 1) {
        configSharedPart.used_in.splice(reconciliationIndex, 1);
      } else {
        delete reconciliationText.id[firmId];
      }
      fsUtils.writeConfig(relativePathSharedPart, configSharedPart);
    }
  } catch (error) {
    errorUtils.errorHandler(error);
  }
}

function findTestRows(testContent) {
  const testYAML = yaml.parse(testContent, (options = { maxAliasCount: -1 }));
  const testNames = Object.keys(testYAML);
  const testRows = testContent.split("\n");
  const indexes = {};
  testNames.forEach((testName) => {
    let index = testRows.findIndex((element) => element.includes(testName));
    indexes[testName] = index;
  });
  return indexes;
}

function buildTestParams(firmId, handle, testName = "", html_render = false) {
  const relativePath = `./reconciliation_texts/${handle}`;
  const config = fsUtils.readConfig(relativePath);
  const testPath = `${relativePath}/${config.test}`;
  const testContent = fs.readFileSync(testPath, "utf-8");

  // Empty YAML check
  if (testContent.split("\n").length <= 1) {
    console.log(`${handle}: there are no tests stored in the YAML file`);
    process.exit(1);
  }

  const templateContent = constructReconciliationText(handle);
  templateContent.handle = handle;
  templateContent.html_render = html_render ? true : false;
  templateContent.reconciliation_type = config.reconciliation_type;
  const sharedParts = fsUtils.getSharedParts(firmId, handle);
  if (sharedParts.length !== 0) {
    templateContent.text_shared_parts = [];
    for (let sharedPart of sharedParts) {
      let sharedPartContent = fs.readFileSync(
        `shared_parts/${sharedPart}/${sharedPart}.liquid`,
        "utf-8"
      );
      templateContent.text_shared_parts.push({
        name: sharedPart,
        content: sharedPartContent,
      });
    }
  }
  const testParams = {
    template: templateContent,
    tests: testContent,
  };
  // Include only one test
  if (testName) {
    const indexes = findTestRows(testContent);
    if (!Object.keys(indexes).includes(testName)) {
      console.log(`Test ${testName} not found in YAML`);
      process.exit(1);
    }
    testParams.test_line = indexes[testName] + 1;
  }
  return testParams;
}

async function fetchResult(firmId, testRunId) {
  let testRun = { status: "started" };
  let pollingDelay = 1000;
  const waitingLimit = 500000;

  spinner.spin("Running tests..");
  let waitingTime = 0;
  while (testRun.status === "started") {
    await new Promise((resolve) => {
      setTimeout(resolve, pollingDelay);
    });
    const response = await SF.fetchTestRun(firmId, testRunId);
    testRun = response.data;
    waitingTime += pollingDelay;
    pollingDelay *= 1.05;
    if (waitingTime >= waitingLimit) {
      spinner.stop();
      console.log("Timeout. Try to run your test again");
      break;
    }
  }
  spinner.stop();
  return testRun;
}

function listErrors(items, type) {
  const itemsKeys = Object.keys(items);
  console.log(
    chalk.red(
      `${itemsKeys.length} ${type} expectation${
        itemsKeys.length > 1 ? "s" : ""
      } failed`
    )
  );
  itemsKeys.forEach((itemName) => {
    let itemDetails = items[itemName];
    console.log(`At line number ${itemDetails.line_number}`);
    console.log(
      `For ${type} ${chalk.blue.bold(itemName)} got ${chalk.blue.bold(
        itemDetails.got
      )} (${chalk.italic(
        typeof itemDetails.got
      )}) but expected ${chalk.blue.bold(itemDetails.expected)} (${chalk.italic(
        typeof itemDetails.expected
      )})`
    );
  });
  console.log("");
}

// Find at least one error in the all tests
function checkAllTestsErrorsPresent(testsFeedback) {
  let errorsPresent = false;
  const testNames = Object.keys(testsFeedback);
  for (let testName of testNames) {
    if (errorsPresent) {
      break;
    }
    errorsPresent = checkTestErrorsPresent(testName, testsFeedback);
  }
  return errorsPresent;
}

function checkTestErrorsPresent(testName, testsFeedback) {
  let errorsPresent = false;
  const SECTIONS = ["reconciled", "results", "rollforwards"];
  let testSections = Object.keys(testsFeedback[testName]);
  // Look for reconciled, results or rollforwards
  // We could have only html for successful tests
  for (let section of testSections) {
    if (SECTIONS.includes(section)) {
      errorsPresent = true;
      break;
    }
  }
  return errorsPresent;
}

function processTestRunResponse(testRun) {
  // Possible status: started, completed, test_error, internal_error
  switch (testRun.status) {
    case "internal_error":
      console.log(
        "Internal error. Try to run the test again or contact support if the issue persists."
      );
      break;
    case "test_error":
      console.log("Ran into an error an couldn't complete test run");
      console.log(chalk.red(testRun.error_message));
      break;
    case "completed":
      const errorsPresent = checkAllTestsErrorsPresent(testRun.tests);
      if (errorsPresent === false) {
        console.log(chalk.green("ALL TESTS HAVE PASSED"));
      } else {
        console.log("");

        console.log(
          chalk.red(
            `${Object.keys(testRun.tests).length} TEST${
              Object.keys(testRun.tests).length > 1 ? "S" : ""
            } FAILED`
          )
        );

        const tests = Object.keys(testRun.tests);
        tests.forEach((testName) => {
          let testErrorsPresent = checkTestErrorsPresent(
            testName,
            testRun.tests
          );
          // No errors in this test
          if (!testErrorsPresent) {
            return;
          }
          console.log(
            "---------------------------------------------------------------"
          );
          console.log(chalk.bold(testName));

          let testElements = testRun.tests[testName];

          // Display success messages of test
          if (testElements.reconciled === null) {
            console.log(chalk.green("Reconciliation expectation passed"));
          }

          if (Object.keys(testElements.results).length === 0) {
            console.log(chalk.green("All result expectations passed"));
          }

          if (Object.keys(testElements.rollforwards).length === 0) {
            console.log(chalk.green("All rollforward expectations passed"));
          }

          // Display error messages of test

          // Reconciled
          if (testElements.reconciled !== null) {
            console.log(chalk.red("Reconciliation expectation failed"));
            console.log(
              `At line number ${testElements.reconciled.line_number}`
            );
            console.log(
              `got ${chalk.blue.bold(
                testElements.reconciled.got
              )} but expected ${chalk.blue.bold(
                testElements.reconciled.expected
              )}`
            );
            console.log("");
          }

          // Results
          if (Object.keys(testElements.results).length > 0) {
            listErrors(testElements.results, "result");
          }

          // Rollforwards
          if (Object.keys(testElements.rollforwards).length > 0) {
            listErrors(testElements.rollforwards, "rollforward");
          }
        });
        break;
      }
  }
}

// Path to store HTML exports
function resolveHTMLPath(testName) {
  const homedir = require("os").homedir();
  const folderPath = path.resolve(homedir, ".silverfin/html_exports");
  const filePath = path.resolve(folderPath, `${testName}.html`);
  fsUtils.createFolder(folderPath);
  return filePath;
}

// Retrieve HTML, store it and open it in the default browser if needed
async function getHTML(url, testName, openBrowser = false) {
  const filePath = resolveHTMLPath(testName);
  const htmlResponse = await axios.get(url);
  if (htmlResponse.status === 200) {
    fs.writeFileSync(filePath, htmlResponse.data);
    if (openBrowser) {
      if (isWsl) {
        if (commandExistsSync("wsl-open")) {
          exec(`wsl-open ${filePath}`);
        } else {
          console.log(
            "In order to automatically open HTML files on WSL, we need to install the wsl-open script."
          );
          console.log(
            "You might be prompted for your password in order for us to install 'sudo npm install -g wsl-open'"
          );
          execSync("sudo npm install -g wsl-open");
          console.log("Installed wsl-open script");
          exec(`wsl-open ${filePath}`);
        }
      } else {
        await open(filePath);
      }
    }
  }
}

async function deleteExistingHTMLs() {
  try {
    const homedir = require("os").homedir();
    const folderPath = path.resolve(homedir, ".silverfin/html_exports");
    if (!fs.existsSync(folderPath)) {
      return;
    }
    const files = fs.readdirSync(folderPath);
    files.forEach((fileName) => {
      const filePath = path.resolve(folderPath, fileName);
      fs.unlinkSync(filePath);
    });
  } catch (err) {}
}

async function handleHTMLfiles(testName = "", testRun) {
  deleteExistingHTMLs();
  if (testName) {
    // Only one test
    await getHTML(testRun.tests[testName].html, testName, true);
  } else {
    // All tests
    const testNames = Object.keys(testRun.tests);
    testNames.forEach(async (testName) => {
      await getHTML(testRun.tests[testName].html, testName, true);
    });
  }
}

// Used by VSCode Extension
async function runTests(firmId, handle, testName = "", html_render = false) {
  try {
    const testParams = buildTestParams(firmId, handle, testName, html_render);
    const testRunResponse = await SF.createTestRun(firmId, testParams);
    const testRunId = testRunResponse.data;
    const testRun = await fetchResult(firmId, testRunId);
    return testRun;
  } catch (error) {
    errorUtils.errorHandler(error);
  }
}

async function runTestsWithOutput(
  firmId,
  handle,
  testName = "",
  html_render = false
) {
  try {
    const testRun = await runTests(firmId, handle, testName, html_render);
    if (!testRun) {
      return;
    }
    processTestRunResponse(testRun);
    if (html_render) {
      handleHTMLfiles(testName, testRun);
    }
  } catch (error) {
    errorUtils.errorHandler(error);
  }
}

function authorize(firmId = undefined) {
  SF.authorizeApp(firmId);
}

function setDefaultFirmID(firmId) {
  config.setFirmId(firmId);
  console.log(`Set firm id to: ${firmId}`);
}

function getDefaultFirmID() {
  const firmId = config.getFirmId();
  return firmId;
}

function listStoredIds() {
  return config.storedIds();
}

module.exports = {
  importExistingReconciliationByHandle,
  importExistingReconciliationById,
  importExistingReconciliations,
  persistReconciliationText,
  newReconciliation,
  newReconciliationsAll,
  importExistingSharedPartByName,
  importExistingSharedParts,
  persistSharedPart,
  newSharedPart,
  newSharedPartsAll,
  addSharedPartToReconciliation,
  removeSharedPartFromReconciliation,
  addAllSharedPartsToAllReconciliation,
  runTests,
  runTestsWithOutput,
  getHTML,
  resolveHTMLPath,
  checkAllTestsErrorsPresent,
  authorize,
  updateTemplateID,
  getAllTemplatesId,
  setDefaultFirmID,
  getDefaultFirmID,
  listStoredIds,
};
