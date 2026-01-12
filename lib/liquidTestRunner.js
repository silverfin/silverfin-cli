const yaml = require("yaml");
const fs = require("fs");
const chalk = require("chalk");
const errorUtils = require("./utils/errorUtils");
const { spinner } = require("./cli/spinner");
const SF = require("./api/sfApi");
const fsUtils = require("./utils/fsUtils");
const runTestUtils = require("./utils/runTestUtils");
const { consola } = require("consola");
const { UrlHandler } = require("./utils/urlHandler");

const { ReconciliationText } = require("./templates/reconciliationText");
const { AccountTemplate } = require("./templates/accountTemplate");

function findTestRows(testContent) {
  const options = { maxAliasCount: 10000 };
  const testYAML = yaml.parse(testContent, options);

  const testNames = Object.keys(testYAML);
  const testRows = testContent.split("\n");
  const indexes = {};
  testNames.forEach((testName) => {
    const index = testRows.findIndex((element) => element.includes(testName));
    indexes[testName] = index;
  });
  return indexes;
}

function filterTestsByPattern(testContent, pattern, testIndexes) {
  const indexes = testIndexes || findTestRows(testContent);
  const matchingTests = Object.keys(indexes).filter((testName) => testName.includes(pattern));

  if (matchingTests.length === 0) {
    return { filteredContent: "", matchingTests: [], lineAdjustments: {} };
  }

  const testRows = testContent.split("\n");

  const orderedTests = Object.entries(indexes)
    .map(([name, index]) => ({ name, index }))
    .sort((a, b) => a.index - b.index);

  const matchingSet = new Set(matchingTests);
  const segments = [];

  orderedTests.forEach((test, idx) => {
    if (!matchingSet.has(test.name)) {
      return;
    }

    let start = test.index;

    while (start > 0) {
      const previousLine = testRows[start - 1];
      const trimmedPrevious = previousLine.trim();
      if (trimmedPrevious === "" || trimmedPrevious.startsWith("#")) {
        start -= 1;
      } else {
        break;
      }
    }

    let end = testRows.length;
    for (let nextIdx = idx + 1; nextIdx < orderedTests.length; nextIdx++) {
      const nextTest = orderedTests[nextIdx];
      if (nextTest.index > test.index) {
        end = nextTest.index;
        break;
      }
    }

    const segment = testRows.slice(start, end).join("\n").trimEnd();
    segments.push(segment);
  });

  const filteredContent = segments.join("\n\n").trim();
  const orderedMatchingTests = orderedTests.filter((test) => matchingSet.has(test.name)).map((test) => test.name);

  const lineAdjustments = {};
  if (filteredContent) {
    const filteredIndexes = findTestRows(filteredContent);
    orderedMatchingTests.forEach((testName) => {
      const originalIndex = indexes[testName];
      const filteredIndex = filteredIndexes[testName];
      if (typeof originalIndex === "number" && typeof filteredIndex === "number") {
        lineAdjustments[testName] = originalIndex - filteredIndex;
      }
    });
  }

  return {
    filteredContent,
    matchingTests: orderedMatchingTests,
    lineAdjustments,
  };
}

