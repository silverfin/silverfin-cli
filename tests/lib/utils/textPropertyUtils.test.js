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

    // Simulate a repo layout: each handle dir has a config.json whose "test" key
    // points at the canonical YAML file, mirroring how run-test resolves it.
    const mockRepo = (configs, yamlContents) => {
      fs.existsSync.mockImplementation((p) => {
        const file = String(p);
        if (file.endsWith("config.json")) return true;
        if (file.endsWith(".yml")) return Object.keys(yamlContents).some((name) => file.endsWith(name));
        return true; // base dir and everything else
      });
      fs.statSync.mockReturnValue({ isDirectory: () => true });
      fs.readdirSync.mockReturnValue(Object.keys(configs));
      fs.readFileSync.mockImplementation((p) => {
        const file = String(p);
        if (file.endsWith("config.json")) {
          const dir = Object.keys(configs).find((d) => file.includes(`/${d}/`));
          return JSON.stringify(configs[dir] ?? {});
        }
        return "yaml-content:" + file;
      });
      yaml.parse.mockImplementation((content) => {
        const name = Object.keys(yamlContents).find((n) => String(content).endsWith(n));
        const payload = yamlContents[name];
        if (payload instanceof Error) throw payload;
        return payload;
      });
    };

    it("extracts custom data at all four levels from the config-referenced file when scoped by handle", () => {
      mockRepo({ my_handle: { test: "tests/my_handle_liquid_test.yml" } }, { "my_handle_liquid_test.yml": yamlPayload });

      const result = findTestData("my_test", "my_handle");

      expect(result.handle).toBe("my_handle");
      expect(result.file).toBe("my_handle_liquid_test.yml");
      expect(result.company).toEqual({ custom: { "co.k": "cv" } });
      expect(result.periods["2024-12-31"].custom).toEqual({ "p.k": "pv" });
      expect(result.periods["2024-12-31"].reconciliations.my_handle).toEqual({ "r.k": "rv" });
      expect(result.periods["2024-12-31"].accounts["610000"]).toEqual({ "a.k": "av" });
    });

    it("scans all templates' config-referenced test files when no handle is given", () => {
      mockRepo(
        {
          handle_a: { test: "tests/handle_a_liquid_test.yml" },
          handle_b: { test: "tests/handle_b_liquid_test.yml" },
        },
        {
          "handle_a_liquid_test.yml": { some_other_test: {} },
          "handle_b_liquid_test.yml": { my_test: { data: { periods: {} } } },
        }
      );

      const result = findTestData("my_test");

      expect(result.handle).toBe("handle_b");
      expect(result.file).toBe("handle_b_liquid_test.yml");
    });

    it("skips a template with a malformed YAML file and continues with the others", () => {
      mockRepo(
        {
          handle_a: { test: "tests/bad_liquid_test.yml" },
          handle_b: { test: "tests/good_liquid_test.yml" },
        },
        {
          "bad_liquid_test.yml": new Error("bad indentation"),
          "good_liquid_test.yml": { my_test: { data: { periods: {} } } },
        }
      );

      const result = findTestData("my_test");

      expect(consola.warn).toHaveBeenCalledWith(expect.stringContaining("malformed YAML"));
      expect(result.file).toBe("good_liquid_test.yml");
    });

    it("skips templates whose config.json has no test key", () => {
      mockRepo(
        {
          handle_a: {},
          handle_b: { test: "tests/handle_b_liquid_test.yml" },
        },
        { "handle_b_liquid_test.yml": { my_test: { data: { periods: {} } } } }
      );

      const result = findTestData("my_test");

      expect(result.handle).toBe("handle_b");
    });

    it("errors and exits when the test name is not found, pointing at --file", () => {
      mockRepo({ my_handle: { test: "tests/my_handle_liquid_test.yml" } }, { "my_handle_liquid_test.yml": { some_other_test: {} } });
      const exitSpy = jest.spyOn(process, "exit").mockImplementation(() => {
        throw new Error("process.exit");
      });

      expect(() => findTestData("missing_test", "my_handle")).toThrow("process.exit");
      expect(consola.error).toHaveBeenCalledWith(expect.stringContaining("--file"));

      exitSpy.mockRestore();
    });

    it("refuses to guess when the test name exists in multiple templates", () => {
      const payload = { my_test: { data: { periods: {} } } };
      mockRepo(
        {
          handle_a: { test: "tests/handle_a_liquid_test.yml" },
          handle_b: { test: "tests/handle_b_liquid_test.yml" },
        },
        { "handle_a_liquid_test.yml": payload, "handle_b_liquid_test.yml": payload }
      );
      const exitSpy = jest.spyOn(process, "exit").mockImplementation(() => {
        throw new Error("process.exit");
      });

      expect(() => findTestData("my_test")).toThrow("process.exit");
      expect(consola.error).toHaveBeenCalledWith(expect.stringContaining("multiple templates"));
      expect(consola.error).toHaveBeenCalledWith(expect.stringContaining("handle_a/tests/handle_a_liquid_test.yml"));
      expect(consola.error).toHaveBeenCalledWith(expect.stringContaining("--handle"));

      exitSpy.mockRestore();
    });

    it("reads the exact tests/<fileName> when fileName is given, overriding config.json", () => {
      mockRepo(
        { my_handle: { test: "tests/my_handle_liquid_test.yml" } },
        {
          "my_handle_liquid_test.yml": { my_test: { data: { periods: { "2023-12-31": {} } } } },
          "my_handle_TY25_liquid_test.yml": { my_test: { data: { periods: { "2024-12-31": {} } } } },
        }
      );

      const result = findTestData("my_test", "my_handle", "my_handle_TY25_liquid_test.yml");

      expect(result.file).toBe("my_handle_TY25_liquid_test.yml");
      expect(Object.keys(result.periods)).toEqual(["2024-12-31"]);
      expect(yaml.parse).toHaveBeenCalledTimes(1);
    });

    it("errors when fileName matches no file containing the test", () => {
      mockRepo({ my_handle: { test: "tests/my_handle_liquid_test.yml" } }, { "my_handle_liquid_test.yml": { my_test: {} } });
      const exitSpy = jest.spyOn(process, "exit").mockImplementation(() => {
        throw new Error("process.exit");
      });

      expect(() => findTestData("my_test", "my_handle", "does_not_exist.yml")).toThrow("process.exit");
      expect(consola.error).toHaveBeenCalledWith(expect.stringContaining('named "does_not_exist.yml"'));

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
