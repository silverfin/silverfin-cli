const fs = require("fs");
const fsPromises = require("fs").promises;
const path = require("path");
const templateUtils = require("../../../lib/utils/templateUtils");
const { SharedPart } = require("../../../lib/templates/sharedPart");

jest.mock("../../../lib/utils/templateUtils");
jest.mock("consola");
jest.mock("../../../lib/utils/apiUtils", () => ({
  checkRequiredEnvVariables: jest.fn(() => true),
}));

describe("SharedPart", () => {
  describe("save", () => {
    const template = {
      id: 808080,
      name: "example_shared_part_name",
      text: "example_shared_part_name.liquid",
      used_in: [],
      externally_managed: true,
    };
    const name = template.name;
    const configToWrite = {
      id: { 100: 808080 },
      partner_id: {},
      name: "example_shared_part_name",
      text: "example_shared_part_name.liquid",
      used_in: [],
      externally_managed: true,
    };

    const repoRoot = path.resolve(__dirname, "../../..");
    let tempDir;
    let expectedFolderPath;
    let mainLiquidPath;
    let configPath;

    beforeEach(() => {
      tempDir = fs.mkdtempSync(path.join(repoRoot, "tmp-"));
      process.chdir(tempDir);

      expectedFolderPath = path.join(tempDir, "shared_parts", name);
      mainLiquidPath = path.join(expectedFolderPath, `${name}.liquid`);
      configPath = path.join(expectedFolderPath, "config.json");
    });

    afterEach(() => {
      process.chdir(repoRoot);
      if (tempDir && fs.existsSync(tempDir)) fs.rmSync(tempDir, { recursive: true, force: true });
      jest.resetAllMocks();
    });

    it("should return false if the template name is invalid", async () => {
      templateUtils.checkValidName.mockReturnValue(false);
      const result = await SharedPart.save("firm", 100, template);
      expect(result).toBe(false);
      expect(templateUtils.checkValidName).toHaveBeenCalledWith("example_shared_part_name", "sharedPart");
    });

    it("should create the necessary files and store template's relevant details", async () => {
      templateUtils.checkValidName.mockReturnValue(true);

      await SharedPart.save("firm", 100, template);

      // Check folder creation
      expect(fs.existsSync(expectedFolderPath)).toBe(true);
      // Check main liquid file
      expect(fs.existsSync(mainLiquidPath)).toBe(true);
      const mainLiquidContent = await fsPromises.readFile(mainLiquidPath, "utf-8");
      expect(mainLiquidContent).toBe(template.text);
      // Check config file
      expect(fs.existsSync(configPath)).toBe(true);
      const configSaved = JSON.parse(await fsPromises.readFile(configPath, "utf-8"));
      expect(configSaved).toEqual(configToWrite);
    });
  });

  describe("read", () => {
    const name = "example_shared_part_name";
    const repoRoot = path.resolve(__dirname, "../../..");
    let tempDir;
    let expectedFolderPath;
    let mainLiquidPath;
    let configPath;

    const configContent = {
      id: { 100: 808080 },
      partner_id: {},
      name: "example_shared_part_name",
      text: "example_shared_part_name.liquid",
      used_in: [],
      externally_managed: true,
    };

    beforeEach(() => {
      tempDir = fs.mkdtempSync(path.join(repoRoot, "tmp-"));
      process.chdir(tempDir);

      expectedFolderPath = path.join(tempDir, "shared_parts", name);
      mainLiquidPath = path.join(expectedFolderPath, `${name}.liquid`);
      configPath = path.join(expectedFolderPath, "config.json");

      // Create necessary directories and files
      fs.mkdirSync(expectedFolderPath, { recursive: true });
      fs.mkdirSync(path.join(expectedFolderPath, "shared_parts"), { recursive: true });
      fs.writeFileSync(configPath, JSON.stringify(configContent));
      fs.writeFileSync(mainLiquidPath, "Main liquid content");

      // Mock valid handle check
      templateUtils.checkValidName.mockReturnValue(true);
    });

    afterEach(() => {
      process.chdir(repoRoot);
      if (tempDir && fs.existsSync(tempDir)) fs.rmSync(tempDir, { recursive: true, force: true });
      jest.resetAllMocks();
    });

    it("should create the liquid file if it doesn't exist", async () => {
      await fsPromises.unlink(mainLiquidPath);

      SharedPart.read(name);

      expect(fs.existsSync(mainLiquidPath)).toBe(true);
      const content = await fsPromises.readFile(mainLiquidPath, "utf-8");
      expect(content).toBe("{% comment %} MAIN PART {% endcomment %}");
    });
  });
});