function buildTestParams(firmId, templateType, handle, testName = "", renderMode, pattern = "") {
  let relativePath = `./reconciliation_texts/${handle}`;

  if (templateType === "accountTemplate") {
    relativePath = `./account_templates/${handle}`;
  }

  const configPresent = fsUtils.configExists(templateType, handle);

  if (!configPresent) {
    consola.error(`Config file for "${handle}" not found`);

    return;
  }

  const config = fsUtils.readConfig(templateType, handle);
  const testPath = `${relativePath}/${config.test}`;

  if (!fs.existsSync(testPath)) {
    consola.error(`Test file for "${handle}" not found`);

    return;
  }

  const testContent = fs.readFileSync(testPath, "utf-8").trim();

  // Empty YAML check
  if (testContent.split("\n").length <= 1) {
    consola.info(`${handle}: there are no tests stored in the YAML file`);
    return false;
  }

  const testIndexes = findTestRows(testContent);

  let finalTests = testContent;
  let lineAdjustments = {};

  if (pattern) {
    const { filteredContent, matchingTests, lineAdjustments: patternLineAdjustments } = filterTestsByPattern(testContent, pattern, testIndexes);

    if (!matchingTests.length) {
      consola.error(`No tests found containing "${pattern}" in their name`);
      process.exit(1);
    }

    finalTests = filteredContent;
    lineAdjustments = patternLineAdjustments;
    consola.info(`Running ${matchingTests.length} test${matchingTests.length === 1 ? "" : "s"} matching pattern "${pattern}":`);
    matchingTests.forEach((testName) => {
      consola.log(`  • ${testName}`);
    });
  }

  let templateContent;

  if (templateType === "accountTemplate") {
    templateContent = AccountTemplate.read(handle);
  } else {
    templateContent = ReconciliationText.read(handle);
    templateContent.handle = handle;
    templateContent.reconciliation_type = config.reconciliation_type;
  }

  const sharedParts = fsUtils.listSharedPartsUsedInTemplate(firmId, templateType, handle);

  if (sharedParts.length !== 0) {
    templateContent.text_shared_parts = [];
    for (const sharedPart of sharedParts) {
      const sharedPartContent = fs.readFileSync(`shared_parts/${sharedPart}/${sharedPart}.liquid`, "utf-8");
      templateContent.text_shared_parts.push({
        name: sharedPart,
        content: sharedPartContent,
      });
    }
  }

  const testParams = {
    template: templateContent,
    tests: finalTests,
    mode: renderMode,
  };

  // Include only one test
  if (testName) {
    if (!Object.keys(testIndexes).includes(testName)) {
      consola.error(`Test ${testName} not found in YAML`);
      process.exit(1);
    }
    testParams.test_line = testIndexes[testName] + 1;
  }
  return { testParams, metadata: { lineAdjustments } };
}

async function fetchResult(firmId, testRunId, templateType) {
  let testRun = { status: "started" };
  let pollingDelay = 1000;
  const waitingLimit = 500000;

  spinner.spin("Running tests..");
  let waitingTime = 0;
  while (testRun.status === "started") {
    await new Promise((resolve) => {
      setTimeout(resolve, pollingDelay);
    });
    const response = await SF.readTestRun(firmId, testRunId, templateType);
    testRun = response.data;
    waitingTime += pollingDelay;
    pollingDelay *= 1.05;
    if (waitingTime >= waitingLimit) {
      spinner.stop();
      consola.error("Timeout. Try to run your test again");
      break;
    }
  }
  spinner.stop();
  return testRun;
}

function listErrors(items, type, lineAdjustment = 0) {
  const itemsKeys = Object.keys(items);
  consola.log(chalk.red(`${itemsKeys.length} ${type} expectation${itemsKeys.length > 1 ? "s" : ""} failed`));
  itemsKeys.forEach((itemName) => {
    const itemDetails = items[itemName];
    if (typeof itemDetails.line_number === "number") {
      consola.log(`At line number ${itemDetails.line_number + lineAdjustment}`);
    }
    let gotDataType = typeof itemDetails.got;
    let expectedDataType = typeof itemDetails.expected;
    let displayedGot = itemDetails.got;
    let displayedExpected = itemDetails.expected;

    // If the type is an object, check if it's an array or an object
    if (gotDataType === "object") {
      if (Array.isArray(itemDetails.got)) {
        gotDataType = "array";
      } else if (!itemDetails.got) {
        gotDataType = "null";
      } else {
        gotDataType = "object";

        // If the received got is an object, split it into lines
        displayedGot = "\n";

        for (const key in itemDetails.got) {
          displayedGot += `${key}: ${itemDetails.got[key]}\n`;
        }

        displayedExpected = JSON.stringify(itemDetails.expected, null, 2);
      }
    }

    if (itemDetails.got === "nothing") {
      gotDataType = "blank";
    }

    if (itemDetails.expected === "nothing") {
      expectedDataType = "blank";
    } else if (!itemDetails.expected) {
      expectedDataType = "null";
    }

    consola.log(
      `For ${type} ${chalk.blue.bold(itemName)} got ${chalk.blue.bold(displayedGot)} (${chalk.italic(gotDataType)}) but expected ${chalk.blue.bold(
        displayedExpected
      )} (${chalk.italic(expectedDataType)})`
    );
  });
  consola.log("");
}

