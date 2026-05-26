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

  describe("publishExportFileByName", () => {
    it("should update export file when config and id exist", async () => {
      const fixturesPath = path.join(__dirname, "../../../fixtures/market-repo");
      await fsPromises.cp(fixturesPath, tempDir, { recursive: true });

      SF.updateExportFile.mockResolvedValue({
        data: { name_nl: "export_1" },
      });

      await toolkit.publishExportFileByName("firm", "1001", "export_1");

      expect(SF.updateExportFile).toHaveBeenCalledWith("firm", "1001", 2201, expect.any(Object));
      expect(consola.success).toHaveBeenCalledWith(expect.stringContaining("export_1"));
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
        data: { name_nl: "export_1" },
      });

      await toolkit.publishExportFileById("firm", "1001", 2201);

      expect(SF.updateExportFile).toHaveBeenCalledWith("firm", "1001", 2201, expect.any(Object));
      expect(consola.success).toHaveBeenCalledWith(expect.stringContaining("export_1"));
    });

    it("should return false when no local export file has the given id", async () => {
      const result = await toolkit.publishExportFileById("firm", "1001", 99999);
      expect(result).toBe(false);
      expect(consola.error).toHaveBeenCalledWith(expect.stringContaining("No template found"));
    });
  });
});
