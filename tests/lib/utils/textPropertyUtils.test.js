jest.mock("fs");
jest.mock("consola");
jest.mock("yaml");

const fs = require("fs");
const yaml = require("yaml");
const { consola } = require("consola");
const { transformCustomToProperties, findTestData } = require("../../../lib/utils/textPropertyUtils");

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
});