// Find at least one error in the all tests
function checkAllTestsErrorsPresent(testsFeedback) {
  let errorsPresent = false;
  const testNames = Object.keys(testsFeedback);
  for (const testName of testNames) {
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
  const testSections = Object.keys(testsFeedback[testName]);
  // Look for reconciled, results or rollforwards
  // We could have only html for successful tests
  // If the reconciled is null and the results + rollforwards are empty objects, no errors are present
  for (const section of testSections) {
    if (SECTIONS.includes(section)) {
      const sectionElement = testsFeedback[testName][section];

      if (section === "reconciled" && sectionElement !== null) {
        errorsPresent = true;
        break;
      } else if ((section === "results" || section === "rollforwards") && Object.keys(sectionElement).length > 0) {
        errorsPresent = true;
        break;
      }
    }
  }
  return errorsPresent;
}

function processTestRunResponse(testRun, previewOnly, lineAdjustments = {}) {
  // Possible status: started, completed, test_error, internal_error
  let errorsPresent;
  switch (testRun.status) {
    case "internal_error":
      consola.error("Internal error. Try to run the test again or contact support if the issue persists.");
      break;
    case "test_error":
      consola.error("Ran into an error an couldn't complete test run");
      consola.log(chalk.red(testRun.error_message));
      break;
    case "completed":
      errorsPresent = checkAllTestsErrorsPresent(testRun.tests);
      if (errorsPresent === false) {
        if (previewOnly) {
          consola.success(chalk.green("SUCCESSFULLY RENDERED HTML (SKIPPED TESTS)"));
        } else {
          consola.success(chalk.green("ALL TESTS HAVE PASSED"));
        }
      } else {
        consola.log("");
        consola.log(chalk.red(`${Object.keys(testRun.tests).length} TEST${Object.keys(testRun.tests).length > 1 ? "S" : ""} FAILED`));

        const tests = Object.keys(testRun.tests).sort();
        tests.forEach((testName) => {
          const testErrorsPresent = checkTestErrorsPresent(testName, testRun.tests);
          // No errors in this test
          if (!testErrorsPresent) {
            return;
          }
          consola.log("---------------------------------------------------------------");
          consola.log(chalk.bold(testName));

          const testElements = testRun.tests[testName];
          const lineAdjustment = lineAdjustments[testName] || 0;

          // Display success messages of test
          if (testElements.reconciled === null) {
            consola.success(chalk.green("Reconciliation expectation passed"));
          }

          if (Object.keys(testElements.results).length === 0) {
            consola.success(chalk.green("All result expectations passed"));
          }

          if (Object.keys(testElements.rollforwards).length === 0) {
            consola.success(chalk.green("All rollforward expectations passed"));
          }

          // Display error messages of test

          // Reconciled
          if (testElements.reconciled !== null) {
            consola.log(chalk.red("Reconciliation expectation failed"));
            if (typeof testElements.reconciled.line_number === "number") {
              consola.log(`At line number ${testElements.reconciled.line_number + lineAdjustment}`);
            }
            consola.log(`got ${chalk.blue.bold(testElements.reconciled.got)} but expected ${chalk.blue.bold(testElements.reconciled.expected)}`);
            consola.log("");
          }

          // Results
          if (Object.keys(testElements.results).length > 0) {
            listErrors(testElements.results, "result", lineAdjustment);
          }

          // Rollforwards
          if (Object.keys(testElements.rollforwards).length > 0) {
            listErrors(testElements.rollforwards, "rollforward", lineAdjustment);
          }
        });
        break;
      }
  }
}

// Retrieve HTML and open it in the default browser if needed
async function getHTML(url, testName, openBrowser = false, htmlMode) {
  if (openBrowser) {
    const filename = `${testName}_${htmlMode}`;
    await new UrlHandler(url, filename).openFile();
  }
}

async function getHTMLrenders(renderMode, testName, testRun, openBrowser) {
  const htmlModes = {
    all: ["html_input", "html_preview"],
    input: ["html_input"],
    preview: ["html_preview"],
  };
  const htmlModesToRender = htmlModes[renderMode];
  for (const htmlMode of htmlModesToRender) {
    await getHTML(testRun.tests[testName][htmlMode], testName, openBrowser, htmlMode);
  }
}

async function handleHTMLfiles(testName = "", testRun, renderMode) {
  if (testName) {
    // Only one test
    getHTMLrenders(renderMode, testName, testRun, true);
  } else {
    // All tests
    const testNames = Object.keys(testRun.tests);
    testNames.forEach(async (testName) => {
      getHTMLrenders(renderMode, testName, testRun, true);
    });
  }
}

// Used by VSCode Extension
async function runTests(firmId, templateType, handle, testName = "", previewOnly = false, renderMode = "none", pattern = "") {
  try {
    if (templateType !== "reconciliationText" && templateType !== "accountTemplate") {
      consola.error(`Template type is missing or invalid`);
      process.exit(1);
    }

    const buildResult = buildTestParams(firmId, templateType, handle, testName, renderMode, pattern);

    if (!buildResult) return;

    const { testParams, metadata } = buildResult;

    let testRun = null;
    let previewRun = null;

    if (renderMode !== "none") {
      const previewRunResponse = await SF.createPreviewRun(firmId, testParams, templateType);
      const previewRunId = previewRunResponse.data;
      previewRun = await fetchResult(firmId, previewRunId, templateType);
    }

    if (!previewOnly) {
      const testRunResponse = await SF.createTestRun(firmId, testParams, templateType);

      const testRunId = testRunResponse.data;
      testRun = await fetchResult(firmId, testRunId, templateType);
    }

    return { testRun, previewRun, metadata };
  } catch (error) {
    errorUtils.errorHandler(error);
  }
}

async function runTestsWithOutput(firmId, templateType, handle, testName = "", previewOnly = false, htmlInput = false, htmlPreview = false, pattern = "") {
  try {
    if (templateType !== "reconciliationText" && templateType !== "accountTemplate") {
      consola.error(`Template type is missing or invalid`);
      process.exit(1);
    }

    const renderMode = runTestUtils.checkRenderMode(htmlInput, htmlPreview);
    const testsRun = await runTests(firmId, templateType, handle, testName, previewOnly, renderMode, pattern);
    if (!testsRun) return;

    processTestRunResponse(testsRun?.testRun || testsRun?.previewRun, previewOnly, testsRun?.metadata?.lineAdjustments || {});

    if (testsRun.previewRun && testsRun.previewRun.status !== "test_error" && renderMode !== "none") {
      handleHTMLfiles(testName, testsRun.previewRun, renderMode);
    }
  } catch (error) {
    errorUtils.errorHandler(error);
  }
}

// RETURN (AND LOG) ONLY PASSED OR FAILED
// CAN BE USED BY GITHUB ACTIONS
async function runTestsStatusOnly(firmId, templateType, handles, testName = "", pattern = "") {
  if (templateType !== "reconciliationText" && templateType !== "accountTemplate") {
    consola.error(`Template type is missing or invalid`);
    process.exit(1);
  }

  const runSingleHandle = async (singleHandle) => {
    let status = "FAILED";
    const failedTestNames = [];
    const testResult = await runTests(firmId, templateType, singleHandle, testName, false, "none", pattern);

    if (!testResult) {
      status = "FAILED";
      consola.error(`Error running tests for ${singleHandle}`);
    } else {
      const testRun = testResult?.testRun;

      if (testRun && testRun?.status === "completed") {
        const errorsPresent = checkAllTestsErrorsPresent(testRun.tests);
        if (errorsPresent === false) {
          status = "PASSED";
        } else {
          // Extract failed test names
          const testNames = Object.keys(testRun.tests).sort();
          testNames.forEach((testName) => {
            const testErrorsPresent = checkTestErrorsPresent(testName, testRun.tests);
            if (testErrorsPresent) {
              failedTestNames.push(testName);
            }
          });
        }
      }
    }

    if (status === "PASSED") {
      consola.log(`${singleHandle}: ${status}`);
    } else {
      consola.log(`${singleHandle}: ${status}`);
      // Display failed test names
      failedTestNames.forEach((testName) => {
        consola.log(`  ${testName}: FAILED`);
      });
    }

    return { handle: singleHandle, status, failedTestNames };
  };

  const results = await Promise.all(handles.map(runSingleHandle));

  const overallStatus = results.every((result) => result.status === "PASSED") ? "PASSED" : "FAILED";

  return overallStatus;
}

module.exports = {
  runTests,
  runTestsWithOutput,
  runTestsStatusOnly,
  getHTML,
  checkAllTestsErrorsPresent,
};
