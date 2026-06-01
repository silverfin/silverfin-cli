const fs = require("fs");
const fsPromises = require("fs").promises;
const path = require("path");
const os = require("os");

jest.mock("consola");
jest.mock("../../../lib/api/sfApi");

const SF = require("../../../lib/api/sfApi");
const consola = require("consola");
const toolkit = require("../../../index");
const exportFileFixture = require("../../../fixtures/api-responses/export-files/single.json");

describe("import-export-file", () => {
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

  describe("fetchExportFileById", () => {
    it("should import export file and create necessary files", async () => {
      const mockApiResponse = {
        id: exportFileFixture.id,
        name: "export_1",
        name_nl: exportFileFixture.name_nl,
        name_en: exportFileFixture.name_en,
        text: exportFileFixture.text,
        text_parts: exportFileFixture.text_parts,
        externally_managed: exportFileFixture.externally_managed,
        published: exportFileFixture.published,
      };

      SF.readExportFileById.mockResolvedValue(mockApiResponse);

      await toolkit.fetchExportFileById("firm", "1001", 2201);

      expect(SF.readExportFileById).toHaveBeenCalledWith("firm", "1001", 2201);
      expect(consola.success).toHaveBeenCalledWith(expect.stringContaining("export_1"));

      const exportDir = path.join(tempDir, "export_files", "export_1");
      expect(fs.existsSync(path.join(exportDir, "main.liquid"))).toBe(true);
      expect(fs.existsSync(path.join(exportDir, "config.json"))).toBe(true);
    });

    it("should log error and exit when export file not found", async () => {
      SF.readExportFileById.mockResolvedValue(null);

      await toolkit.fetchExportFileById("firm", "1001", 99999);

      expect(consola.error).toHaveBeenCalledWith(expect.stringContaining("wasn't found"));
      expect(process.exit).toHaveBeenCalledWith(1);
    });
  });

  describe("fetchExportFileByName", () => {
    it("should import export file when found by name", async () => {
      SF.findExportFileByName.mockResolvedValue(exportFileFixture);

      await toolkit.fetchExportFileByName("firm", "1001", "export_1");

      expect(SF.findExportFileByName).toHaveBeenCalledWith("firm", "1001", "export_1");
      expect(consola.success).toHaveBeenCalledWith(expect.stringContaining("export_1"));
    });

    it("should log error and exit when export file not found by name", async () => {
      SF.findExportFileByName.mockResolvedValue(null);

      await toolkit.fetchExportFileByName("firm", "1001", "nonexistent_export");

      expect(consola.error).toHaveBeenCalledWith(expect.stringContaining("wasn't found"));
      expect(process.exit).toHaveBeenCalledWith(1);
    });
  });
});
