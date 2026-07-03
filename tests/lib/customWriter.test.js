jest.mock("../../lib/api/sfApi");
jest.mock("../../lib/utils/liquidTestUtils");
jest.mock("consola");
jest.mock("fs");

const SF = require("../../lib/api/sfApi");
const Utils = require("../../lib/utils/liquidTestUtils");
const { consola } = require("consola");
const fs = require("fs");
const { prepareWrite, buildProperties, coerceValue } = require("../../lib/customWriter");

const reconUrl = "https://live.getsilverfin.com/f/96/100/...";

describe("customWriter", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    Utils.extractURL.mockReturnValue({
      templateType: "reconciliationText",
      firmId: "96",
      companyId: "100",
      ledgerId: "200",
      reconciliationId: "300",
    });
  });

  describe("coerceValue", () => {
    it("parses numbers, booleans and JSON, and keeps plain strings", () => {
      expect(coerceValue("10")).toBe(10);
      expect(coerceValue("true")).toBe(true);
      expect(coerceValue('{"a":1}')).toEqual({ a: 1 });
      expect(coerceValue("hello")).toBe("hello");
    });
  });

  describe("buildProperties", () => {
    it("builds a single set property with a coerced value", () => {
      expect(buildProperties({ namespace: "ns", key: "k", value: "10" }, false)).toEqual([{ namespace: "ns", key: "k", value: 10 }]);
    });

    it("forces value null for deletes", () => {
      expect(buildProperties({ namespace: "ns", key: "k" }, true)).toEqual([{ namespace: "ns", key: "k", value: null }]);
    });

    it("reads a batch from --file (and nulls values on delete)", () => {
      fs.readFileSync.mockReturnValue('[{"namespace":"n","key":"k","value":1},{"namespace":"n2","key":"k2","value":2}]');
      expect(buildProperties({ file: "props.json" }, false)).toEqual([
        { namespace: "n", key: "k", value: 1 },
        { namespace: "n2", key: "k2", value: 2 },
      ]);
      expect(buildProperties({ file: "props.json" }, true)).toEqual([
        { namespace: "n", key: "k", value: null },
        { namespace: "n2", key: "k2", value: null },
      ]);
    });

    it("throws when namespace/key are missing", () => {
      expect(() => buildProperties({ value: "x" }, false)).toThrow();
    });
  });

  describe("prepareWrite", () => {
    it("defaults to reconciliation level using the URL reconciliationId", async () => {
      const plan = await prepareWrite(reconUrl, { namespace: "ns", key: "k", value: "5" }, { del: false });
      expect(plan.level).toBe("reconciliation");
      await plan.apply();
      expect(SF.updateReconciliationCustom).toHaveBeenCalledWith("96", "100", "200", "300", [{ namespace: "ns", key: "k", value: 5 }]);
    });

    it("resolves the reconciliation by --handle", async () => {
      SF.findReconciliationInWorkflows.mockResolvedValue({ id: 777 });
      const plan = await prepareWrite(reconUrl, { handle: "some_handle", namespace: "ns", key: "k", value: "1" });
      await plan.apply();
      expect(SF.findReconciliationInWorkflows).toHaveBeenCalledWith("96", "some_handle", "100", "200");
      expect(SF.updateReconciliationCustom).toHaveBeenCalledWith("96", "100", "200", 777, expect.any(Array));
    });

    it("writes at company level", async () => {
      const plan = await prepareWrite(reconUrl, { level: "company", namespace: "ns", key: "k", value: "1" });
      await plan.apply();
      expect(SF.updateCompanyCustom).toHaveBeenCalledWith("96", "100", [{ namespace: "ns", key: "k", value: 1 }]);
    });

    it("writes at period level", async () => {
      const plan = await prepareWrite(reconUrl, { level: "period", namespace: "ns", key: "k", value: "1" });
      await plan.apply();
      expect(SF.updatePeriodCustom).toHaveBeenCalledWith("96", "100", "200", expect.any(Array));
    });

    it("resolves the account and writes at account level", async () => {
      SF.findAccountByNumber.mockResolvedValue({ account: { id: 555 } });
      const plan = await prepareWrite(reconUrl, { level: "account", account: "610000", namespace: "ns", key: "k", value: "1" });
      await plan.apply();
      expect(SF.findAccountByNumber).toHaveBeenCalledWith("96", "100", "200", "610000");
      expect(SF.updateAccountCustom).toHaveBeenCalledWith("96", "100", "200", 555, expect.any(Array));
    });

    it("builds null-valued properties for a delete", async () => {
      const plan = await prepareWrite(reconUrl, { namespace: "ns", key: "k" }, { del: true });
      expect(plan.properties).toEqual([{ namespace: "ns", key: "k", value: null }]);
    });

    it("returns null and logs when the account cannot be resolved", async () => {
      SF.findAccountByNumber.mockResolvedValue(null);
      const plan = await prepareWrite(reconUrl, { level: "account", account: "999", namespace: "ns", key: "k", value: "1" });
      expect(plan).toBeNull();
      expect(consola.error).toHaveBeenCalled();
    });
  });
});
