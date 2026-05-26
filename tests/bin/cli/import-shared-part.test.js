const fs = require("fs");
const fsPromises = require("fs").promises;
const path = require("path");
const os = require("os");

jest.mock("consola");
jest.mock("../../../lib/api/sfApi");

const SF = require("../../../lib/api/sfApi");
const consola = require("consola");
const toolkit = require("../../../index");

describe("import-shared-part", () => {
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

  describe("fetchSharedPartById", () => {
    it("should import shared part and create necessary files", async () => {
      const mockApiResponse = {
        id: 5601,
        name: "shared_part_1",
        text: "{% comment %}shared_part_1 content{% endcomment %}",
        externally_managed: true,
        used_in: [],
      };

      SF.readSharedPartById.mockResolvedValue({ data: mockApiResponse });

      await toolkit.fetchSharedPartById("firm", "1001", 5601);

      expect(SF.readSharedPartById).toHaveBeenCalledWith("firm", "1001", 5601);
      expect(consola.success).toHaveBeenCalledWith(expect.stringContaining("shared_part_1"));

      const sharedPartDir = path.join(tempDir, "shared_parts", "shared_part_1");
      expect(fs.existsSync(path.join(sharedPartDir, "shared_part_1.liquid"))).toBe(true);
      expect(fs.existsSync(path.join(sharedPartDir, "config.json"))).toBe(true);
    });

    it("should log error and exit when shared part not found", async () => {
      SF.readSharedPartById.mockResolvedValue({ data: null });

      await toolkit.fetchSharedPartById("firm", "1001", 99999);

      expect(consola.error).toHaveBeenCalledWith(expect.stringContaining("wasn't found"));
      expect(process.exit).toHaveBeenCalledWith(1);
    });
  });

  describe("fetchSharedPartByName", () => {
    it("should import shared part when found by name", async () => {
      const listEntry = { id: 5601, name: "shared_part_1" };
      const fullResponse = {
        id: 5601,
        name: "shared_part_1",
        text: "{% comment %}shared_part_1{% endcomment %}",
        externally_managed: true,
        used_in: [],
      };

      SF.findSharedPartByName.mockResolvedValue(listEntry);
      SF.readSharedPartById.mockResolvedValue({ data: fullResponse });

      await toolkit.fetchSharedPartByName("firm", "1001", "shared_part_1");

      expect(SF.findSharedPartByName).toHaveBeenCalledWith("firm", "1001", "shared_part_1");
      expect(SF.readSharedPartById).toHaveBeenCalledWith("firm", "1001", 5601);
      expect(consola.success).toHaveBeenCalledWith(expect.stringContaining("shared_part_1"));
    });

    it("should log error and exit when shared part not found by name", async () => {
      SF.findSharedPartByName.mockResolvedValue(null);
      process.exit.mockImplementation((code) => {
        throw new Error(`EXIT_${code}`);
      });

      await expect(
        toolkit.fetchSharedPartByName("firm", "1001", "nonexistent_part"),
      ).rejects.toThrow("EXIT_1");

      expect(consola.error).toHaveBeenCalledWith(expect.stringContaining("wasn't found"));
      expect(process.exit).toHaveBeenCalledWith(1);
      expect(SF.readSharedPartById).not.toHaveBeenCalled();
    });
  });
});
