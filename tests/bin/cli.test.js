const { execSync } = require("child_process");
const path = require("path");
const fs = require("fs");
const os = require("os");

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

  // Every remaining id the CLI accepts. These are not firm ids, but they reach the API the same
  // way and a bad one is the same typo, so they are checked by the same function
  describe("the other ids accepted on the command line", () => {
    // The message is asserted, not just the exit code: these commands exit 1 on a network failure
    // too, so an exit code alone cannot tell "the CLI rejected the id" from "the API refused it
    // later", which is the whole difference this change makes
    it.each([
      ["company id", "generate-export-file -f 13827 -c abc -p 1 -e 1", "abc"],
      ["period id", "generate-export-file -f 13827 -c 1 -p abc -e 1", "abc"],
      ["export file id", "generate-export-file -f 13827 -c 1 -p 1 -e abc", "abc"],
      ["company id", "company-data-copier -f 13827 -c abc -l 33417839", "abc"],
      ["period id", "company-data-copier -f 13827 -c 1224550 -l xyz", "xyz"],
      ["period id", "company-data-copier -f 13827 -c 1224550 -l 33417839 xyz", "xyz"],
      ["sampler id", "run-sampler -p 500 --id abc", "abc"],
    ])("reports an invalid %s", (label, args, value) => {
      expect(runCli(args)).toMatch(new RegExp(`Invalid ${label} "${value}"`));
      expect(runCliExitCode(args)).toBe(1);
    });

    // The three checks these replace used Number(), which accepts a padded id and then passes the
    // raw string on - so the value that was validated was not the value that got used
    it.each([
      ["company id", "company-data-copier -f 13827 -c 007 -l 33417839", "007"],
      ["period id", "company-data-copier -f 13827 -c 1224550 -l 007", "007"],
      ["sampler id", "run-sampler -p 500 --id 007", "007"],
    ])("reports a zero-padded %s", (label, args, value) => {
      expect(runCli(args)).toMatch(new RegExp(`Invalid ${label} "${value}"`));
      expect(runCliExitCode(args)).toBe(1);
    });
  });

  // These commands write to the credentials file, so they run against a throwaway HOME. Without
  // it a rejected value would be stored in the developer's own ~/.silverfin/config.json
  describe("ids on the commands which store credentials", () => {
    let isolatedHome;

    beforeAll(() => {
      isolatedHome = fs.mkdtempSync(path.join(os.tmpdir(), "silverfin-cli-home-"));
    });

    afterAll(() => {
      fs.rmSync(isolatedHome, { recursive: true, force: true });
    });

    function runIsolated(args) {
      const env = { ...process.env, HOME: isolatedHome, NODE_ENV: "test", SF_API_CLIENT_ID: "test", SF_API_SECRET: "test" };
      try {
        const output = execSync(`node bin/cli.js ${args} 2>&1`, { cwd: repoRoot, env }).toString();
        return { code: 0, output };
      } catch (err) {
        return { code: err.status, output: (err.stdout || Buffer.alloc(0)).toString() };
      }
    }

    // As above, the message is what proves the CLI rejected the id: --refresh-token and
    // --update-name already exited 1 on a bad id, but only after trying to reach the API with it
    it.each([
      ["config --set-firm", "config --set-firm abc", "firm id"],
      ["config --update-name", "config --update-name abc", "firm id"],
      ["config --refresh-token", "config --refresh-token abc", "firm id"],
      ["config --refresh-partner-token", "config --refresh-partner-token abc", "partner id"],
      ["authorize-partner", "authorize-partner -i abc -k some-key", "partner id"],
    ])("%s reports an id which is not a number", (_name, args, label) => {
      const { code, output } = runIsolated(args);
      expect(output).toMatch(new RegExp(`Invalid ${label} "abc"`));
      expect(code).toBe(1);
    });

    // The value is rejected before it is written, so nothing reaches the credentials file
    it("does not store a firm id which was rejected", () => {
      runIsolated("config --set-firm abc");
      const credentialsPath = path.join(isolatedHome, ".silverfin", "config.json");
      const stored = fs.existsSync(credentialsPath) ? fs.readFileSync(credentialsPath, "utf-8") : "";
      expect(stored).not.toMatch(/abc/);
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
