const fs = require("fs");
const fsPromises = require("fs").promises;
const path = require("path");
const os = require("os");

jest.mock("consola");
jest.mock("../../../lib/api/sfApi");

const SF = require("../../../lib/api/sfApi");
const consola = require("consola");
const toolkit = require("../../../index");

describe("update-shared-part", () => {
  let tempDir;

  let originalExit;

  beforeEach(async () => {
    jest.clearAllMocks();

    tempDir = await fsPromises.mkdtemp(path.join(os.tmpdir(), "sf-cli-test-"));

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
    process.chdir(path.resolve(__dirname, "../../.."));
    process.exit = originalExit;
    await fsPromises.rm(tempDir, { recursive: true, force: true });
  });

  describe("publishSharedPartByName", () => {
    it("should update shared part when config and id exist", async () => {
      const fixturesPath = path.join(__dirname, "../../../fixtures/market-repo");
      await fsPromises.cp(fixturesPath, tempDir, { recursive: true });

      SF.updateSharedPart.mockResolvedValue({
        data: { name: "shared_part_1" },
      });

      await toolkit.publishSharedPartByName("firm", "1001", "shared_part_1");

      expect(SF.updateSharedPart).toHaveBeenCalledWith("firm", "1001", 5601, expect.any(Object));
      expect(consola.success).toHaveBeenCalledWith(expect.stringContaining("shared_part_1"));
    });

    it("should return false when config does not exist", async () => {
      const result = await toolkit.publishSharedPartByName("firm", "1001", "nonexistent");
      expect(result).toBe(false);
      expect(SF.updateSharedPart).not.toHaveBeenCalled();
    });

    it("should return false when config has no matching firm id", async () => {
      const fixturesPath = path.join(__dirname, "../../../fixtures/market-repo");
      await fsPromises.cp(fixturesPath, tempDir, { recursive: true });

      const result = await toolkit.publishSharedPartByName("firm", "9999", "shared_part_1");
      expect(result).toBe(false);
      expect(SF.updateSharedPart).not.toHaveBeenCalled();
    });
  });

  describe("publishSharedPartById", () => {
    it("should update shared part when matching local shared part found by id", async () => {
      const fixturesPath = path.join(__dirname, "../../../fixtures/market-repo");
      await fsPromises.cp(fixturesPath, tempDir, { recursive: true });

      SF.updateSharedPart.mockResolvedValue({
        data: { name: "shared_part_1" },
      });

      await toolkit.publishSharedPartById("firm", "1001", 5601);

      expect(SF.updateSharedPart).toHaveBeenCalledWith("firm", "1001", 5601, expect.any(Object));
      expect(consola.success).toHaveBeenCalledWith(expect.stringContaining("shared_part_1"));
    });

    it("should return false when no local shared part has the given id", async () => {
      const result = await toolkit.publishSharedPartById("firm", "1001", 99999);
      expect(result).toBe(false);
      expect(consola.error).toHaveBeenCalledWith(expect.stringContaining("No template found"));
    });
  });
});
