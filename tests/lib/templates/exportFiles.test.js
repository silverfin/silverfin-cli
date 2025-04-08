const fs = require("fs");
const fsPromises = require("fs").promises;
const path = require("path");
const fsUtils = require("../../../lib/utils/fsUtils");
const templateUtils = require("../../../lib/utils/templateUtils");
const { ExportFile } = require("../../../lib/templates/exportFile");

jest.mock("../../../lib/utils/templateUtils");
jest.mock("consola");

describe("ExportFile", () => {
  describe("save", () => {
    const textParts = { part_1: "Part 1: updated content" };
    // Data coming from the API (stored on partner/firm)
    const template = {
      name_nl: "example_name_nl",
      id: 808080,
      text: "Main liquid content",
      text_parts: [{ name: "part_1", content: "Part 1: updated content" }],
      externally_managed: true,
      file_name: "export_file.sxbrl",
      name_en: "example_name_nl",
      name_fr: "example_name_nl",
    };
    const name_nl = template.name_nl;
    // Expected config to be written after processing (import command)
    const configToWrite = {
      id: { 100: 808080 },
      partner_id: {},
      externally_managed: true,
      name_nl: "example_name_nl",
      name_fr: "example_name_nl",
      name_en: "example_name_nl",
      file_name: "export_file.sxbrl",

      text: "main.liquid",
      encoding: "UTF-8",
      text_parts: {
        part_1: "text_parts/part_1.liquid",
      },
    };
    // Local config file
    const existingConfig = {
      id: { 200: 505050 },
      partner_id: {},
      externally_managed: false,
      name_nl: "example_name_nl",
      name_fr: "old_name_fr",
      name_en: "old_name_en",
      file_name: "old_file_name.sxbrl",
      text: "main.liquid",
      encoding: "UTF-8",
      text_parts: {
        old_part: "text_parts/old_part.liquid",
        part_1: "text_parts/part_1.liquid",
      },
    };

    const tempDir = path.join(process.cwd(), "tmp");
    const expectedFolderPath = path.join(tempDir, "export_files", name_nl);
    const configPath = path.join(expectedFolderPath, "config.json");
    const mainLiquidPath = path.join(expectedFolderPath, "main.liquid");
    const part1LiquidPath = path.join(expectedFolderPath, "text_parts", "part_1.liquid");
    const oldPartLiquidPath = path.join(expectedFolderPath, "text_parts", "old_part.liquid");

    beforeEach(() => {
      if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, { recursive: true });
      }
      process.chdir(tempDir);
    });

    afterEach(() => {
      if (fs.existsSync(tempDir)) {
        fs.rmdirSync(tempDir, { recursive: true });
      }
      jest.resetAllMocks();
    });

    it("should return false if the template name_nl is missing", () => {
      templateUtils.missingNameNL.mockReturnValue(true);
      const result = ExportFile.save("firm", 100, { id: 808080 });
      expect(result).toBe(false);
      expect(templateUtils.missingNameNL).toHaveBeenCalledWith({ id: 808080 });
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
      expect(templateUtils.checkValidName).toHaveBeenCalledWith("example_name_nl", "exportFile");
    });

    it("should create the necessary files and store template's relevant details", async () => {
      templateUtils.missingNameNL.mockReturnValue(false);
      templateUtils.missingLiquidCode.mockReturnValue(false);
      templateUtils.checkValidName.mockReturnValue(true);
      templateUtils.filterParts.mockReturnValue({ part_1: "Part 1 content" });

      ExportFile.save("firm", 100, template);

      // Check folder creation
      console.log(expectedFolderPath);
      expect(fs.existsSync(expectedFolderPath)).toBe(true);

      // Check main liquid file
      expect(fs.existsSync(mainLiquidPath)).toBe(true);
      const mainLiquidContent = await fsPromises.readFile(mainLiquidPath, "utf-8");
      expect(mainLiquidContent).toBe(template.text);

      // Check text parts liquid files
      expect(fs.existsSync(part1LiquidPath)).toBe(true);
      const part1LiquidContent = await fsPromises.readFile(part1LiquidPath, "utf-8");
      expect(part1LiquidContent).toBe("Part 1 content");

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
      fs.mkdirSync(path.join(tempDir, "export_files", "example_name_nl"));
      fs.writeFileSync(configPath, JSON.stringify(existingConfig));

      // Check existing config file before save
      expect(fs.existsSync(configPath)).toBe(true);
      let configSaved = JSON.parse(await fsPromises.readFile(configPath, "utf-8"));
      expect(configSaved).toEqual(existingConfig);

      ExportFile.save("firm", 100, template);

      // Check config file after save
      configToWrite.id[200] = 505050;
      expect(fs.existsSync(configPath)).toBe(true);
      configSaved = JSON.parse(await fsPromises.readFile(configPath, "utf-8"));
      expect(configSaved).toEqual(configToWrite);
    });

    // NOTE: Do we need to modify this behavior?
    it("should not replace or delete unspecified text_parts", async () => {
      templateUtils.missingNameNL.mockReturnValue(false);
      templateUtils.missingLiquidCode.mockReturnValue(false);
      templateUtils.checkValidName.mockReturnValue(true);
      templateUtils.filterParts.mockReturnValue(textParts);

      const existingPartContent = "Old part: existing Part Content";

      fs.mkdirSync(path.join(tempDir, "export_files"));
      fs.mkdirSync(path.join(tempDir, "export_files", "example_name_nl"));
      fs.mkdirSync(path.join(tempDir, "export_files", "example_name_nl", "text_parts"));
      fs.writeFileSync(configPath, JSON.stringify(existingConfig));
      fs.writeFileSync(oldPartLiquidPath, existingPartContent);

      ExportFile.save("firm", 100, template);

      // Check Old Part liquid file
      const oldPartLiquidContent = await fsPromises.readFile(oldPartLiquidPath, "utf-8");
      expect(oldPartLiquidContent).toBe(existingPartContent);
    });
  });
});
