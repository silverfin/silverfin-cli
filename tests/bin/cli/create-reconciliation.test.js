const fs = require("fs");
const fsPromises = require("fs").promises;
const path = require("path");
const os = require("os");

jest.mock("consola");
jest.mock("../../../lib/api/sfApi");

const SF = require("../../../lib/api/sfApi");
const consola = require("consola");
const toolkit = require("../../../index");

describe("create-reconciliation", () => {
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

  describe("newReconciliation", () => {
    it("should create reconciliation and store new id on success", async () => {
      const fixturesPath = path.join(__dirname, "../../../fixtures/market-repo");
      await fsPromises.cp(fixturesPath, tempDir, { recursive: true });

      SF.findReconciliationTextByHandle.mockResolvedValue(null);
      SF.createReconciliationText.mockResolvedValue({
        status: 201,
        data: { id: 99001, handle: "reconciliation_text_1" },
      });

      await toolkit.newReconciliation("firm", "2000", "reconciliation_text_1");

      expect(SF.createReconciliationText).toHaveBeenCalledWith("firm", "2000", expect.any(Object));
      expect(consola.success).toHaveBeenCalledWith(expect.stringContaining("reconciliation_text_1"));

      // Verify id was stored in config
      const configPath = path.join(tempDir, "reconciliation_texts", "reconciliation_text_1", "config.json");
      const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
      expect(config.id["2000"]).toBe(99001);
    });

    it("should skip creation when reconciliation already exists on remote", async () => {
      const fixturesPath = path.join(__dirname, "../../../fixtures/market-repo");
      await fsPromises.cp(fixturesPath, tempDir, { recursive: true });

      SF.findReconciliationTextByHandle.mockResolvedValue({ id: 8801, handle: "reconciliation_text_1" });

      await toolkit.newReconciliation("firm", "1001", "reconciliation_text_1");

      expect(SF.createReconciliationText).not.toHaveBeenCalled();
      expect(consola.warn).toHaveBeenCalledWith(expect.stringContaining("already exists"));
    });
  });
});
