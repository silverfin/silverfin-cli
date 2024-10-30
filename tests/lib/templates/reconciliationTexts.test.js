const fs = require("fs");
const fsPromises = require("fs").promises;
const path = require("path");
const fsUtils = require("../../../lib/utils/fsUtils");
const templateUtils = require("../../../lib/utils/templateUtils");
const {
  ReconciliationText,
} = require("../../../lib/templates/reconciliationText");

jest.mock("../../../lib/utils/templateUtils");
jest.mock("consola");

describe("ReconciliationText", () => {
  describe("save", () => {
    const testContent = "Test content as string";
    const textParts = { part_1: "Part 1: updated content" };
    const template = {
      handle: "example_handle",
      id: 808080,
      text: "Main liquid content",
      text_parts: [
        { name: "part_1", content: "Part 1: updated content" },
        { name: "", content: "" },
      ],
      tests: testContent,
      externally_managed: true,
    };
    const handle = template.handle;
    const configToWrite = {
      id: {
        100: 808080,
      },
      partner_id: {},
      handle: "example_handle",
      text: "main.liquid",
      text_parts: {
        part_1: "text_parts/part_1.liquid",
      },
      test: "tests/example_handle_liquid_test.yml",
      externally_managed: true,
      auto_hide_formula: "",
      downloadable_as_docx: false,
      hide_code: true,
      is_active: true,
      name_en: "example_handle",
      name_fr: "example_handle",
      name_nl: "example_handle",
      public: false,
      published: true,
      reconciliation_type: "only_reconciled_with_data",
      use_full_width: true,
      virtual_account_number: "",
    };
    const existingConfig = {
      id: { 200: 505050 },
      handle: "old_handle",
      text: "main.liquid",
      text_parts: {
        old_part: "text_parts/old_part.liquid",
        part_1: "text_parts/part_1.liquid",
      },
      externally_managed: false,
      auto_hide_formula: "",
      downloadable_as_docx: false,
      hide_code: true,
      is_active: true,
      name_en: "example_handle",
      name_fr: "example_handle",
      name_nl: "example_handle",
      public: false,
      published: true,
      reconciliation_type: "only_reconciled_with_data",
      use_full_width: true,
      virtual_account_number: "",
    };

    const tempDir = path.join(process.cwd(), "tmp");
    const expectedFolderPath = path.join(
      tempDir,
      "reconciliation_texts",
      handle
    );
    const configPath = path.join(expectedFolderPath, "config.json");
    const mainLiquidPath = path.join(expectedFolderPath, "main.liquid");
    const testLiquidPath = path.join(
      expectedFolderPath,
      "tests",
      `${handle}_liquid_test.yml`
    );
    const part1LiquidPath = path.join(
      expectedFolderPath,
      "text_parts",
      "part_1.liquid"
    );
    const oldPartLiquidPath = path.join(
      expectedFolderPath,
      "text_parts",
      "old_part.liquid"
    );

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

    it("should return false if the template handle is missing", async () => {
      const result = await ReconciliationText.save("firm", 100, { id: 808080 });
      expect(result).toBe(false);
      expect(require("consola").warn).toHaveBeenCalledWith(
        'Template with id "808080" has no handle, add a handle before importing it from Silverfin. Skipped'
      );
    });

    it("should return false if the liquid code is missing", async () => {
      templateUtils.missingLiquidCode.mockReturnValue(true);
      const result = await ReconciliationText.save("firm", 100, template);
      expect(result).toBe(false);
      expect(templateUtils.missingLiquidCode).toHaveBeenCalledWith(template);
    });

    it("should return false if the template handle is invalid", async () => {
      templateUtils.checkValidName.mockReturnValue(false);
      const result = await ReconciliationText.save("firm", 100, template);
      expect(result).toBe(false);
      expect(templateUtils.checkValidName).toHaveBeenCalledWith(
        "example_handle",
        "reconciliationText"
      );
    });

    it("should create the necessary files and store template's relevant details", async () => {
      templateUtils.missingLiquidCode.mockReturnValue(false);
      templateUtils.checkValidName.mockReturnValue(true);
      templateUtils.filterParts.mockReturnValue({ part_1: "Part 1 content" });

      await ReconciliationText.save("firm", 100, template);

      // Check folder creation
      expect(fs.existsSync(expectedFolderPath)).toBe(true);
      // Check main liquid file
      expect(fs.existsSync(mainLiquidPath)).toBe(true);
      const mainLiquidContent = await fsPromises.readFile(
        mainLiquidPath,
        "utf-8"
      );
      expect(mainLiquidContent).toBe(template.text);
      // Check text parts liquid files
      expect(fs.existsSync(part1LiquidPath)).toBe(true);
      const part1LiquidContent = await fsPromises.readFile(
        part1LiquidPath,
        "utf-8"
      );
      expect(part1LiquidContent).toBe("Part 1 content");
      // Check liquid test file
      expect(fs.existsSync(testLiquidPath)).toBe(true);
      const testLiquidContent = await fsPromises.readFile(
        testLiquidPath,
        "utf-8"
      );
      expect(testLiquidContent).toBe(template.tests);
      // Check config file
      expect(fs.existsSync(configPath)).toBe(true);
      const configSaved = JSON.parse(
        await fsPromises.readFile(configPath, "utf-8")
      );
      expect(configSaved).toEqual(configToWrite);
    });

    it("should fetch an existing template's config and update with new details", async () => {
      templateUtils.missingLiquidCode.mockReturnValue(false);
      templateUtils.checkValidName.mockReturnValue(true);
      templateUtils.filterParts.mockReturnValue(textParts);

      fs.mkdirSync(path.join(tempDir, "reconciliation_texts"));
      fs.mkdirSync(
        path.join(tempDir, "reconciliation_texts", "example_handle")
      );
      fs.writeFileSync(configPath, JSON.stringify(existingConfig));

      // Check existing config file before save
      expect(fs.existsSync(configPath)).toBe(true);
      let configSaved = JSON.parse(
        await fsPromises.readFile(configPath, "utf-8")
      );
      expect(configSaved).toEqual(existingConfig);

      await ReconciliationText.save("firm", 100, template);

      // Check config file after save
      configToWrite.id[200] = 505050;
      expect(fs.existsSync(configPath)).toBe(true);
      configSaved = JSON.parse(await fsPromises.readFile(configPath, "utf-8"));
      expect(configSaved).toEqual(configToWrite);
    });

    it("should replace existing liquid files if the template already exists", async () => {
      templateUtils.missingLiquidCode.mockReturnValue(false);
      templateUtils.checkValidName.mockReturnValue(true);
      templateUtils.filterParts.mockReturnValue(textParts);

      fs.mkdirSync(path.join(tempDir, "reconciliation_texts"));
      fs.mkdirSync(
        path.join(tempDir, "reconciliation_texts", "example_handle")
      );
      fs.mkdirSync(
        path.join(
          tempDir,
          "reconciliation_texts",
          "example_handle",
          "text_parts"
        )
      );
      fs.writeFileSync(configPath, JSON.stringify(existingConfig));
      fs.writeFileSync(mainLiquidPath, "Main part: existing content");
      fs.writeFileSync(part1LiquidPath, "Part 1: existing content");

      await ReconciliationText.save("firm", 100, template);

      // Check main liquid file
      const mainLiquidContent = await fsPromises.readFile(
        mainLiquidPath,
        "utf-8"
      );
      expect(mainLiquidContent).toBe(template.text);
      // Check text parts liquid files
      const part1LiquidContent = await fsPromises.readFile(
        part1LiquidPath,
        "utf-8"
      );
      expect(part1LiquidContent).toBe(textParts.part_1);
    });

    it("should not replace existing liquid test files if the template already exists", async () => {
      templateUtils.missingLiquidCode.mockReturnValue(false);
      templateUtils.checkValidName.mockReturnValue(true);
      templateUtils.filterParts.mockReturnValue(textParts);

      const existingLiquidTest = "Existing Liquid Test";

      fs.mkdirSync(path.join(tempDir, "reconciliation_texts"));
      fs.mkdirSync(
        path.join(tempDir, "reconciliation_texts", "example_handle")
      );
      fs.mkdirSync(
        path.join(tempDir, "reconciliation_texts", "example_handle", "tests")
      );
      fs.writeFileSync(configPath, JSON.stringify(existingConfig));
      fs.writeFileSync(testLiquidPath, existingLiquidTest);

      await ReconciliationText.save("firm", 100, template);

      // Check liquid test file
      const testLiquidContent = await fsPromises.readFile(
        testLiquidPath,
        "utf-8"
      );
      expect(testLiquidContent).toBe(existingLiquidTest);
    });

    // NOTE: Do we need to modify this behavior?
    it("should not replace or delete unspecified text_parts", async () => {
      templateUtils.missingLiquidCode.mockReturnValue(false);
      templateUtils.checkValidName.mockReturnValue(true);
      templateUtils.filterParts.mockReturnValue(textParts);

      const existingPartContent = "Old part: existing Part Content";

      fs.mkdirSync(path.join(tempDir, "reconciliation_texts"));
      fs.mkdirSync(
        path.join(tempDir, "reconciliation_texts", "example_handle")
      );
      fs.mkdirSync(
        path.join(
          tempDir,
          "reconciliation_texts",
          "example_handle",
          "text_parts"
        )
      );
      fs.writeFileSync(configPath, JSON.stringify(existingConfig));
      fs.writeFileSync(oldPartLiquidPath, existingPartContent);

      await ReconciliationText.save("firm", 100, template);

      // Check Old Part liquid file
      const oldPartLiquidContent = await fsPromises.readFile(
        oldPartLiquidPath,
        "utf-8"
      );
      expect(oldPartLiquidContent).toBe(existingPartContent);
    });
  });

  describe("read", () => {
    const handle = "example_handle";
    const tempDir = path.join(process.cwd(), "tmp");
    const templateDir = path.join(tempDir, "reconciliation_texts", handle);
    const configPath = path.join(templateDir, "config.json");
    const mainLiquidPath = path.join(templateDir, "main.liquid");
    const testLiquidPath = path.join(
      templateDir,
      "tests",
      `${handle}_liquid_test.yml`
    );
    const part1LiquidPath = path.join(
      templateDir,
      "text_parts",
      "part_1.liquid"
    );

    const configContent = {
      id: { 100: 808080 },
      handle: "example_handle",
      name_en: "Example Handle",
      name_nl: "Voorbeeld Handle",
      reconciliation_type: "can_be_reconciled_without_data",
      text: "main.liquid",
      text_parts: {
        part_1: "text_parts/part_1.liquid",
      },
      externally_managed: true,
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

      // Mock valid handle check
      templateUtils.checkValidName.mockReturnValue(true);
    });

    afterEach(() => {
      if (fs.existsSync(tempDir)) {
        fs.rmdirSync(tempDir, { recursive: true });
      }
      jest.resetAllMocks();
    });

    it("should return false if the template handle is invalid", () => {
      templateUtils.checkValidName.mockReturnValue(false);
      const result = ReconciliationText.read("invalid_handle");
      expect(result).toBe(false);
      expect(templateUtils.checkValidName).toHaveBeenCalledWith(
        "invalid_handle",
        "reconciliationText"
      );
    });

    it("should read and process the template correctly", () => {
      const result = ReconciliationText.read(handle);

      expect(result).toEqual({
        handle: "example_handle",
        name_en: "Example Handle",
        name_nl: "Voorbeeld Handle",
        reconciliation_type: "can_be_reconciled_without_data",
        externally_managed: true,
        text: "Main liquid content",
        text_parts: [{ name: "part_1", content: "Part 1 content" }],
      });
    });

    it("should create main.liquid if it doesn't exist", async () => {
      await fsPromises.unlink(mainLiquidPath);

      ReconciliationText.read(handle);

      expect(fs.existsSync(mainLiquidPath)).toBe(true);
      const content = await fsPromises.readFile(mainLiquidPath, "utf-8");
      expect(content).toBe("{% comment %} MAIN PART {% endcomment %}");
    });

    it("should create liquid test file if it's missing", async () => {
      await fsPromises.unlink(testLiquidPath);

      ReconciliationText.read(handle);

      expect(fs.existsSync(testLiquidPath)).toBe(true);
      const content = await fsPromises.readFile(testLiquidPath, "utf-8");
      expect(content).toBe("# Add your Liquid Tests here");
    });

    it("should warn and remove invalid reconciliation_type", () => {
      const invalidConfig = {
        ...configContent,
        reconciliation_type: "invalid_type",
      };
      fs.writeFileSync(configPath, JSON.stringify(invalidConfig));

      const result = ReconciliationText.read(handle);

      expect(result).not.toHaveProperty("reconciliation_type");
      expect(require("consola").warn).toHaveBeenCalled();
    });

    it("should add missing handle and names to config", () => {
      const incompleteConfig = { ...configContent };
      delete incompleteConfig.handle;
      delete incompleteConfig.name_en;
      delete incompleteConfig.name_nl;
      fs.writeFileSync(configPath, JSON.stringify(incompleteConfig));

      const result = ReconciliationText.read(handle);

      expect(result.handle).toBe(handle);
      expect(result.name_en).toBe(handle);
      expect(result.name_nl).toBe(handle);
    });

    it("should handle templates with no text parts", () => {
      const noPartsConfig = { ...configContent };
      noPartsConfig.text_parts = {};
      fs.writeFileSync(configPath, JSON.stringify(noPartsConfig));

      const result = ReconciliationText.read(handle);

      expect(result.text_parts).toEqual([]);
    });

    it("should handle empty text parts", () => {
      const emptyPartConfig = {
        ...configContent,
        text_parts: { empty_part: "text_parts/empty_part.liquid" },
      };
      fs.writeFileSync(configPath, JSON.stringify(emptyPartConfig));
      fs.writeFileSync(
        path.join(templateDir, "text_parts", "empty_part.liquid"),
        ""
      );

      const result = ReconciliationText.read(handle);

      expect(result.text_parts).toEqual([{ name: "empty_part", content: "" }]);
    });
  });
});
