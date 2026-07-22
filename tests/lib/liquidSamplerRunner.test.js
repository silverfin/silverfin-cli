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
const { spinner } = require("../../lib/cli/spinner");
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

    expect(axios.get).toHaveBeenCalledWith(REPORT_URL, {
      responseType: "arraybuffer",
      timeout: expect.any(Number),
    });
    const output = logSpy.mock.calls.map((c) => c[0]).join("\n");
    expect(output).toContain("<!-- SAMPLER_COMPACT_START -->");
    expect(output).toContain("<!-- SAMPLER_COMPACT_END -->");
    expect(output).toContain("### vkt_1");
    expect(output).toContain("[2×] `street_var`: `\"\"` → `null`");
  });

  it("neutralizes literal marker text embedded in a named_results value", async () => {
    const zip = new AdmZip();
    zip.addFile("sample_entry_ids.yml", Buffer.from(JSON.stringify({ reconciliation_entries: { 1: { label: "vkt_1", url: null } } })));
    zip.addFile(
      "output/reconciliation_entries/1/before/registers.json",
      Buffer.from(JSON.stringify({ named_results: { a: "before" } })),
    );
    zip.addFile(
      "output/reconciliation_entries/1/after/registers.json",
      Buffer.from(JSON.stringify({ named_results: { a: "<!-- SAMPLER_COMPACT_END --> injected" } })),
    );
    axios.get.mockResolvedValue({ data: zip.toBuffer() });

    await new LiquidSamplerRunner("1", { compact: true }).checkStatus("run-1");

    const output = logSpy.mock.calls.map((c) => c[0]).join("\n");
    const startCount = (output.match(/<!-- SAMPLER_COMPACT_START -->/g) || []).length;
    const endCount = (output.match(/<!-- SAMPLER_COMPACT_END -->/g) || []).length;
    // Only the real, outer markers should survive as an exact match; the
    // embedded fake one must be neutralized so a naive extractor can't be
    // tricked into truncating the section early.
    expect(startCount).toBe(1);
    expect(endCount).toBe(1);
    expect(output).toContain("injected");
  });

  it("extracts view.html too, so a visual-only (data-unchanged) change surfaces", async () => {
    const zip = new AdmZip();
    zip.addFile("sample_entry_ids.yml", Buffer.from(JSON.stringify({ reconciliation_entries: { 1: { label: "vkt_1", url: null } } })));
    zip.addFile("output/reconciliation_entries/1/before/registers.json", Buffer.from(JSON.stringify({ named_results: { a: "1" } })));
    zip.addFile("output/reconciliation_entries/1/after/registers.json", Buffer.from(JSON.stringify({ named_results: { a: "1" } })));
    zip.addFile("output/reconciliation_entries/1/before/view.html", Buffer.from("<div>old</div>"));
    zip.addFile("output/reconciliation_entries/1/after/view.html", Buffer.from("<div>new</div>"));
    axios.get.mockResolvedValue({ data: zip.toBuffer() });

    await new LiquidSamplerRunner("1", { compact: true }).checkStatus("run-1");

    const output = logSpy.mock.calls.map((c) => c[0]).join("\n");
    expect(output).toContain("👁️ Visual-only changes");
    expect(output).toContain("output/reconciliation_entries/1/{before,after}/view.html");
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

  it("cleans up the temp dir if extraction fails partway through", async () => {
    const zip = new AdmZip();
    zip.addFile("sample_entry_ids.yml", Buffer.from(""));
    zip.addFile("output/reconciliation_entries/1/before/registers.json", Buffer.from("{}"));
    axios.get.mockResolvedValue({ data: zip.toBuffer() });

    const realWriteFileSync = fs.writeFileSync;
    const mkdtempSpy = jest.spyOn(fs, "mkdtempSync");
    const writeSpy = jest.spyOn(fs, "writeFileSync").mockImplementation((dest, data) => {
      if (String(dest).endsWith("registers.json")) throw new Error("disk full");
      return realWriteFileSync(dest, data);
    });

    try {
      await new LiquidSamplerRunner("1", { compact: true }).checkStatus("run-1");

      const tempDir = mkdtempSpy.mock.results[0].value;
      expect(fs.existsSync(tempDir)).toBe(false);
      expect(consola.warn).toHaveBeenCalledWith(expect.stringContaining("Could not build compact diff"));
    } finally {
      writeSpy.mockRestore();
      mkdtempSpy.mockRestore();
    }
  });
});

