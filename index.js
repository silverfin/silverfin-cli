const SF = require("./api/sf_api");
const fsUtils = require("./fs_utils");
const fs = require("fs");
const { spinner } = require("./resources/spinner");
const chalk = require("chalk");
const pkg = require("./package.json");

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
  "is_active",
  "externally_managed",
];
const RECONCILIATION_FIELDS_TO_PUSH = [
  "name_en",
  "name_fr",
  "name_nl",
  "auto_hide_formula",
  "text_configuration",
];

// Uncaught Errors. Open Issue in GitHub
function uncaughtErrors(error) {
  if (error.stack) {
    console.error("");
    console.error(
      `!!! Please open an issue including this log on ${pkg.bugs.url}`
    );
    console.error("");
    console.error(error.message);
    console.error(`silverfin: v${pkg.version}, node: ${process.version}`);
    console.error("");
    console.error(error.stack);
  }
  process.exit(1);
}

function errorHandler(error) {
  if (error.code == "ENOENT") {
    console.log(
      `The path ${error.path} was not found, please ensure you've imported all required files`
    );
  } else {
    uncaughtErrors(error);
  }
}

function storeImportedReconciliation(reconciliationText) {
  const handle = reconciliationText.handle || reconciliationText.id;

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

  const configContent = {
    ...attributes,
    text: "main.liquid",
    text_parts: configTextParts,
    test: `tests/${handle}_liquid_test.yml`,
  };
  fsUtils.writeConfig(relativePath, configContent);
}

async function importExistingReconciliationByHandle(handle) {
  reconciliationText = await SF.findReconciliationText(handle);
  if (!reconciliationText) {
    throw `${handle} wasn't found`;
  }
  storeImportedReconciliation(reconciliationText);
}

async function importExistingReconciliations(page = 1) {
  const response = await SF.fetchReconciliationTexts(page);
  const reconciliationsArray = response.data;
  if (reconciliationsArray.length == 0) {
    if (page == 1) {
      console.log("No reconciliations found");
    }
    return;
  }
  reconciliationsArray.forEach(async (reconciliation) => {
    storeImportedReconciliation(reconciliation);
  });
  importExistingReconciliations(page + 1);
}

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

async function persistReconciliationText(handle) {
  try {
    const relativePath = `./reconciliation_texts/${handle}`;
    const config = fsUtils.readConfig(relativePath);
    let reconciliationTextId;
    if (config && config.id) {
      reconciliationTextId = config.id;
      console.log("Loaded from config");
    } else {
      reconciliationTextId = { ...(await SF.findReconciliationText(handle)) }
        .id;
    }
    if (!reconciliationTextId) {
      throw "Reconciliation not found";
    }
    SF.updateReconciliationText(reconciliationTextId, {
      ...constructReconciliationText(handle),
      version_comment: "Update published using the API",
    });
  } catch (error) {
    errorHandler(error);
  }
}

async function importExistingSharedPartById(id) {
  const sharedPart = await SF.fetchSharedPartById(id);

  if (!sharedPart) {
    throw `Shared part ${id} wasn't found.`;
  }

  const relativePath = `./shared_parts/${sharedPart.data.name}`;

  fsUtils.createFolder(`./shared_parts`);
  fsUtils.createFolder(relativePath);

  fsUtils.createLiquidFile(
    relativePath,
    sharedPart.data.name,
    sharedPart.data.text
  );

  config = {
    id: sharedPart.data.id,
    name: sharedPart.data.name,
    text: "main.liquid",
    used_in: sharedPart.data.used_in,
  };

  fsUtils.writeConfig(relativePath, config);
}

async function importExistingSharedPartByName(name) {
  const sharedPartByName = await SF.findSharedPart(name);
  if (!sharedPartByName) {
    throw `Shared part with name ${name} wasn't found.`;
  }
  importExistingSharedPartById(sharedPartByName.id);
}

async function importExistingSharedParts(page = 1) {
  const response = await SF.fetchSharedParts(page);
  const sharedParts = response.data;
  if (sharedParts.length == 0) {
    if (page == 1) {
      console.log(`No shared parts found`);
    }
    return;
  }
  sharedParts.forEach(async (sharedPart) => {
    await importExistingSharedPartById(sharedPart.id);
  });
  importExistingSharedParts(page + 1);
}

async function persistSharedPart(name) {
  try {
    const relativePath = `./shared_parts/${name}`;
    const config = fsUtils.readConfig(relativePath);
    const attributes = {};
    attributes.text = fs.readFileSync(
      `${relativePath}/${name}.liquid`,
      "utf-8"
    );
    SF.updateSharedPart(config.id, {
      ...attributes,
      version_comment: "Testing Cli",
    });
  } catch (error) {
    errorHandler(error);
  }
}

