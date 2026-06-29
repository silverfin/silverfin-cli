jest.mock("../../lib/api/sfApi");
jest.mock("../../lib/utils/liquidTestUtils");
jest.mock("../../lib/liquidTestGenerator");
jest.mock("consola");

const SF = require("../../lib/api/sfApi");
const Utils = require("../../lib/utils/liquidTestUtils");
const liquidTestGenerator = require("../../lib/liquidTestGenerator");
const { capture } = require("../../lib/dataCapture");

describe("dataCapture.capture", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("scoped (default)", () => {
    it("reuses buildLiquidTest and returns the scoped snapshot", async () => {
      liquidTestGenerator.buildLiquidTest.mockResolvedValue({
        templateHandle: "my_handle",
        templateType: "reconciliationText",
        liquidTestObject: {
          capture: {
            context: { period: "2024-12-31" },
            data: { periods: { "2024-12-31": {} } },
            expectation: { results: { r: "1" } },
          },
        },
      });

      const result = await capture("https://live.getsilverfin.com/f/96/100/...", { full: false });

      expect(liquidTestGenerator.buildLiquidTest).toHaveBeenCalledWith("https://live.getsilverfin.com/f/96/100/...", "capture", true);
      expect(result).toEqual({
        mode: "scoped",
        handle: "my_handle",
        templateType: "reconciliationText",
        context: { period: "2024-12-31" },
        data: { periods: { "2024-12-31": {} } },
        expectation: { results: { r: "1" } },
      });
    });

    it("returns null when the template could not be built", async () => {
      liquidTestGenerator.buildLiquidTest.mockResolvedValue(undefined);
      const result = await capture("https://live.getsilverfin.com/f/96/100/...");
      expect(result).toBeNull();
    });
  });

  describe("full", () => {
    it("captures company + period + workflow reconciliation customs and results", async () => {
      Utils.extractURL.mockReturnValue({ firmId: "96", companyId: "100" });
      SF.getCompanyDrop.mockResolvedValue({ data: { name: "Co" } });
      SF.getCompanyCustom.mockResolvedValue({ data: [{ namespace: "c", key: "k", value: 1 }] });
      SF.getPeriods.mockResolvedValue({ data: [{ id: 200, fiscal_year: { end_date: "2024-12-31" } }] });
      SF.getAllPeriodCustom.mockResolvedValue([{ namespace: "p", key: "k", value: 2 }]);
      SF.getWorkflows.mockResolvedValue({ data: [{ id: 11, name: "WF" }] });
      SF.getWorkflowInformation.mockResolvedValue({ data: [{ id: 300, handle: "recon_a" }] });
      SF.getReconciliationCustom.mockResolvedValue({ data: [{ namespace: "r", key: "k", value: 3 }] });
      SF.getReconciliationResults.mockResolvedValue({ data: { res: "9" } });

      const result = await capture("https://live.getsilverfin.com/f/96/100/...", { full: true });

      expect(result.mode).toBe("full");
      expect(result.firmId).toBe("96");
      expect(result.company.drop).toEqual({ name: "Co" });
      expect(result.company.custom).toEqual([{ namespace: "c", key: "k", value: 1 }]);

      const period = result.periods["2024-12-31"];
      expect(period.periodId).toBe(200);
      expect(period.custom).toEqual([{ namespace: "p", key: "k", value: 2 }]);
      expect(period.workflows["WF (11)"].reconciliations.recon_a).toEqual({
        id: 300,
        custom: [{ namespace: "r", key: "k", value: 3 }],
        results: { res: "9" },
      });
    });
  });
});
