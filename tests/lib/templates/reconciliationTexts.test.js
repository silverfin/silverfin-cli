const fs = require("fs");
const fsPromises = require("fs").promises;
const os = require("os");
const path = require("path");
const templateUtils = require("../../../lib/utils/templateUtils");
const { ReconciliationText } = require("../../../lib/templates/reconciliationText");

jest.mock("../../../lib/utils/templateUtils");
jest.mock("consola");

// Load shared fixtures
const apiResponse = require("../../../fixtures/api-responses/reconciliation-texts/single.json");
const existingConfigFixture = require("../../../fixtures/market-repo/reconciliation_texts/reconciliation_text_2/config.json");

describe("ReconciliationText", () => {
  describe("save", () => {
    // API response fixture
    const template = apiResponse;
    const handle = template.handle; // "reconciliation_text_1"

    // The text parts mock return value (filterParts is mocked)
    const textParts = { part_1: "Part 1: updated content" };

    // Expected config written after save("firm", 100, template)
    // Derived from API response fixture + ReconciliationText.CONFIG_ITEMS
    const configToWrite = {
      id: { 100: template.id },
      partner_id: {},
      test: `tests/${template.handle}_liquid_test.yml`,
      handle: template.handle,
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
      auto_hide_formula: template.auto_hide_formula,
      virtual_account_number: template.virtual_account_number,
      reconciliation_type: template.reconciliation_type,
      public: template.public,
      allow_duplicate_reconciliations: template.allow_duplicate_reconciliations,
      is_active: template.is_active,
      externally_managed: template.externally_managed,
      published: template.published,
      hide_code: template.hide_code,
      use_full_width: template.use_full_width,
      downloadable_as_docx: template.downloadable_as_docx,
      test_firm_id: template.test_firm_id,
      text: "main.liquid",
      text_parts: {
        part_1: "text_parts/part_1.liquid",
      },
    };

    // Use a different fixture (reconciliation_text_2) as the "existing" config on disk
    const existingConfig = existingConfigFixture;

    const repoRoot = path.resolve(__dirname, "../../..");
    let tempDir;
    let expectedFolderPath;
    let configPath;
    let mainLiquidPath;
    let testLiquidPath;
    let readmePath;
    let part1LiquidPath;

    beforeEach(() => {
      tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "sf-cli-test-"));
      process.chdir(tempDir);

      expectedFolderPath = path.join(tempDir, "reconciliation_texts", handle);
      configPath = path.join(expectedFolderPath, "config.json");
      mainLiquidPath = path.join(expectedFolderPath, "main.liquid");
      testLiquidPath = path.join(expectedFolderPath, "tests", `${handle}_liquid_test.yml`);
      readmePath = path.join(expectedFolderPath, "tests", "README.md");
      part1LiquidPath = path.join(expectedFolderPath, "text_parts", "part_1.liquid");
    });

    afterEach(() => {
      process.chdir(repoRoot);
      if (tempDir && fs.existsSync(tempDir)) fs.rmSync(tempDir, { recursive: true, force: true });
      jest.resetAllMocks();
    });

    it("should return false if the template handle is missing", async () => {
      const result = await ReconciliationText.save("firm", 100, { id: template.id });
      expect(result).toBe(false);
      expect(require("consola").warn).toHaveBeenCalledWith(`Template with id "${template.id}" has no handle, add a handle before importing it from Silverfin. Skipped`);
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
      expect(templateUtils.checkValidName).toHaveBeenCalledWith(template.handle, "reconciliationText");
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
      fs.mkdirSync(path.join(tempDir, "reconciliation_texts", handle));
      fs.writeFileSync(configPath, JSON.stringify(existingConfig));

      // Check existing config file before save
      expect(fs.existsSync(configPath)).toBe(true);
      const configSaved = JSON.parse(await fsPromises.readFile(configPath, "utf-8"));
      expect(configSaved).toEqual(existingConfig);

      await ReconciliationText.save("firm", 100, template);

      // After save, the config should merge existing ids with new API data
      // The ids from existingConfig (reconciliation_text_2) should be preserved
      // and the new id from the API response should be added under key "100"
      const configSavedAfter = JSON.parse(await fsPromises.readFile(configPath, "utf-8"));
      expect(configSavedAfter.id[100]).toBe(template.id);
      // Existing ids from the fixture config should be preserved
      expect(configSavedAfter.id["1001"]).toBe(existingConfig.id["1001"]);
      expect(configSavedAfter.handle).toBe(template.handle);
      expect(configSavedAfter.externally_managed).toBe(template.externally_managed);
    });

    it("should replace existing liquid files if the template already exists", async () => {
      templateUtils.missingLiquidCode.mockReturnValue(false);
      templateUtils.checkValidName.mockReturnValue(true);
      templateUtils.filterParts.mockReturnValue(textParts);

      fs.mkdirSync(path.join(tempDir, "reconciliation_texts"));
      fs.mkdirSync(path.join(tempDir, "reconciliation_texts", handle));
      fs.mkdirSync(path.join(tempDir, "reconciliation_texts", handle, "text_parts"));
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
      fs.mkdirSync(path.join(tempDir, "reconciliation_texts", handle));
      fs.mkdirSync(path.join(tempDir, "reconciliation_texts", handle, "tests"));
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
      const oldPartLiquidPath = path.join(expectedFolderPath, "text_parts", "old_part.liquid");

      fs.mkdirSync(path.join(tempDir, "reconciliation_texts"));
      fs.mkdirSync(path.join(tempDir, "reconciliation_texts", handle));
      fs.mkdirSync(path.join(tempDir, "reconciliation_texts", handle, "text_parts"));
      fs.writeFileSync(configPath, JSON.stringify(existingConfig));
      fs.writeFileSync(oldPartLiquidPath, existingPartContent);

      await ReconciliationText.save("firm", 100, template);

      // Check Old Part liquid file
      const oldPartLiquidContent = await fsPromises.readFile(oldPartLiquidPath, "utf-8");
      expect(oldPartLiquidContent).toBe(existingPartContent);
    });

    it("should preserve subfolder paths in config and write part files to subfolder on re-import", async () => {
      templateUtils.missingLiquidCode.mockReturnValue(false);
      templateUtils.checkValidName.mockReturnValue(true);
      templateUtils.filterParts.mockReturnValue(textParts);

      const existingConfigWithSubfolder = {
        ...existingConfig,
        text_parts: { part_1: "text_parts/tables/part_1.liquid" },
      };
      const subfolderPath = path.join(expectedFolderPath, "text_parts", "tables");
      const partInSubfolderPath = path.join(subfolderPath, "part_1.liquid");

      fs.mkdirSync(path.join(tempDir, "reconciliation_texts"));
      fs.mkdirSync(path.join(tempDir, "reconciliation_texts", "example_handle"));
      fs.mkdirSync(path.join(tempDir, "reconciliation_texts", "example_handle", "text_parts"));
      fs.mkdirSync(subfolderPath);
      fs.writeFileSync(configPath, JSON.stringify(existingConfigWithSubfolder));
      fs.writeFileSync(partInSubfolderPath, "Old content in subfolder");

      await ReconciliationText.save("firm", 100, template);

      const configSaved = JSON.parse(await fsPromises.readFile(configPath, "utf-8"));
      expect(configSaved.text_parts.part_1).toBe("text_parts/tables/part_1.liquid");

      const partContent = await fsPromises.readFile(partInSubfolderPath, "utf-8");
      expect(partContent).toBe(textParts.part_1);
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
      fs.mkdirSync(path.join(tempDir, "reconciliation_texts", handle));
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
      process.chdir(path.resolve(__dirname, "../../.."));
      if (fs.existsSync(tempDir)) {
        fs.rmSync(tempDir, { recursive: true, force: true });
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

    it("should read a text part from a subdirectory when config path is set manually", () => {
      // User manually set config to point to a subfolder; file lives there
      const subDir = path.join(templateDir, "text_parts", "tables");
      fs.mkdirSync(subDir, { recursive: true });
      fs.renameSync(part1LiquidPath, path.join(subDir, "part_1.liquid"));

      const configWithSubfolderPath = { ...configContent, text_parts: { part_1: "text_parts/tables/part_1.liquid" } };
      fs.writeFileSync(configPath, JSON.stringify(configWithSubfolderPath));

      const result = ReconciliationText.read(handle);

      expect(result.text_parts).toEqual([{ name: "part_1", content: "Part 1 content" }]);
    });

    it("should read a text part nested multiple levels deep when config path is set manually", () => {
      const deepDir = path.join(templateDir, "text_parts", "section", "subsection");
      fs.mkdirSync(deepDir, { recursive: true });
      fs.writeFileSync(path.join(deepDir, "part_1.liquid"), "Part 1 content");
      fs.unlinkSync(part1LiquidPath);

      const configWithDeepPath = { ...configContent, text_parts: { part_1: "text_parts/section/subsection/part_1.liquid" } };
      fs.writeFileSync(configPath, JSON.stringify(configWithDeepPath));

      const result = ReconciliationText.read(handle);

      expect(result.text_parts).toEqual([{ name: "part_1", content: "Part 1 content" }]);
    });

    it("should only include parts listed in the config", () => {
      // Extra file on disk not in config is ignored
      fs.writeFileSync(path.join(templateDir, "text_parts", "extra_part.liquid"), "Extra content");

      const result = ReconciliationText.read(handle);

      expect(result.text_parts).toEqual([{ name: "part_1", content: "Part 1 content" }]);
    });

    it("should throw when a text part in config is missing from disk", () => {
      fs.unlinkSync(part1LiquidPath);

      expect(() => ReconciliationText.read(handle)).toThrow();
    });
  });
});
