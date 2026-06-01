const fs = require("fs");
const path = require("path");

jest.mock("consola");
jest.mock("../../lib/api/sfApi");
jest.mock("../../lib/cli/spinner", () => ({ spinner: { spin: jest.fn(), stop: jest.fn() } }));
jest.mock("../../lib/utils/errorUtils", () => ({
  errorHandler: jest.fn(),
}));
jest.mock("../../lib/utils/urlHandler", () => ({
  UrlHandler: jest.fn().mockImplementation(() => ({ openFile: jest.fn().mockResolvedValue(undefined) })),
}));
jest.mock("../../lib/utils/fsUtils");
jest.mock("../../lib/utils/runTestUtils", () => ({
  checkRenderMode: jest.fn().mockReturnValue("none"),
}));
jest.mock("../../lib/templates/reconciliationText");
jest.mock("../../lib/templates/accountTemplate");

const SF = require("../../lib/api/sfApi");
const { consola } = require("consola");
const fsUtils = require("../../lib/utils/fsUtils");
const { ReconciliationText } = require("../../lib/templates/reconciliationText");
const { AccountTemplate } = require("../../lib/templates/accountTemplate");
const { UrlHandler } = require("../../lib/utils/urlHandler");

const { runTests, runTestsWithOutput, runTestsStatusOnly, getHTML, checkAllTestsErrorsPresent } = require("../../lib/liquidTestRunner");

// ─── Helpers ───────────────────────────────────────────────────────────────

const SIMPLE_YAML = [
  "test_basic:",
  "  name: Basic test",
  "  context: period",
  "  data:",
  "    period:",
  "      accounts:",
  '        "100":',
  "          value: 1000",
  "  expectation: |",
  "    Balance: 1,000.00",
].join("\n");

function makeTestRun(status, tests = {}) {
  return { status, tests };
}

function makePassedTests() {
  return {
    test_basic: { reconciled: null, results: {}, rollforwards: {}, html_input: "http://example.com/input", html_preview: "http://example.com/preview" },
  };
}

function makeFailedTests() {
  return {
    test_basic: {
      reconciled: { got: false, expected: true, line_number: 5 },
      results: {},
      rollforwards: {},
    },
  };
}

function setupFsUtilsMocks(handle = "reconciliation_text_1") {
  fsUtils.configExists.mockReturnValue(true);
  fsUtils.readConfig.mockReturnValue({
    test: `tests/${handle}_liquid_test.yml`,
    reconciliation_type: "can_be_reconciled_without_data",
    id: { 1001: 8801 },
  });
  fsUtils.listSharedPartsUsedInTemplate.mockReturnValue([]);
}

// ─── checkAllTestsErrorsPresent ────────────────────────────────────────────

describe("checkAllTestsErrorsPresent", () => {
  it("should return false when all tests pass (reconciled null, empty results/rollforwards)", () => {
    const testsFeedback = makePassedTests();
    expect(checkAllTestsErrorsPresent(testsFeedback)).toBe(false);
  });

  it("should return true when reconciled is not null", () => {
    const testsFeedback = {
      test_basic: { reconciled: { got: false, expected: true }, results: {}, rollforwards: {} },
    };
    expect(checkAllTestsErrorsPresent(testsFeedback)).toBe(true);
  });

  it("should return true when results has entries", () => {
    const testsFeedback = {
      test_basic: { reconciled: null, results: { some_result: { got: 1, expected: 2 } }, rollforwards: {} },
    };
    expect(checkAllTestsErrorsPresent(testsFeedback)).toBe(true);
  });

  it("should return true when rollforwards has entries", () => {
    const testsFeedback = {
      test_basic: { reconciled: null, results: {}, rollforwards: { some_rollforward: { got: 1, expected: 2 } } },
    };
    expect(checkAllTestsErrorsPresent(testsFeedback)).toBe(true);
  });

  it("should return false for empty tests object", () => {
    expect(checkAllTestsErrorsPresent({})).toBe(false);
  });

  it("should return true as soon as one test has an error even if others pass", () => {
    const testsFeedback = {
      test_pass: { reconciled: null, results: {}, rollforwards: {} },
      test_fail: { reconciled: { got: false, expected: true }, results: {}, rollforwards: {} },
    };
    expect(checkAllTestsErrorsPresent(testsFeedback)).toBe(true);
  });
});

// ─── getHTML ────────────────────────────────────────────────────────────────

