const axios = require("axios");
const AxiosMockAdapter = require("axios-mock-adapter");

// Mock apiUtils to prevent env var check at module load time
jest.mock("../../../lib/utils/apiUtils", () => ({
  checkRequiredEnvVariables: jest.fn(),
  responseSuccessHandler: jest.fn(),
  responseErrorHandler: jest.fn().mockResolvedValue(undefined),
}));

jest.mock("../../../lib/api/silverfinAuthorizer", () => ({
  SilverfinAuthorizer: {
    authorizeFirm: jest.fn(),
    refreshFirm: jest.fn(),
    refreshPartner: jest.fn(),
  },
}));

jest.mock("../../../lib/api/axiosFactory", () => ({
  AxiosFactory: {
    createInstance: jest.fn(),
  },
}));

jest.mock("consola");

// Load API response fixtures
const reconciliationSingle = require("../../../fixtures/api-responses/reconciliation-texts/single.json");
const reconciliationList = require("../../../fixtures/api-responses/reconciliation-texts/list.json");
const accountTemplateSingle = require("../../../fixtures/api-responses/account-templates/single.json");
const accountTemplateList = require("../../../fixtures/api-responses/account-templates/list.json");
const exportFileSingle = require("../../../fixtures/api-responses/export-files/single.json");
const exportFileList = require("../../../fixtures/api-responses/export-files/list.json");
const sharedPartSingle = require("../../../fixtures/api-responses/shared-parts/single.json");
const sharedPartList = require("../../../fixtures/api-responses/shared-parts/list.json");

const SF = require("../../../lib/api/sfApi");
const { AxiosFactory } = require("../../../lib/api/axiosFactory");

