const fsPromises = require("fs").promises;
const path = require("path");
const os = require("os");

jest.mock("consola");
jest.mock("../../../lib/api/sfApi");

const SF = require("../../../lib/api/sfApi");
const consola = require("consola");
const toolkit = require("../../../index");

describe("update-export-file", () => {
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

  describe("publishExportFileByName", () => {
    it("should update export file when config and id exist", async () => {
      const fixturesPath = path.join(__dirname, "../../../fixtures/market-repo");
      await fsPromises.cp(fixturesPath, tempDir, { recursive: true });

      SF.updateExportFile.mockResolvedValue({
        status: 201,
        data: { name_nl: "export_1" },
      });

      await toolkit.publishExportFileByName("firm", "1001", "export_1");

      expect(SF.updateExportFile).toHaveBeenCalledWith("firm", "1001", 2201, expect.any(Object));
      expect(consola.success).toHaveBeenCalledWith(expect.stringContaining("export_1"));
    });

    it("should report success when the response omits name_nl", async () => {
      const fixturesPath = path.join(__dirname, "../../../fixtures/market-repo");
      await fsPromises.cp(fixturesPath, tempDir, { recursive: true });

      SF.updateExportFile.mockResolvedValue({ status: 201, data: { id: 2201 } });

      const result = await toolkit.publishExportFileByName("firm", "1001", "export_1");

      expect(result).toBe(true);
      expect(consola.success).toHaveBeenCalledWith("Export file updated: export_1");
      expect(consola.error).not.toHaveBeenCalled();
    });

    it("should return false when config does not exist", async () => {
      const result = await toolkit.publishExportFileByName("firm", "1001", "nonexistent");
      expect(result).toBe(false);
      expect(SF.updateExportFile).not.toHaveBeenCalled();
    });

    it("should return false when config has no matching firm id", async () => {
      const fixturesPath = path.join(__dirname, "../../../fixtures/market-repo");
      await fsPromises.cp(fixturesPath, tempDir, { recursive: true });

      const result = await toolkit.publishExportFileByName("firm", "9999", "export_1");
      expect(result).toBe(false);
      expect(SF.updateExportFile).not.toHaveBeenCalled();
    });
  });

  describe("publishExportFileById", () => {
    it("should update export file when matching local file found by id", async () => {
      const fixturesPath = path.join(__dirname, "../../../fixtures/market-repo");
      await fsPromises.cp(fixturesPath, tempDir, { recursive: true });

      SF.updateExportFile.mockResolvedValue({
        status: 201,
        data: { name_nl: "export_1" },
      });

      await toolkit.publishExportFileById("firm", "1001", 2201);

      expect(SF.updateExportFile).toHaveBeenCalledWith("firm", "1001", 2201, expect.any(Object));
      expect(consola.success).toHaveBeenCalledWith(expect.stringContaining("export_1"));
    });

    it("should report success by id when the response omits name_nl", async () => {
      const fixturesPath = path.join(__dirname, "../../../fixtures/market-repo");
      await fsPromises.cp(fixturesPath, tempDir, { recursive: true });

      SF.updateExportFile.mockResolvedValue({ status: 201, data: { id: 2201 } });

      const result = await toolkit.publishExportFileById("firm", "1001", 2201);

      expect(result).toBe(true);
      expect(consola.success).toHaveBeenCalledWith("Export file updated: export_1 (ID: 2201)");
    });

    it("should return false when no local export file has the given id", async () => {
      const result = await toolkit.publishExportFileById("firm", "1001", 99999);
      expect(result).toBe(false);
      expect(consola.error).toHaveBeenCalledWith(expect.stringContaining("No template found"));
    });
  });
});
