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

      expect(require("consola").error).toHaveBeenCalledWith(`No template found with reconciliation ID: ${mockReconciliationId} in ${mockType} ${mockEnvId}`);
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

    it("should return false when template reading fails", async () => {
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

      expect(require("consola").error).toHaveBeenCalledWith(`Reconciliation update failed for ID: ${mockReconciliationId} in ${mockType} ${mockEnvId}`);
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

    it("should return false when template reading fails", async () => {
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

    it("should return false when template reading fails", async () => {
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

    it("should return false when template reading fails", async () => {
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
});
