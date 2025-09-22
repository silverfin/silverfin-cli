const Utils = require("../../../lib/utils/liquidTestUtils");

describe("liquidTestUtils", () => {
  describe("processCustom", () => {
    it("should sort by namespace first", () => {
      const input = [
        { namespace: "zebra", key: "first", value: "z1" },
        { namespace: "alpha", key: "second", value: "a1" },
        { namespace: "beta", key: "third", value: "b1" },
      ];

      const result = Utils.processCustom(input);

      const keys = Object.keys(result);
      expect(keys).toEqual(["alpha.second", "beta.third", "zebra.first"]);
    });

    it("should sort by key within the same namespace", () => {
      const input = [
        { namespace: "test", key: "zebra", value: "z1" },
        { namespace: "test", key: "alpha", value: "a1" },
        { namespace: "test", key: "beta", value: "b1" },
      ];

      const result = Utils.processCustom(input);

      const keys = Object.keys(result);
      expect(keys).toEqual(["test.alpha", "test.beta", "test.zebra"]);
    });

    it("should handle numeric suffixes correctly", () => {
      const input = [
        { namespace: "test", key: "item_10", value: "10" },
        { namespace: "test", key: "item_2", value: "2" },
        { namespace: "test", key: "item_1", value: "1" },
        { namespace: "test", key: "item_20", value: "20" },
      ];

      const result = Utils.processCustom(input);

      const keys = Object.keys(result);
      expect(keys).toEqual(["test.item_1", "test.item_2", "test.item_10", "test.item_20"]);
    });

    it("should handle mixed keys (with and without numeric suffixes)", () => {
      const input = [
        { namespace: "test", key: "item_2", value: "2" },
        { namespace: "test", key: "zebra", value: "z" },
        { namespace: "test", key: "item_1", value: "1" },
        { namespace: "test", key: "alpha", value: "a" },
        { namespace: "test", key: "item_10", value: "10" },
      ];

      const result = Utils.processCustom(input);

      const keys = Object.keys(result);
      expect(keys).toEqual(["test.alpha", "test.item_1", "test.item_2", "test.item_10", "test.zebra"]);
    });

    it("should handle values with field property", () => {
      const input = [
        { namespace: "test", key: "field1", value: { field: "field_value1" } },
        { namespace: "test", key: "field2", value: { field: "field_value2" } },
      ];

      const result = Utils.processCustom(input);

      expect(result).toEqual({
        "test.field1": "field_value1",
        "test.field2": "field_value2",
      });
    });

    it("should handle regular values without field property", () => {
      const input = [
        { namespace: "test", key: "simple1", value: "simple_value1" },
        { namespace: "test", key: "simple2", value: "simple_value2" },
      ];

      const result = Utils.processCustom(input);

      expect(result).toEqual({
        "test.simple1": "simple_value1",
        "test.simple2": "simple_value2",
      });
    });

    it("should handle mixed value types (with and without field property)", () => {
      const input = [
        { namespace: "test", key: "field", value: { field: "field_value" } },
        { namespace: "test", key: "simple", value: "simple_value" },
      ];

      const result = Utils.processCustom(input);

      expect(result).toEqual({
        "test.field": "field_value",
        "test.simple": "simple_value",
      });
    });

    it("should handle complex sorting scenario with multiple namespaces and numeric keys", () => {
      const input = [
        { namespace: "pit_integration", key: "code_1002", value: "yes" },
        { namespace: "alpha", key: "item_10", value: "10" },
        { namespace: "pit_integration", key: "code_1001", value: "no" },
        { namespace: "beta", key: "simple", value: "beta_simple" },
        { namespace: "alpha", key: "item_2", value: "2" },
        { namespace: "alpha", key: "zebra", value: "z" },
      ];

      const result = Utils.processCustom(input);

      const keys = Object.keys(result);
      expect(keys).toEqual([
        "alpha.item_2",
        "alpha.item_10",
        "alpha.zebra",
        "beta.simple",
        "pit_integration.code_1001",
        "pit_integration.code_1002"
      ]);
    });

    it("should handle empty array", () => {
      const result = Utils.processCustom([]);
      expect(result).toEqual({});
    });

    it("should handle single item", () => {
      const input = [{ namespace: "test", key: "single", value: "value" }];
      const result = Utils.processCustom(input);
      expect(result).toEqual({ "test.single": "value" });
    });

    it("should handle numeric suffixes with more than 10 items", () => {
      const input = [
        { namespace: "test", key: "key_14", value: "14" },
        { namespace: "test", key: "key_3", value: "3" },
        { namespace: "test", key: "key_1", value: "1" },
        { namespace: "test", key: "key_11", value: "11" },
        { namespace: "test", key: "key_2", value: "2" },
        { namespace: "test", key: "key_10", value: "10" },
        { namespace: "test", key: "key_12", value: "12" },
        { namespace: "test", key: "key_5", value: "5" },
        { namespace: "test", key: "key_9", value: "9" },
        { namespace: "test", key: "key_13", value: "13" },
        { namespace: "test", key: "key_4", value: "4" },
        { namespace: "test", key: "key_8", value: "8" },
        { namespace: "test", key: "key_6", value: "6" },
        { namespace: "test", key: "key_7", value: "7" },
      ];

      const result = Utils.processCustom(input);

      const keys = Object.keys(result);
      expect(keys).toEqual([
        "test.key_1",
        "test.key_2",
        "test.key_3",
        "test.key_4",
        "test.key_5",
        "test.key_6",
        "test.key_7",
        "test.key_8",
        "test.key_9",
        "test.key_10",
        "test.key_11",
        "test.key_12",
        "test.key_13",
        "test.key_14"
      ]);
    });
  });
});