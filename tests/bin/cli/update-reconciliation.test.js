const fsPromises = require("fs").promises;
const path = require("path");
const os = require("os");

jest.mock("consola");
jest.mock("../../../lib/api/sfApi");

const SF = require("../../../lib/api/sfApi");
const consola = require("consola");
const toolkit = require("../../../index");

describe("update-reconciliation", () => {
  let tempDir;
  let originalCwd;

  let originalExit;

  beforeEach(async () => {
    jest.clearAllMocks();

    tempDir = await fsPromises.mkdtemp(path.join(os.tmpdir(), "sf-cli-test-"));

    originalCwd = process.cwd();
    process.chdir(tempDir);

    originalExit = process.exit;
    process.exit = jest.fn();

    consola.success = jest.fn();
    consola.error = jest.fn();
    consola.info = jest.fn();
    consola.log = jest.fn();
    consola.warn = jest.fn();
  });

  afterEach(async () => {
    process.chdir(originalCwd);
    process.exit = originalExit;
    await fsPromises.rm(tempDir, { recursive: true, force: true });
  });

  describe("publishReconciliationByHandle", () => {
    it("should update reconciliation when config and id exist", async () => {
      // Setup: copy market-repo fixture with reconciliation_text_1
      const fixturesPath = path.join(__dirname, "../../../fixtures/market-repo");
      await fsPromises.cp(fixturesPath, tempDir, { recursive: true });

      SF.updateReconciliationText.mockResolvedValue({
        data: { handle: "reconciliation_text_1" },
      });

      await toolkit.publishReconciliationByHandle("firm", "1001", "reconciliation_text_1");

      expect(SF.updateReconciliationText).toHaveBeenCalledWith("firm", "1001", 8801, expect.any(Object));
      expect(consola.success).toHaveBeenCalledWith(expect.stringContaining("reconciliation_text_1"));
    });

    it("should return false when config file does not exist", async () => {
      const result = await toolkit.publishReconciliationByHandle("firm", "1001", "nonexistent_handle");
      expect(result).toBe(false);
      expect(SF.updateReconciliationText).not.toHaveBeenCalled();
    });

    it("should return false when config has no matching firm id", async () => {
      const fixturesPath = path.join(__dirname, "../../../fixtures/market-repo");
      await fsPromises.cp(fixturesPath, tempDir, { recursive: true });

      const result = await toolkit.publishReconciliationByHandle("firm", "9999", "reconciliation_text_1");
      expect(result).toBe(false);
      expect(SF.updateReconciliationText).not.toHaveBeenCalled();
    });
  });

  describe("publishReconciliationById", () => {
    it("should update reconciliation when matching handle found by ID", async () => {
      const fixturesPath = path.join(__dirname, "../../../fixtures/market-repo");
      await fsPromises.cp(fixturesPath, tempDir, { recursive: true });

      SF.updateReconciliationText.mockResolvedValue({
        data: { handle: "reconciliation_text_1" },
      });

      await toolkit.publishReconciliationById("firm", "1001", 8801);

      expect(SF.updateReconciliationText).toHaveBeenCalledWith("firm", "1001", 8801, expect.any(Object));
      expect(consola.success).toHaveBeenCalledWith(expect.stringContaining("reconciliation_text_1"));
    });

    it("should return false when no local template has the given id", async () => {
      const result = await toolkit.publishReconciliationById("firm", "1001", 99999);
      expect(result).toBe(false);
      expect(consola.error).toHaveBeenCalledWith(expect.stringContaining("No template found"));
    });
  });
});
