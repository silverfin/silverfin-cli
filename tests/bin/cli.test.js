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

// Runs the CLI and returns only the exit code, discarding output. Used to assert the process
// exit-code contract: a failing command must not exit 0, or scripts/CI read failure as success.
function runCliExitCode(args) {
  try {
    execSync(`node bin/cli.js ${args}`, {
      cwd: repoRoot,
      stdio: "ignore",
      env: { ...process.env, NODE_ENV: "test", SF_API_CLIENT_ID: "test", SF_API_SECRET: "test" },
    });
    return 0;
  } catch (err) {
    return err.status;
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

    it("output contains company-data-copier", () => {
      expect(helpOutput).toMatch(/company-data-copier/);
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

  describe("silverfin company-data-copier --help", () => {
    let helpOutput;

    beforeAll(() => {
      helpOutput = runCli("company-data-copier --help");
    });

    it("output contains --firm option", () => {
      expect(helpOutput).toMatch(/--firm/);
    });

    it("output contains --source-company-id option", () => {
      expect(helpOutput).toMatch(/--source-company-id/);
    });

    it("output contains --source-ledger-ids option", () => {
      expect(helpOutput).toMatch(/--source-ledger-ids/);
    });
  });

  describe("silverfin company-data-copier exit codes", () => {
    it("exits 1 on an invalid source company id", () => {
      expect(runCliExitCode("company-data-copier -c abc -l 33417839 -f 13692")).toBe(1);
    });

    it("exits 1 on an invalid source ledger id", () => {
      expect(runCliExitCode("company-data-copier -c 1224550 -l xyz -f 13692")).toBe(1);
    });

    it("exits 1 when a required option is missing", () => {
      expect(runCliExitCode("company-data-copier -f 13692")).toBe(1);
    });
  });
});