describe("getHTML", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("should call UrlHandler.openFile when openBrowser is true", async () => {
    const mockInstance = { openFile: jest.fn().mockResolvedValue(undefined) };
    UrlHandler.mockImplementationOnce(() => mockInstance);

    await getHTML("http://example.com/html", "test_name", true, "html_preview");

    expect(UrlHandler).toHaveBeenCalledWith("http://example.com/html", "test_name_html_preview");
    expect(mockInstance.openFile).toHaveBeenCalled();
  });

  it("should NOT call UrlHandler when openBrowser is false", async () => {
    UrlHandler.mockClear();

    await getHTML("http://example.com/html", "test_name", false, "html_preview");

    expect(UrlHandler).not.toHaveBeenCalled();
  });
});

// ─── runTests ────────────────────────────────────────────────────────────────

describe("runTests", () => {
  let tempDir;
  let originalCwd;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();

    tempDir = fs.mkdtempSync(path.join(require("os").tmpdir(), "lt-test-"));
    originalCwd = process.cwd();
    process.chdir(tempDir);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    fs.rmSync(tempDir, { recursive: true, force: true });
    jest.useRealTimers();
  });

  it("should exit with error for invalid templateType", async () => {
    const mockExit = jest.spyOn(process, "exit").mockImplementation(() => {});
    await runTests(1001, "invalidType", "some_handle");
    expect(consola.error).toHaveBeenCalledWith("Template type is missing or invalid");
    expect(mockExit).toHaveBeenCalledWith(1);
    mockExit.mockRestore();
  });

  it("should return undefined when config is missing", async () => {
    fsUtils.configExists.mockReturnValue(false);

    const result = await runTests(1001, "reconciliationText", "missing_handle");

    expect(result).toBeUndefined();
    expect(consola.error).toHaveBeenCalledWith(expect.stringContaining("missing_handle"));
  });

  it("should return undefined when YAML test file does not exist", async () => {
    setupFsUtilsMocks("reconciliation_text_1");

    const result = await runTests(1001, "reconciliationText", "reconciliation_text_1");

    expect(result).toBeUndefined();
    expect(consola.error).toHaveBeenCalledWith(expect.stringContaining("not found"));
  });

  it("should run tests and return testRun result when YAML exists and API responds", async () => {
    const handle = "reconciliation_text_1";
    setupFsUtilsMocks(handle);

    // Write a minimal YAML test file
    const testDir = path.join(tempDir, "reconciliation_texts", handle, "tests");
    fs.mkdirSync(testDir, { recursive: true });
    fs.writeFileSync(path.join(testDir, `${handle}_liquid_test.yml`), SIMPLE_YAML);

    // Mock ReconciliationText.read
    ReconciliationText.read.mockReturnValue({
      handle,
      text: "{% assign x = 1 %}",
      text_parts: [],
    });

    // Mock SF API calls
    const testRunId = 42;
    SF.createTestRun = jest.fn().mockResolvedValue({ data: testRunId });
    SF.readTestRun = jest.fn().mockResolvedValue({
      data: makeTestRun("completed", makePassedTests()),
    });

    const promise = runTests(1001, "reconciliationText", handle, "", false, "none");
    await jest.runAllTimersAsync();
    const result = await promise;

    expect(SF.createTestRun).toHaveBeenCalled();
    expect(SF.readTestRun).toHaveBeenCalledWith(1001, testRunId, "reconciliationText");
    expect(result.testRun.status).toBe("completed");
    expect(result.testRun.tests).toEqual(makePassedTests());
  });

  it("should log info and return false when YAML file is empty (single line)", async () => {
    const handle = "reconciliation_text_1";
    setupFsUtilsMocks(handle);

    const testDir = path.join(tempDir, "reconciliation_texts", handle, "tests");
    fs.mkdirSync(testDir, { recursive: true });
    fs.writeFileSync(path.join(testDir, `${handle}_liquid_test.yml`), "# empty");

    const result = await runTests(1001, "reconciliationText", handle);

    expect(result).toBeUndefined();
    expect(consola.info).toHaveBeenCalledWith(expect.stringContaining("no tests stored"));
  });

  it("should run tests for accountTemplate type", async () => {
    const handle = "account_1";
    fsUtils.configExists.mockReturnValue(true);
    fsUtils.readConfig.mockReturnValue({
      test: `tests/${handle}_liquid_test.yml`,
      id: { 1001: 1101 },
    });
    fsUtils.listSharedPartsUsedInTemplate.mockReturnValue([]);

    const testDir = path.join(tempDir, "account_templates", handle, "tests");
    fs.mkdirSync(testDir, { recursive: true });
    fs.writeFileSync(path.join(testDir, `${handle}_liquid_test.yml`), SIMPLE_YAML);

    AccountTemplate.read.mockReturnValue({ name_nl: handle, text: "liquid" });

    const testRunId = 55;
    SF.createTestRun = jest.fn().mockResolvedValue({ data: testRunId });
    SF.readTestRun = jest.fn().mockResolvedValue({
      data: makeTestRun("completed", makePassedTests()),
    });

    const promise = runTests(1001, "accountTemplate", handle, "", false, "none");
    await jest.runAllTimersAsync();
    const result = await promise;

    expect(result.testRun.status).toBe("completed");
  });
});

