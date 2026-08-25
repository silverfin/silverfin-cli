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

  // The commands below do not go through runCommandChecks, so the id check has to be wired into
  // each action. Without it a bad firm id reaches the API: run-test exited 0 with "Config file
  // not found", which scripts read as a pass
  describe("firm and partner id validation on commands outside runCommandChecks", () => {
    it.each([
      ["run-test", "run-test -h some_handle"],
      ["development-mode", "development-mode -h some_handle"],
      ["create-all-templates", "create-all-templates --yes"],
      ["update-all-templates", "update-all-templates --yes"],
      ["generate-export-file", "generate-export-file -c 1 -p 1 -e 1"],
      ["company-data-copier", "company-data-copier -c 1224550 -l 33417839"],
    ])("%s exits 1 on a non-numeric firm id", (_name, args) => {
      expect(runCliExitCode(`${args} -f abc`)).toBe(1);
    });

    it.each([
      ["run-test", "run-test -h some_handle"],
      ["development-mode", "development-mode -h some_handle"],
      ["create-all-templates", "create-all-templates --yes"],
      ["update-all-templates", "update-all-templates --yes"],
      ["generate-export-file", "generate-export-file -c 1 -p 1 -e 1"],
      ["company-data-copier", "company-data-copier -c 1224550 -l 33417839"],
    ])("%s exits 1 on a zero-padded firm id", (_name, args) => {
      expect(runCliExitCode(`${args} -f 007`)).toBe(1);
    });

    it("run-sampler exits 1 on a non-numeric partner id", () => {
      expect(runCliExitCode("run-sampler -p abc -h some_handle")).toBe(1);
    });

    it("run-sampler exits 1 when any of the variadic firm ids is not a number", () => {
      expect(runCliExitCode("run-sampler -p 500 -h some_handle --firm-ids 13827 abc")).toBe(1);
    });

    // Only the exit code is asserted here. runCli sets NODE_ENV=test, which puts consola at level
    // 1 and drops everything below a warning, so the consola.log follow-up lines ("Did you mean
    // 7?") never reach this harness even though a real user sees them. The message itself is
    // covered in tests/lib/utils/errorUtils.test.js
    it("reports the invalid id rather than failing later", () => {
      expect(runCli("run-test -h some_handle -f 007")).toMatch(/Invalid firm id "007"/);
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
