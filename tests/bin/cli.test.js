const { execSync } = require("child_process");
const path = require("path");

const repoRoot = path.resolve(__dirname, "../..");

function runCli(args) {
  try {
    return execSync(`node bin/cli.js ${args} 2>&1`, {
      cwd: repoRoot,
      env: { ...process.env, NODE_ENV: "test", SF_API_CLIENT_ID: "test", SF_API_SECRET: "test" },
    }).toString();
  } catch (err) {
    // Commander exits with code 1 for --help; capture stdout
    return (err.stdout || Buffer.alloc(0)).toString() + (err.stderr || Buffer.alloc(0)).toString();
  }
}

describe("bin/cli.js Commander wiring", () => {
  describe("silverfin --help", () => {
    let helpOutput;

    beforeAll(() => {
      helpOutput = runCli("--help");
    });

    it("output contains import-reconciliation", () => {
      expect(helpOutput).toMatch(/import-reconciliation/);
    });

    it("output contains update-reconciliation", () => {
      expect(helpOutput).toMatch(/update-reconciliation/);
    });

    it("output contains import-shared-part", () => {
      expect(helpOutput).toMatch(/import-shared-part/);
    });

    it("output contains import-export-file", () => {
      expect(helpOutput).toMatch(/import-export-file/);
    });

    it("output contains import-account-template", () => {
      expect(helpOutput).toMatch(/import-account-template/);
    });
  });

  describe("silverfin import-reconciliation --help", () => {
    let helpOutput;

    beforeAll(() => {
      helpOutput = runCli("import-reconciliation --help");
    });

    it("output contains --handle option", () => {
      expect(helpOutput).toMatch(/--handle/);
    });

    it("output contains --id option", () => {
      expect(helpOutput).toMatch(/--id/);
    });

    it("output contains --all option", () => {
      expect(helpOutput).toMatch(/--all/);
    });

    it("output contains --existing option", () => {
      expect(helpOutput).toMatch(/--existing/);
    });
  });

  describe("silverfin update-reconciliation --help", () => {
    let helpOutput;

    beforeAll(() => {
      helpOutput = runCli("update-reconciliation --help");
    });

    it("output contains --handle option", () => {
      expect(helpOutput).toMatch(/--handle/);
    });

    it("output contains --id option", () => {
      expect(helpOutput).toMatch(/--id/);
    });

    it("output contains --all option", () => {
      expect(helpOutput).toMatch(/--all/);
    });
  });

  describe("silverfin run-sampler", () => {
    it("--from-zip does not require -p/--partner (offline path, no partner API involved)", () => {
      // No -p given; passing a non-existent zip path exercises the option
      // parsing/validation only, before any partner-API-requiring code runs.
      const output = runCli("run-sampler --from-zip /tmp/does-not-exist-cli-test.zip");
      expect(output).not.toMatch(/You need to specify a partner/);
      expect(output).toMatch(/Could not read zip/);
    });

    it("every other path still requires -p/--partner", () => {
      const output = runCli("run-sampler -h some_handle");
      expect(output).toMatch(/You need to specify a partner/);
    });
  });
});
