const fs = require("fs");
const fsPromises = require("fs").promises;
const path = require("path");
const templateUtils = require("../../../lib/utils/templateUtils");
const { ReconciliationText } = require("../../../lib/templates/reconciliationText");

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
      name_en: "",
      name_nl: "example_handle",
      name_fr: "",
      description_en: "",
      description_fr: "",
      description_nl: "",
      public: false,
      published: true,
      reconciliation_type: "only_reconciled_with_data",
      use_full_width: true,
      virtual_account_number: "",
      test_firm_id: null,
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
      name_nl: "example_handle",
      name_fr: "",
      name_en: "",
      name_de: "",
      name_da: "",
      name_se: "",
      name_fi: "",
      public: false,
      published: true,
      reconciliation_type: "only_reconciled_with_data",
      use_full_width: true,
      virtual_account_number: "",
      test_firm_id: null,
    };

    const tempDir = path.join(process.cwd(), "tmp");
    const expectedFolderPath = path.join(tempDir, "reconciliation_texts", handle);
    const configPath = path.join(expectedFolderPath, "config.json");
    const mainLiquidPath = path.join(expectedFolderPath, "main.liquid");
    const testLiquidPath = path.join(expectedFolderPath, "tests", `${handle}_liquid_test.yml`);
    const readmePath = path.join(expectedFolderPath, "tests", "README.md");
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

    it("should return false if the template handle is missing", async () => {
      const result = await ReconciliationText.save("firm", 100, { id: 808080 });
      expect(result).toBe(false);
      expect(require("consola").warn).toHaveBeenCalledWith('Template with id "808080" has no handle, add a handle before importing it from Silverfin. Skipped');
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
      expect(templateUtils.checkValidName).toHaveBeenCalledWith("example_handle", "reconciliationText");
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
      const mainLiquidContent = await fsPromises.readFile(mainLiquidPath, "utf-8");
      expect(mainLiquidContent).toBe(template.text);
      // Check text parts liquid files
      expect(fs.existsSync(part1LiquidPath)).toBe(true);
      const part1LiquidContent = await fsPromises.readFile(part1LiquidPath, "utf-8");
      expect(part1LiquidContent).toBe("Part 1 content");
      // Check liquid test file
      expect(fs.existsSync(testLiquidPath)).toBe(true);
      const testLiquidContent = await fsPromises.readFile(testLiquidPath, "utf-8");
      expect(testLiquidContent).toBe(template.tests);
      const readmeContent = await fsPromises.readFile(readmePath, "utf-8");
      expect(readmeContent).toContain("Use this Readme file to add extra information about the Liquid Tests ");
      // Check config file
      expect(fs.existsSync(configPath)).toBe(true);
      const configSaved = JSON.parse(await fsPromises.readFile(configPath, "utf-8"));
      expect(configSaved).toEqual(configToWrite);
    });

    it("should fetch an existing template's config and update with new details", async () => {
      templateUtils.missingLiquidCode.mockReturnValue(false);
      templateUtils.checkValidName.mockReturnValue(true);
      templateUtils.filterParts.mockReturnValue(textParts);

      fs.mkdirSync(path.join(tempDir, "reconciliation_texts"));
      fs.mkdirSync(path.join(tempDir, "reconciliation_texts", "example_handle"));
      fs.writeFileSync(configPath, JSON.stringify(existingConfig));

      // Check existing config file before save
      expect(fs.existsSync(configPath)).toBe(true);
      let configSaved = JSON.parse(await fsPromises.readFile(configPath, "utf-8"));
      expect(configSaved).toEqual(existingConfig);

      await ReconciliationText.save("firm", 100, template);

      // Check config file after save
      const expectedConfig = {
        id: { 100: 808080, 200: 505050 },
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
        name_en: "",
        name_nl: "example_handle",
        name_fr: "",
        name_de: "",
        name_da: "",
        name_fi: "",
        name_se: "",
        description_en: "",
        description_fr: "",
        description_nl: "",
        public: false,
        published: true,
        reconciliation_type: "only_reconciled_with_data",
        test_firm_id: null,
        use_full_width: true,
        virtual_account_number: "",
      };
      expect(fs.existsSync(configPath)).toBe(true);
      configSaved = JSON.parse(await fsPromises.readFile(configPath, "utf-8"));
      expect(configSaved).toEqual(expectedConfig);
    });

    it("should replace existing liquid files if the template already exists", async () => {
      templateUtils.missingLiquidCode.mockReturnValue(false);
      templateUtils.checkValidName.mockReturnValue(true);
      templateUtils.filterParts.mockReturnValue(textParts);

      fs.mkdirSync(path.join(tempDir, "reconciliation_texts"));
      fs.mkdirSync(path.join(tempDir, "reconciliation_texts", "example_handle"));
      fs.mkdirSync(path.join(tempDir, "reconciliation_texts", "example_handle", "text_parts"));
      fs.writeFileSync(configPath, JSON.stringify(existingConfig));
      fs.writeFileSync(mainLiquidPath, "Main part: existing content");
      fs.writeFileSync(part1LiquidPath, "Part 1: existing content");

      await ReconciliationText.save("firm", 100, template);

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
      const existingReadmeContent = "Existing Readme content";

      fs.mkdirSync(path.join(tempDir, "reconciliation_texts"));
      fs.mkdirSync(path.join(tempDir, "reconciliation_texts", "example_handle"));
      fs.mkdirSync(path.join(tempDir, "reconciliation_texts", "example_handle", "tests"));
      fs.writeFileSync(configPath, JSON.stringify(existingConfig));
      fs.writeFileSync(testLiquidPath, existingLiquidTest);
      fs.writeFileSync(readmePath, existingReadmeContent);

      await ReconciliationText.save("firm", 100, template);

      // Check liquid test file
      const testLiquidContent = await fsPromises.readFile(testLiquidPath, "utf-8");
      expect(testLiquidContent).toBe(existingLiquidTest);
      const readmeContent = await fsPromises.readFile(readmePath, "utf-8");
      expect(readmeContent).toBe(existingReadmeContent);
    });

    // NOTE: Do we need to modify this behavior?
    it("should not replace or delete unspecified text_parts", async () => {
      templateUtils.missingLiquidCode.mockReturnValue(false);
      templateUtils.checkValidName.mockReturnValue(true);
      templateUtils.filterParts.mockReturnValue(textParts);

      const existingPartContent = "Old part: existing Part Content";

      fs.mkdirSync(path.join(tempDir, "reconciliation_texts"));
      fs.mkdirSync(path.join(tempDir, "reconciliation_texts", "example_handle"));
      fs.mkdirSync(path.join(tempDir, "reconciliation_texts", "example_handle", "text_parts"));
      fs.writeFileSync(configPath, JSON.stringify(existingConfig));
      fs.writeFileSync(oldPartLiquidPath, existingPartContent);

      await ReconciliationText.save("firm", 100, template);

      // Check Old Part liquid file
      const oldPartLiquidContent = await fsPromises.readFile(oldPartLiquidPath, "utf-8");
      expect(oldPartLiquidContent).toBe(existingPartContent);
    });

    it("should save template with all locale names", async () => {
      templateUtils.missingLiquidCode.mockReturnValue(false);
      templateUtils.checkValidName.mockReturnValue(true);
      templateUtils.filterParts.mockReturnValue(textParts);

      const templateWithLocales = {
        ...template,
        name_en: "Custom English Name",
        name_fr: "Nom Français Personnalisé",
        name_nl: "Aangepaste Nederlandse Naam",
        name_de: "Benutzerdefinierter Deutscher Name",
        name_da: "Tilpasset Dansk Navn",
        name_se: "Anpassat Svenskt Namn",
        name_fi: "Mukautettu Suomenkielinen Nimi",
      };

      await ReconciliationText.save("firm", 100, templateWithLocales);

      // Check config file contains all locale names
      expect(fs.existsSync(configPath)).toBe(true);
      const configSaved = JSON.parse(await fsPromises.readFile(configPath, "utf-8"));
      expect(configSaved.name_en).toBe("Custom English Name");
      expect(configSaved.name_fr).toBe("Nom Français Personnalisé");
      expect(configSaved.name_nl).toBe("Aangepaste Nederlandse Naam");
      expect(configSaved.name_de).toBe("Benutzerdefinierter Deutscher Name");
      expect(configSaved.name_da).toBe("Tilpasset Dansk Navn");
      expect(configSaved.name_se).toBe("Anpassat Svenskt Namn");
      expect(configSaved.name_fi).toBe("Mukautettu Suomenkielinen Nimi");
    });

    it("should preserve existing locale names when saving template", async () => {
      templateUtils.missingLiquidCode.mockReturnValue(false);
      templateUtils.checkValidName.mockReturnValue(true);
      templateUtils.filterParts.mockReturnValue(textParts);

      const existingConfigWithLocales = {
        ...existingConfig,
        name_en: "Existing English Name",
        name_fr: "Nom Français Existant",
        name_nl: "Bestaande Nederlandse Naam",
        name_de: "Bestehender Deutscher Name",
        name_da: "Eksisterende Dansk Navn",
        name_se: "Befintligt Svenskt Namn",
        name_fi: "Olemassa Oleva Suomenkielinen Nimi",
      };

      fs.mkdirSync(path.join(tempDir, "reconciliation_texts"));
      fs.mkdirSync(path.join(tempDir, "reconciliation_texts", "example_handle"));
      fs.writeFileSync(configPath, JSON.stringify(existingConfigWithLocales));

      // Save template without locale names
      const templateWithoutLocales = { ...template };
      delete templateWithoutLocales.name_en;
      delete templateWithoutLocales.name_fr;
      delete templateWithoutLocales.name_nl;
      delete templateWithoutLocales.name_de;
      delete templateWithoutLocales.name_da;
      delete templateWithoutLocales.name_se;
      delete templateWithoutLocales.name_fi;

      await ReconciliationText.save("firm", 100, templateWithoutLocales);

      // Check that existing locale names are preserved
      const configSaved = JSON.parse(await fsPromises.readFile(configPath, "utf-8"));
      expect(configSaved.name_en).toBe("Existing English Name");
      expect(configSaved.name_fr).toBe("Nom Français Existant");
      expect(configSaved.name_nl).toBe("Bestaande Nederlandse Naam");
      expect(configSaved.name_de).toBe("Bestehender Deutscher Name");
      expect(configSaved.name_da).toBe("Eksisterende Dansk Navn");
      expect(configSaved.name_se).toBe("Befintligt Svenskt Namn");
      expect(configSaved.name_fi).toBe("Olemassa Oleva Suomenkielinen Nimi");
    });
  });

  describe("read", () => {
    const handle = "example_handle";
    const tempDir = path.join(process.cwd(), "tmp");
    const templateDir = path.join(tempDir, "reconciliation_texts", handle);
    const configPath = path.join(templateDir, "config.json");
    const mainLiquidPath = path.join(templateDir, "main.liquid");
    const testLiquidPath = path.join(templateDir, "tests", `${handle}_liquid_test.yml`);
    const part1LiquidPath = path.join(templateDir, "text_parts", "part_1.liquid");

    const configContent = {
      id: { 100: 808080 },
      handle: "example_handle",
      name_en: "Example Handle",
      name_nl: "Voorbeeld Handle",
      name_fr: "Exemple",
      name_de: "Beispiel Handle",
      name_da: "Eksempel Handle",
      name_se: "Exempel Handle",
      name_fi: "Esimerkki Handle",
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
      expect(templateUtils.checkValidName).toHaveBeenCalledWith("invalid_handle", "reconciliationText");
    });

    it("should read and process the template correctly", () => {
      const result = ReconciliationText.read(handle);

      expect(result).toEqual({
        handle: "example_handle",
        name_en: "Example Handle",
        name_nl: "Voorbeeld Handle",
        name_de: "Beispiel Handle",
        name_da: "Eksempel Handle",
        name_se: "Exempel Handle",
        name_fi: "Esimerkki Handle",
        name_fr: "Exemple",
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
      delete incompleteConfig.name_de;
      delete incompleteConfig.name_da;
      delete incompleteConfig.name_se;
      delete incompleteConfig.name_fi;
      fs.writeFileSync(configPath, JSON.stringify(incompleteConfig));

      const result = ReconciliationText.read(handle);

      expect(result.handle).toBe(handle);
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
      fs.writeFileSync(path.join(templateDir, "text_parts", "empty_part.liquid"), "");

      const result = ReconciliationText.read(handle);

      expect(result.text_parts).toEqual([{ name: "empty_part", content: "" }]);
    });

    it("should exclude downloadable_as_docx and show warning when externally_managed is false", () => {
      const invalidCombinationConfig = {
        ...configContent,
        externally_managed: false,
        downloadable_as_docx: true,
      };
      fs.writeFileSync(configPath, JSON.stringify(invalidCombinationConfig));

      const result = ReconciliationText.read(handle);

      expect(result.downloadable_as_docx).toBeUndefined();
      expect(require("consola").warn).toHaveBeenCalledWith(
        "The following attributes were skipped because they can only be updated when the template is externally managed: downloadable_as_docx."
      );
    });

    it("should include downloadable_as_docx when externally_managed is true", () => {
      const validCombinationConfig = {
        ...configContent,
        externally_managed: true,
        downloadable_as_docx: true,
      };
      fs.writeFileSync(configPath, JSON.stringify(validCombinationConfig));

      const result = ReconciliationText.read(handle);

      expect(result.downloadable_as_docx).toBe(true);
    });

    it("should handle templates with custom locale names", () => {
      const customLocaleConfig = {
        ...configContent,
        name_en: "Custom English Name",
        name_fr: "Nom Français Personnalisé",
        name_nl: "Aangepaste Nederlandse Naam",
        name_de: "Benutzerdefinierter Deutscher Name",
        name_da: "Tilpasset Dansk Navn",
        name_se: "Anpassat Svenskt Namn",
        name_fi: "Mukautettu Suomenkielinen Nimi",
      };
      fs.writeFileSync(configPath, JSON.stringify(customLocaleConfig));

      const result = ReconciliationText.read(handle);

      expect(result.name_en).toBe("Custom English Name");
      expect(result.name_fr).toBe("Nom Français Personnalisé");
      expect(result.name_nl).toBe("Aangepaste Nederlandse Naam");
      expect(result.name_de).toBe("Benutzerdefinierter Deutscher Name");
      expect(result.name_da).toBe("Tilpasset Dansk Navn");
      expect(result.name_se).toBe("Anpassat Svenskt Namn");
      expect(result.name_fi).toBe("Mukautettu Suomenkielinen Nimi");
    });

    it("should add missing locale names to config with handle as fallback", () => {
      const incompleteLocaleConfig = { ...configContent };
      delete incompleteLocaleConfig.name_en;
      delete incompleteLocaleConfig.name_fr;
      delete incompleteLocaleConfig.name_nl;
      delete incompleteLocaleConfig.name_de;
      delete incompleteLocaleConfig.name_da;
      delete incompleteLocaleConfig.name_se;
      delete incompleteLocaleConfig.name_fi;
      fs.writeFileSync(configPath, JSON.stringify(incompleteLocaleConfig));

      const result = ReconciliationText.read(handle);

      expect(result.name_nl).toBe(handle);
    });
  });
});
