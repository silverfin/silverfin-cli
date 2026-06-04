const fs = require("fs");
const fsPromises = require("fs").promises;
const path = require("path");
const os = require("os");

jest.mock("consola");
jest.mock("../../../lib/api/sfApi");

const SF = require("../../../lib/api/sfApi");
const consola = require("consola");
const toolkit = require("../../../index");

describe("get-shared-part-id", () => {
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

  describe("getTemplateId for sharedPart", () => {
    it("should store the shared part id and return true when found", async () => {
      const fixturesPath = path.join(__dirname, "../../../fixtures/market-repo");
      await fsPromises.cp(fixturesPath, tempDir, { recursive: true });

      SF.findSharedPartByName.mockResolvedValue({ id: 99008, name: "shared_part_1" });

      const result = await toolkit.getTemplateId("firm", "2000", "sharedPart", "shared_part_1");

      expect(result).toBe(true);
      expect(SF.findSharedPartByName).toHaveBeenCalledWith("firm", "2000", "shared_part_1");
      expect(consola.success).toHaveBeenCalledWith(expect.stringContaining("shared_part_1"));

      const configPath = path.join(tempDir, "shared_parts", "shared_part_1", "config.json");
      const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
      expect(config.id["2000"]).toBe(99008);
    });

    it("should warn and return false when shared part not found", async () => {
      const fixturesPath = path.join(__dirname, "../../../fixtures/market-repo");
      await fsPromises.cp(fixturesPath, tempDir, { recursive: true });

      SF.findSharedPartByName.mockResolvedValue(null);

      const result = await toolkit.getTemplateId("firm", "1001", "sharedPart", "shared_part_1");

      expect(result).toBe(false);
      expect(consola.warn).toHaveBeenCalledWith(expect.stringContaining("shared_part_1"));
    });
  });
});
