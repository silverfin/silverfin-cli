const fs = require("fs");
const path = require("path");
const fsUtils = require("../../../lib/utils/fsUtils");

jest.mock("consola");

const repoRoot = path.resolve(__dirname, "../../..");

describe("fsUtils", () => {
  let tempDir;
  let originalCwd;

  beforeEach(() => {
    jest.clearAllMocks();
    originalCwd = process.cwd();
    tempDir = fs.mkdtempSync(path.join(repoRoot, "tmp-"));
    process.chdir(tempDir);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    if (tempDir && fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  // ─── createFolder ─────────────────────────────────────────────────────────

  describe("createFolder", () => {
    it("should create a folder when it does not exist", () => {
      const folderPath = path.join(tempDir, "new_folder");
      expect(fs.existsSync(folderPath)).toBe(false);

      fsUtils.createFolder(folderPath);

      expect(fs.existsSync(folderPath)).toBe(true);
      expect(fs.statSync(folderPath).isDirectory()).toBe(true);
    });

    it("should be a no-op when the folder already exists", () => {
      const folderPath = path.join(tempDir, "existing_folder");
      fs.mkdirSync(folderPath);
      fs.writeFileSync(path.join(folderPath, "marker.txt"), "content");

      expect(() => fsUtils.createFolder(folderPath)).not.toThrow();
      expect(fs.existsSync(path.join(folderPath, "marker.txt"))).toBe(true);
    });
  });

  // ─── createTemplateFolders ────────────────────────────────────────────────

  describe("createTemplateFolders", () => {
    it("should create main + text_parts + tests subdir when testFolder=true", () => {
      fsUtils.createTemplateFolders("reconciliationText", "test_handle", true);

      expect(fs.existsSync(path.join(tempDir, "reconciliation_texts", "test_handle"))).toBe(true);
      expect(fs.existsSync(path.join(tempDir, "reconciliation_texts", "test_handle", "text_parts"))).toBe(true);
      expect(fs.existsSync(path.join(tempDir, "reconciliation_texts", "test_handle", "tests"))).toBe(true);
    });

    it("should create main + text_parts but NOT tests when testFolder=false", () => {
      fsUtils.createTemplateFolders("exportFile", "test_export", false);

      expect(fs.existsSync(path.join(tempDir, "export_files", "test_export"))).toBe(true);
      expect(fs.existsSync(path.join(tempDir, "export_files", "test_export", "text_parts"))).toBe(true);
      expect(fs.existsSync(path.join(tempDir, "export_files", "test_export", "tests"))).toBe(false);
    });

    it("should default testFolder to true", () => {
      fsUtils.createTemplateFolders("accountTemplate", "my_account");

      expect(fs.existsSync(path.join(tempDir, "account_templates", "my_account", "tests"))).toBe(true);
    });
  });

  // ─── createSharedPartFolders ──────────────────────────────────────────────

  describe("createSharedPartFolders", () => {
    it("should create only the root folder for shared part", () => {
      fsUtils.createSharedPartFolders("my_shared_part");

      expect(fs.existsSync(path.join(tempDir, "shared_parts", "my_shared_part"))).toBe(true);
      expect(fs.existsSync(path.join(tempDir, "shared_parts", "my_shared_part", "text_parts"))).toBe(false);
    });
  });

  // ─── createLiquidTestYaml ─────────────────────────────────────────────────

  describe("createLiquidTestYaml (via createLiquidTestFiles)", () => {
    it("should write YAML file if it does not exist", () => {
      fsUtils.createTemplateFolders("reconciliationText", "my_template", true);
      const yamlPath = path.join(tempDir, "reconciliation_texts", "my_template", "tests", "my_template_liquid_test.yml");

      expect(fs.existsSync(yamlPath)).toBe(false);
      fsUtils.createLiquidTestFiles("reconciliationText", "my_template", "# Test content");
      expect(fs.existsSync(yamlPath)).toBe(true);
      expect(fs.readFileSync(yamlPath, "utf-8")).toBe("# Test content");
    });

    it("should skip writing YAML file if it already exists", () => {
      fsUtils.createTemplateFolders("reconciliationText", "my_template", true);
      const yamlPath = path.join(tempDir, "reconciliation_texts", "my_template", "tests", "my_template_liquid_test.yml");
      fs.writeFileSync(yamlPath, "# Existing content");

      fsUtils.createLiquidTestFiles("reconciliationText", "my_template", "# New content");

      expect(fs.readFileSync(yamlPath, "utf-8")).toBe("# Existing content");
    });
  });

  // ─── createLiquidTestReadme ───────────────────────────────────────────────

  describe("createLiquidTestReadme (via createLiquidTestFiles)", () => {
    it("should write README.md if it does not exist", () => {
      fsUtils.createTemplateFolders("reconciliationText", "my_template", true);
      const readmePath = path.join(tempDir, "reconciliation_texts", "my_template", "tests", "README.md");

      expect(fs.existsSync(readmePath)).toBe(false);
      fsUtils.createLiquidTestFiles("reconciliationText", "my_template", "# Test content");
      expect(fs.existsSync(readmePath)).toBe(true);
    });

    it("should skip writing README.md if it already exists", () => {
      fsUtils.createTemplateFolders("reconciliationText", "my_template", true);
      const readmePath = path.join(tempDir, "reconciliation_texts", "my_template", "tests", "README.md");
      fs.writeFileSync(readmePath, "Existing readme");

      fsUtils.createLiquidTestFiles("reconciliationText", "my_template", "# Test content");

      expect(fs.readFileSync(readmePath, "utf-8")).toBe("Existing readme");
    });
  });

  // ─── createTemplateFiles ──────────────────────────────────────────────────

  describe("createTemplateFiles", () => {
    it("should write main.liquid and text part files", () => {
      fsUtils.createTemplateFolders("reconciliationText", "test_handle", true);

      fsUtils.createTemplateFiles(
        "reconciliationText",
        "test_handle",
        "Main liquid content",
        { part_1: "Part 1 content", part_2: "Part 2 content" }
      );

      const mainPath = path.join(tempDir, "reconciliation_texts", "test_handle", "main.liquid");
      const part1Path = path.join(tempDir, "reconciliation_texts", "test_handle", "text_parts", "part_1.liquid");
      const part2Path = path.join(tempDir, "reconciliation_texts", "test_handle", "text_parts", "part_2.liquid");

      expect(fs.readFileSync(mainPath, "utf-8")).toBe("Main liquid content");
      expect(fs.readFileSync(part1Path, "utf-8")).toBe("Part 1 content");
      expect(fs.readFileSync(part2Path, "utf-8")).toBe("Part 2 content");
    });

    it("should skip text parts with empty name", () => {
      fsUtils.createTemplateFolders("reconciliationText", "test_handle", true);

      fsUtils.createTemplateFiles(
        "reconciliationText",
        "test_handle",
        "Main content",
        { "": "empty name part", valid_part: "valid content" }
      );

      const validPartPath = path.join(tempDir, "reconciliation_texts", "test_handle", "text_parts", "valid_part.liquid");
      const emptyPartPath = path.join(tempDir, "reconciliation_texts", "test_handle", "text_parts", ".liquid");

      expect(fs.existsSync(validPartPath)).toBe(true);
      expect(fs.existsSync(emptyPartPath)).toBe(false);
    });
  });

  // ─── createLiquidFile ─────────────────────────────────────────────────────

  describe("createLiquidFile", () => {
    it("should write a single liquid file at the given relative path", () => {
      const dirPath = path.join(tempDir, "reconciliation_texts", "test_handle");
      fs.mkdirSync(dirPath, { recursive: true });

      fsUtils.createLiquidFile(dirPath, "main", "My liquid content");

      const filePath = path.join(dirPath, "main.liquid");
      expect(fs.existsSync(filePath)).toBe(true);
      expect(fs.readFileSync(filePath, "utf-8")).toBe("My liquid content");
    });
  });

  // ─── writeConfig / readConfig ─────────────────────────────────────────────

  describe("writeConfig", () => {
    it("should write a config.json file with formatted JSON", () => {
      const dirPath = path.join(tempDir, "reconciliation_texts", "test_handle");
      fs.mkdirSync(dirPath, { recursive: true });

      const config = { id: { 100: 12345 }, handle: "test_handle" };
      fsUtils.writeConfig("reconciliationText", "test_handle", config);

      const configPath = path.join(dirPath, "config.json");
      expect(fs.existsSync(configPath)).toBe(true);
      const written = JSON.parse(fs.readFileSync(configPath, "utf-8"));
      expect(written).toEqual(config);
    });
  });

  describe("readConfig", () => {
    it("should read and parse an existing config.json", () => {
      const dirPath = path.join(tempDir, "reconciliation_texts", "test_handle");
      fs.mkdirSync(dirPath, { recursive: true });
      const config = { id: { 100: 12345 }, handle: "test_handle" };
      fs.writeFileSync(path.join(dirPath, "config.json"), JSON.stringify(config));

      const result = fsUtils.readConfig("reconciliationText", "test_handle");

      expect(result).toMatchObject({ id: { 100: 12345 }, handle: "test_handle" });
    });

    it("should create config.json with defaults and return it when missing", () => {
      const result = fsUtils.readConfig("reconciliationText", "new_handle");

      expect(result).toHaveProperty("id");
      expect(result).toHaveProperty("partner_id");
      expect(result.handle).toBe("new_handle");
    });
  });

  // ─── configExists ─────────────────────────────────────────────────────────

  describe("configExists", () => {
    it("should return true when config.json exists", () => {
      const dirPath = path.join(tempDir, "reconciliation_texts", "existing_template");
      fs.mkdirSync(dirPath, { recursive: true });
      fs.writeFileSync(path.join(dirPath, "config.json"), "{}");

      expect(fsUtils.configExists("reconciliationText", "existing_template")).toBe(true);
    });

    it("should return false when config.json does not exist", () => {
      expect(fsUtils.configExists("reconciliationText", "missing_template")).toBe(false);
    });
  });

  // ─── setTemplateId / getTemplateId ────────────────────────────────────────

  describe("setTemplateId", () => {
    it("should set the template id for firm type", () => {
      const config = { id: {}, partner_id: {} };
      fsUtils.setTemplateId("firm", "100", config, 99999);
      expect(config.id["100"]).toBe(99999);
    });

    it("should set the template id for partner type", () => {
      const config = { id: {}, partner_id: {} };
      fsUtils.setTemplateId("partner", "25", config, 77777);
      expect(config.partner_id["25"]).toBe(77777);
    });

    it("should throw for invalid type", () => {
      const config = { id: {}, partner_id: {} };
      expect(() => fsUtils.setTemplateId("invalid", "100", config, 123)).toThrow();
    });
  });

  describe("getTemplateId", () => {
    it("should return firm template id", () => {
      const config = { id: { 100: 55555 }, partner_id: {} };
      expect(fsUtils.getTemplateId("firm", "100", config)).toBe(55555);
    });

    it("should return partner template id", () => {
      const config = { id: {}, partner_id: { 25: 44444 } };
      expect(fsUtils.getTemplateId("partner", "25", config)).toBe(44444);
    });

    it("should return undefined when id is not set", () => {
      const config = { id: {}, partner_id: {} };
      expect(fsUtils.getTemplateId("firm", "100", config)).toBeUndefined();
    });

    it("should throw for invalid type", () => {
      const config = { id: {}, partner_id: {} };
      expect(() => fsUtils.getTemplateId("invalid", "100", config)).toThrow();
    });
  });

  // ─── findHandleByID ───────────────────────────────────────────────────────

  describe("findHandleByID", () => {
    it("should return the handle when a matching firm id is found", () => {
      // Create a reconciliation text with a config containing a known id
      const dirPath = path.join(tempDir, "reconciliation_texts", "target_handle");
      fs.mkdirSync(dirPath, { recursive: true });
      const config = { id: { 100: 99999 }, partner_id: {}, handle: "target_handle" };
      fs.writeFileSync(path.join(dirPath, "config.json"), JSON.stringify(config));

      const result = fsUtils.findHandleByID("firm", "100", "reconciliationText", 99999);

      expect(result).toBe("target_handle");
    });

    it("should return undefined when no matching template is found", () => {
      const result = fsUtils.findHandleByID("firm", "100", "reconciliationText", 9999999);
      expect(result).toBeUndefined();
    });

    it("should return the name_nl for account templates when id matches", () => {
      const dirPath = path.join(tempDir, "account_templates", "test_account");
      fs.mkdirSync(dirPath, { recursive: true });
      const config = { id: { 100: 88888 }, partner_id: {}, name_nl: "test_account" };
      fs.writeFileSync(path.join(dirPath, "config.json"), JSON.stringify(config));

      const result = fsUtils.findHandleByID("firm", "100", "accountTemplate", 88888);

      expect(result).toBe("test_account");
    });
  });

  // ─── getAllTemplatesOfAType ────────────────────────────────────────────────

  describe("getAllTemplatesOfAType", () => {
    it("should return all template handles for reconciliationText when configs exist", () => {
      const templates = ["template_a", "template_b", "template_c"];
      for (const handle of templates) {
        const dirPath = path.join(tempDir, "reconciliation_texts", handle);
        fs.mkdirSync(dirPath, { recursive: true });
        fs.writeFileSync(path.join(dirPath, "config.json"), JSON.stringify({ handle }));
      }

      const result = fsUtils.getAllTemplatesOfAType("reconciliationText");

      expect(result).toHaveLength(3);
      expect(result).toEqual(expect.arrayContaining(templates));
    });

    it("should return empty array when no templates folder exists", () => {
      const result = fsUtils.getAllTemplatesOfAType("exportFile");
      expect(result).toEqual([]);
    });

    it("should skip directories without config.json", () => {
      const dirPath = path.join(tempDir, "reconciliation_texts", "no_config_template");
      fs.mkdirSync(dirPath, { recursive: true });
      // No config.json written

      const result = fsUtils.getAllTemplatesOfAType("reconciliationText");

      expect(result).toEqual([]);
    });

    it("should throw for invalid template type", () => {
      expect(() => fsUtils.getAllTemplatesOfAType("invalidType")).toThrow();
    });
  });

  // ─── getTemplateFolderPath ────────────────────────────────────────────────

  describe("FOLDERS (getTemplateFolderPath equivalent)", () => {
    it("should have correct folder names for all template types", () => {
      expect(fsUtils.FOLDERS.reconciliationText).toBe("reconciliation_texts");
      expect(fsUtils.FOLDERS.sharedPart).toBe("shared_parts");
      expect(fsUtils.FOLDERS.exportFile).toBe("export_files");
      expect(fsUtils.FOLDERS.accountTemplate).toBe("account_templates");
    });
  });

  // ─── createConfigIfMissing ────────────────────────────────────────────────

  describe("createConfigIfMissing", () => {
    it("should create a default config for reconciliationText when missing", () => {
      fsUtils.createConfigIfMissing("reconciliationText", "new_recon");

      const configPath = path.join(tempDir, "reconciliation_texts", "new_recon", "config.json");
      expect(fs.existsSync(configPath)).toBe(true);

      const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
      expect(config.handle).toBe("new_recon");
      expect(config.id).toEqual({});
      expect(config.partner_id).toEqual({});
      expect(config.reconciliation_type).toBe("only_reconciled_with_data");
    });

    it("should create a default config for sharedPart when missing", () => {
      fsUtils.createConfigIfMissing("sharedPart", "new_shared");

      const configPath = path.join(tempDir, "shared_parts", "new_shared", "config.json");
      expect(fs.existsSync(configPath)).toBe(true);
      const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
      expect(config.name).toBe("new_shared");
    });

    it("should create a default config for exportFile when missing", () => {
      fsUtils.createConfigIfMissing("exportFile", "new_export");

      const configPath = path.join(tempDir, "export_files", "new_export", "config.json");
      expect(fs.existsSync(configPath)).toBe(true);
      const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
      expect(config.name_nl).toBe("new_export");
      expect(config.encoding).toBe("UTF-8");
    });

    it("should create a default config for accountTemplate when missing", () => {
      fsUtils.createConfigIfMissing("accountTemplate", "new_account");

      const configPath = path.join(tempDir, "account_templates", "new_account", "config.json");
      expect(fs.existsSync(configPath)).toBe(true);
      const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
      expect(config.name_nl).toBe("new_account");
      expect(config.account_range).toBe(null);
    });

    it("should not overwrite an existing config", () => {
      const dirPath = path.join(tempDir, "reconciliation_texts", "existing_handle");
      fs.mkdirSync(dirPath, { recursive: true });
      const existingConfig = { id: { 100: 12345 }, custom: "value" };
      fs.writeFileSync(path.join(dirPath, "config.json"), JSON.stringify(existingConfig));

      fsUtils.createConfigIfMissing("reconciliationText", "existing_handle");

      const config = JSON.parse(fs.readFileSync(path.join(dirPath, "config.json"), "utf-8"));
      expect(config.custom).toBe("value");
      expect(config.id[100]).toBe(12345);
    });
  });
});
