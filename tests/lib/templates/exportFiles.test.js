const fs = require("fs");
const fsPromises = require("fs").promises;
const path = require("path");
const templateUtils = require("../../../lib/utils/templateUtils");
const { ExportFile } = require("../../../lib/templates/exportFile");

jest.mock("../../../lib/utils/templateUtils");
jest.mock("consola");

// Load shared fixtures
const apiResponse = require("../../../fixtures/api-responses/export-files/single.json");
const existingConfigFixture = require("../../../fixtures/market-repo/export_files/export_2/config.json");

describe("ExportFile", () => {
  describe("save", () => {
    // API response fixture (export_1)
    const template = apiResponse;
    const name_nl = template.name_nl; // "export_1"

    // The text parts mock return value (filterParts is mocked)
    const textParts = { header: "Header: updated content" };

    // Expected config written after save("firm", 100, template)
    // ExportFile.CONFIG_ITEMS: name_en, name_nl, name_fr, name_de, name_da, name_se, name_fi,
    //   description_en, description_nl, description_fr, description_de, description_da, description_se, description_fi,
    //   file_name, externally_managed, encoding, published, hide_code, download_warning, test_firm_id (NOT included in ExportFile)
    const configToWrite = {
      id: { 100: template.id },
      partner_id: {},
      name_en: template.name_en,
      name_nl: template.name_nl,
      name_fr: template.name_fr,
      name_de: template.name_de,
      name_da: template.name_da,
      name_se: template.name_se,
      name_fi: template.name_fi,
      description_en: template.description_en,
      description_nl: template.description_nl,
      description_fr: template.description_fr,
      description_de: template.description_de,
      description_da: template.description_da,
      description_se: template.description_se,
      description_fi: template.description_fi,
      file_name: template.file_name,
      externally_managed: template.externally_managed,
      encoding: template.encoding,
      published: template.published,
      hide_code: template.hide_code,
      download_warning: template.download_warning,
      test_firm_id: template.test_firm_id,
      text: "main.liquid",
      text_parts: {
        header: "text_parts/header.liquid",
      },
    };

    // Use export_2 fixture as the "existing" config on disk
    const existingConfig = existingConfigFixture;

    const repoRoot = path.resolve(__dirname, "../../..");
    let tempDir;
    let expectedFolderPath;
    let configPath;
    let mainLiquidPath;
    let part1LiquidPath;

    beforeEach(() => {
      tempDir = fs.mkdtempSync(path.join(repoRoot, "tmp-"));
      process.chdir(tempDir);

      expectedFolderPath = path.join(tempDir, "export_files", name_nl);
      configPath = path.join(expectedFolderPath, "config.json");
      mainLiquidPath = path.join(expectedFolderPath, "main.liquid");
      part1LiquidPath = path.join(expectedFolderPath, "text_parts", "header.liquid");
    });

    afterEach(() => {
      process.chdir(repoRoot);
      if (tempDir && fs.existsSync(tempDir)) fs.rmSync(tempDir, { recursive: true, force: true });
      jest.resetAllMocks();
    });

    it("should return false if the template name_nl is missing", () => {
      templateUtils.missingNameNL.mockReturnValue(true);
      const result = ExportFile.save("firm", 100, { id: template.id });
      expect(result).toBe(false);
      expect(templateUtils.missingNameNL).toHaveBeenCalledWith({ id: template.id });
    });

    it("should return false if there is no liquid code", () => {
      templateUtils.missingLiquidCode.mockReturnValue(true);
      const result = ExportFile.save("firm", 100, template);
      expect(result).toBe(false);
      expect(templateUtils.missingLiquidCode).toHaveBeenCalledWith(template);
    });

    it("should return false if the template name_nl is invalid", () => {
      templateUtils.checkValidName.mockReturnValue(false);
      const result = ExportFile.save("firm", 100, template);
      expect(result).toBe(false);
      expect(templateUtils.checkValidName).toHaveBeenCalledWith(template.name_nl, "exportFile");
    });

    it("should create the necessary files and store template's relevant details", async () => {
      templateUtils.missingNameNL.mockReturnValue(false);
      templateUtils.missingLiquidCode.mockReturnValue(false);
      templateUtils.checkValidName.mockReturnValue(true);
      templateUtils.filterParts.mockReturnValue({ header: "Header content" });

      ExportFile.save("firm", 100, template);

      // Check folder creation
      expect(fs.existsSync(expectedFolderPath)).toBe(true);

      // Check main liquid file
      expect(fs.existsSync(mainLiquidPath)).toBe(true);
      const mainLiquidContent = await fsPromises.readFile(mainLiquidPath, "utf-8");
      expect(mainLiquidContent).toBe(template.text);

      // Check text parts liquid files
      expect(fs.existsSync(part1LiquidPath)).toBe(true);
      const part1LiquidContent = await fsPromises.readFile(part1LiquidPath, "utf-8");
      expect(part1LiquidContent).toBe("Header content");

      // Check config file
      expect(fs.existsSync(configPath)).toBe(true);
      const configSaved = JSON.parse(await fsPromises.readFile(configPath, "utf-8"));
      expect(configSaved).toEqual(configToWrite);
    });

    it("should fetch an existing template's config and update with new details", async () => {
      templateUtils.missingNameNL.mockReturnValue(false);
      templateUtils.missingLiquidCode.mockReturnValue(false);
      templateUtils.checkValidName.mockReturnValue(true);
      templateUtils.filterParts.mockReturnValue(textParts);

      fs.mkdirSync(path.join(tempDir, "export_files"));
      fs.mkdirSync(path.join(tempDir, "export_files", name_nl));
      fs.writeFileSync(configPath, JSON.stringify(existingConfig));

      // Check existing config file before save
      expect(fs.existsSync(configPath)).toBe(true);
      let configSaved = JSON.parse(await fsPromises.readFile(configPath, "utf-8"));
      expect(configSaved).toEqual(existingConfig);

      ExportFile.save("firm", 100, template);

      // After save, ids from existingConfig should be preserved and new id added
      configSaved = JSON.parse(await fsPromises.readFile(configPath, "utf-8"));
      expect(configSaved.id[100]).toBe(template.id);
      expect(configSaved.id["1001"]).toBe(existingConfig.id["1001"]);
      expect(configSaved.name_nl).toBe(template.name_nl);
      expect(configSaved.file_name).toBe(template.file_name);
    });

    // NOTE: Do we need to modify this behavior?
    it("should not replace or delete unspecified text_parts", async () => {
      templateUtils.missingNameNL.mockReturnValue(false);
      templateUtils.missingLiquidCode.mockReturnValue(false);
      templateUtils.checkValidName.mockReturnValue(true);
      templateUtils.filterParts.mockReturnValue(textParts);

      const existingPartContent = "Old part: existing Part Content";
      const oldPartLiquidPath = path.join(expectedFolderPath, "text_parts", "old_part.liquid");

      fs.mkdirSync(path.join(tempDir, "export_files"));
      fs.mkdirSync(path.join(tempDir, "export_files", name_nl));
      fs.mkdirSync(path.join(tempDir, "export_files", name_nl, "text_parts"));
      fs.writeFileSync(configPath, JSON.stringify(existingConfig));
      fs.writeFileSync(oldPartLiquidPath, existingPartContent);

      ExportFile.save("firm", 100, template);

      // Check Old Part liquid file
      const oldPartLiquidContent = await fsPromises.readFile(oldPartLiquidPath, "utf-8");
      expect(oldPartLiquidContent).toBe(existingPartContent);
    });
  });
});
