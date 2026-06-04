const fs = require("fs");
const fsPromises = require("fs").promises;
const os = require("os");
const path = require("path");
const templateUtils = require("../../../lib/utils/templateUtils");
const { AccountTemplate } = require("../../../lib/templates/accountTemplate");

jest.mock("../../../lib/utils/templateUtils");
jest.mock("consola");

// Load shared fixtures
const apiResponse = require("../../../fixtures/api-responses/account-templates/single.json");
const existingConfigFixture = require("../../../fixtures/market-repo/account_templates/account_2/config.json");

describe("AccountTemplate", () => {
  describe("save", () => {
    // API response fixture (account_1)
    const template = apiResponse;
    const name_nl = template.name_nl; // "account_1"

    // The text parts mock return value (filterParts is mocked)
    const textParts = { detail: "Detail: updated content" };

    // Expected config written after save("firm", 100, template)
    // AccountTemplate.CONFIG_ITEMS: name_en, name_nl, name_fr, name_de, name_da, name_se, name_fi,
    //   description_en, description_nl, description_fr, description_de, description_da, description_se, description_fi,
    //   externally_managed, account_range, mapping_list_ranges, published, hide_code, test_firm_id
    const configToWrite = {
      id: { 100: template.id },
      partner_id: {},
      test: `tests/${name_nl}_liquid_test.yml`,
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
      externally_managed: template.externally_managed,
      account_range: template.account_range,
      mapping_list_ranges: [],
      published: template.published,
      hide_code: template.hide_code,
      test_firm_id: template.test_firm_id,
      text: "main.liquid",
      text_parts: {
        detail: "text_parts/detail.liquid",
      },
    };

    // Use account_2 fixture as the "existing" config on disk
    const existingConfig = existingConfigFixture;

    const repoRoot = path.resolve(__dirname, "../../..");
    let tempDir;
    let expectedFolderPath;
    let configPath;
    let mainLiquidPath;
    let part1LiquidPath;
    let testLiquidPath;

    beforeEach(() => {
      tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "sf-cli-test-"));
      process.chdir(tempDir);

      expectedFolderPath = path.join(tempDir, "account_templates", name_nl);
      configPath = path.join(expectedFolderPath, "config.json");
      mainLiquidPath = path.join(expectedFolderPath, "main.liquid");
      part1LiquidPath = path.join(expectedFolderPath, "text_parts", "detail.liquid");
      testLiquidPath = path.join(expectedFolderPath, "tests", `${name_nl}_liquid_test.yml`);
    });

    afterEach(() => {
      process.chdir(repoRoot);
      if (tempDir && fs.existsSync(tempDir)) fs.rmSync(tempDir, { recursive: true, force: true });
      jest.resetAllMocks();
    });

    it("should return false if name_nl is missing", () => {
      templateUtils.missingNameNL.mockReturnValue(true);
      const result = AccountTemplate.save("firm", 100, { id: template.id });
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
      expect(templateUtils.checkValidName).toHaveBeenCalledWith(template.name_nl, "accountTemplate");
    });

    it("should create the necessary files and store template's relevant details", async () => {
      templateUtils.missingNameNL.mockReturnValue(false);
      templateUtils.missingLiquidCode.mockReturnValue(false);
      templateUtils.checkValidName.mockReturnValue(true);
      templateUtils.filterParts.mockReturnValue({ detail: "Detail content" });

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
      expect(part1LiquidContent).toBe("Detail content");
      // Check config file
      expect(fs.existsSync(configPath)).toBe(true);
      const configSaved = JSON.parse(await fsPromises.readFile(configPath, "utf-8"));
      expect(configSaved).toEqual(configToWrite);
      // Check liquid test file
      expect(fs.existsSync(testLiquidPath)).toBe(true);
      const testLiquidContent = await fsPromises.readFile(testLiquidPath, "utf-8");
      expect(testLiquidContent).toBe("# Add your Liquid Tests here");
    });

    it("should fetch an existing template's config and update with new details", async () => {
      templateUtils.missingNameNL.mockReturnValue(false);
      templateUtils.missingLiquidCode.mockReturnValue(false);
      templateUtils.checkValidName.mockReturnValue(true);
      templateUtils.filterParts.mockReturnValue(textParts);

      fs.mkdirSync(path.join(tempDir, "account_templates"));
      fs.mkdirSync(path.join(tempDir, "account_templates", name_nl));
      fs.writeFileSync(configPath, JSON.stringify(existingConfig));

      // Check existing config file before save
      expect(fs.existsSync(configPath)).toBe(true);
      let configSaved = JSON.parse(await fsPromises.readFile(configPath, "utf-8"));
      expect(configSaved).toEqual(existingConfig);

      await AccountTemplate.save("firm", 100, template);

      // After save, ids from existingConfig should be preserved and new id added
      configSaved = JSON.parse(await fsPromises.readFile(configPath, "utf-8"));
      expect(configSaved.id[100]).toBe(template.id);
      expect(configSaved.id["1001"]).toBe(existingConfig.id["1001"]);
      expect(configSaved.name_nl).toBe(template.name_nl);
      expect(configSaved.externally_managed).toBe(template.externally_managed);
    });

    it("should replace existing liquid files if the template already exists", async () => {
      templateUtils.missingNameNL.mockReturnValue(false);
      templateUtils.missingLiquidCode.mockReturnValue(false);
      templateUtils.checkValidName.mockReturnValue(true);
      templateUtils.filterParts.mockReturnValue(textParts);

      fs.mkdirSync(path.join(tempDir, "account_templates"));
      fs.mkdirSync(path.join(tempDir, "account_templates", name_nl));
      fs.mkdirSync(path.join(tempDir, "account_templates", name_nl, "text_parts"));
      fs.writeFileSync(configPath, JSON.stringify(existingConfig));
      fs.writeFileSync(mainLiquidPath, "Main part: existing content");
      fs.writeFileSync(part1LiquidPath, "Detail: existing content");

      await AccountTemplate.save("firm", 100, template);

      // Check main liquid file
      const mainLiquidContent = await fsPromises.readFile(mainLiquidPath, "utf-8");
      expect(mainLiquidContent).toBe(template.text);
      // Check text parts liquid files
      const part1LiquidContent = await fsPromises.readFile(part1LiquidPath, "utf-8");
      expect(part1LiquidContent).toBe(textParts.detail);
    });

    it("should not replace existing liquid test files if the template already exists", async () => {
      templateUtils.missingNameNL.mockReturnValue(false);
      templateUtils.missingLiquidCode.mockReturnValue(false);
      templateUtils.checkValidName.mockReturnValue(true);
      templateUtils.filterParts.mockReturnValue(textParts);

      const existingLiquidTest = "Existing Liquid Test";

      fs.mkdirSync(path.join(tempDir, "account_templates"));
      fs.mkdirSync(path.join(tempDir, "account_templates", name_nl));
      fs.mkdirSync(path.join(tempDir, "account_templates", name_nl, "tests"));
      fs.writeFileSync(configPath, JSON.stringify(existingConfig));
      fs.writeFileSync(testLiquidPath, existingLiquidTest);

      await AccountTemplate.save("firm", 100, template);

      // Check liquid test file
      const testLiquidContent = await fsPromises.readFile(testLiquidPath, "utf-8");
      expect(testLiquidContent).toBe(existingLiquidTest);
    });

    // NOTE: Do we need to modify this behavior?
    it("should not replace or delete unspecified text_parts", async () => {
      templateUtils.missingNameNL.mockReturnValue(false);
      templateUtils.missingLiquidCode.mockReturnValue(false);
      templateUtils.checkValidName.mockReturnValue(true);
      templateUtils.filterParts.mockReturnValue(textParts);

      const existingPartContent = "Old part: existing Part Content";
      const oldPartLiquidPath = path.join(expectedFolderPath, "text_parts", "old_part.liquid");

      fs.mkdirSync(path.join(tempDir, "account_templates"));
      fs.mkdirSync(path.join(tempDir, "account_templates", name_nl));
      fs.mkdirSync(path.join(tempDir, "account_templates", name_nl, "text_parts"));
      fs.writeFileSync(configPath, JSON.stringify(existingConfig));
      fs.writeFileSync(oldPartLiquidPath, existingPartContent);

      await AccountTemplate.save("firm", 100, template);

      // Check Old Part liquid file
      const oldPartLiquidContent = await fsPromises.readFile(oldPartLiquidPath, "utf-8");
      expect(oldPartLiquidContent).toBe(existingPartContent);
    });

    it("should not overwrite existing YAML test files when importing a template", async () => {
      templateUtils.missingNameNL.mockReturnValue(false);
      templateUtils.missingLiquidCode.mockReturnValue(false);
      templateUtils.checkValidName.mockReturnValue(true);
      templateUtils.filterParts.mockReturnValue(textParts);

      const existingYamlContent = "existing:\n  yaml:\n    content: true\n  tests:\n    - test1\n    - test2";

      // Create existing template structure
      fs.mkdirSync(path.join(tempDir, "account_templates"));
      fs.mkdirSync(path.join(tempDir, "account_templates", name_nl));
      fs.mkdirSync(path.join(tempDir, "account_templates", name_nl, "tests"));
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
      expect(yamlContent).not.toBe("# Add your Liquid Tests here");
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
      process.chdir(path.resolve(__dirname, "../../.."));
      if (fs.existsSync(tempDir)) {
        fs.rmSync(tempDir, { recursive: true, force: true });
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
