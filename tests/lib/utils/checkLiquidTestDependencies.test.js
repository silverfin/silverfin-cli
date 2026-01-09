const fs = require("fs");
const path = require("path");
const fsUtils = require("../../../lib/utils/fsUtils");

jest.mock("consola");

describe("fsUtils", () => {
  describe("check_liquid_test_dependencies", () => {
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

    it("should return empty array when no templates depend on the target handle", () => {
      const targetHandle = "target_template";
      const handle1 = "template_one";
      const handle2 = "template_two";

      const templateDir1 = path.join(reconciliationTextsDir, handle1);
      const templateDir2 = path.join(reconciliationTextsDir, handle2);

      fs.mkdirSync(path.join(templateDir1, "tests"), { recursive: true });
      fs.mkdirSync(path.join(templateDir2, "tests"), { recursive: true });

      // Create test files that don't reference targetHandle
      fs.writeFileSync(
        path.join(templateDir1, "tests", `${handle1}_liquid_test.yml`),
        `
test_case_1:
  data:
    periods:
      "2024-01-01":
        reconciliations:
          other_template: {}
`
      );
      fs.writeFileSync(
        path.join(templateDir2, "tests", `${handle2}_liquid_test.yml`),
        `
test_case_1:
  data:
    periods:
      "2024-01-01":
        reconciliations:
          another_template: {}
`
      );

      const result = fsUtils.check_liquid_test_dependencies(targetHandle);
      expect(result).toEqual([]);
    });

    it("should find templates that reference target handle in data subtree as string values", () => {
      const targetHandle = "target_template";
      const dependentHandle1 = "template_one";
      const dependentHandle2 = "template_two";
      const independentHandle = "template_three";

      const templateDir1 = path.join(reconciliationTextsDir, dependentHandle1);
      const templateDir2 = path.join(reconciliationTextsDir, dependentHandle2);
      const templateDir3 = path.join(reconciliationTextsDir, independentHandle);

      fs.mkdirSync(path.join(templateDir1, "tests"), { recursive: true });
      fs.mkdirSync(path.join(templateDir2, "tests"), { recursive: true });
      fs.mkdirSync(path.join(templateDir3, "tests"), { recursive: true });

      // Template 1 references targetHandle as a value
      fs.writeFileSync(
        path.join(templateDir1, "tests", `${dependentHandle1}_liquid_test.yml`),
        `
test_case_1:
  data:
    periods:
      "2024-01-01":
        reconciliations:
          some_field: ${targetHandle}
`
      );

      // Template 2 references targetHandle as a value
      fs.writeFileSync(
        path.join(templateDir2, "tests", `${dependentHandle2}_liquid_test.yml`),
        `
test_case_1:
  data:
    periods:
      "2024-01-01":
        reconciliations:
          nested:
            deep: ${targetHandle}
`
      );

      // Template 3 doesn't reference targetHandle
      fs.writeFileSync(
        path.join(templateDir3, "tests", `${independentHandle}_liquid_test.yml`),
        `
test_case_1:
  data:
    periods:
      "2024-01-01":
        reconciliations:
          other_template: {}
`
      );

      const result = fsUtils.check_liquid_test_dependencies(targetHandle);
      expect(result).toContain(dependentHandle1);
      expect(result).toContain(dependentHandle2);
      expect(result).not.toContain(independentHandle);
    });

    it("should find templates that reference target handle in data subtree as keys", () => {
      const targetHandle = "target_template";
      const dependentHandle = "template_one";
      const independentHandle = "template_two";

      const templateDir1 = path.join(reconciliationTextsDir, dependentHandle);
      const templateDir2 = path.join(reconciliationTextsDir, independentHandle);

      fs.mkdirSync(path.join(templateDir1, "tests"), { recursive: true });
      fs.mkdirSync(path.join(templateDir2, "tests"), { recursive: true });

      // Template 1 references targetHandle as a key
      fs.writeFileSync(
        path.join(templateDir1, "tests", `${dependentHandle}_liquid_test.yml`),
        `
test_case_1:
  data:
    periods:
      "2024-01-01":
        reconciliations:
          ${targetHandle}:
            some_field: value
`
      );

      // Template 2 doesn't reference targetHandle
      fs.writeFileSync(
        path.join(templateDir2, "tests", `${independentHandle}_liquid_test.yml`),
        `
test_case_1:
  data:
    periods:
      "2024-01-01":
        reconciliations:
          other_template: {}
`
      );

      const result = fsUtils.check_liquid_test_dependencies(targetHandle);
      expect(result).toContain(dependentHandle);
      expect(result).not.toContain(independentHandle);
    });

    it("should only scan data subtree, not context or expectation", () => {
      const targetHandle = "target_template";
      const dependentHandle = "template_one";
      const independentHandle = "template_two";

      const templateDir1 = path.join(reconciliationTextsDir, dependentHandle);
      const templateDir2 = path.join(reconciliationTextsDir, independentHandle);

      fs.mkdirSync(path.join(templateDir1, "tests"), { recursive: true });
      fs.mkdirSync(path.join(templateDir2, "tests"), { recursive: true });

      // Template 1 has targetHandle in data (should be found)
      fs.writeFileSync(
        path.join(templateDir1, "tests", `${dependentHandle}_liquid_test.yml`),
        `
test_case_1:
  context:
    period: "2024-01-01"
    some_field: ${targetHandle}
  data:
    periods:
      "2024-01-01":
        reconciliations:
          ${targetHandle}: {}
  expectation:
    reconciled: true
    results:
      ${targetHandle}: some_value
`
      );

      // Template 2 has targetHandle only in context/expectation (should NOT be found)
      fs.writeFileSync(
        path.join(templateDir2, "tests", `${independentHandle}_liquid_test.yml`),
        `
test_case_1:
  context:
    period: "2024-01-01"
    some_field: ${targetHandle}
  data:
    periods:
      "2024-01-01":
        reconciliations:
          other_template: {}
  expectation:
    reconciled: true
    results:
      ${targetHandle}: some_value
`
      );

      const result = fsUtils.check_liquid_test_dependencies(targetHandle);
      expect(result).toContain(dependentHandle);
      expect(result).not.toContain(independentHandle);
    });

    it("should handle nested structures in data", () => {
      const targetHandle = "target_template";
      const dependentHandle = "template_one";

      const templateDir = path.join(reconciliationTextsDir, dependentHandle);
      fs.mkdirSync(path.join(templateDir, "tests"), { recursive: true });

      // Nested structure with targetHandle
      fs.writeFileSync(
        path.join(templateDir, "tests", `${dependentHandle}_liquid_test.yml`),
        `
test_case_1:
  data:
    periods:
      "2024-01-01":
        reconciliations:
          nested:
            deep:
              value: ${targetHandle}
`
      );

      const result = fsUtils.check_liquid_test_dependencies(targetHandle);
      expect(result).toContain(dependentHandle);
    });

    it("should handle arrays in data", () => {
      const targetHandle = "target_template";
      const dependentHandle = "template_one";

      const templateDir = path.join(reconciliationTextsDir, dependentHandle);
      fs.mkdirSync(path.join(templateDir, "tests"), { recursive: true });

      // targetHandle in arrays
      fs.writeFileSync(
        path.join(templateDir, "tests", `${dependentHandle}_liquid_test.yml`),
        `
test_case_1:
  data:
    periods:
      "2024-01-01":
        reconciliations:
          list:
            - ${targetHandle}
            - other_template
`
      );

      const result = fsUtils.check_liquid_test_dependencies(targetHandle);
      expect(result).toContain(dependentHandle);
    });

    it("should only check templates with liquid test files", () => {
      const targetHandle = "target_template";
      const dependentHandle = "template_with_test";
      const handleWithoutTest = "template_without_test";

      const templateDir1 = path.join(reconciliationTextsDir, dependentHandle);
      const templateDir2 = path.join(reconciliationTextsDir, handleWithoutTest);

      fs.mkdirSync(path.join(templateDir1, "tests"), { recursive: true });
      fs.mkdirSync(templateDir2, { recursive: true }); // No tests directory

      // Template with test references targetHandle
      fs.writeFileSync(
        path.join(templateDir1, "tests", `${dependentHandle}_liquid_test.yml`),
        `
test_case_1:
  data:
    periods:
      "2024-01-01":
        reconciliations:
          ${targetHandle}: {}
`
      );

      // Template without test (won't be checked)
      // Even if it had a reference, it wouldn't be found

      const result = fsUtils.check_liquid_test_dependencies(targetHandle);
      expect(result).toContain(dependentHandle);
      expect(result).not.toContain(handleWithoutTest);
    });

    it("should handle multiple test cases", () => {
      const targetHandle = "target_template";
      const dependentHandle = "template_one";

      const templateDir = path.join(reconciliationTextsDir, dependentHandle);
      fs.mkdirSync(path.join(templateDir, "tests"), { recursive: true });

      // Multiple test cases, targetHandle in second one
      fs.writeFileSync(
        path.join(templateDir, "tests", `${dependentHandle}_liquid_test.yml`),
        `
test_case_1:
  data:
    periods:
      "2024-01-01":
        reconciliations:
          other_template: {}

test_case_2:
  data:
    periods:
      "2024-01-01":
        reconciliations:
          ${targetHandle}: {}
`
      );

      const result = fsUtils.check_liquid_test_dependencies(targetHandle);
      expect(result).toContain(dependentHandle);
    });

    it("should return unique handles even if target appears multiple times", () => {
      const targetHandle = "target_template";
      const dependentHandle = "template_one";

      const templateDir = path.join(reconciliationTextsDir, dependentHandle);
      fs.mkdirSync(path.join(templateDir, "tests"), { recursive: true });

      // Same handle appears multiple times
      fs.writeFileSync(
        path.join(templateDir, "tests", `${dependentHandle}_liquid_test.yml`),
        `
test_case_1:
  data:
    periods:
      "2024-01-01":
        reconciliations:
          ${targetHandle}: {}
          nested:
            ${targetHandle}: {}
            array:
              - ${targetHandle}
`
      );

      const result = fsUtils.check_liquid_test_dependencies(targetHandle);
      expect(result).toHaveLength(1);
      expect(result).toContain(dependentHandle);
    });

    it("should handle parsing errors gracefully", () => {
      const targetHandle = "target_template";
      const validHandle = "template_one";
      const invalidHandle = "template_invalid";

      const templateDir1 = path.join(reconciliationTextsDir, validHandle);
      const templateDir2 = path.join(reconciliationTextsDir, invalidHandle);

      fs.mkdirSync(path.join(templateDir1, "tests"), { recursive: true });
      fs.mkdirSync(path.join(templateDir2, "tests"), { recursive: true });

      // Valid template with targetHandle
      fs.writeFileSync(
        path.join(templateDir1, "tests", `${validHandle}_liquid_test.yml`),
        `
test_case_1:
  data:
    periods:
      "2024-01-01":
        reconciliations:
          ${targetHandle}: {}
`
      );

      // Invalid YAML (should be skipped)
      fs.writeFileSync(
        path.join(templateDir2, "tests", `${invalidHandle}_liquid_test.yml`),
        "invalid: yaml: content: ["
      );

      const result = fsUtils.check_liquid_test_dependencies(targetHandle);
      expect(result).toContain(validHandle);
      expect(result).not.toContain(invalidHandle);
    });
  });
});