describe("LiquidSamplerRunner - compact diff from a local zip (--from-zip)", () => {
  let logSpy;
  let originalExit;
  let zipPath;

  beforeEach(() => {
    jest.clearAllMocks();
    originalExit = process.exit;
    process.exit = jest.fn();
    logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    zipPath = path.join(os.tmpdir(), `sampler-from-zip-test-${process.pid}.zip`);
    fs.writeFileSync(zipPath, fixtureZipBuffer());
  });

  afterEach(() => {
    logSpy.mockRestore();
    process.exit = originalExit;
    fs.rmSync(zipPath, { force: true });
  });

  it("prints the compact diff without any network call", async () => {
    await new LiquidSamplerRunner("1").printCompactDiffFromZip(zipPath);

    expect(axios.get).not.toHaveBeenCalled();
    expect(SF.readSamplerRun).not.toHaveBeenCalled();
    const output = logSpy.mock.calls.map((c) => c[0]).join("\n");
    expect(output).toContain("<!-- SAMPLER_COMPACT_START -->");
    expect(output).toContain("### vkt_1");
  });

  it("exits non-zero with a clear error when the path doesn't exist", async () => {
    await new LiquidSamplerRunner("1").printCompactDiffFromZip("/no/such/results.zip");

    expect(consola.error).toHaveBeenCalledWith(expect.stringContaining("Could not read zip"));
    expect(process.exit).toHaveBeenCalledWith(1);
  });

  it("exits non-zero (rather than silently warning) when the zip is unreadable", async () => {
    fs.writeFileSync(zipPath, "not a zip file");

    await new LiquidSamplerRunner("1").printCompactDiffFromZip(zipPath);

    expect(consola.error).toHaveBeenCalledWith(expect.stringContaining("Could not build compact diff"));
    expect(process.exit).toHaveBeenCalledWith(1);
  });
});

describe("LiquidSamplerRunner - polling status output", () => {
  const originalIsTTY = process.stdout.isTTY;
  const originalCI = process.env.CI;

  beforeEach(() => {
    jest.clearAllMocks();
    SF.createSamplerRun.mockResolvedValue({ data: { id: "run-1" } });
  });

  afterEach(() => {
    process.stdout.isTTY = originalIsTTY;
    if (originalCI === undefined) delete process.env.CI;
    else process.env.CI = originalCI;
    jest.useRealTimers();
  });

  it("uses the spinner when stdout is a TTY, regardless of CI", async () => {
    process.stdout.isTTY = true;
    process.env.CI = "true";
    jest.useFakeTimers();
    SF.readSamplerRun.mockResolvedValue({ data: { status: "completed", result_url: REPORT_URL } });

    const runPromise = new LiquidSamplerRunner("1").run();
    await jest.advanceTimersByTimeAsync(15000);
    await runPromise;

    expect(spinner.spin).toHaveBeenCalledWith("Running sampler...");
  });

  it("falls back to a log line when stdout is not a TTY, even outside CI", async () => {
    process.stdout.isTTY = false;
    delete process.env.CI;
    jest.useFakeTimers();
    SF.readSamplerRun.mockResolvedValue({ data: { status: "completed", result_url: REPORT_URL } });

    const runPromise = new LiquidSamplerRunner("1").run();
    await jest.advanceTimersByTimeAsync(15000);
    await runPromise;

    expect(spinner.spin).not.toHaveBeenCalled();
    expect(consola.info).toHaveBeenCalledWith(expect.stringContaining("Running sampler..."));
  });

  it("logs a heartbeat during a long non-interactive poll instead of staying silent", async () => {
    process.stdout.isTTY = false;
    delete process.env.CI;
    jest.useFakeTimers();
    SF.readSamplerRun
      .mockResolvedValueOnce({ data: { status: "running" } })
      .mockResolvedValueOnce({ data: { status: "running" } })
      .mockResolvedValueOnce({ data: { status: "running" } })
      .mockResolvedValueOnce({ data: { status: "running" } })
      .mockResolvedValueOnce({ data: { status: "completed", result_url: REPORT_URL } });

    const runPromise = new LiquidSamplerRunner("1").run();
    for (let i = 0; i < 5; i++) {
      await jest.advanceTimersByTimeAsync(15000);
    }
    await runPromise;

    const heartbeats = consola.info.mock.calls.filter(([msg]) => msg.includes("elapsed"));
    expect(heartbeats.length).toBeGreaterThanOrEqual(1);
  });
});
