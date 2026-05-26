const templateUtils = require("../../../lib/utils/templateUtils");

jest.mock("consola");

describe("templateUtils", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ─── Constants ────────────────────────────────────────────────────────────

  describe("TEMPLATES_NAME_ATTRIBUTE", () => {
    it("should have all 4 type keys", () => {
      const { TEMPLATES_NAME_ATTRIBUTE } = templateUtils;
      expect(TEMPLATES_NAME_ATTRIBUTE).toHaveProperty("reconciliationText", "handle");
      expect(TEMPLATES_NAME_ATTRIBUTE).toHaveProperty("accountTemplate", "name_nl");
      expect(TEMPLATES_NAME_ATTRIBUTE).toHaveProperty("exportFile", "name_nl");
      expect(TEMPLATES_NAME_ATTRIBUTE).toHaveProperty("sharedPart", "name");
    });
  });

  describe("TEMPLATE_TYPE_NAMES", () => {
    it("should have all 4 type keys with human-readable values", () => {
      const { TEMPLATE_TYPE_NAMES } = templateUtils;
      expect(TEMPLATE_TYPE_NAMES).toHaveProperty("reconciliationText");
      expect(TEMPLATE_TYPE_NAMES).toHaveProperty("accountTemplate");
      expect(TEMPLATE_TYPE_NAMES).toHaveProperty("exportFile");
      expect(TEMPLATE_TYPE_NAMES).toHaveProperty("sharedPart");
      expect(typeof TEMPLATE_TYPE_NAMES.reconciliationText).toBe("string");
    });
  });

  describe("TEMPLATE_MAP_TYPES", () => {
    it("should map API type strings to internal type keys", () => {
      const { TEMPLATE_MAP_TYPES } = templateUtils;
      expect(TEMPLATE_MAP_TYPES["reconciliation"]).toBe("reconciliationText");
      expect(TEMPLATE_MAP_TYPES["reconciliation_text"]).toBe("reconciliationText");
      expect(TEMPLATE_MAP_TYPES["shared_part"]).toBe("sharedPart");
      expect(TEMPLATE_MAP_TYPES["export_file"]).toBe("exportFile");
      expect(TEMPLATE_MAP_TYPES["account_detail_template"]).toBe("accountTemplate");
      expect(TEMPLATE_MAP_TYPES["account_template"]).toBe("accountTemplate");
    });
  });

  // ─── getTemplateName ──────────────────────────────────────────────────────

  describe("getTemplateName", () => {
    it("should return handle for reconciliationText", () => {
      const template = { handle: "my_reconciliation", name_nl: "something" };
      expect(templateUtils.getTemplateName(template, "reconciliationText")).toBe("my_reconciliation");
    });

    it("should return name_nl for accountTemplate", () => {
      const template = { handle: "something", name_nl: "my_account" };
      expect(templateUtils.getTemplateName(template, "accountTemplate")).toBe("my_account");
    });

    it("should return name_nl for exportFile", () => {
      const template = { name_nl: "my_export", name: "other" };
      expect(templateUtils.getTemplateName(template, "exportFile")).toBe("my_export");
    });

    it("should return name for sharedPart", () => {
      const template = { name: "my_shared_part", name_nl: "other" };
      expect(templateUtils.getTemplateName(template, "sharedPart")).toBe("my_shared_part");
    });
  });

  // ─── checkValidName ───────────────────────────────────────────────────────

  describe("checkValidName", () => {
    const consola = require("consola");

    it("should return true for valid alphanumeric handle (reconciliationText)", () => {
      const result = templateUtils.checkValidName("valid_handle_123", "reconciliationText");
      expect(result).toBe(true);
      expect(consola.warn).not.toHaveBeenCalled();
    });

    it("should return false for handle with spaces (reconciliationText)", () => {
      const result = templateUtils.checkValidName("invalid handle", "reconciliationText");
      expect(result).toBe(false);
      expect(consola.warn).toHaveBeenCalled();
    });

    it("should return false for handle with forward slash (accountTemplate)", () => {
      const result = templateUtils.checkValidName("invalid/name", "accountTemplate");
      expect(result).toBe(false);
      expect(consola.warn).toHaveBeenCalled();
    });

    it("should return false for handle with backslash (accountTemplate)", () => {
      const result = templateUtils.checkValidName("invalid\\name", "accountTemplate");
      expect(result).toBe(false);
      expect(consola.warn).toHaveBeenCalled();
    });

    it("should return true for valid name with spaces for accountTemplate (no slash)", () => {
      const result = templateUtils.checkValidName("Valid Name With Spaces", "accountTemplate");
      expect(result).toBe(true);
      expect(consola.warn).not.toHaveBeenCalled();
    });

    it("should return false for handle with forward slash (exportFile)", () => {
      const result = templateUtils.checkValidName("some/path", "exportFile");
      expect(result).toBe(false);
      expect(consola.warn).toHaveBeenCalled();
    });

    it("should return true for empty string (reconciliationText)", () => {
      const result = templateUtils.checkValidName("", "reconciliationText");
      // Empty string passes /^[a-zA-Z0-9_]*$/ (matches empty string)
      expect(result).toBe(true);
    });

    it("should return false for string with unicode characters (reconciliationText)", () => {
      const result = templateUtils.checkValidName("tëst_handle", "reconciliationText");
      expect(result).toBe(false);
      expect(consola.warn).toHaveBeenCalled();
    });

    it("should return true for valid alphanumeric sharedPart name", () => {
      const result = templateUtils.checkValidName("shared_part_abc", "sharedPart");
      expect(result).toBe(true);
    });
  });

  // ─── filterParts ─────────────────────────────────────────────────────────

  describe("filterParts", () => {
    it("should reduce text_parts array to {name: content} object with 2 parts", () => {
      const template = {
        text_parts: [
          { name: "part_1", content: "Content 1" },
          { name: "part_2", content: "Content 2" },
        ],
      };
      const result = templateUtils.filterParts(template);
      expect(result).toEqual({ part_1: "Content 1", part_2: "Content 2" });
    });

    it("should return empty object for empty array", () => {
      const template = { text_parts: [] };
      const result = templateUtils.filterParts(template);
      expect(result).toEqual({});
    });

    it("should include part with empty name as key", () => {
      const template = {
        text_parts: [
          { name: "part_1", content: "Content 1" },
          { name: "", content: "" },
        ],
      };
      const result = templateUtils.filterParts(template);
      expect(result).toEqual({ part_1: "Content 1", "": "" });
    });
  });

  // ─── missingLiquidCode ────────────────────────────────────────────────────

  describe("missingLiquidCode", () => {
    const consola = require("consola");

    it("should return false when template has text", () => {
      const template = { text: "Some liquid code", handle: "test_handle" };
      const result = templateUtils.missingLiquidCode(template);
      expect(result).toBe(false);
      expect(consola.warn).not.toHaveBeenCalled();
    });

    it("should return true and warn when template has no text", () => {
      const template = { text: null, handle: "test_handle" };
      const result = templateUtils.missingLiquidCode(template);
      expect(result).toBe(true);
      expect(consola.warn).toHaveBeenCalled();
    });

    it("should return true and warn when template text is empty string", () => {
      const template = { text: "", handle: "test_handle" };
      const result = templateUtils.missingLiquidCode(template);
      expect(result).toBe(true);
      expect(consola.warn).toHaveBeenCalled();
    });

    it("should return true and not throw for null template", () => {
      const result = templateUtils.missingLiquidCode(null);
      expect(result).toBe(true);
      expect(consola.warn).toHaveBeenCalled();
    });
  });

  // ─── missingNameNL ────────────────────────────────────────────────────────

  describe("missingNameNL", () => {
    const consola = require("consola");

    it("should return false when template has name_nl", () => {
      const template = { name_nl: "Valid NL Name" };
      const result = templateUtils.missingNameNL(template);
      expect(result).toBe(false);
      expect(consola.warn).not.toHaveBeenCalled();
    });

    it("should return true and warn when name_nl is missing but name_en is present", () => {
      const template = { name_en: "English Name", name_nl: null };
      const result = templateUtils.missingNameNL(template);
      expect(result).toBe(true);
      expect(consola.warn).toHaveBeenCalled();
    });

    it("should return true and warn when all names are missing", () => {
      const template = { name_en: "", name_nl: "" };
      const result = templateUtils.missingNameNL(template);
      expect(result).toBe(true);
      expect(consola.warn).toHaveBeenCalled();
    });

    it("should return true and warn when template is empty object", () => {
      const result = templateUtils.missingNameNL({});
      expect(result).toBe(true);
      expect(consola.warn).toHaveBeenCalled();
    });
  });
});
