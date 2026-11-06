const fsPromises = require("fs").promises;
const path = require("path");
const os = require("os");

jest.mock("consola");
jest.mock("../../../lib/api/sfApi");

const SF = require("../../../lib/api/sfApi");
const consola = require("consola");
const toolkit = require("../../../index");

describe("update-account-template", () => {
  let tempDir;
  let originalCwd;

  let originalExit;

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
  });

  afterEach(async () => {
    process.chdir(originalCwd);
    process.exit = originalExit;
    await fsPromises.rm(tempDir, { recursive: true, force: true });
  });

  describe("publishAccountTemplateByName", () => {
    it("should update account template when config and id exist", async () => {
      const fixturesPath = path.join(__dirname, "../../../fixtures/market-repo");
      await fsPromises.cp(fixturesPath, tempDir, { recursive: true });

      SF.updateAccountTemplate.mockResolvedValue({
        status: 201,
        data: { name_nl: "account_1" },
      });

      await toolkit.publishAccountTemplateByName("firm", "1001", "account_1");

      expect(SF.updateAccountTemplate).toHaveBeenCalledWith("firm", "1001", 1101, expect.any(Object));
      expect(consola.success).toHaveBeenCalledWith(expect.stringContaining("account_1"));
    });

    it("should report success when the firm has Dutch disabled and omits name_nl", async () => {
      const fixturesPath = path.join(__dirname, "../../../fixtures/market-repo");
      await fsPromises.cp(fixturesPath, tempDir, { recursive: true });

      SF.updateAccountTemplate.mockResolvedValue({
        status: 201,
        data: { id: 1101, name_en: "Account Template 1" },
      });

      const result = await toolkit.publishAccountTemplateByName("firm", "1001", "account_1");

      expect(result).toBe(true);
      expect(consola.success).toHaveBeenCalledWith("Account template updated: account_1");
      expect(consola.error).not.toHaveBeenCalled();
    });

    it("should report failure when the update request returns no response", async () => {
      const fixturesPath = path.join(__dirname, "../../../fixtures/market-repo");
      await fsPromises.cp(fixturesPath, tempDir, { recursive: true });

      SF.updateAccountTemplate.mockResolvedValue(undefined);

      const result = await toolkit.publishAccountTemplateByName("firm", "1001", "account_1");

      expect(result).toBe(false);
      expect(consola.error).toHaveBeenCalledWith("Account template update failed: account_1");
    });

    it("should return false when config does not exist", async () => {
      const result = await toolkit.publishAccountTemplateByName("firm", "1001", "nonexistent");
      expect(result).toBe(false);
      expect(SF.updateAccountTemplate).not.toHaveBeenCalled();
    });

    it("should return false when config has no matching firm id", async () => {
      const fixturesPath = path.join(__dirname, "../../../fixtures/market-repo");
      await fsPromises.cp(fixturesPath, tempDir, { recursive: true });

      const result = await toolkit.publishAccountTemplateByName("firm", "9999", "account_1");
      expect(result).toBe(false);
      expect(SF.updateAccountTemplate).not.toHaveBeenCalled();
    });
  });

  describe("publishAccountTemplateById", () => {
    it("should update account template when matching local template found by id", async () => {
      const fixturesPath = path.join(__dirname, "../../../fixtures/market-repo");
      await fsPromises.cp(fixturesPath, tempDir, { recursive: true });

      SF.updateAccountTemplate.mockResolvedValue({
        status: 201,
        data: { name_nl: "account_1" },
      });

      await toolkit.publishAccountTemplateById("firm", "1001", 1101);

      expect(SF.updateAccountTemplate).toHaveBeenCalledWith("firm", "1001", 1101, expect.any(Object));
      expect(consola.success).toHaveBeenCalledWith(expect.stringContaining("account_1"));
    });

    it("should report success by id when the firm has Dutch disabled and omits name_nl", async () => {
      const fixturesPath = path.join(__dirname, "../../../fixtures/market-repo");
      await fsPromises.cp(fixturesPath, tempDir, { recursive: true });

      SF.updateAccountTemplate.mockResolvedValue({
        status: 201,
        data: { id: 1101, name_en: "Account Template 1" },
      });

      const result = await toolkit.publishAccountTemplateById("firm", "1001", 1101);

      expect(result).toBe(true);
      expect(consola.success).toHaveBeenCalledWith("Account template updated: account_1 (ID: 1101)");
      expect(consola.error).not.toHaveBeenCalled();
    });

    it("should return false when no local account template has the given id", async () => {
      const result = await toolkit.publishAccountTemplateById("firm", "1001", 99999);
      expect(result).toBe(false);
      expect(consola.error).toHaveBeenCalledWith(expect.stringContaining("No template found"));
    });
  });
});
