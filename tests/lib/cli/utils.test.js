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
}));
// Mock prompt-sync so no interactive prompts run in tests
jest.mock("prompt-sync", () => () => jest.fn());

const fs = require("fs");
const os = require("os");
const path = require("path");
const { consola } = require("consola");
const { firmCredentials } = require("../../../lib/api/firmCredentials");
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

  describe("checkSamplerOptions", () => {
    let tempDir;

    beforeEach(() => {
      tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "sf-cli-sampler-"));
    });

    afterEach(() => {
      fs.rmSync(tempDir, { recursive: true, force: true });
    });

    const expectRejected = (options, message) => {
      cliUtils.checkSamplerOptions(options);
      expect(consola.error).toHaveBeenCalledTimes(1);
      expect(consola.error).toHaveBeenCalledWith(expect.stringContaining(message));
      expect(mockExit).toHaveBeenCalledWith(1);
    };

    it("should accept a plain run and fresh output paths", () => {
      expect(cliUtils.checkSamplerOptions({ partner: "1", handle: ["a"] })).toBe(true);
      const options = { fromZip: "r.zip", keepExtracted: path.join(tempDir, "kept"), extractFlaggedOnly: path.join(tempDir, "flagged"), json: path.join(tempDir, "d.json") };
      expect(cliUtils.checkSamplerOptions(options)).toBe(true);
      expect(mockExit).not.toHaveBeenCalled();
    });

    it("should reject --add-diffs-folder and --extract-flagged-only without --from-zip", () => {
      expectRejected({ addDiffsFolder: true }, "--add-diffs-folder requires --from-zip");
      jest.clearAllMocks();
      expectRejected({ extractFlaggedOnly: "out" }, "--extract-flagged-only requires --from-zip");
    });

    it("should reject --keep-extracted and --json without --compact or --from-zip", () => {
      expectRejected({ keepExtracted: "out" }, "--keep-extracted requires --compact or --from-zip");
      jest.clearAllMocks();
      expectRejected({ json: "d.json" }, "--json requires --compact or --from-zip");
    });

    it("should reject nested output directories", () => {
      expectRejected({ fromZip: "r.zip", keepExtracted: tempDir, extractFlaggedOnly: path.join(tempDir, "sub") }, "separate, non-nested directories");
    });

    it("should reject --json inside an output directory", () => {
      expectRejected({ compact: true, keepExtracted: tempDir, json: path.join(tempDir, "d.json") }, "--json must not point inside --keep-extracted");
    });

    it("should reject --json pointing at the --from-zip archive", () => {
      expectRejected({ fromZip: "r.zip", json: "./r.zip" }, "--json must not point at the --from-zip archive");
    });

    it("should reject --json pointing at a directory", () => {
      expectRejected({ compact: true, json: tempDir }, "is a directory");
    });

    it("should reject an output directory that already has files", () => {
      fs.writeFileSync(path.join(tempDir, "old.html"), "x");
      expectRejected({ compact: true, keepExtracted: tempDir }, "already exists and is not an empty directory");
    });

    it("should reject an output directory it cannot inspect", () => {
      fs.writeFileSync(path.join(tempDir, "results.zip"), "zip");
      expectRejected({ compact: true, keepExtracted: path.join(tempDir, "results.zip", "out") }, "--keep-extracted: cannot use");
    });
  });
});
