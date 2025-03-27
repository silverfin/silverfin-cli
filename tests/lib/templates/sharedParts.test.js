const fs = require("fs");
const fsPromises = require("fs").promises;
const path = require("path");
const fsUtils = require("../../../lib/utils/fsUtils");
const templateUtils = require("../../../lib/utils/templateUtils");
const { SharedPart } = require("../../../lib/templates/sharedPart");

jest.mock("../../../lib/utils/templateUtils");
jest.mock("consola");

describe("SharedPart", () => {
  describe("save", () => {
    const template = {
      id: 808080,
      name: "example_shared_part_name",
      text: "example_shared_part_name.liquid",
      externally_managed: true,
    };
    const name = template.name;
    const configToWrite = {
      id: {
        100: 808080,
      },
      name: "example_shared_part_name",
      text: "example_shared_part_name.liquid",
      hide_code: true,
      is_active: true,
      published: true,
      used_in: [],
    };
    const existingConfig = {
      id: { 200: 505050 },
      name: "old_shared_part_name",
      text: "old_shared_part_name.liquid",
      hide_code: true,
      is_active: true,
      published: true,
      used_in: [],
    };

    const tempDir = path.join(process.cwd(), "tmp");
    const expectedFolderPath = path.join(tempDir, "shared_parts", name);
    const configPath = path.join(expectedFolderPath, "config.json");
    const mainLiquidPath = path.join(expectedFolderPath, "main.liquid");

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

    it("should return false if the template name is invalid", async () => {
      templateUtils.checkValidName.mockReturnValue(false);
      const result = await SharedPart.save("firm", 100, template);
      expect(result).toBe(false);
      expect(templateUtils.checkValidName).toHaveBeenCalledWith("example_shared_part_name", "sharedPart");
    });
  });
});
