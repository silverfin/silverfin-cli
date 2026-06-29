jest.mock("../../lib/api/sfApi");
jest.mock("../../lib/utils/liquidTestUtils");
jest.mock("consola");

const SF = require("../../lib/api/sfApi");
const Utils = require("../../lib/utils/liquidTestUtils");
const { consola } = require("consola");
const { fetchResults } = require("../../lib/resultsReader");

describe("resultsReader.fetchResults", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("fetches results + customs for a reconciliation URL", async () => {
    Utils.extractURL.mockReturnValue({
      templateType: "reconciliationText",
      firmId: "96",
      companyId: "100",
      ledgerId: "200",
      reconciliationId: "300",
    });
    SF.getReconciliationCustom.mockResolvedValue({ data: [{ namespace: "ns", key: "k", value: "v" }] });
    SF.getReconciliationResults.mockResolvedValue({ data: { vol_1022_man: "5000.0" } });

    const result = await fetchResults("https://live.getsilverfin.com/f/96/100/...");

    expect(SF.getReconciliationResults).toHaveBeenCalledWith("firm", "96", "100", "200", "300");
    expect(result).toEqual({
      templateType: "reconciliationText",
      firmId: "96",
      companyId: "100",
      periodId: "200",
      reconciliationId: "300",
      results: { vol_1022_man: "5000.0" },
      custom: [{ namespace: "ns", key: "k", value: "v" }],
    });
  });

  it("resolves the account and fetches results + customs for an account URL", async () => {
    Utils.extractURL.mockReturnValue({
      templateType: "accountTemplate",
      firmId: "96",
      companyId: "100",
      ledgerId: "200",
      accountId: "610000",
    });
    SF.findAccountByNumber.mockResolvedValue({ account: { id: 555, number: "610000", name: "Costs" } });
    SF.getAccountTemplateCustom.mockResolvedValue({ data: [{ namespace: "a", key: "b", value: 1 }] });
    SF.getAccountTemplateResults.mockResolvedValue({ data: { unreconciled_amount: "0.0" } });

    const result = await fetchResults("https://live.getsilverfin.com/f/96/100/...");

    expect(SF.getAccountTemplateResults).toHaveBeenCalledWith("firm", "96", "100", "200", 555);
    expect(result).toMatchObject({
      templateType: "accountTemplate",
      accountNumber: "610000",
      accountId: 555,
      results: { unreconciled_amount: "0.0" },
      custom: [{ namespace: "a", key: "b", value: 1 }],
    });
  });

  it("returns null and logs an error when the account cannot be resolved", async () => {
    Utils.extractURL.mockReturnValue({
      templateType: "accountTemplate",
      firmId: "96",
      companyId: "100",
      ledgerId: "200",
      accountId: "999999",
    });
    SF.findAccountByNumber.mockResolvedValue(null);

    const result = await fetchResults("https://live.getsilverfin.com/f/96/100/...");

    expect(result).toBeNull();
    expect(consola.error).toHaveBeenCalled();
    expect(SF.getAccountTemplateResults).not.toHaveBeenCalled();
  });
});
