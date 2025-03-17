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
    const template = {
      name_nl: "example_name_nl",
      id: 808080,
      text: "Main liquid content",
      text_parts: [
        { name: "part_1", content: "Part 1: updated content" },
        { name: "", content: "" },
      ],
      externally_managed: true,
    };
    const name = template.name_nl;
    const configToWrite = {
      id: {
        100: 808080,
      },
      partner_id: {},
      name_nl: "example_name_nl",
      file_name: "export_file.sxbrl",
      text: "main.liquid",
      text_parts: {
        part_1: "text_parts/part_1.liquid",
      },
      externally_managed: true,
      encoding: "UTF-8",
      name_en: "example_name_nl",
      name_fr: "example_name_nl",
      name_nl: "example_name_nl",
    };
    const existingConfig = {
      id: { 200: 505050 },
      name_nl: "old_name",
      file_name: "export_file.sxbrl",
      text: "main.liquid",
      text_parts: {
        old_part: "text_parts/old_part.liquid",
        part_1: "text_parts/part_1.liquid",
      },
      externally_managed: false,
      encoding: "UTF-8",
      name_en: "example_name_nl",
      name_fr: "example_name_nl",
      name_nl: "example_name_nl",
    };

    const tempDir = path.join(process.cwd(), "tmp");
    const expectedFolderPath = path.join(tempDir, "export_files", name);
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

    it("should return false if the template nl name is missing", async () => {
      const result = await ExportFile.save("firm", 100, { id: 808080 });
      expect(result).toBe(false);
    });

    it("should return false if the liquid code is missing", async () => {
      templateUtils.missingLiquidCode.mockReturnValue(true);
      const result = await ExportFile.save("firm", 100, template);
      expect(result).toBe(false);
      expect(templateUtils.missingLiquidCode).toHaveBeenCalledWith(template);
    });

    it("should return false if the template nl name is invalid", async () => {
      templateUtils.checkValidName.mockReturnValue(false);
      const result = await ExportFile.save("firm", 100, template);
      expect(result).toBe(false);
      expect(templateUtils.checkValidName).toHaveBeenCalledWith("example_name_nl", "exportFile");
    });

    it("should create the necessary files and store template's relevant details", async () => {
      templateUtils.missingLiquidCode.mockReturnValue(false);
      templateUtils.checkValidName.mockReturnValue(true);
      templateUtils.filterParts.mockReturnValue({ part_1: "Part 1 content" });

      await ExportFile.save("firm", 100, template);

      // Check folder creation
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
      console.log(configSaved);
      expect(configSaved).toEqual(configToWrite);
    });

    it("should fetch an existing template's config and update with new details", async () => {
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
      console.log(configSaved);
      await ExportFile.save("firm", 100, template);

      // Check config file after save
      configToWrite.id[200] = 505050;
      expect(fs.existsSync(configPath)).toBe(true);
      configSaved = JSON.parse(await fsPromises.readFile(configPath, "utf-8"));
      console.log(configSaved);
      expect(configSaved).toEqual(configToWrite);
    });
  });
});
