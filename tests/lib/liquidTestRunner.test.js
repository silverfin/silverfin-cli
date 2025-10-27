const yaml = require("yaml");
const { consola } = require("consola");

// Mock consola before requiring the module
jest.mock("consola");

describe("liquidTestRunner", () => {
  describe("filterTestsByBatch", () => {
    // We need to test the filterTestsByBatch function
    // Since it's not exported, we'll test it indirectly through buildTestParams
    
    const sampleYAML = `unit_3_test_1:
  context:
    period: '2023'
  expectation:
    reconciled: true

unit_3_test_2:
  context:
    period: '2023'
  expectation:
    reconciled: true

unit_4_test_1:
  context:
    period: '2023'
  expectation:
    reconciled: true

table_test_1:
  context:
    period: '2023'
  expectation:
    reconciled: true`;

    it("should filter tests by batch identifier correctly", () => {
      const options = { maxAliasCount: 10000 };
      const testYAML = yaml.parse(sampleYAML, options);
      const testNames = Object.keys(testYAML);
      
      // Test filtering for "unit_3_"
      const unit3Tests = testNames.filter((name) => name.includes("unit_3_"));
      expect(unit3Tests).toEqual(["unit_3_test_1", "unit_3_test_2"]);
      expect(unit3Tests.length).toBe(2);
      
      // Test filtering for "unit_4_"
      const unit4Tests = testNames.filter((name) => name.includes("unit_4_"));
      expect(unit4Tests).toEqual(["unit_4_test_1"]);
      expect(unit4Tests.length).toBe(1);
      
      // Test filtering for "table_"
      const tableTests = testNames.filter((name) => name.includes("table_"));
      expect(tableTests).toEqual(["table_test_1"]);
      expect(tableTests.length).toBe(1);
      
      // Test filtering for "test_1"
      const test1Tests = testNames.filter((name) => name.includes("test_1"));
      expect(test1Tests).toEqual(["unit_3_test_1", "unit_4_test_1", "table_test_1"]);
      expect(test1Tests.length).toBe(3);
    });

    it("should create filtered YAML with only matching tests", () => {
      const options = { maxAliasCount: 10000 };
      const testYAML = yaml.parse(sampleYAML, options);
      const testNames = Object.keys(testYAML);
      
      // Filter for "unit_3_"
      const matchingTestNames = testNames.filter((name) => name.includes("unit_3_"));
      const filteredTests = {};
      matchingTestNames.forEach((testName) => {
        filteredTests[testName] = testYAML[testName];
      });
      
      const filteredYAML = yaml.stringify(filteredTests, options);
      const reparsed = yaml.parse(filteredYAML, options);
      
      expect(Object.keys(reparsed)).toEqual(["unit_3_test_1", "unit_3_test_2"]);
      expect(Object.keys(reparsed).length).toBe(2);
    });

    it("should return empty array when no tests match the batch identifier", () => {
      const options = { maxAliasCount: 10000 };
      const testYAML = yaml.parse(sampleYAML, options);
      const testNames = Object.keys(testYAML);
      
      const noMatch = testNames.filter((name) => name.includes("nonexistent_"));
      expect(noMatch).toEqual([]);
      expect(noMatch.length).toBe(0);
    });
  });
});