/* This will overwrite existing shared parts in reconcilation's config file */
/* Look in each shared part if it is used in the provided reconciliation */
function refreshSharedPartsUsed(handle) {
  try {
    const relativePath = `./reconciliation_texts/${handle}`;
    const configReconciliation = fsUtils.readConfig(relativePath);
    configReconciliation.shared_parts = [];
    fs.readdir(`./shared_parts`, (error, allSharedParts) => {
      if (error) throw error;
      for (sharedPartDir of allSharedParts) {
        let sharedPartPath = `./shared_parts/${sharedPartDir}`;
        let dir = fs.statSync(sharedPartPath, () => {});
        if (dir.isDirectory()) {
          let configSharedPart = fsUtils.readConfig(sharedPartPath);
          configSharedPart.used_in.find((template, index) => {
            if (template.id == configReconciliation.id) {
              configReconciliation.shared_parts.push({
                id: configSharedPart.id,
                name: sharedPartDir,
              });
              console.log(
                `Shared part ${sharedPartDir} used in reconciliation ${handle}:`
              );
              return true;
            }
          });
        }
      }
      fsUtils.writeConfig(relativePath, configReconciliation);
    });
  } catch (error) {
    errorHandler(error);
  }
}

async function addSharedPartToReconciliation(
  sharedPartHandle,
  reconciliationHandle
) {
  try {
    const relativePathReconciliation = `./reconciliation_texts/${reconciliationHandle}`;
    const configReconciliation = fsUtils.readConfig(relativePathReconciliation);
    configReconciliation.shared_parts = configReconciliation.shared_parts || [];

    const relativePathSharedPart = `./shared_parts/${sharedPartHandle}`;
    const configSharedPart = fsUtils.readConfig(relativePathSharedPart);

    const response = await SF.addSharedPart(
      configSharedPart.id,
      configReconciliation.id
    );

    if (response.status === 201) {
      console.log(
        `Shared part "${sharedPartHandle}" added to "${reconciliationHandle}" reconciliation text.`
      );
    }

    const sharedPartIndex = configReconciliation.shared_parts.findIndex(
      (sharedPart) => sharedPart.id === configSharedPart.id
    );

    if (sharedPartIndex === -1) {
      configReconciliation.shared_parts.push({
        id: configSharedPart.id,
        name: sharedPartHandle,
      });
      fsUtils.writeConfig(relativePathReconciliation, configReconciliation);
    }

    const reconciliationIndex = configSharedPart.used_in.findIndex(
      (reconciliationText) => reconciliationText.id === configReconciliation.id
    );

    if (reconciliationIndex === -1) {
      configSharedPart.used_in.push({
        id: configReconciliation.id,
        type: "reconciliation",
      });
      fsUtils.writeConfig(relativePathSharedPart, configSharedPart);
    }
  } catch (error) {
    errorHandler(error);
  }
}

async function removeSharedPartFromReconciliation(
  sharedPartHandle,
  reconciliationHandle
) {
  try {
    const relativePathReconciliation = `./reconciliation_texts/${reconciliationHandle}`;
    const configReconciliation = fsUtils.readConfig(relativePathReconciliation);
    configReconciliation.shared_parts = configReconciliation.shared_parts || [];

    const relativePathSharedPart = `./shared_parts/${sharedPartHandle}`;
    const configSharedPart = fsUtils.readConfig(relativePathSharedPart);

    const response = await SF.removeSharedPart(
      configSharedPart.id,
      configReconciliation.id
    );
    if (response.status === 200) {
      console.log(
        `Shared part "${sharedPartHandle}" removed from "${reconciliationHandle}" reconciliation text.`
      );
    }

    const sharedPartIndex = configReconciliation.shared_parts.findIndex(
      (sharedPart) => sharedPart.id === configSharedPart.id
    );
    if (sharedPartIndex !== -1) {
      configReconciliation.shared_parts.splice(sharedPartIndex, 1);
      fsUtils.writeConfig(relativePathReconciliation, configReconciliation);
    }

    const reconciliationIndex = configSharedPart.used_in.findIndex(
      (reconciliationText) => reconciliationText.id === configReconciliation.id
    );
    if (reconciliationIndex !== -1) {
      configSharedPart.used_in.splice(reconciliationIndex, 1);
      fsUtils.writeConfig(relativePathSharedPart, configSharedPart);
    }
  } catch (error) {
    errorHandler(error);
  }
}

