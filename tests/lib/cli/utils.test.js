jest.mock("consola");
jest.mock("../../../lib/api/firmCredentials", () => ({
  firmCredentials: {
    getDefaultFirmId: jest.fn(),
    getHost: jest.fn(),
    SF_DEFAULT_HOST: "https://live.getsilverfin.com",
  },
}));
jest.mock("../../../lib/utils/errorUtils", () => ({
  uncaughtErrors: jest.fn(),
  missingHandle: jest.fn(),
  invalidHandleFormat: jest.fn(),
  invalidNumericId: jest.fn(),
  invalidDateFormat: jest.fn(),
  impossibleDate: jest.fn(),
}));
// Mock prompt-sync so no interactive prompts run in tests
jest.mock("prompt-sync", () => () => jest.fn());

const { consola } = require("consola");
const { firmCredentials } = require("../../../lib/api/firmCredentials");
const errorUtils = require("../../../lib/utils/errorUtils");
const cliUtils = require("../../../lib/cli/utils");

describe("cli/utils", () => {
  let mockExit;

  beforeEach(() => {
    jest.clearAllMocks();
    mockExit = jest.spyOn(process, "exit").mockImplementation(() => {});
  });

  afterEach(() => {
    mockExit.mockRestore();
  });

  // ─── loadDefaultFirmId ─────────────────────────────────────────────────────

  describe("loadDefaultFirmId", () => {
    afterEach(() => {
      delete process.env.SF_FIRM_ID;
    });

    it("should return firmId from firmCredentials config when available", () => {
      firmCredentials.getDefaultFirmId.mockReturnValue("1001");
      const result = cliUtils.loadDefaultFirmId();
      expect(result).toBe("1001");
    });

    it("should fall back to SF_FIRM_ID env var when no stored config", () => {
      firmCredentials.getDefaultFirmId.mockReturnValue(undefined);
      process.env.SF_FIRM_ID = "2002";
      const result = cliUtils.loadDefaultFirmId();
      expect(result).toBe("2002");
    });

    it("should return undefined when neither config nor env var is set", () => {
      firmCredentials.getDefaultFirmId.mockReturnValue(undefined);
      delete process.env.SF_FIRM_ID;
      const result = cliUtils.loadDefaultFirmId();
      expect(result).toBeUndefined();
    });

    it("should prefer stored config over env var", () => {
      firmCredentials.getDefaultFirmId.mockReturnValue("1001");
      process.env.SF_FIRM_ID = "9999";
      const result = cliUtils.loadDefaultFirmId();
      expect(result).toBe("1001");
    });
  });

  // ─── checkDefaultFirm ──────────────────────────────────────────────────────

  describe("checkDefaultFirm", () => {
    it("should log info when firmUsed matches firmIdDefault", () => {
      cliUtils.checkDefaultFirm("1001", "1001");
      expect(consola.info).toHaveBeenCalledWith(expect.stringContaining("1001"));
    });

    it("should NOT log when firmUsed does not match firmIdDefault", () => {
      cliUtils.checkDefaultFirm("1001", "2002");
      expect(consola.info).not.toHaveBeenCalled();
    });
  });

  // ─── formatOption ──────────────────────────────────────────────────────────

  describe("formatOption", () => {
    it("should convert camelCase to kebab-case with leading dash on uppercase", () => {
      expect(cliUtils.formatOption("listAll")).toBe("list-all");
    });

    it("should handle single word with no uppercase", () => {
      expect(cliUtils.formatOption("firm")).toBe("firm");
    });

    it("should convert multiple uppercase letters", () => {
      expect(cliUtils.formatOption("importReconciliationText")).toBe("import-reconciliation-text");
    });
  });

  // ─── checkDateFormat ───────────────────────────────────────────────────────

  describe("checkDateFormat", () => {
    it("should return true for a valid YYYY-MM-DD date", () => {
      const result = cliUtils.checkDateFormat("2024-01-31");
      expect(result).toBe(true);
      expect(mockExit).not.toHaveBeenCalled();
    });

    it("should accept a leap day in a leap year", () => {
      const result = cliUtils.checkDateFormat("2024-02-29");
      expect(result).toBe(true);
      expect(mockExit).not.toHaveBeenCalled();
    });

    it("should call process.exit(1) for a date in the wrong format", () => {
      cliUtils.checkDateFormat("31-01-2024");
      expect(errorUtils.invalidDateFormat).toHaveBeenCalledWith("31-01-2024");
      expect(mockExit).toHaveBeenCalledWith(1);
    });

    it("should call process.exit(1) for a non-date string", () => {
      cliUtils.checkDateFormat("not-a-date");
      expect(errorUtils.invalidDateFormat).toHaveBeenCalledWith("not-a-date");
      expect(mockExit).toHaveBeenCalledWith(1);
    });

    it("should call process.exit(1) for an empty string", () => {
      cliUtils.checkDateFormat("");
      expect(mockExit).toHaveBeenCalledWith(1);
    });

    it("should call process.exit(1) when the value is not a string", () => {
      cliUtils.checkDateFormat(undefined);
      expect(mockExit).toHaveBeenCalledWith(1);
    });

    it("should reject a correctly formatted but impossible calendar date", () => {
      cliUtils.checkDateFormat("2024-02-31");
      expect(errorUtils.impossibleDate).toHaveBeenCalledWith("2024-02-31");
      expect(mockExit).toHaveBeenCalledWith(1);
    });

    it("should reject a leap day outside a leap year", () => {
      cliUtils.checkDateFormat("2023-02-29");
      expect(errorUtils.impossibleDate).toHaveBeenCalledWith("2023-02-29");
      expect(mockExit).toHaveBeenCalledWith(1);
    });

    it("should reject a month outside the valid range", () => {
      cliUtils.checkDateFormat("2024-13-01");
      expect(mockExit).toHaveBeenCalledWith(1);
    });

    it("should reject input containing shell metacharacters", () => {
      cliUtils.checkDateFormat('2024-01-01"; rm -rf /; echo "');
      expect(errorUtils.invalidDateFormat).toHaveBeenCalledWith('2024-01-01"; rm -rf /; echo "');
      expect(mockExit).toHaveBeenCalledWith(1);
    });
  });

  // ─── checkNumericIdFormat ──────────────────────────────────────────────────

  describe("checkNumericIdFormat", () => {
    it("should return true for an id given as a string", () => {
      const result = cliUtils.checkNumericIdFormat("13827", "firm id");
      expect(result).toBe(true);
      expect(mockExit).not.toHaveBeenCalled();
      expect(errorUtils.invalidNumericId).not.toHaveBeenCalled();
    });

    it("should return true for an id given as a number", () => {
      const result = cliUtils.checkNumericIdFormat(13827, "firm id");
      expect(result).toBe(true);
      expect(mockExit).not.toHaveBeenCalled();
    });

    // Whether an id is required is decided by checkRequiredFirmOrPartner, so a value which was
    // never given must pass through here rather than being reported as badly formatted
    it.each([undefined, null])("should return true without exiting when the id is %p", (absentId) => {
      const result = cliUtils.checkNumericIdFormat(absentId, "firm id");
      expect(result).toBe(true);
      expect(mockExit).not.toHaveBeenCalled();
      expect(errorUtils.invalidNumericId).not.toHaveBeenCalled();
    });

    it.each(["abc", "", "   ", "12a", "12.0", "1e3", "-1", "+1", "0", "007", " 12 ", "1,2", "$FIRM"])(
      "should call process.exit(1) for the id %p",
      (invalidId) => {
        cliUtils.checkNumericIdFormat(invalidId, "firm id");
        expect(errorUtils.invalidNumericId).toHaveBeenCalledWith(invalidId, "firm id");
        expect(mockExit).toHaveBeenCalledWith(1);
      }
    );

    it("should pass the label on to the error message", () => {
      cliUtils.checkNumericIdFormat("abc", "partner id");
      expect(errorUtils.invalidNumericId).toHaveBeenCalledWith("abc", "partner id");
    });
  });

  // ─── runCommandChecks ──────────────────────────────────────────────────────

  // The single place ~20 commands funnel through, so the id checks being wired in here is
  // what stops a typo reaching the API for all of them at once
  describe("runCommandChecks", () => {
    it("should stop the command when the firm id is not a number", () => {
      cliUtils.runCommandChecks(["handle"], { firm: "my-firm", handle: "template_1", yes: true }, "13827");
      expect(errorUtils.invalidNumericId).toHaveBeenCalledWith("my-firm", "firm id");
      expect(mockExit).toHaveBeenCalledWith(1);
    });

    it("should stop the command when the partner id is not a number", () => {
      cliUtils.runCommandChecks(["handle"], { partner: "my-partner", handle: "template_1", yes: true }, undefined);
      expect(errorUtils.invalidNumericId).toHaveBeenCalledWith("my-partner", "partner id");
      expect(mockExit).toHaveBeenCalledWith(1);
    });

    it("should let a numeric firm id through and return the command settings", () => {
      const settings = cliUtils.runCommandChecks(["handle"], { firm: "13827", handle: "template_1", yes: true }, "13827");
      expect(errorUtils.invalidNumericId).not.toHaveBeenCalled();
      expect(mockExit).not.toHaveBeenCalled();
      expect(settings).toEqual({ type: "firm", envId: "13827" });
    });

    it("should let a numeric partner id through and return the command settings", () => {
      const settings = cliUtils.runCommandChecks(["handle"], { partner: "500", handle: "template_1", yes: true }, undefined);
      expect(errorUtils.invalidNumericId).not.toHaveBeenCalled();
      expect(mockExit).not.toHaveBeenCalled();
      expect(settings).toEqual({ type: "partner", envId: "500" });
    });
  });

  // ─── checkHandleFormat ─────────────────────────────────────────────────────

  describe("checkHandleFormat", () => {
    it("should return true for a handle which names a file", () => {
      const result = cliUtils.checkHandleFormat("workflow_1", "workflow handle");
      expect(result).toBe(true);
      expect(mockExit).not.toHaveBeenCalled();
    });

    it.each(["../escape", "../../etc/passwd", "sub/handle", "sub\\handle", "..", ".", ".hidden", "/absolute"])(
      "should call process.exit(1) for the handle %p",
      (unsafeHandle) => {
        cliUtils.checkHandleFormat(unsafeHandle, "workflow handle");
        expect(errorUtils.invalidHandleFormat).toHaveBeenCalledWith(unsafeHandle, "workflow handle", undefined);
        expect(mockExit).toHaveBeenCalledWith(1);
      }
    );

    // A blank handle is reported as missing rather than as malformed, since it usually
    // means an unset variable was passed on rather than a badly chosen name
    it.each(["", "   "])("should report a blank handle %p as missing", (blankHandle) => {
      cliUtils.checkHandleFormat(blankHandle, "workflow handle");
      expect(errorUtils.missingHandle).toHaveBeenCalledWith("workflow handle", undefined);
      expect(errorUtils.invalidHandleFormat).not.toHaveBeenCalled();
      expect(mockExit).toHaveBeenCalledWith(1);
    });

    it("should report a missing handle as missing", () => {
      cliUtils.checkHandleFormat(undefined, "workflow handle");
      expect(errorUtils.missingHandle).toHaveBeenCalledWith("workflow handle", undefined);
      expect(mockExit).toHaveBeenCalledWith(1);
    });

    it("should pass the suggested command on to the error message", () => {
      cliUtils.checkHandleFormat("../escape", "workflow handle", "silverfin stats --since 2024-01-31 --workflow");
      expect(errorUtils.invalidHandleFormat).toHaveBeenCalledWith("../escape", "workflow handle", "silverfin stats --since 2024-01-31 --workflow");
    });

    it("should pass the suggested command on when the handle is missing", () => {
      cliUtils.checkHandleFormat("", "workflow handle", "silverfin stats --since 2024-01-31 --workflow");
      expect(errorUtils.missingHandle).toHaveBeenCalledWith("workflow handle", "silverfin stats --since 2024-01-31 --workflow");
    });
  });

  // ─── checkUniqueOption ─────────────────────────────────────────────────────

  describe("checkUniqueOption", () => {
    it("should return true when exactly one unique option is used", () => {
      const result = cliUtils.checkUniqueOption(["firm", "partner"], { firm: "1001" });
      expect(result).toBe(true);
      expect(mockExit).not.toHaveBeenCalled();
    });

    it("should call process.exit(1) when none of the unique options are used", () => {
      cliUtils.checkUniqueOption(["firm", "partner"], { other: "value" });
      expect(consola.error).toHaveBeenCalledWith(expect.stringContaining("One of the following options"));
      expect(mockExit).toHaveBeenCalledWith(1);
    });

    it("should call process.exit(1) when more than one unique option is used", () => {
      cliUtils.checkUniqueOption(["firm", "partner"], { firm: "1001", partner: "25" });
      expect(consola.error).toHaveBeenCalledWith(expect.stringContaining("incompatible options"));
      expect(mockExit).toHaveBeenCalledWith(1);
    });

    it("should format option names as kebab-case in error message", () => {
      cliUtils.checkUniqueOption(["listAll", "byHandle"], {});
      expect(consola.error).toHaveBeenCalledWith(expect.stringContaining("list-all"));
    });
  });

  // ─── checkRequiredFirmOrPartner ────────────────────────────────────────────

  describe("checkRequiredFirmOrPartner", () => {
    it("should return true when a required option with firm is used", () => {
      const result = cliUtils.checkRequiredFirmOrPartner({ firm: "1001", handle: "test" }, ["handle"]);
      expect(result).toBe(true);
      expect(mockExit).not.toHaveBeenCalled();
    });

    it("should call process.exit(1) when required option is used but neither firm nor partner is set", () => {
      cliUtils.checkRequiredFirmOrPartner({ handle: "test" }, ["handle"]);
      expect(consola.error).toHaveBeenCalledWith(expect.stringContaining("firm"));
      expect(mockExit).toHaveBeenCalledWith(1);
    });

    it("should return true when no required options are used (not triggered)", () => {
      const result = cliUtils.checkRequiredFirmOrPartner({ other: "val" }, ["handle", "id"]);
      expect(result).toBe(true);
      expect(mockExit).not.toHaveBeenCalled();
    });

    it("should return true when partner is set and partner is supported", () => {
      const result = cliUtils.checkRequiredFirmOrPartner({ partner: "25", handle: "test" }, ["handle"]);
      expect(result).toBe(true);
    });
  });

  // ─── getCommandSettings ────────────────────────────────────────────────────

  describe("getCommandSettings", () => {
    it("should return firm type and firm envId when partner is not set", () => {
      const settings = cliUtils.getCommandSettings({ firm: "1001" });
      expect(settings).toEqual({ type: "firm", envId: "1001" });
    });

    it("should return partner type and partner envId when partner is set", () => {
      const settings = cliUtils.getCommandSettings({ partner: "25" });
      expect(settings).toEqual({ type: "partner", envId: "25" });
    });
  });

  // ─── checkPartnerSupport ───────────────────────────────────────────────────

  describe("checkPartnerSupport", () => {
    it("should call process.exit(1) when both partner and all are set", () => {
      cliUtils.checkPartnerSupport({ partner: "25", all: true });
      expect(consola.error).toHaveBeenCalledWith(expect.stringContaining("Not possible to update all"));
      expect(mockExit).toHaveBeenCalledWith(1);
    });

    it("should not call process.exit when only partner is set (without all)", () => {
      cliUtils.checkPartnerSupport({ partner: "25" });
      expect(mockExit).not.toHaveBeenCalled();
    });

    it("should not call process.exit when only all is set (without partner)", () => {
      cliUtils.checkPartnerSupport({ all: true });
      expect(mockExit).not.toHaveBeenCalled();
    });
  });

  // ─── logCurrentHost ────────────────────────────────────────────────────────

  describe("logCurrentHost", () => {
    it("should NOT log when current host is the default host", () => {
      firmCredentials.getHost.mockReturnValue("https://live.getsilverfin.com");
      cliUtils.logCurrentHost();
      expect(consola.info).not.toHaveBeenCalled();
    });

    it("should log info with host details when host differs from default", () => {
      firmCredentials.getHost.mockReturnValue("https://staging.getsilverfin.com");
      cliUtils.logCurrentHost();
      expect(consola.info).toHaveBeenCalledWith(expect.stringContaining("staging.getsilverfin.com"));
    });
  });
});
