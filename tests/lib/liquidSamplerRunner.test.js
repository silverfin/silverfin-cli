jest.mock("consola");
jest.mock("../../lib/api/sfApi");
jest.mock("../../lib/cli/spinner", () => ({ spinner: { spin: jest.fn(), stop: jest.fn() } }));
jest.mock("../../lib/utils/errorUtils", () => ({
  errorHandler: jest.fn(),
}));

const mockOpenFile = jest.fn();
jest.mock("../../lib/utils/urlHandler", () => ({
  UrlHandler: jest.fn().mockImplementation(() => ({ openFile: mockOpenFile })),
}));

const SF = require("../../lib/api/sfApi");
const { consola } = require("consola");
const { UrlHandler } = require("../../lib/utils/urlHandler");
const { LiquidSamplerRunner } = require("../../lib/liquidSamplerRunner");

const REPORT_URL = "https://reports.example.com/sampler/abc123.html";

describe("LiquidSamplerRunner - surfacing results", () => {
  const originalCI = process.env.CI;

  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.CI;
    SF.readSamplerRun.mockResolvedValue({
      data: { status: "completed", result_url: REPORT_URL },
    });
  });

  afterEach(() => {
    if (originalCI === undefined) delete process.env.CI;
    else process.env.CI = originalCI;
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
});
