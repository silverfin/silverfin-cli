const fs = require("fs");
const fsPromises = require("fs").promises;
const path = require("path");
const os = require("os");

jest.mock("consola");
jest.mock("../../../lib/api/sfApi");

const SF = require("../../../lib/api/sfApi");
const consola = require("consola");
const toolkit = require("../../../index");

describe("create-shared-part", () => {
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

  describe("newSharedPart", () => {
    it("should create shared part and store new id on success", async () => {
      const fixturesPath = path.join(__dirname, "../../../fixtures/market-repo");
      await fsPromises.cp(fixturesPath, tempDir, { recursive: true });

      SF.findSharedPartByName.mockResolvedValue(null);
      SF.createSharedPart.mockResolvedValue({
        status: 201,
        data: { id: 99004, name: "shared_part_1" },
      });

      await toolkit.newSharedPart("firm", "2000", "shared_part_1");

      expect(SF.createSharedPart).toHaveBeenCalledWith("firm", "2000", expect.any(Object));
      expect(consola.success).toHaveBeenCalledWith(expect.stringContaining("shared_part_1"));

      const configPath = path.join(tempDir, "shared_parts", "shared_part_1", "config.json");
      const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
      expect(config.id["2000"]).toBe(99004);
    });

    it("should skip creation when shared part already exists remotely", async () => {
      const fixturesPath = path.join(__dirname, "../../../fixtures/market-repo");
      await fsPromises.cp(fixturesPath, tempDir, { recursive: true });

      SF.findSharedPartByName.mockResolvedValue({ id: 5601, name: "shared_part_1" });

      await toolkit.newSharedPart("firm", "1001", "shared_part_1");

      expect(SF.createSharedPart).not.toHaveBeenCalled();
      expect(consola.warn).toHaveBeenCalledWith(expect.stringContaining("already exists"));
    });
  });
});
