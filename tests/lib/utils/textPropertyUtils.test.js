jest.mock("fs");
jest.mock("consola");
jest.mock("yaml");

const fs = require("fs");
const yaml = require("yaml");
const { consola } = require("consola");
const { transformCustomToProperties, findTestData, findPeriodByKey } = require("../../../lib/utils/textPropertyUtils");

describe("textPropertyUtils", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("transformCustomToProperties", () => {
    it("maps a simple namespace.key to a flat property", () => {
      const result = transformCustomToProperties({ "ns.key": "value" });
      expect(result).toEqual([{ namespace: "ns", key: "key", value: "value" }]);
    });

    it("maps a nested namespace.key.subkey to an object value", () => {
      const result = transformCustomToProperties({ "ns.key.sub": "value" });
      expect(result).toEqual([{ namespace: "ns", key: "key", value: { sub: "value" } }]);
    });

    it("merges multiple subkeys under the same namespace.key", () => {
      const result = transformCustomToProperties({ "ns.key.a": "1", "ns.key.b": "2" });
      expect(result).toEqual([{ namespace: "ns", key: "key", value: { a: "1", b: "2" } }]);
    });

    it("collapses deeper-than-3 segment keys into a single dotted subkey", () => {
      // Documented as a 3-segment-max assumption in practice; this locks current behaviour.
      const result = transformCustomToProperties({ "ns.key.a.b": "v" });
      expect(result).toEqual([{ namespace: "ns", key: "key", value: { "a.b": "v" } }]);
    });

    it("warns and skips keys without a namespace.key shape", () => {
      const result = transformCustomToProperties({ single: "value" });
      expect(result).toEqual([]);
      expect(consola.warn).toHaveBeenCalled();
    });
  });

  describe("findTestData", () => {
    const yamlPayload = {
      my_test: {
        data: {
          company: { custom: { "co.k": "cv" } },
          periods: {
            "2024-12-31": {
              custom: { "p.k": "pv" },
              reconciliations: { my_handle: { custom: { "r.k": "rv" } } },
              accounts: { "610000": { custom: { "a.k": "av" } } },
            },
          },
        },
      },
    };

    it("extracts custom data at all four levels when scoped by handle", () => {
      fs.existsSync.mockReturnValue(true);
      fs.readdirSync.mockReturnValue(["my_handle_liquid_test.yml"]);
      fs.readFileSync.mockReturnValue("yaml-content");
      yaml.parse.mockReturnValue(yamlPayload);

      const result = findTestData("my_test", "my_handle");

      expect(result.handle).toBe("my_handle");
      expect(result.file).toBe("my_handle_liquid_test.yml");
      expect(result.company).toEqual({ custom: { "co.k": "cv" } });
      expect(result.periods["2024-12-31"].custom).toEqual({ "p.k": "pv" });
      expect(result.periods["2024-12-31"].reconciliations.my_handle).toEqual({ "r.k": "rv" });
      expect(result.periods["2024-12-31"].accounts["610000"]).toEqual({ "a.k": "av" });
    });

    it("scans all template folders when no handle is given", () => {
      fs.existsSync.mockReturnValue(true);
      fs.statSync.mockReturnValue({ isDirectory: () => true });
      fs.readdirSync.mockImplementation((p) => (String(p).endsWith("tests") ? ["my_test_liquid_test.yml"] : ["handle_a"]));
      fs.readFileSync.mockReturnValue("yaml-content");
      yaml.parse.mockReturnValue({ my_test: { data: { periods: {} } } });

      const result = findTestData("my_test");

      expect(result.handle).toBe("handle_a");
      expect(result.file).toBe("my_test_liquid_test.yml");
    });

    it("skips a malformed YAML file and continues to the next one", () => {
      fs.existsSync.mockReturnValue(true);
      fs.readdirSync.mockReturnValue(["bad_liquid_test.yml", "good_liquid_test.yml"]);
      fs.readFileSync.mockReturnValue("yaml-content");
      yaml.parse
        .mockImplementationOnce(() => {
          throw new Error("bad indentation");
        })
        .mockImplementationOnce(() => ({ my_test: { data: { periods: {} } } }));

      const result = findTestData("my_test", "my_handle");

      expect(consola.warn).toHaveBeenCalledWith(expect.stringContaining("malformed YAML"));
      expect(result.file).toBe("good_liquid_test.yml");
    });

    it("errors and exits when the test name is not found", () => {
      fs.existsSync.mockReturnValue(true);
      fs.readdirSync.mockReturnValue(["my_handle_liquid_test.yml"]);
      fs.readFileSync.mockReturnValue("yaml-content");
      yaml.parse.mockReturnValue({ some_other_test: {} });
      const exitSpy = jest.spyOn(process, "exit").mockImplementation(() => {
        throw new Error("process.exit");
      });

      expect(() => findTestData("missing_test", "my_handle")).toThrow("process.exit");
      expect(consola.error).toHaveBeenCalled();

      exitSpy.mockRestore();
    });
  });

  describe("findPeriodByKey", () => {
    const yearEnd2024 = { id: 101, end_date: "2024-12-31", fiscal_year: { end_date: "2024-12-31" } };
    const monthly202401 = { id: 102, end_date: "2024-01-31", fiscal_year: { end_date: "2024-12-31" } };
    const monthly202402 = { id: 103, end_date: "2024-02-29", fiscal_year: { end_date: "2024-12-31" } };
    const noFiscalYear = { id: 205, end_date: "2025-03-31", fiscal_year: null };

    it("resolves a unique fiscal year end date", () => {
      const { period, error } = findPeriodByKey([monthly202401, { id: 300, end_date: "2023-12-31", fiscal_year: { end_date: "2023-12-31" } }], "2023-12-31");
      expect(error).toBeUndefined();
      expect(period.id).toBe(300);
    });

    it("prefers the year-end period when several periods share a fiscal year end date", () => {
      const { period } = findPeriodByKey([monthly202401, monthly202402, yearEnd2024], "2024-12-31");
      expect(period.id).toBe(101);
    });

    it("resolves an id-based key for periods without a fiscal year", () => {
      const { period } = findPeriodByKey([yearEnd2024, noFiscalYear], "205");
      expect(period.id).toBe(205);
    });

    it("returns an error instead of picking an arbitrary period when the key stays ambiguous", () => {
      const { period, error } = findPeriodByKey([monthly202401, monthly202402], "2024-12-31");
      expect(period).toBeUndefined();
      expect(error).toContain("ambiguous");
    });

    it("returns an error when no period matches", () => {
      const { period, error } = findPeriodByKey([yearEnd2024], "2030-12-31");
      expect(period).toBeUndefined();
      expect(error).toContain("not found");
    });
  });
});
