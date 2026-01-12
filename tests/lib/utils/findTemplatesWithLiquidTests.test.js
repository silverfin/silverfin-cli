const fs = require("fs");
const path = require("path");
const fsUtils = require("../../../lib/utils/fsUtils");

jest.mock("consola");

describe("fsUtils", () => {
  describe("findTemplatesWithLiquidTests", () => {
    const tempDir = path.join(process.cwd(), "tmp");
    const reconciliationTextsDir = path.join(tempDir, "reconciliation_texts");

    beforeEach(() => {
      if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, { recursive: true });
      }
      process.chdir(tempDir);
    });

    afterEach(() => {
      if (fs.existsSync(tempDir)) {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
      jest.resetAllMocks();
    });

    it("should return empty array when reconciliation_texts directory does not exist", () => {
      const result = fsUtils.findTemplatesWithLiquidTests();
      expect(result).toEqual([]);
    });

    it("should return empty array when no test files exist", () => {
      const templateDir = path.join(reconciliationTextsDir, "test_template");
      fs.mkdirSync(templateDir, { recursive: true });
      fs.mkdirSync(path.join(templateDir, "tests"), { recursive: true });

      const result = fsUtils.findTemplatesWithLiquidTests();
      expect(result).toEqual([]);
    });

    it("should find templates with liquid test files", () => {
      const handle1 = "template_one";
      const handle2 = "template_two";
      const templateDir1 = path.join(reconciliationTextsDir, handle1);
      const templateDir2 = path.join(reconciliationTextsDir, handle2);

      // Create directories and test files
      fs.mkdirSync(path.join(templateDir1, "tests"), { recursive: true });
      fs.mkdirSync(path.join(templateDir2, "tests"), { recursive: true });

      fs.writeFileSync(
        path.join(templateDir1, "tests", `${handle1}_liquid_test.yml`),
        "test: content"
      );
      fs.writeFileSync(
        path.join(templateDir2, "tests", `${handle2}_liquid_test.yml`),
        "test: content"
      );

      const result = fsUtils.findTemplatesWithLiquidTests();

      expect(result).toHaveLength(2);
      expect(result).toEqual(expect.arrayContaining([handle1, handle2]));
    });

    it("should exclude variant files with TY suffix (e.g., _TY21, _TY23)", () => {
      const handle = "test_template";
      const templateDir = path.join(reconciliationTextsDir, handle);
      fs.mkdirSync(path.join(templateDir, "tests"), { recursive: true });

      // Create main test file
      fs.writeFileSync(
        path.join(templateDir, "tests", `${handle}_liquid_test.yml`),
        "test: content"
      );

      // Create variant files (should be excluded)
      fs.writeFileSync(
        path.join(templateDir, "tests", `${handle}_TY21_liquid_test.yml`),
        "test: variant content"
      );
      fs.writeFileSync(
        path.join(templateDir, "tests", `${handle}_TY23_liquid_test.yml`),
        "test: variant content"
      );

      const result = fsUtils.findTemplatesWithLiquidTests();

      expect(result).toHaveLength(1);
      expect(result[0]).toBe(handle);
    });

    it("should exclude variant files with other uppercase suffix patterns", () => {
      const handle = "test_template";
      const templateDir = path.join(reconciliationTextsDir, handle);
      fs.mkdirSync(path.join(templateDir, "tests"), { recursive: true });

      // Create main test file
      fs.writeFileSync(
        path.join(templateDir, "tests", `${handle}_liquid_test.yml`),
        "test: content"
      );

      // Create variant files with different patterns (should be excluded)
      fs.writeFileSync(
        path.join(templateDir, "tests", `${handle}_TY2021_liquid_test.yml`),
        "test: variant content"
      );
      fs.writeFileSync(
        path.join(templateDir, "tests", `${handle}_AB123_liquid_test.yml`),
        "test: variant content"
      );

      const result = fsUtils.findTemplatesWithLiquidTests();

      expect(result).toHaveLength(1);
      expect(result[0]).toBe(handle);
    });

    it("should only search in reconciliation_texts, not account_templates", () => {
      const reconciliationHandle = "reconciliation_template";
      const accountTemplateName = "account_template_name_nl"; // Account templates use name_nl, not handle
      const reconciliationDir = path.join(reconciliationTextsDir, reconciliationHandle);
      const accountTemplatesDir = path.join(tempDir, "account_templates", accountTemplateName);

      fs.mkdirSync(path.join(reconciliationDir, "tests"), { recursive: true });
      fs.mkdirSync(path.join(accountTemplatesDir, "tests"), { recursive: true });

      fs.writeFileSync(
        path.join(reconciliationDir, "tests", `${reconciliationHandle}_liquid_test.yml`),
        "test: content"
      );
      // Account templates use name_nl for the test file name
      fs.writeFileSync(
        path.join(accountTemplatesDir, "tests", `${accountTemplateName}_liquid_test.yml`),
        "test: content"
      );

      const result = fsUtils.findTemplatesWithLiquidTests();

      expect(result).toHaveLength(1);
      expect(result[0]).toBe(reconciliationHandle);
      expect(result).not.toContain(accountTemplateName);
    });

    it("should skip directories without tests folder", () => {
      const handle = "template_no_tests";
      const templateDir = path.join(reconciliationTextsDir, handle);
      fs.mkdirSync(templateDir, { recursive: true });
      // No tests directory created

      const result = fsUtils.findTemplatesWithLiquidTests();
      expect(result).toEqual([]);
    });

    it("should skip non-directory files in reconciliation_texts", () => {
      fs.mkdirSync(reconciliationTextsDir, { recursive: true });
      const filePath = path.join(reconciliationTextsDir, "not_a_directory.txt");
      fs.writeFileSync(filePath, "not a directory");

      const result = fsUtils.findTemplatesWithLiquidTests();
      expect(result).toEqual([]);
    });

    it("should handle multiple templates with mixed main and variant files", () => {
      const handle1 = "template_one";
      const handle2 = "template_two";
      const templateDir1 = path.join(reconciliationTextsDir, handle1);
      const templateDir2 = path.join(reconciliationTextsDir, handle2);

      fs.mkdirSync(path.join(templateDir1, "tests"), { recursive: true });
      fs.mkdirSync(path.join(templateDir2, "tests"), { recursive: true });

      // Template 1: main test file + variants
      fs.writeFileSync(
        path.join(templateDir1, "tests", `${handle1}_liquid_test.yml`),
        "test: content"
      );
      fs.writeFileSync(
        path.join(templateDir1, "tests", `${handle1}_TY21_liquid_test.yml`),
        "test: variant"
      );

      // Template 2: only main test file
      fs.writeFileSync(
        path.join(templateDir2, "tests", `${handle2}_liquid_test.yml`),
        "test: content"
      );

      const result = fsUtils.findTemplatesWithLiquidTests();

      expect(result).toHaveLength(2);
      expect(result.sort()).toEqual([handle1, handle2].sort());
    });
  });
});

