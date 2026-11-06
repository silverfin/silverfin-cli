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

    it("should store the new id under the local name when the response omits name_nl", async () => {
      const fixturesPath = path.join(__dirname, "../../../fixtures/market-repo");
      await fsPromises.cp(fixturesPath, tempDir, { recursive: true });

      SF.findExportFileByName.mockResolvedValue(null);
      SF.createExportFile.mockResolvedValue({
        status: 201,
        data: { id: 99002, name_en: "English name" },
      });

      await toolkit.newExportFile("firm", "2000", "export_1");

      expect(consola.success).toHaveBeenCalledWith(expect.stringContaining('"export_1" created'));
      const configPath = path.join(tempDir, "export_files", "export_1", "config.json");
      const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
      expect(config.id["2000"]).toBe(99002);
    });

    it("should look the template up with the local config's names", async () => {
      const fixturesPath = path.join(__dirname, "../../../fixtures/market-repo");
      await fsPromises.cp(fixturesPath, tempDir, { recursive: true });

      SF.findExportFileByName.mockResolvedValue({ id: 1, name_en: "x" });

      await toolkit.newExportFile("firm", "2000", "export_1");

      expect(SF.findExportFileByName).toHaveBeenCalledWith("firm", "2000", "export_1", 1, expect.objectContaining({ name_nl: "export_1" }));
    });

    it("should report failure and set a non-zero exit code when creation is rejected", async () => {
      const fixturesPath = path.join(__dirname, "../../../fixtures/market-repo");
      await fsPromises.cp(fixturesPath, tempDir, { recursive: true });
      const originalExitCode = process.exitCode;

      SF.findExportFileByName.mockResolvedValue(null);
      SF.createExportFile.mockResolvedValue(undefined);

      await toolkit.newExportFile("firm", "2000", "export_1");

      expect(consola.error).toHaveBeenCalledWith('Export file "export_1" creation failed on firm 2000');
      expect(process.exitCode).toBe(1);
      process.exitCode = originalExitCode;
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