// ─── runTestsWithOutput ────────────────────────────────────────────────────

describe("runTestsWithOutput", () => {
  let tempDir;
  let originalCwd;
  let mockExit;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    tempDir = fs.mkdtempSync(path.join(require("os").tmpdir(), "lt-output-test-"));
    originalCwd = process.cwd();
    process.chdir(tempDir);
    mockExit = jest.spyOn(process, "exit").mockImplementation(() => {});
  });

  afterEach(() => {
    process.chdir(originalCwd);
    fs.rmSync(tempDir, { recursive: true, force: true });
    mockExit.mockRestore();
    jest.useRealTimers();
  });

  it("should exit with error for invalid templateType", async () => {
    await runTestsWithOutput(1001, "invalidType", "some_handle");
    expect(consola.error).toHaveBeenCalledWith("Template type is missing or invalid");
    expect(mockExit).toHaveBeenCalledWith(1);
  });

  it("should log ALL TESTS HAVE PASSED when completed with no errors", async () => {
    const handle = "reconciliation_text_1";
    setupFsUtilsMocks(handle);

    const testDir = path.join(tempDir, "reconciliation_texts", handle, "tests");
    fs.mkdirSync(testDir, { recursive: true });
    fs.writeFileSync(path.join(testDir, `${handle}_liquid_test.yml`), SIMPLE_YAML);

    ReconciliationText.read.mockReturnValue({ handle, text: "x", text_parts: [] });

    SF.createTestRun = jest.fn().mockResolvedValue({ data: 1 });
    SF.readTestRun = jest.fn().mockResolvedValue({
      data: makeTestRun("completed", makePassedTests()),
    });

    const promise = runTestsWithOutput(1001, "reconciliationText", handle);
    await jest.runAllTimersAsync();
    await promise;

    expect(consola.success).toHaveBeenCalledWith(expect.stringContaining("ALL TESTS HAVE PASSED"));
  });

  it("should log TESTS FAILED when completed with errors", async () => {
    const handle = "reconciliation_text_1";
    setupFsUtilsMocks(handle);

    const testDir = path.join(tempDir, "reconciliation_texts", handle, "tests");
    fs.mkdirSync(testDir, { recursive: true });
    fs.writeFileSync(path.join(testDir, `${handle}_liquid_test.yml`), SIMPLE_YAML);

    ReconciliationText.read.mockReturnValue({ handle, text: "x", text_parts: [] });

    SF.createTestRun = jest.fn().mockResolvedValue({ data: 2 });
    SF.readTestRun = jest.fn().mockResolvedValue({
      data: makeTestRun("completed", makeFailedTests()),
    });

    const promise = runTestsWithOutput(1001, "reconciliationText", handle);
    await jest.runAllTimersAsync();
    await promise;

    expect(consola.log).toHaveBeenCalledWith(expect.stringContaining("FAILED"));
  });

  it("should log internal_error message when status is internal_error", async () => {
    const handle = "reconciliation_text_1";
    setupFsUtilsMocks(handle);

    const testDir = path.join(tempDir, "reconciliation_texts", handle, "tests");
    fs.mkdirSync(testDir, { recursive: true });
    fs.writeFileSync(path.join(testDir, `${handle}_liquid_test.yml`), SIMPLE_YAML);

    ReconciliationText.read.mockReturnValue({ handle, text: "x", text_parts: [] });

    SF.createTestRun = jest.fn().mockResolvedValue({ data: 3 });
    SF.readTestRun = jest.fn().mockResolvedValue({
      data: makeTestRun("internal_error"),
    });

    const promise = runTestsWithOutput(1001, "reconciliationText", handle);
    await jest.runAllTimersAsync();
    await promise;

    expect(consola.error).toHaveBeenCalledWith(expect.stringContaining("Internal error"));
  });
});

// ─── runTestsStatusOnly ────────────────────────────────────────────────────

