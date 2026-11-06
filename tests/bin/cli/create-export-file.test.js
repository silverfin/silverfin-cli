const fs = require("fs");
const fsPromises = require("fs").promises;
const path = require("path");
const os = require("os");

jest.mock("consola");
jest.mock("../../../lib/api/sfApi");

const SF = require("../../../lib/api/sfApi");
const consola = require("consola");
const toolkit = require("../../../index");

describe("create-export-file", () => {
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
    process.exitCode = undefined;
    await fsPromises.rm(tempDir, { recursive: true, force: true });
  });

  describe("newExportFile", () => {
    it("should create export file and store new id on success", async () => {
      const fixturesPath = path.join(__dirname, "../../../fixtures/market-repo");
      await fsPromises.cp(fixturesPath, tempDir, { recursive: true });

      SF.findExportFileByName.mockResolvedValue(null);
      SF.createExportFile.mockResolvedValue({
        status: 201,
        data: { id: 99002, name_nl: "export_1" },
      });

      await toolkit.newExportFile("firm", "2000", "export_1");

      expect(SF.createExportFile).toHaveBeenCalledWith("firm", "2000", expect.any(Object));
      expect(consola.success).toHaveBeenCalledWith(expect.stringContaining("export_1"));

      const configPath = path.join(tempDir, "export_files", "export_1", "config.json");
      const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
      expect(config.id["2000"]).toBe(99002);
    });

    it("should store the new id under the local folder name, not the name returned by the API", async () => {
      const fixturesPath = path.join(__dirname, "../../../fixtures/market-repo");
      await fsPromises.cp(fixturesPath, tempDir, { recursive: true });

      SF.findExportFileByName.mockResolvedValue(null);
      SF.createExportFile.mockResolvedValue({
        status: 201,
        data: { id: 99003, name_nl: "renamed_by_api" },
      });

      await toolkit.newExportFile("firm", "2000", "export_1");

      const configPath = path.join(tempDir, "export_files", "export_1", "config.json");
      const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
      expect(config.id["2000"]).toBe(99003);
      expect(fs.existsSync(path.join(tempDir, "export_files", "renamed_by_api"))).toBe(false);
    });

    it("should report a failure and set exit code 1 when the API call returns no response", async () => {
      const fixturesPath = path.join(__dirname, "../../../fixtures/market-repo");
      await fsPromises.cp(fixturesPath, tempDir, { recursive: true });

      SF.findExportFileByName.mockResolvedValue(null);
      // sfApi returns undefined when apiUtils.responseErrorHandler swallows a 400/404
      SF.createExportFile.mockResolvedValue(undefined);

      await toolkit.newExportFile("firm", "2000", "export_1");

      expect(consola.success).not.toHaveBeenCalled();
      expect(consola.error).toHaveBeenCalledWith(expect.stringContaining("export_1"));
      expect(process.exitCode).toBe(1);
    });

    it("should skip creation when export file already exists remotely", async () => {
      const fixturesPath = path.join(__dirname, "../../../fixtures/market-repo");
      await fsPromises.cp(fixturesPath, tempDir, { recursive: true });

      SF.findExportFileByName.mockResolvedValue({ id: 2201, name_nl: "export_1" });

      await toolkit.newExportFile("firm", "1001", "export_1");

      expect(SF.createExportFile).not.toHaveBeenCalled();
      expect(consola.warn).toHaveBeenCalledWith(expect.stringContaining("already exists"));
    });
  });
});
