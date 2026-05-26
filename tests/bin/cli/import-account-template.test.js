const fs = require("fs");
const fsPromises = require("fs").promises;
const path = require("path");
const os = require("os");

jest.mock("consola");
jest.mock("../../../lib/api/sfApi");

const SF = require("../../../lib/api/sfApi");
const consola = require("consola");
const toolkit = require("../../../index");

describe("import-account-template", () => {
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

  describe("fetchAccountTemplateById", () => {
    it("should import account template and create necessary files", async () => {
      const mockApiResponse = {
        id: 1101,
        name_nl: "account_1",
        name_en: "Account Template 1",
        text: "{% comment %}account template content{% endcomment %}",
        text_parts: [{ name: "detail", content: "Detail liquid content" }],
        externally_managed: false,
        published: true,
        account_range: "280,282",
        mapping_list_ranges: [],
      };

      SF.readAccountTemplateById.mockResolvedValue(mockApiResponse);

      await toolkit.fetchAccountTemplateById("firm", "1001", 1101);

      expect(SF.readAccountTemplateById).toHaveBeenCalledWith("firm", "1001", 1101);
      expect(consola.success).toHaveBeenCalledWith(expect.stringContaining("account_1"));

      const accountDir = path.join(tempDir, "account_templates", "account_1");
      expect(fs.existsSync(path.join(accountDir, "main.liquid"))).toBe(true);
      expect(fs.existsSync(path.join(accountDir, "config.json"))).toBe(true);
    });

    it("should log error and exit when account template not found", async () => {
      SF.readAccountTemplateById.mockResolvedValue(null);

      await toolkit.fetchAccountTemplateById("firm", "1001", 99999);

      expect(consola.error).toHaveBeenCalledWith(expect.stringContaining("wasn't found"));
      expect(process.exit).toHaveBeenCalledWith(1);
    });
  });

  describe("fetchAccountTemplateByName", () => {
    it("should import account template when found by name", async () => {
      const mockApiResponse = {
        id: 1101,
        name_nl: "account_1",
        name_en: "Account Template 1",
        text: "{% assign x = 1 %}",
        text_parts: [],
        externally_managed: false,
        published: true,
        account_range: "280,282",
        mapping_list_ranges: [],
      };

      SF.findAccountTemplateByName.mockResolvedValue(mockApiResponse);

      await toolkit.fetchAccountTemplateByName("firm", "1001", "account_1");

      expect(SF.findAccountTemplateByName).toHaveBeenCalledWith("firm", "1001", "account_1");
      expect(consola.success).toHaveBeenCalledWith(expect.stringContaining("account_1"));
    });

    it("should log error and exit when account template not found by name", async () => {
      SF.findAccountTemplateByName.mockResolvedValue(null);

      await toolkit.fetchAccountTemplateByName("firm", "1001", "nonexistent_account");

      expect(consola.error).toHaveBeenCalledWith(expect.stringContaining("wasn't found"));
      expect(process.exit).toHaveBeenCalledWith(1);
    });
  });
});
