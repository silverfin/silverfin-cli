const fs = require("fs");
const fsPromises = require("fs").promises;
const path = require("path");
const os = require("os");

jest.mock("consola");
jest.mock("../../../lib/api/sfApi");

const SF = require("../../../lib/api/sfApi");
const consola = require("consola");
const toolkit = require("../../../index");

describe("get-account-template-id", () => {
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

  describe("getTemplateId for accountTemplate", () => {
    it("should store the account template id and return true when found", async () => {
      const fixturesPath = path.join(__dirname, "../../../fixtures/market-repo");
      await fsPromises.cp(fixturesPath, tempDir, { recursive: true });

      SF.findAccountTemplateByName.mockResolvedValue({ id: 99007, name_nl: "account_1" });

      const result = await toolkit.getTemplateId("firm", "2000", "accountTemplate", "account_1");

      expect(result).toBe(true);
      expect(SF.findAccountTemplateByName).toHaveBeenCalledWith("firm", "2000", "account_1");
      expect(consola.success).toHaveBeenCalledWith(expect.stringContaining("account_1"));

      const configPath = path.join(tempDir, "account_templates", "account_1", "config.json");
      const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
      expect(config.id["2000"]).toBe(99007);
    });

    it("should warn and return false when account template not found", async () => {
      const fixturesPath = path.join(__dirname, "../../../fixtures/market-repo");
      await fsPromises.cp(fixturesPath, tempDir, { recursive: true });

      SF.findAccountTemplateByName.mockResolvedValue(null);

      const result = await toolkit.getTemplateId("firm", "1001", "accountTemplate", "account_1");

      expect(result).toBe(false);
      expect(consola.warn).toHaveBeenCalledWith(expect.stringContaining("account_1"));
    });
  });
});
