const { SilverfinApi } = require("../../../lib/api/silverfinApi");
const { AxiosFactory } = require("../../../lib/api/axiosFactory");
const { SilverfinAuthorizer } = require("../../../lib/api/silverfinAuthorizer");
const MockAdapter = require("axios-mock-adapter");
const axios = require("axios");

jest.mock("../../../lib/api/axiosFactory");
jest.mock("../../../lib/api/silverfinAuthorizer");

// Mock environment variables to avoid exit
process.env.SF_API_CLIENT_ID = 'test-client-id';
process.env.SF_API_SECRET = 'test-secret';

describe("SilverfinApi", () => {
  let silverfinApi;
  let mockAxiosInstance;
  let mockAdapter;

  beforeEach(() => {
    silverfinApi = new SilverfinApi();
    mockAxiosInstance = axios.create();
    mockAdapter = new MockAdapter(mockAxiosInstance);

    AxiosFactory.createInstance.mockReturnValue(mockAxiosInstance);
    
    // Spy on console methods used by private methods
    jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'debug').mockImplementation(() => {});
  });

  afterEach(() => {
    mockAdapter.reset();
    jest.clearAllMocks();
  });

  // Note: makeRequest is now a private method, so we test it indirectly through public methods

  describe("Authentication methods", () => {
    it("should call authorizeFirm", async () => {
      await silverfinApi.authorizeFirm(123);
      expect(SilverfinAuthorizer.authorizeFirm).toHaveBeenCalledWith(123);
    });

    it("should call refreshFirmTokens", async () => {
      SilverfinAuthorizer.refreshFirm.mockResolvedValue({ success: true });
      const result = await silverfinApi.refreshFirmTokens(123);
      expect(SilverfinAuthorizer.refreshFirm).toHaveBeenCalledWith(123);
      expect(result).toEqual({ success: true });
    });

    it("should call refreshPartnerToken", async () => {
      SilverfinAuthorizer.refreshPartner.mockResolvedValue({ success: true });
      const result = await silverfinApi.refreshPartnerToken(456);
      expect(SilverfinAuthorizer.refreshPartner).toHaveBeenCalledWith(456);
      expect(result).toEqual({ success: true });
    });
  });

  describe("Reconciliation methods", () => {
    it("should create reconciliation text", async () => {
      const attributes = { name: "test", text: "liquid code" };
      const responseData = { id: 1, ...attributes };
      mockAdapter.onPost("reconciliations", attributes).reply(200, responseData);

      const result = await silverfinApi.createReconciliationText("firm", 123, attributes);

      expect(result).toEqual(responseData);
    });

    it("should read reconciliation texts with pagination", async () => {
      const responseData = [
        { id: 1, name: "test1" },
        { id: 2, name: "test2" },
      ];
      mockAdapter.onGet("reconciliations").reply(200, responseData);

      const result = await silverfinApi.readReconciliationTexts("firm", 123, 2);

      expect(result).toEqual(responseData);
      expect(mockAdapter.history.get[0].params).toEqual({ page: 2, per_page: 200 });
    });

    it("should read reconciliation text by id", async () => {
      const responseData = { id: 1, name: "test" };
      mockAdapter.onGet("reconciliations/1").reply(200, responseData);

      const result = await silverfinApi.readReconciliationTextById("firm", 123, 1);

      expect(result).toEqual(responseData);
    });

    it("should update reconciliation text", async () => {
      const attributes = { text: "updated liquid code" };
      const responseData = { id: 1, ...attributes };
      mockAdapter.onPost("reconciliations/1", attributes).reply(200, responseData);

      const result = await silverfinApi.updateReconciliationText("firm", 123, 1, attributes);

      expect(result).toEqual(responseData);
    });

    it("should find reconciliation text by handle", async () => {
      const reconciliations = [
        { handle: "test_handle", text: "code", marketplace_template_id: null },
        { handle: "other_handle", text: "other code", marketplace_template_id: null },
      ];
      mockAdapter.onGet("reconciliations").reply(200, reconciliations);

      const result = await silverfinApi.findReconciliationTextByHandle("firm", 123, "test_handle");

      expect(result.handle).toBe("test_handle");
    });

    it("should return null when reconciliation text not found", async () => {
      mockAdapter.onGet("reconciliations").reply(200, []);

      const result = await silverfinApi.findReconciliationTextByHandle("firm", 123, "nonexistent");

      expect(result).toBeNull();
    });

    it("should skip marketplace templates when finding by handle", async () => {
      const reconciliations = [
        { handle: "test_handle", text: "code", marketplace_template_id: 123 },
        { handle: "test_handle", text: "code", marketplace_template_id: null },
      ];
      mockAdapter.onGet("reconciliations").reply(200, reconciliations);

      const result = await silverfinApi.findReconciliationTextByHandle("firm", 123, "test_handle");

      expect(result.marketplace_template_id).toBeNull();
    });
  });

  describe("Shared Parts methods", () => {
    it("should read shared parts", async () => {
      const responseData = [{ id: 1, name: "shared1" }];
      mockAdapter.onGet("shared_parts").reply(200, responseData);

      const result = await silverfinApi.readSharedParts("firm", 123);

      expect(result).toEqual(responseData);
    });

    it("should create shared part", async () => {
      const attributes = { name: "new_shared", text: "shared code" };
      const responseData = { id: 1, ...attributes };
      mockAdapter.onPost("shared_parts", attributes).reply(200, responseData);

      const result = await silverfinApi.createSharedPart("firm", 123, attributes);

      expect(result).toEqual(responseData);
    });

    it("should find shared part by name", async () => {
      const sharedParts = [
        { id: 1, name: "shared1" },
        { id: 2, name: "shared2" },
      ];
      mockAdapter.onGet("shared_parts").reply(200, sharedParts);

      const result = await silverfinApi.findSharedPartByName("firm", 123, "shared1");

      expect(result.name).toBe("shared1");
    });

    it("should return null when shared part not found", async () => {
      mockAdapter.onGet("shared_parts").reply(200, []);

      const result = await silverfinApi.findSharedPartByName("firm", 123, "nonexistent");

      expect(result).toBeNull();
    });

    it("should add shared part to reconciliation", async () => {
      const responseData = { success: true };
      mockAdapter.onPost("reconciliations/1/shared_parts/2").reply(200, responseData);

      const result = await silverfinApi.addSharedPartToReconciliation("firm", 123, 2, 1);

      expect(result).toEqual(responseData);
    });

    it("should remove shared part from reconciliation", async () => {
      mockAdapter.onDelete("reconciliations/1/shared_parts/2").reply(204);

      const result = await silverfinApi.removeSharedPartFromReconciliation("firm", 123, 2, 1);

      expect(result).toBeUndefined();
    });
  });

  describe("Export Files methods", () => {
    it("should create export file", async () => {
      const attributes = { name_nl: "export1" };
      const responseData = { id: 1, ...attributes };
      mockAdapter.onPost("export_files", attributes).reply(200, responseData);

      const result = await silverfinApi.createExportFile("firm", 123, attributes);

      expect(result).toEqual(responseData);
    });

    it("should read export files", async () => {
      const responseData = [{ id: 1, name_nl: "export1" }];
      mockAdapter.onGet("export_files").reply(200, responseData);

      const result = await silverfinApi.readExportFiles("firm", 123);

      expect(result).toEqual(responseData);
    });

    it("should find export file by name", async () => {
      const exportFiles = [{ id: 1, name_nl: "export1" }];
      const exportFileDetail = { id: 1, name_nl: "export1", content: "details" };

      mockAdapter.onGet("export_files").reply(200, exportFiles);
      mockAdapter.onGet("export_files/1").reply(200, exportFileDetail);

      const result = await silverfinApi.findExportFileByName("firm", 123, "export1");

      expect(result).toEqual(exportFileDetail);
    });
  });

  describe("Account Templates methods", () => {
    it("should create account template", async () => {
      const attributes = { name_nl: "template1" };
      const responseData = { id: 1, ...attributes };
      mockAdapter.onPost("account_templates", attributes).reply(200, responseData);

      const result = await silverfinApi.createAccountTemplate("firm", 123, attributes);

      expect(result).toEqual(responseData);
    });

    it("should read account templates", async () => {
      const responseData = [{ id: 1, name_nl: "template1" }];
      mockAdapter.onGet("account_templates").reply(200, responseData);

      const result = await silverfinApi.readAccountTemplates("firm", 123);

      expect(result).toEqual(responseData);
    });
  });

  describe("Company and Period methods", () => {
    it("should get periods", async () => {
      const responseData = [{ id: 1, fiscal_year: { end_date: "2023-12-31" } }];
      mockAdapter.onGet("/companies/1/periods").reply(200, responseData);

      const result = await silverfinApi.getPeriods(123, 1);

      expect(result).toEqual(responseData);
    });

    it("should find period by id", () => {
      const periods = [
        { id: 1, fiscal_year: { end_date: "2023-12-31" } },
        { id: 2, fiscal_year: { end_date: "2022-12-31" } },
      ];

      const result = silverfinApi.findPeriod(1, periods);

      expect(result.id).toBe(1);
    });

    it("should get company drop", async () => {
      const responseData = { id: 1, name: "Company 1" };
      mockAdapter.onGet("/companies/1").reply(200, responseData);

      const result = await silverfinApi.getCompanyDrop(123, 1);

      expect(result).toEqual(responseData);
    });

    it("should get workflows", async () => {
      const responseData = [{ id: 1, name: "Workflow 1" }];
      mockAdapter.onGet("/companies/1/periods/1/workflows").reply(200, responseData);

      const result = await silverfinApi.getWorkflows(123, 1, 1);

      expect(result).toEqual(responseData);
    });

    it("should find reconciliation in workflows", async () => {
      const workflowsData = [{ id: 1, name: "Workflow 1" }];
      const reconciliationsData = [{ handle: "test_handle", id: 1 }];

      mockAdapter.onGet("/companies/1/periods/1/workflows").reply(200, workflowsData);
      mockAdapter.onGet("/companies/1/periods/1/workflows/1/reconciliations").reply(200, reconciliationsData);

      const result = await silverfinApi.findReconciliationInWorkflows(123, "test_handle", 1, 1);

      expect(result.handle).toBe("test_handle");
    });
  });

  describe("Testing methods", () => {
    it("should create test run for reconciliation text", async () => {
      const attributes = { text: "test code" };
      const responseData = { id: 1, status: "running" };
      mockAdapter.onPost("reconciliations/test", attributes).reply(200, responseData);

      const result = await silverfinApi.createTestRun(123, attributes, "reconciliationText");

      expect(result).toEqual(responseData);
    });

    it("should create test run for account template", async () => {
      const attributes = { text: "test code" };
      const responseData = { id: 1, status: "running" };
      mockAdapter.onPost("account_templates/test", attributes).reply(200, responseData);

      const result = await silverfinApi.createTestRun(123, attributes, "accountTemplate");

      expect(result).toEqual(responseData);
    });

    it("should verify liquid code", async () => {
      const attributes = { text: "liquid code" };
      const responseData = { valid: true };
      mockAdapter.onPost("reconciliations/verify_liquid", attributes).reply(200, responseData);

      const result = await silverfinApi.verifyLiquid(123, attributes);

      expect(result).toEqual(responseData);
    });
  });

  describe("Firm methods", () => {
    it("should get firm details", async () => {
      const responseData = { id: 123, name: "Test Firm" };
      mockAdapter.onGet("/user/firm").reply(200, responseData);

      const result = await silverfinApi.getFirmDetails(123);

      expect(result).toEqual(responseData);
    });
  });
});