describe("runTestsStatusOnly", () => {
  let tempDir;
  let originalCwd;
  let mockExit;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    tempDir = fs.mkdtempSync(path.join(require("os").tmpdir(), "lt-status-test-"));
    originalCwd = process.cwd();
    process.chdir(tempDir);
    mockExit = jest.spyOn(process, "exit").mockImplementation(() => {});
  });

  afterEach(() => {
    process.chdir(originalCwd);
    fs.rmSync(tempDir, { recursive: true, force: true });
    mockExit.mockRestore();
    jest.useRealTimers();
  });

  it("should exit for invalid templateType", async () => {
    await runTestsStatusOnly(1001, "invalid", ["some_handle"]);
    expect(consola.error).toHaveBeenCalledWith("Template type is missing or invalid");
    expect(mockExit).toHaveBeenCalledWith(1);
  });

  it("should return PASSED when all handles pass", async () => {
    const handle = "reconciliation_text_1";
    setupFsUtilsMocks(handle);

    const testDir = path.join(tempDir, "reconciliation_texts", handle, "tests");
    fs.mkdirSync(testDir, { recursive: true });
    fs.writeFileSync(path.join(testDir, `${handle}_liquid_test.yml`), SIMPLE_YAML);

    ReconciliationText.read.mockReturnValue({ handle, text: "x", text_parts: [] });

    SF.createTestRun = jest.fn().mockResolvedValue({ data: 10 });
    SF.readTestRun = jest.fn().mockResolvedValue({
      data: makeTestRun("completed", makePassedTests()),
    });

    const promise = runTestsStatusOnly(1001, "reconciliationText", [handle]);
    await jest.runAllTimersAsync();
    const overallStatus = await promise;

    expect(overallStatus).toBe("PASSED");
    expect(consola.log).toHaveBeenCalledWith(expect.stringContaining("PASSED"));
  });

  it("should return FAILED when a handle fails", async () => {
    const handle = "reconciliation_text_1";
    setupFsUtilsMocks(handle);

    const testDir = path.join(tempDir, "reconciliation_texts", handle, "tests");
    fs.mkdirSync(testDir, { recursive: true });
    fs.writeFileSync(path.join(testDir, `${handle}_liquid_test.yml`), SIMPLE_YAML);

    ReconciliationText.read.mockReturnValue({ handle, text: "x", text_parts: [] });

    SF.createTestRun = jest.fn().mockResolvedValue({ data: 11 });
    SF.readTestRun = jest.fn().mockResolvedValue({
      data: makeTestRun("completed", makeFailedTests()),
    });

    const promise = runTestsStatusOnly(1001, "reconciliationText", [handle]);
    await jest.runAllTimersAsync();
    const overallStatus = await promise;

    expect(overallStatus).toBe("FAILED");
    expect(consola.log).toHaveBeenCalledWith(expect.stringContaining("FAILED"));
  });

  it("should return FAILED when test result is null (runTests returned nothing)", async () => {
    fsUtils.configExists.mockReturnValue(false);

    const overallStatus = await runTestsStatusOnly(1001, "reconciliationText", ["missing_handle"]);

    expect(overallStatus).toBe("FAILED");
  });

  it("should handle multiple handles and return FAILED if any fail", async () => {
    const handlePass = "reconciliation_text_1";
    const handleFail = "reconciliation_text_2";

    // Make both config/YAML setups available
    fsUtils.configExists.mockReturnValue(true);
    fsUtils.readConfig.mockImplementation((type, handle) => ({
      test: `tests/${handle}_liquid_test.yml`,
      reconciliation_type: "can_be_reconciled_without_data",
      id: { 1001: handle === handlePass ? 8801 : 9901 },
    }));
    fsUtils.listSharedPartsUsedInTemplate.mockReturnValue([]);

    // Create test files for both handles
    for (const handle of [handlePass, handleFail]) {
      const testDir = path.join(tempDir, "reconciliation_texts", handle, "tests");
      fs.mkdirSync(testDir, { recursive: true });
      fs.writeFileSync(path.join(testDir, `${handle}_liquid_test.yml`), SIMPLE_YAML);
    }

    ReconciliationText.read.mockReturnValue({ handle: "any", text: "x", text_parts: [] });

    let callCount = 0;
    SF.createTestRun = jest.fn().mockResolvedValue({ data: 20 });
    SF.readTestRun = jest.fn().mockImplementation(() => {
      callCount++;
      const tests = callCount === 1 ? makePassedTests() : makeFailedTests();
      return Promise.resolve({ data: makeTestRun("completed", tests) });
    });

    const promise = runTestsStatusOnly(1001, "reconciliationText", [handlePass, handleFail]);
    await jest.runAllTimersAsync();
    const overallStatus = await promise;

    expect(overallStatus).toBe("FAILED");
  });
});
