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
        data: { name_nl: "account_1" },
      });

      await toolkit.publishAccountTemplateByName("firm", "1001", "account_1");

      expect(SF.updateAccountTemplate).toHaveBeenCalledWith("firm", "1001", 1101, expect.any(Object));
      expect(consola.success).toHaveBeenCalledWith(expect.stringContaining("account_1"));
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
        data: { name_nl: "account_1" },
      });

      await toolkit.publishAccountTemplateById("firm", "1001", 1101);

      expect(SF.updateAccountTemplate).toHaveBeenCalledWith("firm", "1001", 1101, expect.any(Object));
      expect(consola.success).toHaveBeenCalledWith(expect.stringContaining("account_1"));
    });

    it("should return false when no local account template has the given id", async () => {
      const result = await toolkit.publishAccountTemplateById("firm", "1001", 99999);
      expect(result).toBe(false);
      expect(consola.error).toHaveBeenCalledWith(expect.stringContaining("No template found"));
    });
  });
});