describe("sfApi", () => {
  let axiosMock;
  let axiosInstance;

  beforeAll(() => {
    // Create a real axios instance to be returned by AxiosFactory.createInstance
    axiosInstance = axios.create({ baseURL: "https://test.getsilverfin.com/api/v4/f/100" });
    axiosMock = new AxiosMockAdapter(axiosInstance);
    AxiosFactory.createInstance.mockReturnValue(axiosInstance);
  });

  beforeEach(() => {
    jest.clearAllMocks();
    axiosMock.reset();
    // Ensure AxiosFactory still returns our instance after clearAllMocks
    AxiosFactory.createInstance.mockReturnValue(axiosInstance);
  });

  afterAll(() => {
    axiosMock.restore();
  });

  // ─── Authorization delegates ──────────────────────────────────────────────

  describe("authorizeFirm", () => {
    it("should delegate to SilverfinAuthorizer.authorizeFirm", async () => {
      const { SilverfinAuthorizer } = require("../../../lib/api/silverfinAuthorizer");
      await SF.authorizeFirm(100);
      expect(SilverfinAuthorizer.authorizeFirm).toHaveBeenCalledWith(100);
    });
  });

  describe("refreshFirmTokens", () => {
    it("should delegate to SilverfinAuthorizer.refreshFirm", async () => {
      const { SilverfinAuthorizer } = require("../../../lib/api/silverfinAuthorizer");
      SilverfinAuthorizer.refreshFirm.mockResolvedValue({ success: true });
      const result = await SF.refreshFirmTokens(100);
      expect(SilverfinAuthorizer.refreshFirm).toHaveBeenCalledWith(100);
      expect(result).toEqual({ success: true });
    });
  });

  describe("refreshPartnerToken", () => {
    it("should delegate to SilverfinAuthorizer.refreshPartner", async () => {
      const { SilverfinAuthorizer } = require("../../../lib/api/silverfinAuthorizer");
      SilverfinAuthorizer.refreshPartner.mockResolvedValue({ success: true });
      const result = await SF.refreshPartnerToken(42);
      expect(SilverfinAuthorizer.refreshPartner).toHaveBeenCalledWith(42);
      expect(result).toEqual({ success: true });
    });
  });

  // ─── Reconciliation Texts ─────────────────────────────────────────────────

  describe("createReconciliationText", () => {
    it("should POST to reconciliations and return response on success (201)", async () => {
      axiosMock.onPost("reconciliations").reply(201, reconciliationSingle);

      const result = await SF.createReconciliationText("firm", 100, { handle: "test" });

      expect(result.data).toEqual(reconciliationSingle);
      expect(result.status).toBe(201);
    });

    it("should call responseErrorHandler on error", async () => {
      axiosMock.onPost("reconciliations").reply(422, { errors: ["Validation failed"] });
      const apiUtils = require("../../../lib/utils/apiUtils");

      await SF.createReconciliationText("firm", 100, { handle: "test" });

      expect(apiUtils.responseErrorHandler).toHaveBeenCalled();
    });
  });

  describe("readReconciliationTexts", () => {
    it("should GET reconciliations list and return data", async () => {
      axiosMock.onGet("reconciliations").reply(200, reconciliationList);

      const result = await SF.readReconciliationTexts("firm", 100, 1);

      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBeGreaterThan(0);
    });

    it("should return empty array when list is empty", async () => {
      axiosMock.onGet("reconciliations").reply(200, []);

      const result = await SF.readReconciliationTexts("firm", 100, 1);

      expect(result).toEqual([]);
    });
  });

  describe("readReconciliationTextById", () => {
    it("should GET reconciliation by id and return response", async () => {
      axiosMock.onGet(`reconciliations/${reconciliationSingle.id}`).reply(200, reconciliationSingle);

      const result = await SF.readReconciliationTextById("firm", 100, reconciliationSingle.id);

      expect(result.data).toEqual(reconciliationSingle);
    });

    it("should call responseErrorHandler on 404", async () => {
      axiosMock.onGet(`reconciliations/99999`).reply(404, { error: "Not found" });
      const apiUtils = require("../../../lib/utils/apiUtils");

      await SF.readReconciliationTextById("firm", 100, 99999);

      expect(apiUtils.responseErrorHandler).toHaveBeenCalled();
    });
  });

  describe("findReconciliationTextByHandle", () => {
    it("should find reconciliation by handle on page 1", async () => {
      const targetHandle = reconciliationSingle.handle;
      const listWithTarget = [{ ...reconciliationSingle, text: "liquid code" }];
      axiosMock.onGet("reconciliations").reply(200, listWithTarget);

      const result = await SF.findReconciliationTextByHandle("firm", 100, targetHandle);

      expect(result.handle).toBe(targetHandle);
    });

    it("should return null when list is empty (not found)", async () => {
      axiosMock.onGet("reconciliations").reply(200, []);

      const result = await SF.findReconciliationTextByHandle("firm", 100, "nonexistent_handle");

      expect(result).toBeNull();
    });

    it("should skip partner templates (marketplace_template_id is not null)", async () => {
      const partnerTemplate = {
        ...reconciliationSingle,
        handle: reconciliationSingle.handle,
        marketplace_template_id: 999,
        text: "liquid code",
      };
      // Page 1: partner template only; page 2: empty
      let callCount = 0;
      axiosMock.onGet("reconciliations").reply(() => {
        callCount++;
        if (callCount === 1) return [200, [partnerTemplate]];
        return [200, []];
      });

      const result = await SF.findReconciliationTextByHandle("firm", 100, reconciliationSingle.handle);

      expect(result).toBeNull();
    });
  });

  describe("updateReconciliationText", () => {
    it("should POST to update reconciliation and return response", async () => {
      axiosMock.onPost(`reconciliations/${reconciliationSingle.id}`).reply(200, reconciliationSingle);

      const result = await SF.updateReconciliationText("firm", 100, reconciliationSingle.id, { text: "new liquid" });

      expect(result.data).toEqual(reconciliationSingle);
    });

    it("should call responseErrorHandler on 422 error", async () => {
      axiosMock.onPost(`reconciliations/${reconciliationSingle.id}`).reply(422, { errors: ["Validation failed"] });
      const apiUtils = require("../../../lib/utils/apiUtils");

      await SF.updateReconciliationText("firm", 100, reconciliationSingle.id, {});

      expect(apiUtils.responseErrorHandler).toHaveBeenCalled();
    });
  });

  // ─── Shared Parts ─────────────────────────────────────────────────────────

  describe("readSharedParts", () => {
    it("should GET shared_parts list and return response", async () => {
      axiosMock.onGet("shared_parts").reply(200, sharedPartList);

      const result = await SF.readSharedParts("firm", 100, 1);

      expect(result.data).toEqual(sharedPartList);
    });
  });

  describe("readSharedPartById", () => {
    it("should GET shared part by id and return response", async () => {
      axiosMock.onGet(`shared_parts/${sharedPartSingle.id}`).reply(200, sharedPartSingle);

      const result = await SF.readSharedPartById("firm", 100, sharedPartSingle.id);

      expect(result.data).toEqual(sharedPartSingle);
    });
  });

  describe("findSharedPartByName", () => {
    it("should find shared part by name", async () => {
      const listData = [sharedPartSingle];
      axiosMock.onGet("shared_parts").reply(200, listData);

      const result = await SF.findSharedPartByName("firm", 100, sharedPartSingle.name);

      expect(result.name).toBe(sharedPartSingle.name);
    });

    it("should return null when list is empty", async () => {
      axiosMock.onGet("shared_parts").reply(200, []);

      const result = await SF.findSharedPartByName("firm", 100, "nonexistent");

      expect(result).toBeNull();
    });
  });

  describe("createSharedPart", () => {
    it("should POST to shared_parts and return response", async () => {
      axiosMock.onPost("shared_parts").reply(201, sharedPartSingle);

      const result = await SF.createSharedPart("firm", 100, { name: "test" });

      expect(result.data).toEqual(sharedPartSingle);
    });
  });

  describe("updateSharedPart", () => {
    it("should POST to update shared part and return response", async () => {
      axiosMock.onPost(`shared_parts/${sharedPartSingle.id}`).reply(200, sharedPartSingle);

      const result = await SF.updateSharedPart("firm", 100, sharedPartSingle.id, { text: "updated" });

      expect(result.data).toEqual(sharedPartSingle);
    });
  });

  // ─── Export Files ─────────────────────────────────────────────────────────

  describe("createExportFile", () => {
    it("should POST to export_files and return response", async () => {
      axiosMock.onPost("export_files").reply(201, exportFileSingle);

      const result = await SF.createExportFile("firm", 100, { name_nl: "test" });

      expect(result.data).toEqual(exportFileSingle);
    });
  });

  describe("readExportFiles", () => {
    it("should GET export_files list and return data", async () => {
      axiosMock.onGet("export_files").reply(200, exportFileList);

      const result = await SF.readExportFiles("firm", 100, 1);

      expect(Array.isArray(result)).toBe(true);
    });
  });

  describe("readExportFileById", () => {
    it("should GET export file by id and return data", async () => {
      axiosMock.onGet(`export_files/${exportFileSingle.id}`).reply(200, exportFileSingle);

      const result = await SF.readExportFileById("firm", 100, exportFileSingle.id);

      expect(result).toEqual(exportFileSingle);
    });
  });

  describe("updateExportFile", () => {
    it("should POST to update export file and return response", async () => {
      axiosMock.onPost(`export_files/${exportFileSingle.id}`).reply(200, exportFileSingle);

      const result = await SF.updateExportFile("firm", 100, exportFileSingle.id, { text: "updated" });

      expect(result.data).toEqual(exportFileSingle);
    });
  });

  describe("findExportFileByName", () => {
    it("should find export file by name_nl", async () => {
      const listData = [exportFileSingle];
      axiosMock.onGet("export_files").reply(200, listData);
      axiosMock.onGet(`export_files/${exportFileSingle.id}`).reply(200, exportFileSingle);

      const result = await SF.findExportFileByName("firm", 100, exportFileSingle.name_nl);

      expect(result).toEqual(exportFileSingle);
    });

    it("should return null when list is empty", async () => {
      axiosMock.onGet("export_files").reply(200, []);

      const result = await SF.findExportFileByName("firm", 100, "nonexistent");

      expect(result).toBeNull();
    });
  });

  // ─── Account Templates ────────────────────────────────────────────────────

  describe("createAccountTemplate", () => {
    it("should POST to account_templates and return response", async () => {
      axiosMock.onPost("account_templates").reply(201, accountTemplateSingle);

      const result = await SF.createAccountTemplate("firm", 100, { name_nl: "test" });

      expect(result.data).toEqual(accountTemplateSingle);
    });
  });

  describe("readAccountTemplates", () => {
    it("should GET account_templates list and return data", async () => {
      axiosMock.onGet("account_templates").reply(200, accountTemplateList);

      const result = await SF.readAccountTemplates("firm", 100, 1);

      expect(Array.isArray(result)).toBe(true);
    });
  });

  describe("readAccountTemplateById", () => {
    it("should GET account template by id and return data", async () => {
      axiosMock.onGet(`account_templates/${accountTemplateSingle.id}`).reply(200, accountTemplateSingle);

      const result = await SF.readAccountTemplateById("firm", 100, accountTemplateSingle.id);

      expect(result).toEqual(accountTemplateSingle);
    });
  });

  describe("updateAccountTemplate", () => {
    it("should POST to update account template and return response", async () => {
      axiosMock.onPost(`account_templates/${accountTemplateSingle.id}`).reply(200, accountTemplateSingle);

      const result = await SF.updateAccountTemplate("firm", 100, accountTemplateSingle.id, { text: "updated" });

      expect(result.data).toEqual(accountTemplateSingle);
    });
  });

  describe("findAccountTemplateByName", () => {
    it("should find account template by name_nl", async () => {
      const listData = [accountTemplateSingle];
      axiosMock.onGet("account_templates").reply(200, listData);
      axiosMock.onGet(`account_templates/${accountTemplateSingle.id}`).reply(200, accountTemplateSingle);

      const result = await SF.findAccountTemplateByName("firm", 100, accountTemplateSingle.name_nl);

      expect(result).toEqual(accountTemplateSingle);
    });

    it("should return null when list is empty", async () => {
      axiosMock.onGet("account_templates").reply(200, []);

      const result = await SF.findAccountTemplateByName("firm", 100, "nonexistent");

      expect(result).toBeNull();
    });
  });
});
