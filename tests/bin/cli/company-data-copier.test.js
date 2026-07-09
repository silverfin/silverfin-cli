const fsPromises = require("fs").promises;
const path = require("path");
const os = require("os");

jest.mock("consola");
jest.mock("../../../lib/api/sfApi");

const SF = require("../../../lib/api/sfApi");
const consola = require("consola");
const toolkit = require("../../../index");

describe("company-data-copier", () => {
  let tempDir;
  let originalCwd;
  let originalExit;

  const destinationFirmId = 13692;
  const sourceCompanyId = 1224550;
  const sourceLedgerIds = [33417839, 32116688];

  beforeEach(async () => {
    jest.clearAllMocks();

    tempDir = await fsPromises.mkdtemp(path.join(os.tmpdir(), "sf-cli-test-"));

    originalCwd = process.cwd();
    process.chdir(tempDir);

    originalExit = process.exit;
    process.exit = jest.fn();

    consola.success = jest.fn();
    consola.error = jest.fn();
    consola.info = jest.fn();
    consola.log = jest.fn();
    consola.warn = jest.fn();
    consola.debug = jest.fn();
  });

  afterEach(async () => {
    process.chdir(originalCwd);
    process.exit = originalExit;
    await fsPromises.rm(tempDir, { recursive: true, force: true });
  });

  describe("copyCompanyData", () => {
    it("should call the Data Copier with firm type and the correct attributes and log success", async () => {
      const mockResponse = { data: { status: "enqueued" } };
      SF.runCompanyDataCopier.mockResolvedValue(mockResponse);

      const result = await toolkit.copyCompanyData(destinationFirmId, sourceCompanyId, sourceLedgerIds);

      expect(SF.runCompanyDataCopier).toHaveBeenCalledWith("firm", destinationFirmId, {
        source_company_id: sourceCompanyId,
        source_ledger_ids: sourceLedgerIds,
      });
      expect(consola.success).toHaveBeenCalled();
      expect(result).toEqual(mockResponse.data);
    });

    it("should error and return false when no source company id is given", async () => {
      const result = await toolkit.copyCompanyData(destinationFirmId, undefined, sourceLedgerIds);

      expect(SF.runCompanyDataCopier).not.toHaveBeenCalled();
      expect(consola.error).toHaveBeenCalled();
      expect(result).toBe(false);
    });

    it("should error and return false when no source ledger ids are given", async () => {
      const result = await toolkit.copyCompanyData(destinationFirmId, sourceCompanyId, []);

      expect(SF.runCompanyDataCopier).not.toHaveBeenCalled();
      expect(consola.error).toHaveBeenCalled();
      expect(result).toBe(false);
    });

    it("should error and return false when the API returns no data", async () => {
      SF.runCompanyDataCopier.mockResolvedValue(undefined);

      const result = await toolkit.copyCompanyData(destinationFirmId, sourceCompanyId, sourceLedgerIds);

      expect(consola.error).toHaveBeenCalled();
      expect(result).toBe(false);
    });
  });
});
