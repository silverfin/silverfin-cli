const toolkit = require("../../index");
const fsUtils = require("../../lib/utils/fsUtils");
const SF = require("../../lib/api/sfApi");
const { ReconciliationText } = require("../../lib/templates/reconciliationText");
const { ExportFile } = require("../../lib/templates/exportFile");
const { AccountTemplate } = require("../../lib/templates/accountTemplate");
const { SharedPart } = require("../../lib/templates/sharedPart");
const errorUtils = require("../../lib/utils/errorUtils");
const consola = require("consola");

jest.mock("../../lib/utils/apiUtils", () => ({
  checkRequiredEnvVariables: jest.fn(() => true),
}));

jest.mock("../../lib/utils/fsUtils");
jest.mock("../../lib/api/sfApi");
jest.mock("../../lib/templates/reconciliationText");
jest.mock("../../lib/templates/exportFile");
jest.mock("../../lib/templates/accountTemplate");
jest.mock("../../lib/templates/sharedPart");
jest.mock("../../lib/utils/errorUtils");

jest.mock("consola");
consola.debug = jest.fn();
consola.success = jest.fn();
consola.error = jest.fn();

describe("Toolkit", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("publishReconciliationById", () => {
    const mockType = "firm";
    const mockEnvId = "100";
    const mockReconciliationId = "12345";
    const mockMessage = "Test update message";
    const mockHandle = "test_handle";
    const mockTemplate = {
      handle: mockHandle,
      text: "test liquid content",
      text_parts: [],
    };

    it("should successfully update reconciliation by ID when matching template found", async () => {
      fsUtils.findHandleByID.mockReturnValue(mockHandle);
      ReconciliationText.read.mockResolvedValue(mockTemplate);
      const mockResponse = {
        data: {
          handle: mockHandle,
        },
      };
      SF.updateReconciliationText.mockResolvedValue(mockResponse);

      const result = await toolkit.publishReconciliationById(mockType, mockEnvId, mockReconciliationId, mockMessage);

      expect(fsUtils.findHandleByID).toHaveBeenCalledWith(mockType, mockEnvId, "reconciliationText", mockReconciliationId);
      expect(ReconciliationText.read).toHaveBeenCalledWith(mockHandle);
      expect(SF.updateReconciliationText).toHaveBeenCalledWith(mockType, mockEnvId, mockReconciliationId, {
        ...mockTemplate,
        version_comment: mockMessage,
      });
      expect(result).toBe(true);
    });

    it("should return false when no template found with matching ID", async () => {
      fsUtils.findHandleByID.mockReturnValue(undefined);

      const result = await toolkit.publishReconciliationById(mockType, mockEnvId, mockReconciliationId, mockMessage);

      expect(consola.error).toHaveBeenCalledWith(`No template found with reconciliation ID: ${mockReconciliationId} in ${mockType} ${mockEnvId}`);
      expect(result).toBe(false);
    });

    it("should handle partner type correctly", async () => {
      fsUtils.findHandleByID.mockReturnValue(mockHandle);
      ReconciliationText.read.mockResolvedValue(mockTemplate);

      const mockResponse = {
        data: {
          handle: mockHandle,
        },
      };
      SF.updateReconciliationText.mockResolvedValue(mockResponse);

      await toolkit.publishReconciliationById("partner", mockEnvId, mockReconciliationId, mockMessage);

      expect(SF.updateReconciliationText).toHaveBeenCalledWith("partner", mockEnvId, mockReconciliationId, {
        ...mockTemplate,
        version_comment: mockMessage,
        version_significant_change: false,
      });
    });

    it("should return undefined when template reading returns null", async () => {
      fsUtils.findHandleByID.mockReturnValue(mockHandle);
      ReconciliationText.read.mockResolvedValue(null);

      const result = await toolkit.publishReconciliationById(mockType, mockEnvId, mockReconciliationId, mockMessage);

      expect(result).toBeUndefined();
    });

    it("should return false when API call fails", async () => {
      fsUtils.findHandleByID.mockReturnValue(mockHandle);
      ReconciliationText.read.mockResolvedValue(mockTemplate);

      // Mock API failure
      SF.updateReconciliationText.mockResolvedValue(null);

      const result = await toolkit.publishReconciliationById(mockType, mockEnvId, mockReconciliationId, mockMessage);

      expect(consola.error).toHaveBeenCalledWith(`Reconciliation update failed for ID: ${mockReconciliationId} in ${mockType} ${mockEnvId}`);
      expect(result).toBe(false);
    });

    it("should handle exceptions gracefully", async () => {
      const mockError = new Error("Test error");
      fsUtils.findHandleByID.mockImplementation(() => {
        throw mockError;
      });

      await toolkit.publishReconciliationById(mockType, mockEnvId, mockReconciliationId, mockMessage);

      expect(errorUtils.errorHandler).toHaveBeenCalledWith(mockError);
    });

    it("should use default message when none provided", async () => {
      fsUtils.findHandleByID.mockReturnValue(mockHandle);
      ReconciliationText.read.mockResolvedValue(mockTemplate);

      const mockResponse = {
        data: {
          handle: mockHandle,
        },
      };
      SF.updateReconciliationText.mockResolvedValue(mockResponse);

      await toolkit.publishReconciliationById(mockType, mockEnvId, mockReconciliationId);

      expect(SF.updateReconciliationText).toHaveBeenCalledWith(mockType, mockEnvId, mockReconciliationId, {
        ...mockTemplate,
        version_comment: "Updated with the Silverfin CLI",
      });
    });
  });

  describe("publishExportFileById", () => {
    const mockType = "firm";
    const mockEnvId = "100";
    const mockExportFileId = "12345";
    const mockMessage = "Test update message";
    const mockHandle = "test_handle";
    const mockTemplate = {
      handle: mockHandle,
      name_nl: "Test Export File",
      text: "test liquid content",
    };

    it("should successfully update export file by ID when matching template found", async () => {
      fsUtils.findHandleByID.mockReturnValue(mockHandle);
      ExportFile.read.mockResolvedValue(mockTemplate);
      const mockResponse = {
        data: {
          name_nl: "Test Export File",
        },
      };
      SF.updateExportFile.mockResolvedValue(mockResponse);

      const result = await toolkit.publishExportFileById(mockType, mockEnvId, mockExportFileId, mockMessage);

      expect(fsUtils.findHandleByID).toHaveBeenCalledWith(mockType, mockEnvId, "exportFile", mockExportFileId);
      expect(ExportFile.read).toHaveBeenCalledWith(mockHandle);
      expect(SF.updateExportFile).toHaveBeenCalledWith(mockType, mockEnvId, mockExportFileId, {
        ...mockTemplate,
        version_comment: mockMessage,
      });
      expect(result).toBe(true);
    });

    it("should return false when no template found with matching ID", async () => {
      fsUtils.findHandleByID.mockReturnValue(undefined);

      const result = await toolkit.publishExportFileById(mockType, mockEnvId, mockExportFileId, mockMessage);

      expect(consola.error).toHaveBeenCalledWith(`No template found with export file ID: ${mockExportFileId} in ${mockType} ${mockEnvId}`);
      expect(result).toBe(false);
    });

    it("should return undefined when template reading returns null", async () => {
      fsUtils.findHandleByID.mockReturnValue(mockHandle);
      ExportFile.read.mockResolvedValue(null);

      const result = await toolkit.publishExportFileById(mockType, mockEnvId, mockExportFileId, mockMessage);

      expect(result).toBeUndefined();
    });

    it("should return false when API call fails", async () => {
      fsUtils.findHandleByID.mockReturnValue(mockHandle);
      ExportFile.read.mockResolvedValue(mockTemplate);

      // Mock API failure
      SF.updateExportFile.mockResolvedValue(null);

      const result = await toolkit.publishExportFileById(mockType, mockEnvId, mockExportFileId, mockMessage);

      expect(consola.error).toHaveBeenCalledWith(`Export file update failed for ID: ${mockExportFileId} in ${mockType} ${mockEnvId}`);
      expect(result).toBe(false);
    });

    it("should handle exceptions gracefully", async () => {
      const mockError = new Error("Test error");
      fsUtils.findHandleByID.mockImplementation(() => {
        throw mockError;
      });

      await toolkit.publishExportFileById(mockType, mockEnvId, mockExportFileId, mockMessage);

      expect(errorUtils.errorHandler).toHaveBeenCalledWith(mockError);
    });

    it("should use default message when none provided", async () => {
      fsUtils.findHandleByID.mockReturnValue(mockHandle);
      ExportFile.read.mockResolvedValue(mockTemplate);

      const mockResponse = {
        data: {
          name_nl: "Test Export File",
        },
      };
      SF.updateExportFile.mockResolvedValue(mockResponse);

      await toolkit.publishExportFileById(mockType, mockEnvId, mockExportFileId);

      expect(SF.updateExportFile).toHaveBeenCalledWith(mockType, mockEnvId, mockExportFileId, {
        ...mockTemplate,
        version_comment: "Updated with the Silverfin CLI",
      });
    });
  });

  describe("publishAccountTemplateById", () => {
    const mockType = "firm";
    const mockEnvId = "100";
    const mockAccountTemplateId = "12345";
    const mockMessage = "Test update message";
    const mockHandle = "test_handle";
    const mockTemplate = {
      handle: mockHandle,
      name_nl: "Test Account Template",
      text: "test liquid content",
      mapping_list_ranges: [
        { type: "firm", env_id: "100", range: "1-10" },
        { type: "partner", env_id: "200", range: "11-20" },
      ],
    };

    it("should successfully update account template by ID when matching template found", async () => {
      fsUtils.findHandleByID.mockReturnValue(mockHandle);
      AccountTemplate.read.mockResolvedValue(mockTemplate);
      const mockResponse = {
        data: {
          name_nl: "Test Account Template",
        },
      };
      SF.updateAccountTemplate.mockResolvedValue(mockResponse);

      const result = await toolkit.publishAccountTemplateById(mockType, mockEnvId, mockAccountTemplateId, mockMessage);

      expect(fsUtils.findHandleByID).toHaveBeenCalledWith(mockType, mockEnvId, "accountTemplate", mockAccountTemplateId);
      expect(AccountTemplate.read).toHaveBeenCalledWith(mockHandle);
      expect(SF.updateAccountTemplate).toHaveBeenCalledWith(mockType, mockEnvId, mockAccountTemplateId, {
        ...mockTemplate,
        version_comment: mockMessage,
        mapping_list_ranges: [{ type: "firm", env_id: "100", range: "1-10" }],
      });
      expect(result).toBe(true);
    });

    it("should return false when no template found with matching ID", async () => {
      fsUtils.findHandleByID.mockReturnValue(undefined);

      const result = await toolkit.publishAccountTemplateById(mockType, mockEnvId, mockAccountTemplateId, mockMessage);

      expect(consola.error).toHaveBeenCalledWith(`No template found with account template ID: ${mockAccountTemplateId} in ${mockType} ${mockEnvId}`);
      expect(result).toBe(false);
    });

    it("should handle partner type correctly", async () => {
      const partnerEnvId = "200";
      fsUtils.findHandleByID.mockReturnValue(mockHandle);
      AccountTemplate.read.mockResolvedValue({
        ...mockTemplate,
        mapping_list_ranges: [
          { type: "firm", env_id: "100", range: "1-10" },
          { type: "partner", env_id: "200", range: "11-20" },
        ],
      });

      const mockResponse = {
        data: {
          name_nl: "Test Account Template",
        },
      };
      SF.updateAccountTemplate.mockResolvedValue(mockResponse);

      await toolkit.publishAccountTemplateById("partner", partnerEnvId, mockAccountTemplateId, mockMessage);

      expect(SF.updateAccountTemplate).toHaveBeenCalledWith("partner", partnerEnvId, mockAccountTemplateId, {
        ...mockTemplate,
        version_comment: mockMessage,
        version_significant_change: false,
        mapping_list_ranges: [{ type: "partner", env_id: partnerEnvId, range: "11-20" }],
      });
    });

    it("should return undefined when template reading returns null", async () => {
      fsUtils.findHandleByID.mockReturnValue(mockHandle);
      AccountTemplate.read.mockResolvedValue(null);

      const result = await toolkit.publishAccountTemplateById(mockType, mockEnvId, mockAccountTemplateId, mockMessage);

      expect(result).toBeUndefined();
    });

    it("should return false when API call fails", async () => {
      fsUtils.findHandleByID.mockReturnValue(mockHandle);
      AccountTemplate.read.mockResolvedValue(mockTemplate);

      // Mock API failure
      SF.updateAccountTemplate.mockResolvedValue(null);

      const result = await toolkit.publishAccountTemplateById(mockType, mockEnvId, mockAccountTemplateId, mockMessage);

      expect(consola.error).toHaveBeenCalledWith(`Account template update failed for ID: ${mockAccountTemplateId} in ${mockType} ${mockEnvId}`);
      expect(result).toBe(false);
    });

    it("should handle exceptions gracefully", async () => {
      const mockError = new Error("Test error");
      fsUtils.findHandleByID.mockImplementation(() => {
        throw mockError;
      });

      await toolkit.publishAccountTemplateById(mockType, mockEnvId, mockAccountTemplateId, mockMessage);

      expect(errorUtils.errorHandler).toHaveBeenCalledWith(mockError);
    });

    it("should use default message when none provided", async () => {
      fsUtils.findHandleByID.mockReturnValue(mockHandle);
      AccountTemplate.read.mockResolvedValue(mockTemplate);

      const mockResponse = {
        data: {
          name_nl: "Test Account Template",
        },
      };
      SF.updateAccountTemplate.mockResolvedValue(mockResponse);

      await toolkit.publishAccountTemplateById(mockType, mockEnvId, mockAccountTemplateId);

      expect(SF.updateAccountTemplate).toHaveBeenCalledWith(mockType, mockEnvId, mockAccountTemplateId, {
        ...mockTemplate,
        version_comment: "Updated with the Silverfin CLI",
        mapping_list_ranges: [{ type: mockType, env_id: mockEnvId, range: "1-10" }],
      });
    });
  });

  describe("publishSharedPartById", () => {
    const mockType = "firm";
    const mockEnvId = "100";
    const mockSharedPartId = "12345";
    const mockMessage = "Test update message";
    const mockHandle = "test_handle";
    const mockTemplate = {
      handle: mockHandle,
      name: "Test Shared Part",
      text: "test liquid content",
    };

    it("should successfully update shared part by ID when matching template found", async () => {
      fsUtils.findHandleByID.mockReturnValue(mockHandle);
      SharedPart.read.mockResolvedValue(mockTemplate);
      const mockResponse = {
        data: {
          name: "Test Shared Part",
        },
      };
      SF.updateSharedPart.mockResolvedValue(mockResponse);

      const result = await toolkit.publishSharedPartById(mockType, mockEnvId, mockSharedPartId, mockMessage);

      expect(fsUtils.findHandleByID).toHaveBeenCalledWith(mockType, mockEnvId, "sharedPart", mockSharedPartId);
      expect(SharedPart.read).toHaveBeenCalledWith(mockHandle);
      expect(SF.updateSharedPart).toHaveBeenCalledWith(mockType, mockEnvId, mockSharedPartId, {
        ...mockTemplate,
        version_comment: mockMessage,
      });
      expect(result).toBe(true);
    });

    it("should return false when no template found with matching ID", async () => {
      fsUtils.findHandleByID.mockReturnValue(undefined);

      const result = await toolkit.publishSharedPartById(mockType, mockEnvId, mockSharedPartId, mockMessage);

      expect(consola.error).toHaveBeenCalledWith(`No template found with shared part ID: ${mockSharedPartId} in ${mockType} ${mockEnvId}`);
      expect(result).toBe(false);
    });

    it("should return undefined when template reading returns null", async () => {
      fsUtils.findHandleByID.mockReturnValue(mockHandle);
      SharedPart.read.mockResolvedValue(null);

      const result = await toolkit.publishSharedPartById(mockType, mockEnvId, mockSharedPartId, mockMessage);

      expect(result).toBeUndefined();
    });

    it("should return false when API call fails", async () => {
      fsUtils.findHandleByID.mockReturnValue(mockHandle);
      SharedPart.read.mockResolvedValue(mockTemplate);

      // Mock API failure
      SF.updateSharedPart.mockResolvedValue(null);

      const result = await toolkit.publishSharedPartById(mockType, mockEnvId, mockSharedPartId, mockMessage);

      expect(consola.error).toHaveBeenCalledWith(`Shared part update failed for ID: ${mockSharedPartId} in ${mockType} ${mockEnvId}`);
      expect(result).toBe(false);
    });

    it("should handle exceptions gracefully", async () => {
      const mockError = new Error("Test error");
      fsUtils.findHandleByID.mockImplementation(() => {
        throw mockError;
      });

      await toolkit.publishSharedPartById(mockType, mockEnvId, mockSharedPartId, mockMessage);

      expect(errorUtils.errorHandler).toHaveBeenCalledWith(mockError);
    });

    it("should use default message when none provided", async () => {
      fsUtils.findHandleByID.mockReturnValue(mockHandle);
      SharedPart.read.mockResolvedValue(mockTemplate);

      const mockResponse = {
        data: {
          name: "Test Shared Part",
        },
      };
      SF.updateSharedPart.mockResolvedValue(mockResponse);

      await toolkit.publishSharedPartById(mockType, mockEnvId, mockSharedPartId);

      expect(SF.updateSharedPart).toHaveBeenCalledWith(mockType, mockEnvId, mockSharedPartId, {
        ...mockTemplate,
        version_comment: "Updated with the Silverfin CLI",
      });
    });
  });

  // ─── fetchReconciliationById ──────────────────────────────────────────────

  describe("fetchReconciliationById", () => {
    const mockType = "firm";
    const mockEnvId = "100";
    const mockId = "808080";
    const mockTemplate = { data: { handle: "test_handle", id: 808080, text: "liquid" } };

    it("should save and log success when template is found", async () => {
      SF.readReconciliationTextById.mockResolvedValue(mockTemplate);
      ReconciliationText.save.mockResolvedValue(true);

      await toolkit.fetchReconciliationById(mockType, mockEnvId, mockId);

      expect(SF.readReconciliationTextById).toHaveBeenCalledWith(mockType, mockEnvId, mockId);
      expect(ReconciliationText.save).toHaveBeenCalledWith(mockType, mockEnvId, mockTemplate.data);
      expect(consola.success).toHaveBeenCalled();
    });

    it("should log error and exit when template not found", async () => {
      SF.readReconciliationTextById.mockResolvedValue(null);
      const exitSpy = jest.spyOn(process, "exit").mockImplementation(() => { throw new Error("exit"); });

      await expect(toolkit.fetchReconciliationById(mockType, mockEnvId, mockId)).rejects.toThrow("exit");

      expect(consola.error).toHaveBeenCalled();
      exitSpy.mockRestore();
    });

    it("should not log success when save returns false", async () => {
      SF.readReconciliationTextById.mockResolvedValue(mockTemplate);
      ReconciliationText.save.mockResolvedValue(false);

      await toolkit.fetchReconciliationById(mockType, mockEnvId, mockId);

      expect(consola.success).not.toHaveBeenCalled();
    });
  });

  // ─── fetchReconciliationByHandle ──────────────────────────────────────────

  describe("fetchReconciliationByHandle", () => {
    const mockType = "firm";
    const mockEnvId = "100";
    const mockHandle = "test_handle";
    const mockTemplate = { handle: mockHandle, id: 808080 };

    it("should use config id when config exists with id", async () => {
      fsUtils.configExists.mockReturnValue(true);
      fsUtils.readConfig.mockReturnValue({ id: { 100: 808080 }, partner_id: {} });
      fsUtils.getTemplateId.mockReturnValue(808080);
      SF.readReconciliationTextById.mockResolvedValue({ data: mockTemplate });
      ReconciliationText.save.mockResolvedValue(true);

      await toolkit.fetchReconciliationByHandle(mockType, mockEnvId, mockHandle);

      expect(fsUtils.getTemplateId).toHaveBeenCalled();
    });

    it("should search SF by handle when config has no id", async () => {
      fsUtils.configExists.mockReturnValue(false);
      SF.findReconciliationTextByHandle.mockResolvedValue(mockTemplate);
      SF.readReconciliationTextById.mockResolvedValue({ data: mockTemplate });
      ReconciliationText.save.mockResolvedValue(true);

      await toolkit.fetchReconciliationByHandle(mockType, mockEnvId, mockHandle);

      expect(SF.findReconciliationTextByHandle).toHaveBeenCalledWith(mockType, mockEnvId, mockHandle);
    });

    it("should exit when template not found in SF", async () => {
      fsUtils.configExists.mockReturnValue(false);
      SF.findReconciliationTextByHandle.mockResolvedValue(null);
      const exitSpy = jest.spyOn(process, "exit").mockImplementation(() => { throw new Error("exit"); });

      await expect(toolkit.fetchReconciliationByHandle(mockType, mockEnvId, mockHandle)).rejects.toThrow("exit");

      expect(consola.error).toHaveBeenCalled();
      exitSpy.mockRestore();
    });
  });

  // ─── fetchAllReconciliations ──────────────────────────────────────────────

  describe("fetchAllReconciliations", () => {
    const mockType = "firm";
    const mockEnvId = "100";

    it("should save each template when array returned", async () => {
      const templates = [{ handle: "recon_1", id: 1 }, { handle: "recon_2", id: 2 }];
      SF.readReconciliationTexts.mockResolvedValueOnce(templates).mockResolvedValueOnce([]);
      ReconciliationText.save.mockResolvedValue(true);

      await toolkit.fetchAllReconciliations(mockType, mockEnvId);

      expect(ReconciliationText.save).toHaveBeenCalledTimes(2);
    });

    it("should log error when page 1 returns empty array", async () => {
      SF.readReconciliationTexts.mockResolvedValue([]);

      await toolkit.fetchAllReconciliations(mockType, mockEnvId, 1);

      expect(consola.error).toHaveBeenCalledWith(`No reconciliations found in ${mockType} ${mockEnvId}`);
    });
  });

  // ─── fetchExistingReconciliations ─────────────────────────────────────────

  describe("fetchExistingReconciliations", () => {
    const mockType = "firm";
    const mockEnvId = "100";

    it("should warn when no local templates exist", async () => {
      fsUtils.getAllTemplatesOfAType.mockReturnValue([]);

      await toolkit.fetchExistingReconciliations(mockType, mockEnvId);

      expect(consola.warn).toHaveBeenCalled();
    });

    it("should call fetchReconciliationById for each template with an id", async () => {
      fsUtils.getAllTemplatesOfAType.mockReturnValue(["handle_1"]);
      fsUtils.configExists.mockReturnValue(true);
      fsUtils.readConfig.mockReturnValue({ id: { 100: 808080 }, partner_id: {} });
      fsUtils.getTemplateId.mockReturnValue(808080);
      SF.readReconciliationTextById.mockResolvedValue({ data: { handle: "handle_1", id: 808080 } });
      ReconciliationText.save.mockResolvedValue(true);

      await toolkit.fetchExistingReconciliations(mockType, mockEnvId);

      expect(SF.readReconciliationTextById).toHaveBeenCalled();
    });
  });

  // ─── publishReconciliationByHandle ────────────────────────────────────────

  describe("publishReconciliationByHandle", () => {
    const mockType = "firm";
    const mockEnvId = "100";
    const mockHandle = "test_handle";
    const mockTemplate = { handle: mockHandle, text: "liquid" };

    it("should update reconciliation when config and id exist", async () => {
      fsUtils.configExists.mockReturnValue(true);
      fsUtils.readConfig.mockReturnValue({ id: { 100: 808080 }, partner_id: {} });
      fsUtils.getTemplateId.mockReturnValue(808080);
      ReconciliationText.read.mockResolvedValue(mockTemplate);
      SF.updateReconciliationText.mockResolvedValue({ data: { handle: mockHandle } });

      const result = await toolkit.publishReconciliationByHandle(mockType, mockEnvId, mockHandle);

      expect(SF.updateReconciliationText).toHaveBeenCalled();
      expect(result).toBe(true);
    });

    it("should return false when config does not exist", async () => {
      fsUtils.configExists.mockReturnValue(false);

      const result = await toolkit.publishReconciliationByHandle(mockType, mockEnvId, mockHandle);

      expect(result).toBe(false);
      expect(errorUtils.missingReconciliationId).toHaveBeenCalled();
    });

    it("should return false when id is not found in config", async () => {
      fsUtils.configExists.mockReturnValue(true);
      fsUtils.readConfig.mockReturnValue({ id: {}, partner_id: {} });
      fsUtils.getTemplateId.mockReturnValue(undefined);

      const result = await toolkit.publishReconciliationByHandle(mockType, mockEnvId, mockHandle);

      expect(result).toBe(false);
    });
  });

  // ─── publishAllReconciliations ────────────────────────────────────────────

  describe("publishAllReconciliations", () => {
    it("should call publishReconciliationByHandle for each template", async () => {
      fsUtils.getAllTemplatesOfAType.mockReturnValue(["handle_1", "handle_2"]);
      fsUtils.configExists.mockReturnValue(true);
      fsUtils.readConfig.mockReturnValue({ id: { 100: 808080 }, partner_id: {} });
      fsUtils.getTemplateId.mockReturnValue(808080);
      ReconciliationText.read.mockResolvedValue({ handle: "handle_1", text: "liquid" });
      SF.updateReconciliationText.mockResolvedValue({ data: { handle: "handle_1" } });

      await toolkit.publishAllReconciliations("firm", "100");

      expect(fsUtils.getAllTemplatesOfAType).toHaveBeenCalledWith("reconciliationText");
    });
  });

  // ─── newReconciliation ────────────────────────────────────────────────────

  describe("newReconciliation", () => {
    const mockType = "firm";
    const mockEnvId = "100";
    const mockHandle = "new_handle";
    const mockTemplate = { handle: mockHandle, text: "liquid", text_parts: [] };

    it("should create reconciliation and store new id on success", async () => {
      SF.findReconciliationTextByHandle.mockResolvedValue(null);
      ReconciliationText.read.mockResolvedValue(mockTemplate);
      SF.createReconciliationText.mockResolvedValue({ status: 201, data: { id: 999, handle: mockHandle } });

      await toolkit.newReconciliation(mockType, mockEnvId, mockHandle);

      expect(SF.createReconciliationText).toHaveBeenCalled();
      expect(ReconciliationText.updateTemplateId).toHaveBeenCalled();
      expect(consola.success).toHaveBeenCalled();
    });

    it("should warn and skip when reconciliation already exists", async () => {
      SF.findReconciliationTextByHandle.mockResolvedValue({ handle: mockHandle, id: 808080 });

      await toolkit.newReconciliation(mockType, mockEnvId, mockHandle);

      expect(consola.warn).toHaveBeenCalled();
      expect(SF.createReconciliationText).not.toHaveBeenCalled();
    });
  });

  // ─── newAllReconciliations ────────────────────────────────────────────────

  describe("newAllReconciliations", () => {
    it("should call newReconciliation for each local template", async () => {
      fsUtils.getAllTemplatesOfAType.mockReturnValue(["handle_1"]);
      SF.findReconciliationTextByHandle.mockResolvedValue(null);
      ReconciliationText.read.mockResolvedValue({ handle: "handle_1", text: "liquid" });
      SF.createReconciliationText.mockResolvedValue({ status: 201, data: { id: 1, handle: "handle_1" } });

      await toolkit.newAllReconciliations("firm", "100");

      expect(fsUtils.getAllTemplatesOfAType).toHaveBeenCalledWith("reconciliationText");
    });
  });

  // ─── fetchExportFileById ──────────────────────────────────────────────────

  describe("fetchExportFileById", () => {
    const mockType = "firm";
    const mockEnvId = "100";
    const mockId = "2201";
    const mockTemplate = { id: 2201, name_nl: "export_1", text: "liquid" };

    it("should save and log success when template is found", async () => {
      SF.readExportFileById.mockResolvedValue(mockTemplate);
      ExportFile.save.mockReturnValue(true);

      await toolkit.fetchExportFileById(mockType, mockEnvId, mockId);

      expect(ExportFile.save).toHaveBeenCalledWith(mockType, mockEnvId, mockTemplate);
      expect(consola.success).toHaveBeenCalled();
    });

    it("should log error and exit when template not found", async () => {
      SF.readExportFileById.mockResolvedValue(null);
      const exitSpy = jest.spyOn(process, "exit").mockImplementation(() => { throw new Error("exit"); });

      await expect(toolkit.fetchExportFileById(mockType, mockEnvId, mockId)).rejects.toThrow("exit");

      expect(consola.error).toHaveBeenCalled();
      exitSpy.mockRestore();
    });
  });

  // ─── fetchAllExportFiles ──────────────────────────────────────────────────

  describe("fetchAllExportFiles", () => {
    it("should save each template when array returned", async () => {
      const templates = [{ name_nl: "export_1", id: 1 }];
      SF.readExportFiles.mockResolvedValueOnce(templates).mockResolvedValueOnce([]);
      ExportFile.save.mockReturnValue(true);

      await toolkit.fetchAllExportFiles("firm", "100");

      expect(ExportFile.save).toHaveBeenCalled();
    });

    it("should log error when page 1 returns empty array", async () => {
      SF.readExportFiles.mockResolvedValue([]);

      await toolkit.fetchAllExportFiles("firm", "100", 1);

      expect(consola.error).toHaveBeenCalledWith(`No export files found in firm 100`);
    });
  });

  // ─── publishExportFileByName ──────────────────────────────────────────────

  describe("publishExportFileByName", () => {
    const mockType = "firm";
    const mockEnvId = "100";
    const mockName = "export_1";
    const mockTemplate = { name_nl: mockName, text: "liquid" };

    it("should update export file when config and id exist", async () => {
      fsUtils.configExists.mockReturnValue(true);
      fsUtils.readConfig.mockReturnValue({ id: { 100: 2201 }, partner_id: {} });
      fsUtils.getTemplateId.mockReturnValue(2201);
      ExportFile.read.mockResolvedValue(mockTemplate);
      SF.updateExportFile.mockResolvedValue({ data: { name_nl: mockName } });

      const result = await toolkit.publishExportFileByName(mockType, mockEnvId, mockName);

      expect(SF.updateExportFile).toHaveBeenCalled();
      expect(result).toBe(true);
    });

    it("should return false when config does not exist", async () => {
      fsUtils.configExists.mockReturnValue(false);

      const result = await toolkit.publishExportFileByName(mockType, mockEnvId, mockName);

      expect(result).toBe(false);
    });
  });

  // ─── newExportFile ────────────────────────────────────────────────────────

  describe("newExportFile", () => {
    const mockType = "firm";
    const mockEnvId = "100";
    const mockName = "new_export";
    const mockTemplate = { name_nl: mockName, text: "liquid" };

    it("should create export file and store new id on success", async () => {
      SF.findExportFileByName.mockResolvedValue(null);
      ExportFile.read.mockResolvedValue(mockTemplate);
      SF.createExportFile.mockResolvedValue({ status: 201, data: { id: 999, name_nl: mockName } });

      await toolkit.newExportFile(mockType, mockEnvId, mockName);

      expect(SF.createExportFile).toHaveBeenCalled();
      expect(ExportFile.updateTemplateId).toHaveBeenCalled();
      expect(consola.success).toHaveBeenCalled();
    });

    it("should warn and skip when export file already exists", async () => {
      SF.findExportFileByName.mockResolvedValue({ name_nl: mockName, id: 2201 });

      await toolkit.newExportFile(mockType, mockEnvId, mockName);

      expect(consola.warn).toHaveBeenCalled();
      expect(SF.createExportFile).not.toHaveBeenCalled();
    });
  });

  // ─── fetchAccountTemplateById ─────────────────────────────────────────────

  describe("fetchAccountTemplateById", () => {
    const mockType = "firm";
    const mockEnvId = "100";
    const mockId = "1101";
    const mockTemplate = { id: 1101, name_nl: "account_1", text: "liquid" };

    it("should save and log success when template is found", async () => {
      SF.readAccountTemplateById.mockResolvedValue(mockTemplate);
      AccountTemplate.save.mockReturnValue(true);

      await toolkit.fetchAccountTemplateById(mockType, mockEnvId, mockId);

      expect(AccountTemplate.save).toHaveBeenCalledWith(mockType, mockEnvId, mockTemplate);
      expect(consola.success).toHaveBeenCalled();
    });

    it("should log error and exit when template not found", async () => {
      SF.readAccountTemplateById.mockResolvedValue(null);
      const exitSpy = jest.spyOn(process, "exit").mockImplementation(() => { throw new Error("exit"); });

      await expect(toolkit.fetchAccountTemplateById(mockType, mockEnvId, mockId)).rejects.toThrow("exit");

      expect(consola.error).toHaveBeenCalled();
      exitSpy.mockRestore();
    });
  });

  // ─── fetchAllAccountTemplates ─────────────────────────────────────────────

  describe("fetchAllAccountTemplates", () => {
    it("should save each template when array returned", async () => {
      const templates = [{ name_nl: "account_1", id: 1 }];
      SF.readAccountTemplates.mockResolvedValueOnce(templates).mockResolvedValueOnce([]);
      AccountTemplate.save.mockReturnValue(true);

      await toolkit.fetchAllAccountTemplates("firm", "100");

      expect(AccountTemplate.save).toHaveBeenCalled();
    });

    it("should warn when page 1 returns empty array", async () => {
      SF.readAccountTemplates.mockResolvedValue([]);

      await toolkit.fetchAllAccountTemplates("firm", "100", 1);

      expect(consola.warn).toHaveBeenCalledWith(`No account templates found in firm 100`);
    });
  });

  // ─── publishAccountTemplateByName ─────────────────────────────────────────

  describe("publishAccountTemplateByName", () => {
    const mockType = "firm";
    const mockEnvId = "100";
    const mockName = "account_1";
    const mockTemplate = { name_nl: mockName, text: "liquid", mapping_list_ranges: [] };

    it("should update account template when config and id exist", async () => {
      fsUtils.configExists.mockReturnValue(true);
      fsUtils.readConfig.mockReturnValue({ id: { 100: 1101 }, partner_id: {} });
      fsUtils.getTemplateId.mockReturnValue(1101);
      AccountTemplate.read.mockResolvedValue(mockTemplate);
      SF.updateAccountTemplate.mockResolvedValue({ data: { name_nl: mockName } });

      const result = await toolkit.publishAccountTemplateByName(mockType, mockEnvId, mockName);

      expect(SF.updateAccountTemplate).toHaveBeenCalled();
      expect(result).toBe(true);
    });

    it("should return false when config does not exist", async () => {
      fsUtils.configExists.mockReturnValue(false);

      const result = await toolkit.publishAccountTemplateByName(mockType, mockEnvId, mockName);

      expect(result).toBe(false);
    });
  });

  // ─── newAccountTemplate ───────────────────────────────────────────────────

  describe("newAccountTemplate", () => {
    const mockType = "firm";
    const mockEnvId = "100";
    const mockName = "new_account";
    const mockTemplate = { name_nl: mockName, text: "liquid", mapping_list_ranges: [] };

    it("should create account template and store new id on success", async () => {
      SF.findAccountTemplateByName.mockResolvedValue(null);
      AccountTemplate.read.mockResolvedValue(mockTemplate);
      SF.createAccountTemplate.mockResolvedValue({ status: 201, data: { id: 999, name_nl: mockName } });

      await toolkit.newAccountTemplate(mockType, mockEnvId, mockName);

      expect(SF.createAccountTemplate).toHaveBeenCalled();
      expect(AccountTemplate.updateTemplateId).toHaveBeenCalled();
      expect(consola.success).toHaveBeenCalled();
    });

    it("should warn and skip when account template already exists", async () => {
      SF.findAccountTemplateByName.mockResolvedValue({ name_nl: mockName, id: 1101 });

      await toolkit.newAccountTemplate(mockType, mockEnvId, mockName);

      expect(consola.warn).toHaveBeenCalled();
      expect(SF.createAccountTemplate).not.toHaveBeenCalled();
    });
  });

  // ─── fetchSharedPartById ──────────────────────────────────────────────────

  describe("fetchSharedPartById", () => {
    const mockType = "firm";
    const mockEnvId = "100";
    const mockId = "5601";
    const mockTemplate = { id: 5601, name: "shared_part_1", text: "liquid", used_in: [] };

    it("should save and log success when template is found", async () => {
      SF.readSharedPartById.mockResolvedValue({ data: mockTemplate });
      SharedPart.save.mockResolvedValue(true);

      await toolkit.fetchSharedPartById(mockType, mockEnvId, mockId);

      expect(SharedPart.save).toHaveBeenCalledWith(mockType, mockEnvId, mockTemplate);
      expect(consola.success).toHaveBeenCalled();
    });

    it("should log error and exit when template not found", async () => {
      SF.readSharedPartById.mockResolvedValue(null);
      const exitSpy = jest.spyOn(process, "exit").mockImplementation(() => { throw new Error("exit"); });

      await expect(toolkit.fetchSharedPartById(mockType, mockEnvId, mockId)).rejects.toThrow("exit");

      expect(consola.error).toHaveBeenCalled();
      exitSpy.mockRestore();
    });
  });

  // ─── fetchAllSharedParts ──────────────────────────────────────────────────

  describe("fetchAllSharedParts", () => {
    it("should fetch each shared part when list returned", async () => {
      const sharedParts = [{ id: 5601, name: "shared_part_1" }];
      SF.readSharedParts.mockResolvedValueOnce({ data: sharedParts }).mockResolvedValueOnce({ data: [] });
      SF.readSharedPartById.mockResolvedValue({ data: { id: 5601, name: "shared_part_1", text: "liquid", used_in: [] } });
      SharedPart.save.mockResolvedValue(true);

      await toolkit.fetchAllSharedParts("firm", "100");

      expect(SF.readSharedPartById).toHaveBeenCalled();
    });

    it("should log error when page 1 returns empty data", async () => {
      SF.readSharedParts.mockResolvedValue({ data: [] });

      await toolkit.fetchAllSharedParts("firm", "100", 1);

      expect(consola.error).toHaveBeenCalledWith(`No shared parts found in firm 100`);
    });
  });

  // ─── publishSharedPartByName ──────────────────────────────────────────────

  describe("publishSharedPartByName", () => {
    const mockType = "firm";
    const mockEnvId = "100";
    const mockName = "shared_part_1";
    const mockTemplate = { name: mockName, text: "liquid" };

    it("should update shared part when config and id exist", async () => {
      fsUtils.configExists.mockReturnValue(true);
      fsUtils.readConfig.mockReturnValue({ id: { 100: 5601 }, partner_id: {} });
      fsUtils.getTemplateId.mockReturnValue(5601);
      SharedPart.read.mockResolvedValue(mockTemplate);
      SF.updateSharedPart.mockResolvedValue({ data: { name: mockName } });

      const result = await toolkit.publishSharedPartByName(mockType, mockEnvId, mockName);

      expect(SF.updateSharedPart).toHaveBeenCalled();
      expect(result).toBe(true);
    });

    it("should return false when config does not exist", async () => {
      fsUtils.configExists.mockReturnValue(false);

      const result = await toolkit.publishSharedPartByName(mockType, mockEnvId, mockName);

      expect(result).toBe(false);
    });
  });

  // ─── newSharedPart ────────────────────────────────────────────────────────

  describe("newSharedPart", () => {
    const mockType = "firm";
    const mockEnvId = "100";
    const mockName = "new_shared";
    const mockTemplate = { name: mockName, text: "liquid" };

    it("should create shared part and store new id on success", async () => {
      SF.findSharedPartByName.mockResolvedValue(null);
      SharedPart.read.mockResolvedValue(mockTemplate);
      SF.createSharedPart.mockResolvedValue({ status: 201, data: { id: 999, name: mockName } });

      await toolkit.newSharedPart(mockType, mockEnvId, mockName);

      expect(SF.createSharedPart).toHaveBeenCalled();
      expect(SharedPart.updateTemplateId).toHaveBeenCalled();
      expect(consola.success).toHaveBeenCalled();
    });

    it("should warn and skip when shared part already exists", async () => {
      SF.findSharedPartByName.mockResolvedValue({ name: mockName, id: 5601 });

      await toolkit.newSharedPart(mockType, mockEnvId, mockName);

      expect(consola.warn).toHaveBeenCalled();
      expect(SF.createSharedPart).not.toHaveBeenCalled();
    });
  });

  // ─── getTemplateId ────────────────────────────────────────────────────────

  describe("getTemplateId", () => {
    const mockType = "firm";
    const mockEnvId = "100";

    it("should update config and return true when reconciliation found", async () => {
      const mockTemplate = { id: 808080, handle: "test_handle" };
      SF.findReconciliationTextByHandle.mockResolvedValue(mockTemplate);
      fsUtils.readConfig.mockReturnValue({ id: {}, partner_id: {} });

      const result = await toolkit.getTemplateId(mockType, mockEnvId, "reconciliationText", "test_handle");

      expect(result).toBe(true);
      expect(fsUtils.writeConfig).toHaveBeenCalled();
    });

    it("should warn and return false when template not found", async () => {
      SF.findReconciliationTextByHandle.mockResolvedValue(null);

      const result = await toolkit.getTemplateId(mockType, mockEnvId, "reconciliationText", "missing_handle");

      expect(result).toBe(false);
      expect(consola.warn).toHaveBeenCalled();
    });

    it("should update config for sharedPart type", async () => {
      SF.findSharedPartByName.mockResolvedValue({ id: 5601, name: "shared_part_1" });
      fsUtils.readConfig.mockReturnValue({ id: {}, partner_id: {} });

      const result = await toolkit.getTemplateId(mockType, mockEnvId, "sharedPart", "shared_part_1");

      expect(result).toBe(true);
    });
  });

  // ─── getAllTemplatesId ────────────────────────────────────────────────────

  describe("getAllTemplatesId", () => {
    it("should call getTemplateId for each template of the type", async () => {
      fsUtils.getAllTemplatesOfAType.mockReturnValue(["handle_1"]);
      fsUtils.readConfig.mockReturnValue({ id: {}, partner_id: {}, handle: "handle_1" });
      SF.findReconciliationTextByHandle.mockResolvedValue({ id: 808080, handle: "handle_1" });
      fsUtils.writeConfig.mockReturnValue(undefined);

      await toolkit.getAllTemplatesId("firm", "100", "reconciliationText");

      expect(fsUtils.getAllTemplatesOfAType).toHaveBeenCalledWith("reconciliationText");
      expect(SF.findReconciliationTextByHandle).toHaveBeenCalled();
    });
  });

  // ─── fetchExistingExportFiles ─────────────────────────────────────────────

  describe("fetchExistingExportFiles", () => {
    const mockType = "firm";
    const mockEnvId = "100";

    it("should warn when no local templates exist", async () => {
      fsUtils.getAllTemplatesOfAType.mockReturnValue(null);

      await toolkit.fetchExistingExportFiles(mockType, mockEnvId);

      expect(consola.warn).toHaveBeenCalled();
    });

    it("should call fetchExportFileById for each template with an id", async () => {
      fsUtils.getAllTemplatesOfAType.mockReturnValue(["export_1"]);
      fsUtils.readConfig.mockReturnValue({ id: { 100: 2201 }, partner_id: {} });
      fsUtils.getTemplateId.mockReturnValue(2201);
      SF.readExportFileById.mockResolvedValue({ id: 2201, name_nl: "export_1", text: "liquid" });
      ExportFile.save.mockReturnValue(true);

      await toolkit.fetchExistingExportFiles(mockType, mockEnvId);

      expect(SF.readExportFileById).toHaveBeenCalled();
    });
  });

  // ─── publishAllExportFiles ────────────────────────────────────────────────

  describe("publishAllExportFiles", () => {
    it("should call publishExportFileByName for each template", async () => {
      fsUtils.getAllTemplatesOfAType.mockReturnValue(["export_1", "export_2"]);
      fsUtils.configExists.mockReturnValue(true);
      fsUtils.readConfig.mockReturnValue({ id: { 100: 2201 }, partner_id: {} });
      fsUtils.getTemplateId.mockReturnValue(2201);
      ExportFile.read.mockResolvedValue({ name_nl: "export_1", text: "liquid" });
      SF.updateExportFile.mockResolvedValue({ data: { name_nl: "export_1" } });

      await toolkit.publishAllExportFiles("firm", "100");

      expect(fsUtils.getAllTemplatesOfAType).toHaveBeenCalledWith("exportFile");
    });
  });

  // ─── newAllExportFiles ────────────────────────────────────────────────────

  describe("newAllExportFiles", () => {
    it("should call newExportFile for each local template", async () => {
      fsUtils.getAllTemplatesOfAType.mockReturnValue(["export_1"]);
      SF.findExportFileByName.mockResolvedValue(null);
      ExportFile.read.mockResolvedValue({ name_nl: "export_1", text: "liquid" });
      SF.createExportFile.mockResolvedValue({ status: 201, data: { id: 999, name_nl: "export_1" } });

      await toolkit.newAllExportFiles("firm", "100");

      expect(fsUtils.getAllTemplatesOfAType).toHaveBeenCalledWith("exportFile");
    });
  });

  // ─── fetchExistingAccountTemplates ───────────────────────────────────────

  describe("fetchExistingAccountTemplates", () => {
    const mockType = "firm";
    const mockEnvId = "100";

    it("should warn when no local templates exist", async () => {
      fsUtils.getAllTemplatesOfAType.mockReturnValue(null);

      await toolkit.fetchExistingAccountTemplates(mockType, mockEnvId);

      expect(consola.warn).toHaveBeenCalled();
    });

    it("should call fetchAccountTemplateById for each template with an id", async () => {
      fsUtils.getAllTemplatesOfAType.mockReturnValue(["account_1"]);
      fsUtils.readConfig.mockReturnValue({ id: { 100: 1101 }, partner_id: {} });
      fsUtils.getTemplateId.mockReturnValue(1101);
      SF.readAccountTemplateById.mockResolvedValue({ id: 1101, name_nl: "account_1", text: "liquid" });
      AccountTemplate.save.mockReturnValue(true);

      await toolkit.fetchExistingAccountTemplates(mockType, mockEnvId);

      expect(SF.readAccountTemplateById).toHaveBeenCalled();
    });
  });

  // ─── publishAllAccountTemplates ───────────────────────────────────────────

  describe("publishAllAccountTemplates", () => {
    it("should call publishAccountTemplateByName for each template", async () => {
      fsUtils.getAllTemplatesOfAType.mockReturnValue(["account_1"]);
      fsUtils.configExists.mockReturnValue(true);
      fsUtils.readConfig.mockReturnValue({ id: { 100: 1101 }, partner_id: {} });
      fsUtils.getTemplateId.mockReturnValue(1101);
      AccountTemplate.read.mockResolvedValue({ name_nl: "account_1", text: "liquid", mapping_list_ranges: [] });
      SF.updateAccountTemplate.mockResolvedValue({ data: { name_nl: "account_1" } });

      await toolkit.publishAllAccountTemplates("firm", "100");

      expect(fsUtils.getAllTemplatesOfAType).toHaveBeenCalledWith("accountTemplate");
    });
  });

  // ─── newAllAccountTemplates ───────────────────────────────────────────────

  describe("newAllAccountTemplates", () => {
    it("should call newAccountTemplate for each local template", async () => {
      fsUtils.getAllTemplatesOfAType.mockReturnValue(["account_1"]);
      SF.findAccountTemplateByName.mockResolvedValue(null);
      AccountTemplate.read.mockResolvedValue({ name_nl: "account_1", text: "liquid", mapping_list_ranges: [] });
      SF.createAccountTemplate.mockResolvedValue({ status: 201, data: { id: 999, name_nl: "account_1" } });

      await toolkit.newAllAccountTemplates("firm", "100");

      expect(fsUtils.getAllTemplatesOfAType).toHaveBeenCalledWith("accountTemplate");
    });
  });

  // ─── fetchExistingSharedParts ─────────────────────────────────────────────

  describe("fetchExistingSharedParts", () => {
    const mockType = "firm";
    const mockEnvId = "100";

    it("should call fetchSharedPartById for each template with an id", async () => {
      fsUtils.getAllTemplatesOfAType.mockReturnValue(["shared_part_1"]);
      fsUtils.configExists.mockReturnValue(true);
      fsUtils.readConfig.mockReturnValue({ id: { 100: 5601 }, partner_id: {} });
      fsUtils.getTemplateId.mockReturnValue(5601);
      SF.readSharedPartById.mockResolvedValue({ data: { id: 5601, name: "shared_part_1", text: "liquid", used_in: [] } });
      SharedPart.save.mockResolvedValue(true);

      await toolkit.fetchExistingSharedParts(mockType, mockEnvId);

      expect(SF.readSharedPartById).toHaveBeenCalled();
    });

    it("should return early when no local templates exist", async () => {
      fsUtils.getAllTemplatesOfAType.mockReturnValue(null);

      await toolkit.fetchExistingSharedParts(mockType, mockEnvId);

      expect(SF.readSharedPartById).not.toHaveBeenCalled();
    });
  });

  // ─── publishAllSharedParts ────────────────────────────────────────────────

  describe("publishAllSharedParts", () => {
    it("should call publishSharedPartByName for each template", async () => {
      fsUtils.getAllTemplatesOfAType.mockReturnValue(["shared_part_1"]);
      fsUtils.configExists.mockReturnValue(true);
      fsUtils.readConfig.mockReturnValue({ id: { 100: 5601 }, partner_id: {} });
      fsUtils.getTemplateId.mockReturnValue(5601);
      SharedPart.read.mockResolvedValue({ name: "shared_part_1", text: "liquid" });
      SF.updateSharedPart.mockResolvedValue({ data: { name: "shared_part_1" } });

      await toolkit.publishAllSharedParts("firm", "100");

      expect(fsUtils.getAllTemplatesOfAType).toHaveBeenCalledWith("sharedPart");
    });
  });

  // ─── newAllSharedParts ────────────────────────────────────────────────────

  describe("newAllSharedParts", () => {
    it("should call newSharedPart for each local template", async () => {
      fsUtils.getAllTemplatesOfAType.mockReturnValue(["shared_part_1"]);
      SF.findSharedPartByName.mockResolvedValue(null);
      SharedPart.read.mockResolvedValue({ name: "shared_part_1", text: "liquid" });
      SF.createSharedPart.mockResolvedValue({ status: 201, data: { id: 999, name: "shared_part_1" } });

      await toolkit.newAllSharedParts("firm", "100");

      expect(fsUtils.getAllTemplatesOfAType).toHaveBeenCalledWith("sharedPart");
    });
  });

  // ─── addSharedPart ────────────────────────────────────────────────────────

  describe("addSharedPart", () => {
    const mockType = "firm";
    const mockEnvId = "100";
    const mockSharedPartName = "shared_part_1";
    const mockTemplateHandle = "test_reconciliation";
    const mockTemplateType = "reconciliationText";

    const mockTemplateConfig = { id: { 100: 8801 }, partner_id: {} };
    const mockSharedPartConfig = { id: { 100: 5601 }, partner_id: {}, name: mockSharedPartName, used_in: [] };

    it("should add shared part to a reconciliationText and return updated config", async () => {
      fsUtils.readConfig
        .mockResolvedValueOnce(mockTemplateConfig)
        .mockResolvedValueOnce(mockSharedPartConfig);
      fsUtils.getTemplateId.mockReturnValue(8801);
      SF.addSharedPartToReconciliation.mockResolvedValue({ status: 201 });
      fsUtils.writeConfig.mockReturnValue(undefined);

      const result = await toolkit.addSharedPart(mockType, mockEnvId, mockSharedPartName, mockTemplateHandle, mockTemplateType);

      expect(SF.addSharedPartToReconciliation).toHaveBeenCalledWith(mockType, mockEnvId, 5601, 8801);
      expect(fsUtils.writeConfig).toHaveBeenCalledTimes(2);
      expect(consola.success).toHaveBeenCalled();
      expect(result).toBeTruthy();
    });

    it("should add shared part to an exportFile", async () => {
      const exportTemplateConfig = { id: { 100: 2201 }, partner_id: {} };
      fsUtils.readConfig
        .mockResolvedValueOnce(exportTemplateConfig)
        .mockResolvedValueOnce(mockSharedPartConfig);
      fsUtils.getTemplateId.mockReturnValue(2201);
      SF.addSharedPartToExportFile.mockResolvedValue({ status: 201 });
      fsUtils.writeConfig.mockReturnValue(undefined);

      const result = await toolkit.addSharedPart(mockType, mockEnvId, mockSharedPartName, mockTemplateHandle, "exportFile");

      expect(SF.addSharedPartToExportFile).toHaveBeenCalledWith(mockType, mockEnvId, 5601, 2201);
      expect(result).toBeTruthy();
    });

    it("should add shared part to an accountTemplate", async () => {
      const accountTemplateConfig = { id: { 100: 1101 }, partner_id: {} };
      fsUtils.readConfig
        .mockResolvedValueOnce(accountTemplateConfig)
        .mockResolvedValueOnce(mockSharedPartConfig);
      fsUtils.getTemplateId.mockReturnValue(1101);
      SF.addSharedPartToAccountTemplate.mockResolvedValue({ status: 201 });
      fsUtils.writeConfig.mockReturnValue(undefined);

      const result = await toolkit.addSharedPart(mockType, mockEnvId, mockSharedPartName, mockTemplateHandle, "accountTemplate");

      expect(SF.addSharedPartToAccountTemplate).toHaveBeenCalledWith(mockType, mockEnvId, 5601, 1101);
      expect(result).toBeTruthy();
    });

    it("should return false when template config has no id and getTemplateId lookup fails", async () => {
      const configWithNoId = { id: {}, partner_id: {} };
      const spConfig = { id: { 100: 5601 }, partner_id: {}, name: mockSharedPartName, used_in: [] };
      fsUtils.readConfig.mockResolvedValueOnce(configWithNoId).mockResolvedValueOnce(spConfig);
      fsUtils.getTemplateId.mockReturnValue(undefined);
      SF.findReconciliationTextByHandle.mockResolvedValue(null);

      const result = await toolkit.addSharedPart(mockType, mockEnvId, mockSharedPartName, mockTemplateHandle, mockTemplateType);

      expect(result).toBe(false);
    });

    it("should return false when shared part config has no id and lookup fails", async () => {
      const spConfigNoId = { id: {}, partner_id: {}, name: mockSharedPartName, used_in: [] };
      fsUtils.readConfig.mockResolvedValueOnce(mockTemplateConfig).mockResolvedValueOnce(spConfigNoId);
      // First getTemplateId returns 8801 (for template), second shared part id is undefined
      fsUtils.getTemplateId.mockReturnValue(8801);
      SF.findSharedPartByName.mockResolvedValue(null);

      const result = await toolkit.addSharedPart(mockType, mockEnvId, mockSharedPartName, mockTemplateHandle, mockTemplateType);

      expect(result).toBe(false);
    });

    it("should warn and return false when API response indicates failure", async () => {
      fsUtils.readConfig
        .mockResolvedValueOnce(mockTemplateConfig)
        .mockResolvedValueOnce(mockSharedPartConfig);
      fsUtils.getTemplateId.mockReturnValue(8801);
      SF.addSharedPartToReconciliation.mockResolvedValue(null);

      const result = await toolkit.addSharedPart(mockType, mockEnvId, mockSharedPartName, mockTemplateHandle, mockTemplateType);

      expect(consola.warn).toHaveBeenCalledWith(expect.stringContaining("failed"));
      expect(result).toBe(false);
    });

    it("should handle exceptions gracefully", async () => {
      const mockError = new Error("Test error");
      fsUtils.readConfig.mockRejectedValue(mockError);

      const result = await toolkit.addSharedPart(mockType, mockEnvId, mockSharedPartName, mockTemplateHandle, mockTemplateType);

      expect(errorUtils.errorHandler).toHaveBeenCalledWith(mockError);
      expect(result).toBe(false);
    });
  });

  // ─── removeSharedPart ─────────────────────────────────────────────────────

  describe("removeSharedPart", () => {
    const mockType = "firm";
    const mockEnvId = "100";
    const mockSharedPartHandle = "shared_part_1";
    const mockTemplateHandle = "test_reconciliation";
    const mockTemplateType = "reconciliationText";

    const mockTemplateConfig = { id: { 100: 8801 }, partner_id: {} };
    const mockSharedPartConfig = {
      id: { 100: 5601 },
      partner_id: {},
      name: mockSharedPartHandle,
      used_in: [{ id: { 100: 8801 }, partner_id: {}, type: mockTemplateType, handle: mockTemplateHandle }],
    };

    it("should remove shared part from reconciliationText", async () => {
      fsUtils.readConfig
        .mockReturnValueOnce(mockTemplateConfig)
        .mockReturnValueOnce(mockSharedPartConfig);
      fsUtils.getTemplateId.mockReturnValue(8801);
      SF.removeSharedPartFromReconciliation.mockResolvedValue({ status: 200 });
      fsUtils.writeConfig.mockReturnValue(undefined);

      await toolkit.removeSharedPart(mockType, mockEnvId, mockSharedPartHandle, mockTemplateHandle, mockTemplateType);

      expect(SF.removeSharedPartFromReconciliation).toHaveBeenCalledWith(mockType, mockEnvId, 5601, 8801);
      expect(consola.debug).toHaveBeenCalled();
    });

    it("should return false when template id not found in config", async () => {
      const configNoId = { id: {}, partner_id: {} };
      fsUtils.readConfig
        .mockReturnValueOnce(configNoId)
        .mockReturnValueOnce(mockSharedPartConfig);
      fsUtils.getTemplateId.mockReturnValue(undefined);

      const result = await toolkit.removeSharedPart(mockType, mockEnvId, mockSharedPartHandle, mockTemplateHandle, mockTemplateType);

      expect(consola.warn).toHaveBeenCalled();
      expect(result).toBe(false);
    });

    it("should return false when shared part id not found in config", async () => {
      const spConfigNoId = { id: {}, partner_id: {}, name: mockSharedPartHandle, used_in: [] };
      fsUtils.readConfig
        .mockReturnValueOnce(mockTemplateConfig)
        .mockReturnValueOnce(spConfigNoId);
      fsUtils.getTemplateId.mockReturnValue(8801);

      const result = await toolkit.removeSharedPart(mockType, mockEnvId, mockSharedPartHandle, mockTemplateHandle, mockTemplateType);

      expect(consola.warn).toHaveBeenCalled();
      expect(result).toBe(false);
    });

    it("should handle exceptions gracefully", async () => {
      const mockError = new Error("Test error");
      fsUtils.readConfig.mockImplementation(() => {
        throw mockError;
      });

      await toolkit.removeSharedPart(mockType, mockEnvId, mockSharedPartHandle, mockTemplateHandle, mockTemplateType);

      expect(errorUtils.errorHandler).toHaveBeenCalledWith(mockError);
    });
  });

  // ─── addAllSharedParts ────────────────────────────────────────────────────

  describe("addAllSharedParts", () => {
    const mockType = "firm";
    const mockEnvId = "100";

    it("should skip shared part with no used_in array", async () => {
      fsUtils.getAllTemplatesOfAType.mockReturnValue(["shared_part_1"]);
      fsUtils.readConfig.mockResolvedValue({ id: { 100: 5601 }, partner_id: {}, name: "shared_part_1" });

      await toolkit.addAllSharedParts(mockType, mockEnvId);

      expect(consola.warn).toHaveBeenCalledWith(expect.stringContaining("has no used_in"));
    });

    it("should skip shared part with no id for this env", async () => {
      fsUtils.getAllTemplatesOfAType.mockReturnValue(["shared_part_1"]);
      fsUtils.readConfig.mockResolvedValue({ id: {}, partner_id: {}, name: "shared_part_1", used_in: [] });

      await toolkit.addAllSharedParts(mockType, mockEnvId);

      expect(consola.warn).toHaveBeenCalledWith(expect.stringContaining("has no id associated"));
    });

    it("should skip template not found locally", async () => {
      const spConfig = {
        id: { 100: 5601 },
        partner_id: {},
        name: "shared_part_1",
        used_in: [{ id: { 100: 8801 }, partner_id: {}, type: "reconciliationText", handle: "test_recon" }],
      };
      fsUtils.getAllTemplatesOfAType.mockReturnValue(["shared_part_1"]);
      fsUtils.readConfig.mockResolvedValue(spConfig);
      SF.readSharedPartById.mockResolvedValue({ data: { used_in: [] } });
      fsUtils.configExists.mockReturnValue(false);

      // Mock SharedPart.checkTemplateType to return the template unchanged
      const { SharedPart: MockedSharedPart } = require("../../lib/templates/sharedPart");
      MockedSharedPart.checkTemplateType = jest.fn((t) => t);

      await toolkit.addAllSharedParts(mockType, mockEnvId);

      expect(consola.warn).toHaveBeenCalledWith(expect.stringContaining("not found in local repository"));
    });

    it("should skip already-linked template when force=false", async () => {
      const spConfig = {
        id: { 100: 5601 },
        partner_id: {},
        name: "shared_part_1",
        used_in: [{ id: { 100: 8801 }, partner_id: {}, type: "reconciliationText", handle: "test_recon" }],
      };
      fsUtils.getAllTemplatesOfAType.mockReturnValue(["shared_part_1"]);
      fsUtils.readConfig.mockResolvedValue(spConfig);
      // Already linked: same id and type
      SF.readSharedPartById.mockResolvedValue({ data: { used_in: [{ id: 8801, type: "reconciliationText" }] } });
      fsUtils.configExists.mockReturnValue(true);

      const { SharedPart: MockedSharedPart } = require("../../lib/templates/sharedPart");
      MockedSharedPart.checkTemplateType = jest.fn((t) => t);

      await toolkit.addAllSharedParts(mockType, mockEnvId, false);

      expect(consola.info).toHaveBeenCalledWith(expect.stringContaining("already has this shared part"));
    });

    it("should call addSharedPart when force=true even if already linked", async () => {
      const spConfig = {
        id: { 100: 5601 },
        partner_id: {},
        name: "shared_part_1",
        used_in: [{ id: { 100: 8801 }, partner_id: {}, type: "reconciliationText", handle: "test_recon" }],
      };
      fsUtils.getAllTemplatesOfAType.mockReturnValue(["shared_part_1"]);
      // For the outer loop readConfig call
      fsUtils.readConfig
        .mockResolvedValueOnce(spConfig)
        // For addSharedPart internal calls
        .mockResolvedValue({ id: { 100: 8801 }, partner_id: {} });
      fsUtils.getTemplateId.mockReturnValue(8801);
      SF.readSharedPartById.mockResolvedValue({ data: { used_in: [{ id: 8801, type: "reconciliationText" }] } });
      fsUtils.configExists.mockReturnValue(true);
      SF.addSharedPartToReconciliation.mockResolvedValue({ status: 201 });
      fsUtils.writeConfig.mockReturnValue(undefined);

      const { SharedPart: MockedSharedPart } = require("../../lib/templates/sharedPart");
      MockedSharedPart.checkTemplateType = jest.fn((t) => t);

      await toolkit.addAllSharedParts(mockType, mockEnvId, true);

      expect(SF.addSharedPartToReconciliation).toHaveBeenCalled();
    });
  });

  // ─── updateFirmName ───────────────────────────────────────────────────────

  describe("updateFirmName", () => {
    it("should store firm name and return true when firm found", async () => {
      const mockFirmDetails = { name: "Test Firm" };
      SF.getFirmDetails.mockResolvedValue(mockFirmDetails);

      await toolkit.updateFirmName(100);

      expect(SF.getFirmDetails).toHaveBeenCalledWith(100);
      expect(consola.info).toHaveBeenCalled();
    });

    it("should warn and return false when firm not found", async () => {
      SF.getFirmDetails.mockResolvedValue(null);

      const result = await toolkit.updateFirmName(100);

      expect(consola.warn).toHaveBeenCalledWith(`Firm 100 not found.`);
      expect(result).toBe(false);
    });
  });
});
