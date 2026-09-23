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
// Only the two lookups #resolveTemplateId makes are stubbed; the rest stays
// real because the template classes read fsUtils.FOLDERS at class-init time.
jest.mock("../../lib/utils/fsUtils", () => ({
  ...jest.requireActual("../../lib/utils/fsUtils"),
  configExists: jest.fn(() => true),
  readConfig: jest.fn(() => ({ partner_id: { 1: 4242 } })),
}));
jest.mock("../../lib/templates/reconciliationText", () => ({
  ReconciliationText: { read: jest.fn() },
}));
jest.mock("../../lib/templates/sharedPart", () => ({
  SharedPart: { read: jest.fn() },
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
const { ReconciliationText } = require("../../lib/templates/reconciliationText");
const { SharedPart } = require("../../lib/templates/sharedPart");
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

describe("LiquidSamplerRunner - add diffs folder to a local zip (--add-diffs-folder)", () => {
  let zipPath;
  let originalExit;

  beforeEach(() => {
    jest.clearAllMocks();
    originalExit = process.exit;
    process.exit = jest.fn();
    zipPath = path.join(os.tmpdir(), `sampler-diffs-test-${process.pid}.zip`);
  });

  afterEach(() => {
    process.exit = originalExit;
    fs.rmSync(zipPath, { force: true });
  });

  function writeZip(entries) {
    const zip = new AdmZip();
    zip.addFile(
      "sample_entry_ids.yml",
      Buffer.from(
        JSON.stringify({
          reconciliation_entries: {
            1: { label: "vkt_1", url: null },
            2: { label: "vkt_1", url: null },
          },
        }),
      ),
    );
    for (const [name, content] of entries) {
      zip.addFile(name, Buffer.from(content));
    }
    fs.writeFileSync(zipPath, zip.toBuffer());
  }

  it("adds view.html before/after only for entries the compact diff flagged, leaving the rest of the zip intact", () => {
    writeZip([
      ["output/reconciliation_entries/1/before/registers.json", JSON.stringify({ named_results: { a: "before" } })],
      ["output/reconciliation_entries/1/after/registers.json", JSON.stringify({ named_results: { a: "after" } })],
      ["output/reconciliation_entries/1/before/view.html", "<div>1 old</div>"],
      ["output/reconciliation_entries/1/after/view.html", "<div>1 new</div>"],
      ["output/reconciliation_entries/2/before/registers.json", JSON.stringify({ named_results: { a: "same" } })],
      ["output/reconciliation_entries/2/after/registers.json", JSON.stringify({ named_results: { a: "same" } })],
      ["output/reconciliation_entries/2/before/view.html", "<div>2 unchanged</div>"],
      ["output/reconciliation_entries/2/after/view.html", "<div>2 unchanged</div>"],
    ]);

    new LiquidSamplerRunner("1").addDiffsFolderToZip(zipPath);

    const zip = new AdmZip(fs.readFileSync(zipPath));
    const names = zip.getEntries().map((e) => e.entryName);
    expect(names).toContain("diffs/reconciliation_entries/1/before/view.html");
    expect(names).toContain("diffs/reconciliation_entries/1/after/view.html");
    expect(names).not.toContain("diffs/reconciliation_entries/2/before/view.html");
    expect(names).not.toContain("diffs/reconciliation_entries/2/after/view.html");
    expect(zip.getEntry("diffs/reconciliation_entries/1/after/view.html").getData().toString()).toBe("<div>1 new</div>");
    // The original entries stay intact - the zip is augmented, not replaced.
    expect(names).toContain("output/reconciliation_entries/1/after/registers.json");

    expect(consola.success).toHaveBeenCalledWith(expect.stringContaining("2 view.html file(s) across 1 entry"));
  });

  it("counts only entries that actually got a view.html, not every flagged entry", () => {
    writeZip([
      ["output/reconciliation_entries/1/before/registers.json", JSON.stringify({ named_results: { a: "before" } })],
      ["output/reconciliation_entries/1/after/registers.json", JSON.stringify({ named_results: { a: "after" } })],
      ["output/reconciliation_entries/1/before/view.html", "<div>1 old</div>"],
      ["output/reconciliation_entries/1/after/view.html", "<div>1 new</div>"],
      // Entry 2 also differs, but has no view.html - it must not inflate the entry count.
      ["output/reconciliation_entries/2/before/registers.json", JSON.stringify({ named_results: { a: "before" } })],
      ["output/reconciliation_entries/2/after/registers.json", JSON.stringify({ named_results: { a: "after" } })],
    ]);

    new LiquidSamplerRunner("1").addDiffsFolderToZip(zipPath);

    expect(consola.success).toHaveBeenCalledWith(expect.stringContaining("2 view.html file(s) across 1 entry"));
  });

  it("reports and leaves the zip untouched when no entries differ", () => {
    writeZip([
      ["output/reconciliation_entries/1/before/registers.json", JSON.stringify({ named_results: { a: "same" } })],
      ["output/reconciliation_entries/1/after/registers.json", JSON.stringify({ named_results: { a: "same" } })],
    ]);

    new LiquidSamplerRunner("1").addDiffsFolderToZip(zipPath);

    expect(consola.info).toHaveBeenCalledWith(expect.stringContaining("No differing entries"));
    const zip = new AdmZip(fs.readFileSync(zipPath));
    expect(zip.getEntries().some((e) => e.entryName.startsWith("diffs/"))).toBe(false);
  });

  it("skips flagged entries whose before/after renders are byte-identical", () => {
    writeZip([
      // Flagged on a named_results change the render doesn't show (e.g. a
      // timestamp-derived result): identical view.html, so a diffs/ pair for it
      // would give the reviewer two files with nothing to compare.
      ["output/reconciliation_entries/1/before/registers.json", JSON.stringify({ named_results: { a: "before" } })],
      ["output/reconciliation_entries/1/after/registers.json", JSON.stringify({ named_results: { a: "after" } })],
      ["output/reconciliation_entries/1/before/view.html", "<div>same render</div>"],
      ["output/reconciliation_entries/1/after/view.html", "<div>same render</div>"],
      // Flagged AND visibly different - this one belongs in diffs/.
      ["output/reconciliation_entries/2/before/registers.json", JSON.stringify({ named_results: { a: "before" } })],
      ["output/reconciliation_entries/2/after/registers.json", JSON.stringify({ named_results: { a: "after" } })],
      ["output/reconciliation_entries/2/before/view.html", "<div>2 old</div>"],
      ["output/reconciliation_entries/2/after/view.html", "<div>2 new</div>"],
    ]);

    new LiquidSamplerRunner("1").addDiffsFolderToZip(zipPath);

    const names = new AdmZip(fs.readFileSync(zipPath)).getEntries().map((e) => e.entryName);
    expect(names).not.toContain("diffs/reconciliation_entries/1/before/view.html");
    expect(names).not.toContain("diffs/reconciliation_entries/1/after/view.html");
    expect(names).toContain("diffs/reconciliation_entries/2/before/view.html");
    expect(names).toContain("diffs/reconciliation_entries/2/after/view.html");
    // The skip is reported, not silent.
    expect(consola.success).toHaveBeenCalledWith(expect.stringContaining("2 view.html file(s) across 1 entry"));
    expect(consola.success).toHaveBeenCalledWith(expect.stringContaining("1 flagged entry had identical before/after renders"));
  });

  it("reports and leaves the zip untouched when every flagged entry renders identically", () => {
    writeZip([
      ["output/reconciliation_entries/1/before/registers.json", JSON.stringify({ named_results: { a: "before" } })],
      ["output/reconciliation_entries/1/after/registers.json", JSON.stringify({ named_results: { a: "after" } })],
      ["output/reconciliation_entries/1/before/view.html", "<div>same</div>"],
      ["output/reconciliation_entries/1/after/view.html", "<div>same</div>"],
      ["output/reconciliation_entries/2/before/registers.json", JSON.stringify({ named_results: { b: "before" } })],
      ["output/reconciliation_entries/2/after/registers.json", JSON.stringify({ named_results: { b: "after" } })],
      ["output/reconciliation_entries/2/before/view.html", "<div>same too</div>"],
      ["output/reconciliation_entries/2/after/view.html", "<div>same too</div>"],
    ]);

    new LiquidSamplerRunner("1").addDiffsFolderToZip(zipPath);

    expect(consola.info).toHaveBeenCalledWith(expect.stringContaining("No visual differences among the flagged entries"));
    expect(consola.info).toHaveBeenCalledWith(expect.stringContaining("2 flagged entries had identical before/after renders"));
    expect(consola.success).not.toHaveBeenCalled();
    const zip = new AdmZip(fs.readFileSync(zipPath));
    expect(zip.getEntries().some((e) => e.entryName.startsWith("diffs/"))).toBe(false);
  });

  it("reports and leaves the zip untouched when entries differ but none have a view.html", () => {
    writeZip([
      ["output/reconciliation_entries/1/before/registers.json", JSON.stringify({ named_results: { a: "before" } })],
      ["output/reconciliation_entries/1/after/registers.json", JSON.stringify({ named_results: { a: "after" } })],
    ]);

    new LiquidSamplerRunner("1").addDiffsFolderToZip(zipPath);

    expect(consola.info).toHaveBeenCalledWith(expect.stringContaining("No view.html files found"));
    expect(consola.success).not.toHaveBeenCalled();
    const zip = new AdmZip(fs.readFileSync(zipPath));
    expect(zip.getEntries().some((e) => e.entryName.startsWith("diffs/"))).toBe(false);
  });

  it("exits non-zero with a clear error when the path doesn't exist", () => {
    new LiquidSamplerRunner("1").addDiffsFolderToZip("/no/such/results.zip");

    expect(consola.error).toHaveBeenCalledWith(expect.stringContaining("Could not read zip"));
    expect(process.exit).toHaveBeenCalledWith(1);
  });

  it("exits non-zero (rather than throwing) when the zip is unreadable", () => {
    fs.writeFileSync(zipPath, "not a zip file");

    new LiquidSamplerRunner("1").addDiffsFolderToZip(zipPath);

    expect(consola.error).toHaveBeenCalledWith(expect.stringContaining("Could not build diffs/ folder"));
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

describe("LiquidSamplerRunner - payload attributes", () => {
  const originalIsTTY = process.stdout.isTTY;
  let originalExit;

  beforeEach(() => {
    jest.clearAllMocks();
    process.stdout.isTTY = false;
    originalExit = process.exit;
    process.exit = jest.fn();
    SF.createSamplerRun.mockResolvedValue({ data: { id: "run-1" } });
    SF.readSamplerRun.mockResolvedValue({ data: { status: "completed", result_url: REPORT_URL } });
  });

  afterEach(() => {
    process.stdout.isTTY = originalIsTTY;
    process.exit = originalExit;
    jest.useRealTimers();
  });

  async function runTemplates(templateHandles) {
    jest.useFakeTimers();
    const runPromise = new LiquidSamplerRunner("1").run(templateHandles, [7]);
    await jest.advanceTimersByTimeAsync(15000);
    await runPromise;
    jest.useRealTimers();
    return SF.createSamplerRun.mock.calls[0][1].templates[0];
  }

  async function runWithConfig(config) {
    ReconciliationText.read.mockResolvedValue(config);
    return runTemplates({ reconciliationTexts: ["my_handle"] });
  }

  it("sends auto_hide_formula and reconciliation_type when present in the local config", async () => {
    const template = await runWithConfig({
      text: "{% comment %}main{% endcomment %}",
      text_parts: [{ name: "part_1", content: "part liquid" }],
      auto_hide_formula: "{% if period.reconciliations.my_handle.results.total == 0 %}t{% endif %}",
      reconciliation_type: "only_reconciled_with_data",
    });

    expect(template).toEqual({
      type: "reconciliation_text",
      id: "4242",
      text: "{% comment %}main{% endcomment %}",
      text_parts: [{ name: "part_1", content: "part liquid" }],
      auto_hide_formula: "{% if period.reconciliations.my_handle.results.total == 0 %}t{% endif %}",
      reconciliation_type: "only_reconciled_with_data",
    });
  });

  it("omits attributes that are absent from the local config", async () => {
    const template = await runWithConfig({ text: "liquid", text_parts: [] });

    expect(Object.keys(template).sort()).toEqual(["id", "text", "text_parts", "type"]);
  });

  it("omits attributes the config sets to null, rather than nulling the partner's value", async () => {
    const template = await runWithConfig({ text: "liquid", text_parts: [], name_fi: null, name_de: null });

    expect(template).not.toHaveProperty("name_fi");
    expect(template).not.toHaveProperty("name_de");
  });

  it("keeps an empty-string auto_hide_formula (clearing the formula is a real change)", async () => {
    const template = await runWithConfig({ text: "liquid", text_parts: [], auto_hide_formula: "" });

    expect(template.auto_hide_formula).toBe("");
  });

  it("sends handle and the localized names present in the config", async () => {
    const template = await runWithConfig({
      text: "liquid",
      text_parts: [],
      handle: "renamed_handle",
      name_en: "Renamed",
      name_nl: "Hernoemd",
    });

    expect(template.handle).toBe("renamed_handle");
    expect(template.name_en).toBe("Renamed");
    expect(template.name_nl).toBe("Hernoemd");
    expect(template).not.toHaveProperty("name_fr");
  });

  it("never sends an attribute the API does not declare", async () => {
    const template = await runWithConfig({
      text: "liquid",
      text_parts: [],
      description_en: "should not be sent",
      published: true,
      hide_code: false,
    });

    expect(template).not.toHaveProperty("description_en");
    expect(template).not.toHaveProperty("published");
    expect(template).not.toHaveProperty("hide_code");
  });

  it("sends nothing but the liquid for a shared part", async () => {
    SharedPart.read.mockResolvedValue({ text: "shared liquid", name: "my_part", externally_managed: true, used_in: [] });

    const template = await runTemplates({ sharedParts: ["my_part"] });

    expect(template).toEqual({ type: "shared_part", id: "4242", text: "shared liquid" });
  });
});

describe("LiquidSamplerRunner - keeping and narrowing the extracted output", () => {
  let zipPath;
  let outDir;
  let keepDir;
  let jsonPath;
  let originalExit;

  beforeEach(() => {
    jest.clearAllMocks();
    originalExit = process.exit;
    process.exit = jest.fn();
    const stamp = `${process.pid}-${Date.now()}`;
    zipPath = path.join(os.tmpdir(), `sampler-narrow-${stamp}.zip`);
    outDir = path.join(os.tmpdir(), `sampler-flagged-${stamp}`);
    keepDir = path.join(os.tmpdir(), `sampler-keep-${stamp}`);
    jsonPath = path.join(os.tmpdir(), `sampler-json-${stamp}.json`);
  });

  afterEach(() => {
    process.exit = originalExit;
    fs.rmSync(zipPath, { force: true });
    fs.rmSync(outDir, { recursive: true, force: true });
    fs.rmSync(keepDir, { recursive: true, force: true });
    fs.rmSync(jsonPath, { force: true });
  });

  // One entry that really differs, one that doesn't, and one flagged on data
  // alone with byte-identical renders - the three cases that decide what a
  // narrowed extraction should contain.
  function writeZip() {
    const zip = new AdmZip();
    zip.addFile(
      "sample_entry_ids.yml",
      Buffer.from(
        JSON.stringify({
          reconciliation_entries: {
            1: { label: "vkt_1", url: null },
            2: { label: "vkt_1", url: null },
            3: { label: "vkt_2", url: null },
          },
        })
      )
    );
    const files = [
      ["output/reconciliation_entries/1/before/registers.json", JSON.stringify({ named_results: { a: "before" } })],
      ["output/reconciliation_entries/1/after/registers.json", JSON.stringify({ named_results: { a: "after" } })],
      ["output/reconciliation_entries/1/before/view.html", "<div>1 old</div>"],
      ["output/reconciliation_entries/1/after/view.html", "<div>1 new</div>"],
      ["output/reconciliation_entries/2/before/registers.json", JSON.stringify({ named_results: { a: "same" } })],
      ["output/reconciliation_entries/2/after/registers.json", JSON.stringify({ named_results: { a: "same" } })],
      ["output/reconciliation_entries/2/before/view.html", "<div>2 unchanged</div>"],
      ["output/reconciliation_entries/2/after/view.html", "<div>2 unchanged</div>"],
      ["output/reconciliation_entries/3/before/registers.json", JSON.stringify({ named_results: { a: "before" } })],
      ["output/reconciliation_entries/3/after/registers.json", JSON.stringify({ named_results: { a: "after" } })],
      ["output/reconciliation_entries/3/before/view.html", "<div>3 same render</div>"],
      ["output/reconciliation_entries/3/after/view.html", "<div>3 same render</div>"],
    ];
    for (const [name, content] of files) zip.addFile(name, Buffer.from(content));
    fs.writeFileSync(zipPath, zip.toBuffer());
  }

  describe("--extract-flagged-only", () => {
    it("writes before/after only for flagged entries whose renders actually differ", () => {
      writeZip();

      new LiquidSamplerRunner("1").extractFlaggedOnly(zipPath, outDir);

      expect(fs.existsSync(path.join(outDir, "reconciliation_entries", "1", "before", "view.html"))).toBe(true);
      expect(fs.existsSync(path.join(outDir, "reconciliation_entries", "1", "after", "view.html"))).toBe(true);
      expect(fs.readFileSync(path.join(outDir, "reconciliation_entries", "1", "after", "view.html"), "utf8")).toBe("<div>1 new</div>");
      // Never flagged at all.
      expect(fs.existsSync(path.join(outDir, "reconciliation_entries", "2"))).toBe(false);
      // Flagged on data, but the renders are identical - a pair with nothing to compare.
      expect(fs.existsSync(path.join(outDir, "reconciliation_entries", "3"))).toBe(false);
    });

    it("reports what it wrote and what it skipped", () => {
      writeZip();

      new LiquidSamplerRunner("1").extractFlaggedOnly(zipPath, outDir);

      expect(consola.success).toHaveBeenCalledWith(expect.stringContaining("2 view.html file(s) across 1 entry"));
      expect(consola.success).toHaveBeenCalledWith(expect.stringContaining("identical before/after renders"));
    });

    it("does not create the directory when nothing differs", () => {
      const zip = new AdmZip();
      zip.addFile("sample_entry_ids.yml", Buffer.from(JSON.stringify({ reconciliation_entries: { 1: { label: "vkt_1", url: null } } })));
      zip.addFile("output/reconciliation_entries/1/before/registers.json", Buffer.from(JSON.stringify({ named_results: { a: "same" } })));
      zip.addFile("output/reconciliation_entries/1/after/registers.json", Buffer.from(JSON.stringify({ named_results: { a: "same" } })));
      fs.writeFileSync(zipPath, zip.toBuffer());

      new LiquidSamplerRunner("1").extractFlaggedOnly(zipPath, outDir);

      expect(consola.info).toHaveBeenCalledWith(expect.stringContaining("No differing entries"));
      expect(fs.existsSync(outDir)).toBe(false);
    });
  });

  describe("--keep-extracted", () => {
    it("leaves the extracted tree on disk instead of deleting it", async () => {
      writeZip();

      await new LiquidSamplerRunner("1", { compact: true, keepExtracted: keepDir }).printCompactDiffFromZip(zipPath);

      expect(fs.existsSync(path.join(keepDir, "output", "reconciliation_entries", "1", "after", "view.html"))).toBe(true);
      expect(consola.info).toHaveBeenCalledWith(expect.stringContaining(keepDir));
    });

    it("still cleans up when the option is absent", async () => {
      writeZip();
      const before = fs.readdirSync(os.tmpdir()).filter((n) => n.startsWith("silverfin-sampler-")).length;

      await new LiquidSamplerRunner("1", { compact: true }).printCompactDiffFromZip(zipPath);

      const after = fs.readdirSync(os.tmpdir()).filter((n) => n.startsWith("silverfin-sampler-")).length;
      expect(after).toBe(before);
    });
  });

  describe("--json sidecar", () => {
    it("writes the same structured data the markdown is rendered from", async () => {
      writeZip();

      await new LiquidSamplerRunner("1", { compact: true, jsonOut: jsonPath }).printCompactDiffFromZip(zipPath);

      const data = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
      expect(data.summary.entriesSampled).toBe(3);
      expect(data.summary.entriesChanged).toBeGreaterThan(0);
      expect(Array.isArray(data.templates)).toBe(true);
      expect(data.templates.map((t) => t.label)).toContain("vkt_1");
      expect(consola.info).toHaveBeenCalledWith(expect.stringContaining(jsonPath));
    });
  });
});
