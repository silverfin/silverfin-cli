const fs = require("fs");
const fsPromises = require("fs").promises;
const path = require("path");
const templateUtils = require("../../../lib/utils/templateUtils");
const { AccountTemplate } = require("../../../lib/templates/accountTemplate");

jest.mock("../../../lib/utils/templateUtils");
jest.mock("consola");

describe("AccountTemplate", () => {
  describe("save", () => {
    const testContent = "# Add your Liquid Tests here";
    const textParts = { part_1: "Part 1: updated content" };
    const template = {
      name_nl: "name_nl",
      name_en: "name_nl",
      name_fr: "name_nl",
      id: 808080,
      text: "Main liquid content",
      text_parts: [
        { name: "part_1", content: "Part 1: updated content" },
        { name: "", content: "" },
      ],
      tests: testContent,
      externally_managed: true,
      hide_code: true,
      mapping_list_ranges: [],
    };
    const name_nl = template.name_nl;
    const configToWrite = {
      id: {
        100: 808080,
      },
      partner_id: {},
      externally_managed: true,
      name_en: "",
      name_nl: "name_nl",
      name_fr: "",
      description_en: "",
      description_fr: "",
      description_nl: "",
      text: "main.liquid",
      test: "tests/name_nl_liquid_test.yml",
      text_parts: {
        part_1: "text_parts/part_1.liquid",
      },
      account_range: null,
      mapping_list_ranges: [],
      hide_code: true,
      published: true,
      test_firm_id: null,
    };
    const existingConfig = {
      id: { 200: 505050 },
      name_nl: "old_name_nl",
      text: "main.liquid",
      text_parts: {
        old_part: "text_parts/old_part.liquid",
        part_1: "text_parts/part_1.liquid",
      },
      name_fr: "",
      name_en: "",
      account_range: null,
      mapping_list_ranges: [],
      hide_code: false,
      published: true,
      test_firm_id: null,
    };

    const tempDir = path.join(process.cwd(), "tmp");
    const expectedFolderPath = path.join(tempDir, "account_templates", name_nl);
    const configPath = path.join(expectedFolderPath, "config.json");
    const mainLiquidPath = path.join(expectedFolderPath, "main.liquid");
    const part1LiquidPath = path.join(expectedFolderPath, "text_parts", "part_1.liquid");
    const oldPartLiquidPath = path.join(expectedFolderPath, "text_parts", "old_part.liquid");
    const testLiquidPath = path.join(expectedFolderPath, "tests", `${name_nl}_liquid_test.yml`);

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

    it("should return false if name_nl is missing", () => {
      const result = AccountTemplate.save("firm", 100, { id: 808080 });
      expect(result).toBe(false);
    });

    it("should return false if the liquid code is missing", () => {
      templateUtils.missingLiquidCode.mockReturnValue(true);
      const result = AccountTemplate.save("firm", 100, template);
      expect(result).toBe(false);
      expect(templateUtils.missingLiquidCode).toHaveBeenCalledWith(template);
    });

    it("should return false if the template handle is invalid", () => {
      templateUtils.checkValidName.mockReturnValue(false);
      const result = AccountTemplate.save("firm", 100, template);
      expect(result).toBe(false);
      expect(templateUtils.checkValidName).toHaveBeenCalledWith("name_nl", "accountTemplate");
    });

    it("should create the necessary files and store template's relevant details", async () => {
      templateUtils.missingLiquidCode.mockReturnValue(false);
      templateUtils.checkValidName.mockReturnValue(true);
      templateUtils.filterParts.mockReturnValue({ part_1: "Part 1 content" });

      await AccountTemplate.save("firm", 100, template);

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
      expect(configSaved).toEqual(configToWrite);
      // Check liquid test file
      expect(fs.existsSync(testLiquidPath)).toBe(true);
      const testLiquidContent = await fsPromises.readFile(testLiquidPath, "utf-8");
      expect(testLiquidContent).toBe(template.tests);
    });

    it("should fetch an existing template's config and update with new details", async () => {
      templateUtils.missingLiquidCode.mockReturnValue(false);
      templateUtils.checkValidName.mockReturnValue(true);
      templateUtils.filterParts.mockReturnValue(textParts);

      fs.mkdirSync(path.join(tempDir, "account_templates"));
      fs.mkdirSync(path.join(tempDir, "account_templates", "name_nl"));
      fs.writeFileSync(configPath, JSON.stringify(existingConfig));

      // Check existing config file before save
      expect(fs.existsSync(configPath)).toBe(true);
      let configSaved = JSON.parse(await fsPromises.readFile(configPath, "utf-8"));
      expect(configSaved).toEqual(existingConfig);

      await AccountTemplate.save("firm", 100, template);

      // Check config file after save
      const expectedConfig = {
        id: { 100: 808080, 200: 505050 },
        partner_id: {},
        externally_managed: true,
        name_en: "",
        name_nl: "name_nl",
        name_fr: "",
        text: "main.liquid",
        test: "tests/name_nl_liquid_test.yml",
        text_parts: {
          part_1: "text_parts/part_1.liquid",
        },
        account_range: null,
        mapping_list_ranges: [],
        hide_code: true,
        published: true,
        test_firm_id: null,
      };
      expect(fs.existsSync(configPath)).toBe(true);
      configSaved = JSON.parse(await fsPromises.readFile(configPath, "utf-8"));
      expect(configSaved).toEqual(expectedConfig);
    });

    it("should replace existing liquid files if the template already exists", async () => {
      templateUtils.missingLiquidCode.mockReturnValue(false);
      templateUtils.checkValidName.mockReturnValue(true);
      templateUtils.filterParts.mockReturnValue(textParts);

      fs.mkdirSync(path.join(tempDir, "account_templates"));
      fs.mkdirSync(path.join(tempDir, "account_templates", "name_nl"));
      fs.mkdirSync(path.join(tempDir, "account_templates", "name_nl", "text_parts"));
      fs.writeFileSync(configPath, JSON.stringify(existingConfig));
      fs.writeFileSync(mainLiquidPath, "Main part: existing content");
      fs.writeFileSync(part1LiquidPath, "Part 1: existing content");

      await AccountTemplate.save("firm", 100, template);

      // Check main liquid file
      const mainLiquidContent = await fsPromises.readFile(mainLiquidPath, "utf-8");
      expect(mainLiquidContent).toBe(template.text);
      // Check text parts liquid files
      const part1LiquidContent = await fsPromises.readFile(part1LiquidPath, "utf-8");
      expect(part1LiquidContent).toBe(textParts.part_1);
    });

    it("should not replace existing liquid test files if the template already exists", async () => {
      templateUtils.missingLiquidCode.mockReturnValue(false);
      templateUtils.checkValidName.mockReturnValue(true);
      templateUtils.filterParts.mockReturnValue(textParts);

      const existingLiquidTest = "Existing Liquid Test";

      fs.mkdirSync(path.join(tempDir, "account_templates"));
      fs.mkdirSync(path.join(tempDir, "account_templates", "name_nl"));
      fs.mkdirSync(path.join(tempDir, "account_templates", "name_nl", "tests"));
      fs.writeFileSync(configPath, JSON.stringify(existingConfig));
      fs.writeFileSync(testLiquidPath, existingLiquidTest);

      await AccountTemplate.save("firm", 100, template);

      // Check liquid test file
      const testLiquidContent = await fsPromises.readFile(testLiquidPath, "utf-8");
      expect(testLiquidContent).toBe(existingLiquidTest);
    });

    // NOTE: Do we need to modify this behavior?
    it("should not replace or delete unspecified text_parts", async () => {
      templateUtils.missingLiquidCode.mockReturnValue(false);
      templateUtils.checkValidName.mockReturnValue(true);
      templateUtils.filterParts.mockReturnValue(textParts);

      const existingPartContent = "Old part: existing Part Content";

      fs.mkdirSync(path.join(tempDir, "account_templates"));
      fs.mkdirSync(path.join(tempDir, "account_templates", "name_nl"));
      fs.mkdirSync(path.join(tempDir, "account_templates", "name_nl", "text_parts"));
      fs.writeFileSync(configPath, JSON.stringify(existingConfig));
      fs.writeFileSync(oldPartLiquidPath, existingPartContent);

      await AccountTemplate.save("firm", 100, template);

      // Check Old Part liquid file
      const oldPartLiquidContent = await fsPromises.readFile(oldPartLiquidPath, "utf-8");
      expect(oldPartLiquidContent).toBe(existingPartContent);
    });

    it("should not overwrite existing YAML test files when importing a template", async () => {
      templateUtils.missingLiquidCode.mockReturnValue(false);
      templateUtils.checkValidName.mockReturnValue(true);
      templateUtils.filterParts.mockReturnValue(textParts);

      const existingYamlContent = "existing:\n  yaml:\n    content: true\n  tests:\n    - test1\n    - test2";

      // Create existing template structure
      fs.mkdirSync(path.join(tempDir, "account_templates"));
      fs.mkdirSync(path.join(tempDir, "account_templates", "name_nl"));
      fs.mkdirSync(path.join(tempDir, "account_templates", "name_nl", "tests"));
      fs.writeFileSync(configPath, JSON.stringify(existingConfig));
      fs.writeFileSync(testLiquidPath, existingYamlContent);

      // Verify the existing YAML file exists and has the expected content
      expect(fs.existsSync(testLiquidPath)).toBe(true);
      let yamlContent = await fsPromises.readFile(testLiquidPath, "utf-8");
      expect(yamlContent).toBe(existingYamlContent);

      // Import the template
      await AccountTemplate.save("firm", 100, template);

      // Verify the YAML file still contains the original content and wasn't overwritten
      yamlContent = await fsPromises.readFile(testLiquidPath, "utf-8");
      expect(yamlContent).toBe(existingYamlContent);
      expect(yamlContent).not.toBe(template.tests);
    });
  });

  describe("read", () => {
    const name = "test_account_template";
    const tempDir = path.join(process.cwd(), "tmp");
    const templateDir = path.join(tempDir, "account_templates", name);
    const configPath = path.join(templateDir, "config.json");
    const mainLiquidPath = path.join(templateDir, "main.liquid");
    const testLiquidPath = path.join(templateDir, "tests", `${name}_liquid_test.yml`);
    const part1LiquidPath = path.join(templateDir, "text_parts", "part_1.liquid");

    const configContent = {
      id: { 100: 808080 },
      name_en: "test_account_template",
      name_nl: "test_account_template",
      name_fr: "test_account_template",
      text: "main.liquid",
      text_parts: {
        part_1: "text_parts/part_1.liquid",
      },
      externally_managed: true,
      account_range: null,
      mapping_list_ranges: [],
      hide_code: true,
      published: true,
    };

    beforeEach(() => {
      if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, { recursive: true });
      }
      process.chdir(tempDir);

      // Create necessary directories and files
      fs.mkdirSync(templateDir, { recursive: true });
      fs.mkdirSync(path.join(templateDir, "text_parts"), { recursive: true });
      fs.mkdirSync(path.join(templateDir, "tests"), { recursive: true });
      fs.writeFileSync(configPath, JSON.stringify(configContent));
      fs.writeFileSync(mainLiquidPath, "Main liquid content");
      fs.writeFileSync(part1LiquidPath, "Part 1 content");
      fs.writeFileSync(testLiquidPath, "# Add your Liquid Tests here");

      // Mock valid name check
      templateUtils.checkValidName.mockReturnValue(true);
    });

    afterEach(() => {
      if (fs.existsSync(tempDir)) {
        fs.rmdirSync(tempDir, { recursive: true });
      }
      jest.resetAllMocks();
    });

    it("should read and process the account template correctly", () => {
      const result = AccountTemplate.read(name);

      expect(result).toEqual({
        name_en: "test_account_template",
        name_nl: "test_account_template",
        name_fr: "test_account_template",
        externally_managed: true,
        account_range: null,
        mapping_list_ranges: [],
        hide_code: true,
        published: true,
        text: "Main liquid content",
        text_parts: [{ name: "part_1", content: "Part 1 content" }],
      });
    });

    it("should create liquid test file if it's missing", async () => {
      await fsPromises.unlink(testLiquidPath);

      AccountTemplate.read(name);

      expect(fs.existsSync(testLiquidPath)).toBe(true);
      const content = await fsPromises.readFile(testLiquidPath, "utf-8");
      expect(content).toBe("# Add your Liquid Tests here");
    });
  });
});
