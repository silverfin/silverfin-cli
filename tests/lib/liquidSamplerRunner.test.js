jest.mock("consola");
jest.mock("../../lib/api/sfApi");
jest.mock("axios");
jest.mock("../../lib/cli/spinner", () => ({ spinner: { spin: jest.fn(), stop: jest.fn() } }));
jest.mock("../../lib/utils/errorUtils", () => ({
  errorHandler: jest.fn(),
}));

const mockOpenFile = jest.fn();
jest.mock("../../lib/utils/urlHandler", () => ({
  UrlHandler: jest.fn().mockImplementation(() => ({ openFile: mockOpenFile })),
}));

const os = require("os");
const fs = require("fs");
const path = require("path");
const AdmZip = require("adm-zip");
const axios = require("axios");
const SF = require("../../lib/api/sfApi");
const { consola } = require("consola");
const { UrlHandler } = require("../../lib/utils/urlHandler");
const { LiquidSamplerRunner } = require("../../lib/liquidSamplerRunner");

const REPORT_URL = "https://reports.example.com/sampler/abc123.html";

// Build an in-memory results.zip from the committed fixture so the compact path
// can be exercised end-to-end without hitting the backend or shipping a 150 MB zip.
function fixtureZipBuffer() {
  const zip = new AdmZip();
  const fixtureDir = path.join(__dirname, "..", "fixtures", "sampler-results");
  zip.addLocalFile(path.join(fixtureDir, "sample_entry_ids.yml"));
  zip.addLocalFolder(path.join(fixtureDir, "output"), "output");
  return zip.toBuffer();
}

describe("LiquidSamplerRunner - surfacing results", () => {
  const originalCI = process.env.CI;
  let originalExit;

  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.CI;
    SF.readSamplerRun.mockResolvedValue({
      data: { status: "completed", result_url: REPORT_URL },
    });
    originalExit = process.exit;
    process.exit = jest.fn();
  });

  afterEach(() => {
    if (originalCI === undefined) delete process.env.CI;
    else process.env.CI = originalCI;
    process.exit = originalExit;
  });

  it("always logs the report URL on completion", async () => {
    await new LiquidSamplerRunner("1").checkStatus("run-1");

    expect(consola.success).toHaveBeenCalledWith(`Sampler report: ${REPORT_URL}`);
  });

  it("opens the report locally by default (not CI)", async () => {
    await new LiquidSamplerRunner("1").checkStatus("run-1");

    expect(UrlHandler).toHaveBeenCalledWith(REPORT_URL);
    expect(mockOpenFile).toHaveBeenCalledTimes(1);
  });

  it("does NOT open the report when running in CI", async () => {
    process.env.CI = "true";

    await new LiquidSamplerRunner("1").checkStatus("run-1");

    // URL still logged, but nothing is downloaded/opened
    expect(consola.success).toHaveBeenCalledWith(`Sampler report: ${REPORT_URL}`);
    expect(mockOpenFile).not.toHaveBeenCalled();
  });

  it("does NOT open the report when openReport is false (--no-open)", async () => {
    await new LiquidSamplerRunner("1", { openReport: false }).checkStatus("run-1");

    expect(consola.success).toHaveBeenCalledWith(`Sampler report: ${REPORT_URL}`);
    expect(mockOpenFile).not.toHaveBeenCalled();
  });

  it("still opens when explicitly requested even outside CI", async () => {
    await new LiquidSamplerRunner("1", { openReport: true }).checkStatus("run-1");

    expect(mockOpenFile).toHaveBeenCalledTimes(1);
  });

  it("errors and exits non-zero when completed with no result_url", async () => {
    SF.readSamplerRun.mockResolvedValue({ data: { status: "completed" } });

    await new LiquidSamplerRunner("1").checkStatus("run-1");

    expect(consola.error).toHaveBeenCalledWith(expect.stringContaining("no result URL"));
    expect(process.exit).toHaveBeenCalledWith(1);
    expect(mockOpenFile).not.toHaveBeenCalled();
  });
});

describe("LiquidSamplerRunner - compact diff", () => {
  let logSpy;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.CI = "true"; // compact must work in CI
    SF.readSamplerRun.mockResolvedValue({
      data: { status: "completed", result_url: REPORT_URL },
    });
    axios.get.mockResolvedValue({ data: fixtureZipBuffer() });
    logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
    delete process.env.CI;
  });

  it("downloads the result and prints the compact diff between markers when compact is set", async () => {
    await new LiquidSamplerRunner("1", { compact: true }).checkStatus("run-1");

    expect(axios.get).toHaveBeenCalledWith(REPORT_URL, { responseType: "arraybuffer" });
    const output = logSpy.mock.calls.map((c) => c[0]).join("\n");
    expect(output).toContain("<!-- SAMPLER_COMPACT_START -->");
    expect(output).toContain("<!-- SAMPLER_COMPACT_END -->");
    expect(output).toContain("### vkt_1");
    expect(output).toContain("[2×] `street_var`: `\"\"` → `null`");
  });

  it("does NOT download or print a compact diff by default", async () => {
    await new LiquidSamplerRunner("1", { openReport: false }).checkStatus("run-1");

    expect(axios.get).not.toHaveBeenCalled();
    const output = logSpy.mock.calls.map((c) => c[0]).join("\n");
    expect(output).not.toContain("SAMPLER_COMPACT_START");
  });

  it("does not fail the run if the compact download fails", async () => {
    axios.get.mockRejectedValue(new Error("network down"));

    await new LiquidSamplerRunner("1", { compact: true }).checkStatus("run-1");

    // URL still surfaced, warning logged, no throw
    expect(consola.success).toHaveBeenCalledWith(`Sampler report: ${REPORT_URL}`);
    expect(consola.warn).toHaveBeenCalledWith(expect.stringContaining("Could not build compact diff"));
  });

  it("never writes outside the temp dir for a zip-slip entry name", async () => {
    const zip = new AdmZip();
    zip.addFile("sample_entry_ids.yml", Buffer.from(""));
    // AdmZip normalizes "../" out of entryName on add, so smuggle a raw
    // traversal name straight into the entry to simulate a maliciously
    // crafted archive that tries to escape the extraction temp dir into a
    // sibling directory under the OS temp root (still writable, unlike
    // escaping all the way to "/").
    const evilEntry = zip.addFile("registers.json", Buffer.from("{}"));
    evilEntry.entryName = "../evil-zip-slip/registers.json";
    axios.get.mockResolvedValue({ data: zip.toBuffer() });

    const escapedDir = path.join(os.tmpdir(), "evil-zip-slip");
    try {
      await new LiquidSamplerRunner("1", { compact: true }).checkStatus("run-1");

      expect(fs.existsSync(escapedDir)).toBe(false);
    } finally {
      fs.rmSync(escapedDir, { recursive: true, force: true });
    }
  });
});
