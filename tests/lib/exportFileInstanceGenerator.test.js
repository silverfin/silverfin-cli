jest.mock("consola");
jest.mock("../../lib/api/sfApi");
jest.mock("../../lib/utils/errorUtils", () => ({ errorHandler: jest.fn() }));
jest.mock("../../lib/utils/urlHandler", () => ({
  UrlHandler: jest.fn().mockImplementation(() => ({ openFile: jest.fn().mockResolvedValue(undefined) })),
}));

const SF = require("../../lib/api/sfApi");
const { consola } = require("consola");
const { UrlHandler } = require("../../lib/utils/urlHandler");
const { ExportFileInstanceGenerator } = require("../../lib/exportFileInstanceGenerator");

describe("ExportFileInstanceGenerator", () => {
  const FIRM_ID = 1001;
  const COMPANY_ID = 200;
  const PERIOD_ID = 300;
  const EXPORT_FILE_ID = 400;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ─── Constructor ─────────────────────────────────────────────────────────

  describe("constructor", () => {
    it("should create an instance with all required parameters", () => {
      const gen = new ExportFileInstanceGenerator(FIRM_ID, COMPANY_ID, PERIOD_ID, EXPORT_FILE_ID);
      expect(gen.firmId).toBe(FIRM_ID);
      expect(gen.companyId).toBe(COMPANY_ID);
      expect(gen.periodId).toBe(PERIOD_ID);
      expect(gen.exportFileId).toBe(EXPORT_FILE_ID);
    });

    it("should throw when firmId is missing", () => {
      expect(() => new ExportFileInstanceGenerator(null, COMPANY_ID, PERIOD_ID, EXPORT_FILE_ID)).toThrow(
        "All parameters (firmId, companyId, periodId, exportFileId) are required."
      );
    });

    it("should throw when companyId is missing", () => {
      expect(() => new ExportFileInstanceGenerator(FIRM_ID, null, PERIOD_ID, EXPORT_FILE_ID)).toThrow(
        "All parameters (firmId, companyId, periodId, exportFileId) are required."
      );
    });

    it("should throw when periodId is missing", () => {
      expect(() => new ExportFileInstanceGenerator(FIRM_ID, COMPANY_ID, null, EXPORT_FILE_ID)).toThrow(
        "All parameters (firmId, companyId, periodId, exportFileId) are required."
      );
    });

    it("should throw when exportFileId is missing", () => {
      expect(() => new ExportFileInstanceGenerator(FIRM_ID, COMPANY_ID, PERIOD_ID, null)).toThrow(
        "All parameters (firmId, companyId, periodId, exportFileId) are required."
      );
    });
  });

  // ─── generateAndOpenFile ──────────────────────────────────────────────────

  describe("generateAndOpenFile", () => {
    it("should log error and return false when createExportFileInstance returns no id", async () => {
      SF.createExportFileInstance = jest.fn().mockResolvedValue(null);

      const gen = new ExportFileInstanceGenerator(FIRM_ID, COMPANY_ID, PERIOD_ID, EXPORT_FILE_ID);
      await gen.generateAndOpenFile();

      expect(SF.createExportFileInstance).toHaveBeenCalledWith(FIRM_ID, COMPANY_ID, PERIOD_ID, EXPORT_FILE_ID);
      expect(consola.error).toHaveBeenCalledWith(expect.stringContaining("Failed to create export file instance"));
    });

    it("should poll until state is created and open the download URL", async () => {
      const instanceId = 999;
      const contentUrl = "https://example.com/download/file.xlsx";

      SF.createExportFileInstance = jest.fn().mockResolvedValue({ id: instanceId });
      SF.getExportFileInstance = jest.fn().mockResolvedValue({ state: "created", content_url: contentUrl });

      const mockInstance = { openFile: jest.fn().mockResolvedValue(undefined) };
      UrlHandler.mockImplementationOnce(() => mockInstance);

      const gen = new ExportFileInstanceGenerator(FIRM_ID, COMPANY_ID, PERIOD_ID, EXPORT_FILE_ID);
      await gen.generateAndOpenFile();

      expect(SF.getExportFileInstance).toHaveBeenCalledWith(FIRM_ID, COMPANY_ID, PERIOD_ID, instanceId);
      expect(consola.success).toHaveBeenCalledWith(expect.stringContaining("completed successfully"));
      expect(UrlHandler).toHaveBeenCalledWith(contentUrl);
      expect(mockInstance.openFile).toHaveBeenCalled();
    });

    it("should log warning for validation errors after successful generation", async () => {
      const instanceId = 998;
      const contentUrl = "https://example.com/download/file.xlsx";
      const validationErrors = ["Field X is required"];

      SF.createExportFileInstance = jest.fn().mockResolvedValue({ id: instanceId });
      SF.getExportFileInstance = jest.fn().mockResolvedValue({
        state: "created",
        content_url: contentUrl,
        validation_errors: validationErrors,
      });

      const gen = new ExportFileInstanceGenerator(FIRM_ID, COMPANY_ID, PERIOD_ID, EXPORT_FILE_ID);
      await gen.generateAndOpenFile();

      expect(consola.warn).toHaveBeenCalledWith(expect.stringContaining("Validation errors"));
    });

    it("should retry while state is pending and succeed on eventual created state", async () => {
      const instanceId = 997;
      const contentUrl = "https://example.com/download/file.xlsx";

      SF.createExportFileInstance = jest.fn().mockResolvedValue({ id: instanceId });

      let pollCount = 0;
      SF.getExportFileInstance = jest.fn().mockImplementation(() => {
        pollCount++;
        if (pollCount < 3) {
          return Promise.resolve({ state: "pending" });
        }
        return Promise.resolve({ state: "created", content_url: contentUrl });
      });

      jest.useFakeTimers();
      const gen = new ExportFileInstanceGenerator(FIRM_ID, COMPANY_ID, PERIOD_ID, EXPORT_FILE_ID);
      const promise = gen.generateAndOpenFile();

      // Advance timers enough for 3 poll cycles (each uses setTimeout internally)
      for (let i = 0; i < 3; i++) {
        await Promise.resolve(); // flush microtasks
        jest.runAllTimers();
        await Promise.resolve();
      }

      jest.useRealTimers();
      await promise;

      expect(SF.getExportFileInstance).toHaveBeenCalledTimes(3);
      expect(consola.success).toHaveBeenCalledWith(expect.stringContaining("completed successfully"));
    }, 15000);

    it("should log error when state is neither pending nor created", async () => {
      const instanceId = 996;

      SF.createExportFileInstance = jest.fn().mockResolvedValue({ id: instanceId });
      SF.getExportFileInstance = jest.fn().mockResolvedValue({ state: "failed" });

      const gen = new ExportFileInstanceGenerator(FIRM_ID, COMPANY_ID, PERIOD_ID, EXPORT_FILE_ID);
      await gen.generateAndOpenFile();

      expect(consola.error).toHaveBeenCalledWith(expect.stringContaining("failed or encountered an unexpected state"));
    });

    it("should log error when no content_url is present in response", async () => {
      const instanceId = 995;

      SF.createExportFileInstance = jest.fn().mockResolvedValue({ id: instanceId });
      SF.getExportFileInstance = jest.fn().mockResolvedValue({ state: "created" }); // no content_url

      const gen = new ExportFileInstanceGenerator(FIRM_ID, COMPANY_ID, PERIOD_ID, EXPORT_FILE_ID);
      await gen.generateAndOpenFile();

      expect(consola.error).toHaveBeenCalledWith(expect.stringContaining("No download URL found"));
    });
  });
});