async function runTests(handle) {
  try {
    const relativePath = `./reconciliation_texts/${handle}`;
    const config = fsUtils.readConfig(relativePath);
    const testPath = `${relativePath}/${config.test}`;
    const testContent = fs.readFileSync(testPath, "utf-8");
    const templateContent = constructReconciliationText(handle);
    templateContent.handle = handle;
    templateContent.reconciliation_type = config.reconciliation_type;
    const sharedParts = fsUtils.getSharedParts(handle);
    if (sharedParts.length !== 0) {
      templateContent.text_shared_parts = [];
      for (sharedPart of sharedParts) {
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

    const testRunResponse = await SF.createTestRun(testParams);
    const testRunId = testRunResponse.data;

    let testRun = { status: "started" };
    const pollingDelay = 2000;

    spinner.spin("Running tests..");
    while (testRun.status === "started") {
      await new Promise((resolve) => {
        setTimeout(resolve, pollingDelay);
      });
      const response = await SF.fetchTestRun(testRunId);
      testRun = response.data;
    }
    spinner.stop();

    // Possible status: started, completed, test_error, internal_error
    if (testRun.status === "internal_error") {
      console.log(
        "Internal error. Try to run the test again or contact support if the issue persists."
      );
    }

    if (testRun.status === "test_error") {
      console.log("Ran into an error an couldn't complete test run");
      console.log(chalk.red(testRun.error_message));
    }

    if (testRun.status === "completed") {
      if (testRun.result.length === 0) {
        console.log(chalk.green("ALL TESTS HAVE PASSED"));
      } else {
        // Test run successfully but return errors
        spinner.spin("Processing test results..");
        spinner.stop();
        const formattedTests = [];

        testRun.result.map((test) => {
          const name = test.test;
          const type = test.result.split(".")[0];
          const outcome = test.got;
          const expected = test.expected;
          const lineNumber = test.line_number;

          const emptyTestExpectations = {
            name,
            reconciled: {},
            results: [],
            rollforwards: [],
          };

          const existingItemIndex = formattedTests.findIndex(
            (item) => item.name === name
          );
          const existingItem =
            formattedTests[existingItemIndex] || emptyTestExpectations;

          const testOutput = {
            lineNumber,
            expected,
            outcome,
          };

          const testExpectations = {
            name,
            reconciled: { ...existingItem.reconciled },
            results: [...existingItem.results],
            rollforwards: [...existingItem.rollforwards],
          };

          switch (type) {
            case "reconciled":
              testExpectations.reconciled = testOutput;
              break;
            case "results":
              const resultName = test.result.split(".")[1];
              testOutput.resultName = resultName;
              testExpectations.results.push(testOutput);
              break;
            case "rollforward":
              const rollforwardName = test.result.split(".").slice(1);
              testOutput.rollforwardName = rollforwardName;
              testExpectations.rollforwards.push(testOutput);
              break;
          }

          if (existingItemIndex !== -1) {
            formattedTests[existingItemIndex] = testExpectations;
          } else {
            formattedTests.push(testExpectations);
          }
        });

        spinner.clear();
        console.log("");

        console.error(
          chalk.red(
            `${formattedTests.length} TEST${
              formattedTests.length > 1 ? "S" : ""
            } FAILED`
          )
        );

        formattedTests.forEach((test) => {
          console.log(
            "---------------------------------------------------------------"
          );
          console.log(chalk.bold(test.name));

          // Display success messages of test
          if (Object.keys(test.reconciled).length === 0) {
            console.log(chalk.green("Reconciliation expectation passed"));
          }

          if (test.results.length === 0) {
            console.log(chalk.green("All result expectations passed"));
          }

          if (test.rollforwards.length === 0) {
            console.log(chalk.green("All rollforward expectations passed"));
          }

          // Display error messages of test
          if (Object.keys(test.reconciled).length > 0) {
            console.log(chalk.red("Reconciliation expectation failed"));
            console.log(`At line number ${test.reconciled.lineNumber}`);
            console.log(
              `got ${chalk.blue.bold(
                test.reconciled.outcome
              )} but expected ${chalk.blue.bold(test.reconciled.expected)}`
            );
            console.log("");
          }

          if (test.results.length > 0) {
            console.log(
              chalk.red(
                `${test.results.length} result expectation${
                  test.results.length > 1 ? "s" : ""
                } failed`
              )
            );
            test.results.forEach((expectation) => {
              console.log(`At line number ${expectation.lineNumber}`);
              console.log(
                `For result ${chalk.blue.bold(
                  expectation.resultName
                )} got ${chalk.blue.bold(expectation.outcome)} (${chalk.italic(
                  typeof expectation.outcome
                )}) but expected ${chalk.blue.bold(
                  expectation.expected
                )} (${chalk.italic(typeof expectation.expected)})`
              );
            });
            console.log("");
          }

          if (test.rollforwards.length > 0) {
            console.log(
              chalk.red(
                `${test.rollforwards.length} rollforward expectation${
                  test.rollforwards.length > 1 ? "s" : ""
                } failed`
              )
            );
            test.rollforwards.forEach((expectation) => {
              console.log(`At line number ${expectation.lineNumber}`);
              console.log(
                `For rollforward ${chalk.blue.bold(
                  expectation.rollforwardName
                )} got ${chalk.blue.bold(expectation.outcome)} (${chalk.italic(
                  typeof expectation.outcome
                )}) but expected ${chalk.blue.bold(
                  expectation.expected
                )} (${chalk.italic(typeof expectation.expected)})`
              );
            });
            console.log("");
          }
        });
      }
    }
  } catch (error) {
    errorHandler(error);
  }
}

function authorize() {
  SF.authorizeApp();
}

module.exports = {
  importExistingReconciliationByHandle,
  importExistingReconciliations,
  persistReconciliationText,
  importExistingSharedPartByName,
  importExistingSharedParts,
  persistSharedPart,
  refreshSharedPartsUsed,
  addSharedPartToReconciliation,
  removeSharedPartFromReconciliation,
  runTests,
  authorize,
  uncaughtErrors,
};
