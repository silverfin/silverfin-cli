const fs = require("fs");
const fsPromises = require("fs").promises;
const path = require("path");
const fsUtils = require("../../../lib/utils/fsUtils");
const templateUtils = require("../../../lib/utils/templateUtils");
const { AccountTemplate } = require("../../../lib/templates/accountTemplate");

jest.mock("../../../lib/utils/templateUtils");
jest.mock("consola");

describe("AccountTemplate", () => {
  describe("save", () => {
    const testContent = "Test content as string";
    const textParts = { part_1: "Part 1: updated content" };
    const template = {
      name_nl: "name_nl",
      id: 808080,
      text: "Main liquid content",
      text_parts: [
        { name: "part_1", content: "Part 1: updated content" },
        { name: "", content: "" },
      ],
      tests: testContent,
      externally_managed: true,
    };
    const name_nl = template.name_nl;
    const configToWrite = {
      id: {
        100: 808080,
      },
      partner_id: {},
      name_nl: "name_nl",
      text: "main.liquid",
      text_parts: {
        part_1: "text_parts/part_1.liquid",
      },
	  name_nl: "name_nl",
	  name_fr: "name_fr",
	  name_en: "name_en",
	  account_range: null,
	  mapping_list_ranges: [],
	  hide_code: true,
      published: true,
    };
    const existingConfig = {
      id: { 200: 505050 },
      name_nl: "old_name_nl",
      text: "main.liquid",
      text_parts: {
        old_part: "text_parts/old_part.liquid",
        part_1: "text_parts/part_1.liquid",
      },
      name_nl: "name_nl",
	  name_fr: "name_fr",
	  name_en: "name_en",
	  account_range: null,
	  mapping_list_ranges: [],
	  hide_code: false,
      published: true,
    };

    const tempDir = path.join(process.cwd(), "tmp");
    const expectedFolderPath = path.join(tempDir, "account_templates", name_nl);
    const configPath = path.join(expectedFolderPath, "config.json");
    const mainLiquidPath = path.join(expectedFolderPath, "main.liquid");
    const part1LiquidPath = path.join(expectedFolderPath, "text_parts", "part_1.liquid");
    const oldPartLiquidPath = path.join(expectedFolderPath, "text_parts", "old_part.liquid");

    beforeEach(() => {
      if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, { recursive: true });
      }
      process.chdir(tempDir);
    });

    afterEach(() => {
      if (fs.existsSync(tempDir)) {
        fs.rmdirSync(tempDir, { recursive: true });
      }
      jest.resetAllMocks();
    });

	it("should return false if name_nl is missing", () => {
		const result = AccountTemplate.save("firm", 100, { id: 808080 });
		expect(result).toBe(false);
		expect(require("consola").warn).toHaveBeenCalledWith('Template name_nl is missing \"undefined\". Skipping. NL must be enabled in \"Advanced Settings\" in Silverfin because the NL name is the only required field for a template name.');
	});

	it("should return false if the liquid code is missing", () => {
		templateUtils.missingLiquidCode.mockReturnValue(true);
		const result = AccountTemplate.save("firm", 100, template);
		expect(result).toBe(false);
		expect(templateUtils.missingLiquidCode).toHaveBeenCalledWith(template);
	  });

	it("should return false if the template handle is invalid", () => {
		templateUtils.checkValidName.mockReturnValue(false);
		const result = AccountTemplate.save("firm", 100, template);
		expect(result).toBe(false);
		expect(templateUtils.checkValidName).toHaveBeenCalledWith("name_nl", "accountTemplate");
	});

});

});