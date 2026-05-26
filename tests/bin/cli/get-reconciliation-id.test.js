const fs = require("fs");
const fsPromises = require("fs").promises;
const path = require("path");
const os = require("os");

jest.mock("consola");
jest.mock("../../../lib/api/sfApi");

const SF = require("../../../lib/api/sfApi");
const consola = require("consola");
const toolkit = require("../../../index");

describe("get-reconciliation-id", () => {
  let tempDir;

  let originalExit;

  beforeEach(async () => {
    jest.clearAllMocks();

    tempDir = await fsPromises.mkdtemp(path.join(os.tmpdir(), "sf-cli-test-"));

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
    process.chdir(path.resolve(__dirname, "../../.."));
    process.exit = originalExit;
    await fsPromises.rm(tempDir, { recursive: true, force: true });
  });

  describe("getTemplateId for reconciliationText", () => {
    it("should store the reconciliation id and return true when found", async () => {
      const fixturesPath = path.join(__dirname, "../../../fixtures/market-repo");
      await fsPromises.cp(fixturesPath, tempDir, { recursive: true });

      SF.findReconciliationTextByHandle.mockResolvedValue({ id: 99005, handle: "reconciliation_text_1" });

      const result = await toolkit.getTemplateId("firm", "2000", "reconciliationText", "reconciliation_text_1");

      expect(result).toBe(true);
      expect(SF.findReconciliationTextByHandle).toHaveBeenCalledWith("firm", "2000", "reconciliation_text_1");
      expect(consola.success).toHaveBeenCalledWith(expect.stringContaining("reconciliation_text_1"));

      // Verify id stored in config
      const configPath = path.join(tempDir, "reconciliation_texts", "reconciliation_text_1", "config.json");
      const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
      expect(config.id["2000"]).toBe(99005);
    });

    it("should warn and return false when reconciliation not found", async () => {
      const fixturesPath = path.join(__dirname, "../../../fixtures/market-repo");
      await fsPromises.cp(fixturesPath, tempDir, { recursive: true });

      SF.findReconciliationTextByHandle.mockResolvedValue(null);

      const result = await toolkit.getTemplateId("firm", "1001", "reconciliationText", "reconciliation_text_1");

      expect(result).toBe(false);
      expect(consola.warn).toHaveBeenCalledWith(expect.stringContaining("reconciliation_text_1"));
    });
  });
});
