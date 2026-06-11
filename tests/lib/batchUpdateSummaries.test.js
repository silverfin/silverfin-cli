const toolkit = require("../../index");
const fsUtils = require("../../lib/utils/fsUtils");
const SF = require("../../lib/api/sfApi");
const { ReconciliationText } = require("../../lib/templates/reconciliationText");
const { ExportFile } = require("../../lib/templates/exportFile");
const { AccountTemplate } = require("../../lib/templates/accountTemplate");
const { SharedPart } = require("../../lib/templates/sharedPart");
const errorUtils = require("../../lib/utils/errorUtils");

jest.mock("../../lib/utils/apiUtils", () => ({
  checkRequiredEnvVariables: jest.fn(() => true),
}));

jest.mock("../../lib/utils/fsUtils");
jest.mock("../../lib/api/sfApi");
jest.mock("../../lib/templates/reconciliationText");
jest.mock("../../lib/templates/exportFile");
jest.mock("../../lib/templates/accountTemplate");
jest.mock("../../lib/templates/sharedPart");

jest.mock("consola", () => {
  const consola = {
    debug: jest.fn(),
    success: jest.fn(),
    error: jest.fn(),
    log: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
  };
  return { consola };
});

const { consola } = require("consola");

describe("Batch update error summaries", () => {
  const mockType = "firm";
  const mockEnvId = "100";
  const mockMessage = "batch test message";

  beforeEach(() => {
    jest.clearAllMocks();
    process.exitCode = 0;
    fsUtils.getTemplateId.mockImplementation((_type, envId, config) => config?.id?.[envId] ?? null);
  });

  describe("errorUtils.print*BatchErrorSummary", () => {
    it("printReconciliationBatchErrorSummary does nothing for empty array", () => {
      errorUtils.printReconciliationBatchErrorSummary([]);
      expect(consola.error).not.toHaveBeenCalled();
    });

    it("printReconciliationBatchErrorSummary prints missing_id and deduped hint", () => {
      errorUtils.printReconciliationBatchErrorSummary([{ kind: "missing_id", handle: "h1" }]);
      expect(consola.error).toHaveBeenCalledWith("Reconciliation update finished with 1 error(s):");
      expect(consola.error).toHaveBeenCalledWith(
        expect.stringContaining("Reconciliation h1: ID is missing")
      );
      expect(consola.log).toHaveBeenCalledWith(expect.stringContaining("get-reconciliation-id --all"));
    });

    it("printExportFileBatchErrorSummary prints update_failed without missing-id hint", () => {
      errorUtils.printExportFileBatchErrorSummary([{ kind: "update_failed", name: "exp1" }]);
      expect(consola.error).toHaveBeenCalledWith("Export file update finished with 1 error(s):");
      expect(consola.error).toHaveBeenCalledWith("Export file update failed: exp1");
      const hintLogged = consola.log.mock.calls.some((c) => String(c[0]).includes("get-export-file-id"));
      expect(hintLogged).toBe(false);
    });

    it("printSharedPartBatchErrorSummary prints exception line", () => {
      errorUtils.printSharedPartBatchErrorSummary([
        { kind: "exception", name: "sp1", message: "Something broke" },
      ]);
      expect(consola.error).toHaveBeenCalledWith("Shared part update finished with 1 error(s):");
      expect(consola.error).toHaveBeenCalledWith("Shared part sp1: Something broke");
    });

    it("printSharedPartBatchErrorSummary prints deduped get-shared-part-id hint for missing_id", () => {
      errorUtils.printSharedPartBatchErrorSummary([{ kind: "missing_id", name: "sp1" }]);
      expect(consola.log).toHaveBeenCalledWith(expect.stringContaining("get-shared-part-id --all"));
    });

    it("printAccountTemplateBatchErrorSummary prints missing_id hint once for two rows", () => {
      errorUtils.printAccountTemplateBatchErrorSummary([
        { kind: "missing_id", name: "at1" },
        { kind: "missing_id", name: "at2" },
      ]);
      const logCalls = consola.log.mock.calls.map((c) => c[0]);
      const hintCalls = logCalls.filter((m) => String(m).includes("get-account-template-id --all"));
      expect(hintCalls.length).toBe(1);
    });
  });

  describe("publishAllReconciliations", () => {
    it("defers missing-id errors to summary and sets exitCode", async () => {
      fsUtils.getAllTemplatesOfAType.mockReturnValue(["good", "bad"]);
      fsUtils.configExists.mockReturnValue(true);
      fsUtils.readConfig.mockImplementation((_tt, handle) =>
        handle === "good" ? { id: { [mockEnvId]: "999" } } : { id: { [mockEnvId]: null } }
      );

      ReconciliationText.read.mockResolvedValue({
        handle: "good",
        text: "x",
        text_parts: [],
      });
      SF.updateReconciliationText.mockResolvedValue({ data: { handle: "good" } });

      await toolkit.publishAllReconciliations(mockType, mockEnvId, mockMessage);

      expect(consola.success).toHaveBeenCalledWith("Reconciliation updated: good");
      expect(consola.error).toHaveBeenCalledWith("Reconciliation update finished with 1 error(s):");
      expect(process.exitCode).toBe(1);
    });
  });

  describe("publishAllExportFiles", () => {
    it("defers missing-id errors to summary and sets exitCode", async () => {
      fsUtils.getAllTemplatesOfAType.mockReturnValue(["ok_export", "bad_export"]);
      fsUtils.configExists.mockReturnValue(true);
      fsUtils.readConfig.mockImplementation((_tt, name) =>
        name === "ok_export" ? { id: { [mockEnvId]: "888" } } : { id: {} }
      );

      ExportFile.read.mockResolvedValue({
        name_nl: "ok_export",
        text: "x",
      });
      SF.updateExportFile.mockResolvedValue({ data: { name_nl: "ok_export" } });

      await toolkit.publishAllExportFiles(mockType, mockEnvId, mockMessage);

      expect(consola.success).toHaveBeenCalledWith("Export file updated: ok_export");
      expect(consola.error).toHaveBeenCalledWith("Export file update finished with 1 error(s):");
      expect(process.exitCode).toBe(1);
    });
  });

  describe("publishAllSharedParts", () => {
    it("defers missing-id errors to summary and sets exitCode", async () => {
      fsUtils.getAllTemplatesOfAType.mockReturnValue(["ok_sp", "bad_sp"]);
      fsUtils.configExists.mockReturnValue(true);
      fsUtils.readConfig.mockImplementation((_tt, name) =>
        name === "ok_sp" ? { id: { [mockEnvId]: "777" } } : { id: {} }
      );

      SharedPart.read.mockResolvedValue({
        name: "ok_sp",
        text: "x",
      });
      SF.updateSharedPart.mockResolvedValue({ data: { name: "ok_sp" } });

      await toolkit.publishAllSharedParts(mockType, mockEnvId, mockMessage);

      expect(consola.success).toHaveBeenCalledWith("Shared part updated: ok_sp");
      expect(consola.error).toHaveBeenCalledWith("Shared part update finished with 1 error(s):");
      expect(process.exitCode).toBe(1);
    });
  });

  describe("publishAllAccountTemplates", () => {
    it("defers missing-id errors to summary and sets exitCode", async () => {
      fsUtils.getAllTemplatesOfAType.mockReturnValue(["ok_at", "bad_at"]);
      fsUtils.configExists.mockReturnValue(true);
      fsUtils.readConfig.mockImplementation((_tt, name) =>
        name === "ok_at" ? { id: { [mockEnvId]: "666" } } : { id: {} }
      );

      AccountTemplate.read.mockResolvedValue({
        name_nl: "ok_at",
        text: "x",
        mapping_list_ranges: [],
      });
      SF.updateAccountTemplate.mockResolvedValue({ data: { name_nl: "ok_at" } });

      await toolkit.publishAllAccountTemplates(mockType, mockEnvId, mockMessage);

      expect(consola.success).toHaveBeenCalledWith("Account template updated: ok_at");
      expect(consola.error).toHaveBeenCalledWith("Account template update finished with 1 error(s):");
      expect(process.exitCode).toBe(1);
    });
  });

  describe("publish*ByName with deferredErrors array", () => {
    it("publishReconciliationByHandle pushes to deferredErrors instead of calling missingReconciliationId", async () => {
      const deferred = [];
      fsUtils.configExists.mockReturnValue(true);
      fsUtils.readConfig.mockReturnValue({ id: {} });

      await toolkit.publishReconciliationByHandle(mockType, mockEnvId, "solo", mockMessage, deferred);

      expect(deferred).toEqual([{ kind: "missing_id", handle: "solo" }]);
    });

    it("publishExportFileByName pushes update_failed when API returns no data", async () => {
      const deferred = [];
      fsUtils.configExists.mockReturnValue(true);
      fsUtils.readConfig.mockReturnValue({ id: { [mockEnvId]: "1" } });
      ExportFile.read.mockResolvedValue({ name_nl: "x", text: "y" });
      SF.updateExportFile.mockResolvedValue(null);

      await toolkit.publishExportFileByName(mockType, mockEnvId, "e1", mockMessage, deferred);

      expect(deferred).toEqual([{ kind: "update_failed", name: "e1" }]);
    });

    it("publishSharedPartByName pushes missing_id to deferredErrors", async () => {
      const deferred = [];
      fsUtils.configExists.mockReturnValue(true);
      fsUtils.readConfig.mockReturnValue({ id: {} });

      await toolkit.publishSharedPartByName(mockType, mockEnvId, "sp_solo", mockMessage, deferred);

      expect(deferred).toEqual([{ kind: "missing_id", name: "sp_solo" }]);
    });

    it("publishAccountTemplateByName pushes update_failed when API returns no data", async () => {
      const deferred = [];
      fsUtils.configExists.mockReturnValue(true);
      fsUtils.readConfig.mockReturnValue({ id: { [mockEnvId]: "1" } });
      AccountTemplate.read.mockResolvedValue({
        name_nl: "at1",
        text: "y",
        mapping_list_ranges: [],
      });
      SF.updateAccountTemplate.mockResolvedValue(null);

      await toolkit.publishAccountTemplateByName(mockType, mockEnvId, "at1", mockMessage, deferred);

      expect(deferred).toEqual([{ kind: "update_failed", name: "at1" }]);
    });
  });
});
