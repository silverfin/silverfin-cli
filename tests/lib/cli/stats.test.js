const fs = require("fs");
const os = require("os");
const path = require("path");
const exec = require("child_process");

jest.mock("consola");

const { consola } = require("consola");
const stats = require("../../../lib/cli/stats");

const VALID_WORKFLOW = {
  name: "Workflow 1",
  templates: {
    reconciliations: ["reconciliation_text_1"],
    accounts: ["account_1"],
    exports: ["export_1"],
  },
};

describe("cli/stats", () => {
  let tempDir;
  let originalCwd;
  let mockExit;
  let execSyncSpy;

  const writeWorkflow = (handle, content) => {
    const workflowsPath = path.join(tempDir, "workflows");
    fs.mkdirSync(workflowsPath, { recursive: true });
    fs.writeFileSync(path.join(workflowsPath, `${handle}.json`), typeof content === "string" ? content : JSON.stringify(content));
  };

  // Create a template folder with a non-empty main.liquid, a config and a liquid test
  const writeTemplate = (folder, handle, { unitTests = 0, externallyManaged = false } = {}) => {
    const templatePath = path.join(tempDir, folder, handle);
    fs.mkdirSync(path.join(templatePath, "tests"), { recursive: true });
    fs.writeFileSync(path.join(templatePath, "main.liquid"), "{% comment %}\nsome liquid\n{% endcomment %}");
    fs.writeFileSync(path.join(templatePath, "config.json"), JSON.stringify({ handle, externally_managed: externallyManaged }));
    if (unitTests > 0) {
      const testContent = Array.from({ length: unitTests }, (_, index) => `unit_test_${index + 1}:\n  context:\n    period: 2024-12-31\n`).join("");
      fs.writeFileSync(path.join(templatePath, "tests", `${handle}_liquid_test.yml`), testContent);
    }
  };

  beforeEach(() => {
    jest.clearAllMocks();
    originalCwd = process.cwd();
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "sf-cli-stats-test-"));
    process.chdir(tempDir);
    mockExit = jest.spyOn(process, "exit").mockImplementation(() => {});
    // The stats module shells out to git; no repository exists in the temp dir
    execSyncSpy = jest.spyOn(exec, "execSync").mockReturnValue("");
  });

  afterEach(() => {
    process.chdir(originalCwd);
    mockExit.mockRestore();
    execSyncSpy.mockRestore();
    if (tempDir && fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  // ─── generateWorkflowOverview: workflow discovery ──────────────────────────

  describe("generateWorkflowOverview without a handle", () => {
    it("should inform the user and stop when the workflows folder is missing", async () => {
      const reported = await stats.generateWorkflowOverview("2024-01-01");

      expect(reported).toBe(false);
      expect(consola.error).toHaveBeenCalledWith(expect.stringContaining("No workflows were found"));
      expect(mockExit).not.toHaveBeenCalled();
      expect(fs.existsSync(path.join(tempDir, "stats"))).toBe(false);
    });

    it("should inform the user and stop when the workflows folder is empty", async () => {
      fs.mkdirSync(path.join(tempDir, "workflows"), { recursive: true });

      const reported = await stats.generateWorkflowOverview("2024-01-01");

      expect(reported).toBe(false);
      expect(consola.error).toHaveBeenCalledWith(expect.stringContaining("No workflows were found"));
      expect(mockExit).not.toHaveBeenCalled();
    });

    it("should ignore non-JSON files when discovering workflows", async () => {
      fs.mkdirSync(path.join(tempDir, "workflows"), { recursive: true });
      fs.writeFileSync(path.join(tempDir, "workflows", "README.md"), "# not a workflow");

      const reported = await stats.generateWorkflowOverview("2024-01-01");

      expect(reported).toBe(false);
      expect(consola.error).toHaveBeenCalledWith(expect.stringContaining("No workflows were found"));
      expect(mockExit).not.toHaveBeenCalled();
    });

    it("should skip a faulty workflow and still process the valid ones", async () => {
      writeTemplate("reconciliation_texts", "reconciliation_text_1", { unitTests: 2 });
      writeTemplate("account_templates", "account_1");
      writeTemplate("export_files", "export_1");
      writeWorkflow("workflow_valid", VALID_WORKFLOW);
      writeWorkflow("workflow_broken", "{ not json");

      await stats.generateWorkflowOverview("2024-01-01");

      // The valid workflow produced its CSV
      expect(fs.existsSync(path.join(tempDir, "stats", "workflow_valid_stats.csv"))).toBe(true);
      // The broken one did not
      expect(fs.existsSync(path.join(tempDir, "stats", "workflow_broken_stats.csv"))).toBe(false);
      expect(mockExit).not.toHaveBeenCalled();
      expect(consola.warn).toHaveBeenCalledWith(expect.stringContaining('Skipping workflow "workflow_broken"'));
    });

    it("should report a tally so a partial run is not mistaken for a complete one", async () => {
      writeTemplate("reconciliation_texts", "reconciliation_text_1", { unitTests: 1 });
      writeTemplate("account_templates", "account_1");
      writeTemplate("export_files", "export_1");
      writeWorkflow("workflow_valid", VALID_WORKFLOW);
      writeWorkflow("workflow_broken", "{ not json");
      writeWorkflow("workflow_missing_accounts", { name: "Missing", templates: { reconciliations: [], exports: [] } });

      const reported = await stats.generateWorkflowOverview("2024-01-01");

      expect(consola.error).toHaveBeenCalledWith(expect.stringContaining("2 of 3 workflows were skipped"));
      // One workflow still produced its statistics, so the run was not a failure
      expect(reported).toBe(true);
    });

    it("should report a failure when every workflow was skipped", async () => {
      writeWorkflow("workflow_broken", "{ not json");
      writeWorkflow("workflow_missing_accounts", { name: "Missing", templates: { reconciliations: [], exports: [] } });

      const reported = await stats.generateWorkflowOverview("2024-01-01");

      expect(reported).toBe(false);
      expect(consola.error).toHaveBeenCalledWith(expect.stringContaining("2 of 2 workflows were skipped"));
    });

    it("should not report a tally when every workflow is valid", async () => {
      writeTemplate("reconciliation_texts", "reconciliation_text_1", { unitTests: 1 });
      writeTemplate("account_templates", "account_1");
      writeTemplate("export_files", "export_1");
      writeWorkflow("workflow_valid", VALID_WORKFLOW);

      await stats.generateWorkflowOverview("2024-01-01");

      expect(consola.error).not.toHaveBeenCalledWith(expect.stringContaining("were skipped"));
    });
  });

  // ─── generateWorkflowOverview: explicit handle ─────────────────────────────

  describe("generateWorkflowOverview with an explicit handle", () => {
    it("should report a failure when the requested workflow does not exist", async () => {
      writeWorkflow("workflow_valid", VALID_WORKFLOW);

      const reported = await stats.generateWorkflowOverview("2024-01-01", "no_such_workflow");

      expect(reported).toBe(false);
      expect(consola.error).toHaveBeenCalledWith(expect.stringContaining("no_such_workflow"));
      // Stopping the run is the caller's decision, not this function's
      expect(mockExit).not.toHaveBeenCalled();
    });

    it("should report a failure when the requested workflow is malformed", async () => {
      writeWorkflow("workflow_broken", { name: "Broken", templates: { reconciliations: [] } });

      const reported = await stats.generateWorkflowOverview("2024-01-01", "workflow_broken");

      expect(reported).toBe(false);
      expect(consola.error).toHaveBeenCalledWith(expect.stringContaining("templates.accounts"));
      expect(mockExit).not.toHaveBeenCalled();
    });

    it("should report a failure on a handle which points outside the workflows folder", async () => {
      writeWorkflow("workflow_valid", VALID_WORKFLOW);
      const escapedPath = path.join(tempDir, "..", "escape_stats.csv");

      const reported = await stats.generateWorkflowOverview("2024-01-01", "../escape");

      expect(reported).toBe(false);
      expect(consola.error).toHaveBeenCalledWith(expect.stringContaining("is not valid"));
      expect(fs.existsSync(escapedPath)).toBe(false);
      expect(mockExit).not.toHaveBeenCalled();
    });

    it("should not skip the workflow it was asked for", async () => {
      writeWorkflow("workflow_valid", VALID_WORKFLOW);

      await stats.generateWorkflowOverview("2024-01-01", "no_such_workflow");

      // The batch wording belongs to the every-workflow run, where carrying on makes sense
      expect(consola.warn).not.toHaveBeenCalledWith(expect.stringContaining("Skipping workflow"));
      expect(consola.error).not.toHaveBeenCalledWith(expect.stringContaining("were skipped"));
    });

    it("should produce a CSV named after the workflow handle", async () => {
      writeTemplate("reconciliation_texts", "reconciliation_text_1", { unitTests: 2 });
      writeTemplate("account_templates", "account_1");
      writeTemplate("export_files", "export_1");
      writeWorkflow("workflow_valid", VALID_WORKFLOW);

      await stats.generateWorkflowOverview("2024-01-01", "workflow_valid");

      const csvPath = path.join(tempDir, "stats", "workflow_valid_stats.csv");
      expect(fs.existsSync(csvPath)).toBe(true);
      const csv = fs.readFileSync(csvPath, "utf-8");
      expect(csv).toContain("Workflow Name");
      expect(csv).toContain("Workflow 1");
      expect(mockExit).not.toHaveBeenCalled();
    });

    it("should count only the templates belonging to the workflow", async () => {
      writeTemplate("reconciliation_texts", "reconciliation_text_1", { unitTests: 2 });
      // This template has tests but is NOT part of the workflow
      writeTemplate("reconciliation_texts", "reconciliation_text_outside", { unitTests: 3 });
      writeTemplate("account_templates", "account_1");
      writeTemplate("export_files", "export_1");
      writeWorkflow("workflow_valid", VALID_WORKFLOW);

      await stats.generateWorkflowOverview("2024-01-01", "workflow_valid");

      const csv = fs.readFileSync(path.join(tempDir, "stats", "workflow_valid_stats.csv"), "utf-8");
      const values = csv.trim().split("\r\n")[1].split(";");
      // "Reconciliations - templates" and "Reconciliations - unit tests"
      expect(values[9]).toBe("1");
      expect(values[12]).toBe("2");
    });
  });

  // ─── empty template lists ──────────────────────────────────────────────────

  describe("workflow without templates", () => {
    it("should report zero without silently matching every template", async () => {
      // These templates exist in the repo but belong to no workflow
      writeTemplate("reconciliation_texts", "reconciliation_text_1", { unitTests: 5 });
      writeTemplate("account_templates", "account_1", { unitTests: 4 });
      writeWorkflow("workflow_empty", { name: "Empty Workflow", templates: { reconciliations: [], accounts: [], exports: [] } });

      await stats.generateWorkflowOverview("2024-01-01", "workflow_empty");

      const csv = fs.readFileSync(path.join(tempDir, "stats", "workflow_empty_stats.csv"), "utf-8");
      const values = csv.trim().split("\r\n")[1].split(";");
      // All - templates, All - yaml files, All - unit tests
      expect(values[5]).toBe("0");
      expect(values[7]).toBe("0");
      expect(values[8]).toBe("0");
      expect(mockExit).not.toHaveBeenCalled();
    });

    it("should explain that no YAML changes can be counted", async () => {
      writeWorkflow("workflow_empty", { name: "Empty Workflow", templates: { reconciliations: [], accounts: [], exports: [] } });

      await stats.generateWorkflowOverview("2024-01-01", "workflow_empty");

      expect(consola.info).toHaveBeenCalledWith(expect.stringContaining("no reconciliations or account templates"));
    });

    it("should not run the git scan when there is nothing to match", async () => {
      writeWorkflow("workflow_empty", { name: "Empty Workflow", templates: { reconciliations: [], accounts: [], exports: [] } });

      await stats.generateWorkflowOverview("2024-01-01", "workflow_empty");

      expect(execSyncSpy).not.toHaveBeenCalled();
    });
  });

  // ─── regex safety ──────────────────────────────────────────────────────────

  describe("template names containing regular expression characters", () => {
    it("should treat a quantifier in a name literally", async () => {
      // Unescaped, "account_1+2" means "account_" then one or more "1", so it would
      // match "account_1112" and miss the template actually named "account_1+2"
      writeTemplate("account_templates", "account_1+2", { unitTests: 2 });
      writeTemplate("account_templates", "account_1112", { unitTests: 7 });
      writeWorkflow("workflow_plus", { name: "Plus", templates: { reconciliations: [], accounts: ["account_1+2"], exports: [] } });

      await stats.generateWorkflowOverview("2024-01-01", "workflow_plus");

      const csv = fs.readFileSync(path.join(tempDir, "stats", "workflow_plus_stats.csv"), "utf-8");
      const values = csv.trim().split("\r\n")[1].split(";");
      // "Account Templates - unit tests" must be the 2 from account_1+2, never the 7 from account_1112
      expect(values[16]).toBe("2");
    });

    it("should not build an invalid regular expression from a name with brackets", async () => {
      writeTemplate("account_templates", "account_(1)", { unitTests: 1 });
      writeWorkflow("workflow_brackets", { name: "Brackets", templates: { reconciliations: [], accounts: ["account_(1)"], exports: [] } });

      await expect(stats.generateWorkflowOverview("2024-01-01", "workflow_brackets")).resolves.not.toThrow();
      expect(mockExit).not.toHaveBeenCalled();
    });
  });

  // ─── several test files in one tests folder ────────────────────────────────

  describe("a template with more than one liquid test file", () => {
    // The counts are compared against a number of templates, so a template with two test
    // files must not be counted twice
    const writeExtraTestFile = (folder, handle, fileName, unitTests) => {
      const testContent = Array.from({ length: unitTests }, (_, index) => `extra_unit_test_${index + 1}:\n  context:\n    period: 2024-12-31\n`).join("");
      fs.writeFileSync(path.join(tempDir, folder, handle, "tests", fileName), testContent);
    };

    it("should count the template once and add up its unit tests in the repository overview", async () => {
      writeTemplate("reconciliation_texts", "reconciliation_text_1", { unitTests: 2 });
      writeExtraTestFile("reconciliation_texts", "reconciliation_text_1", "extra_liquid_test.yml", 3);

      await stats.generateOverview("2024-01-01");

      const values = fs.readFileSync(path.join(tempDir, "stats", "overview.csv"), "utf-8").trim().split("\r\n")[1].split(";");
      // Reconciliations - templates, - templates with yaml tests, - unit tests
      expect(values[8]).toBe("1");
      expect(values[10]).toBe("1");
      expect(values[11]).toBe("5");
    });

    it("should count the template once and add up its unit tests in a workflow overview", async () => {
      writeTemplate("account_templates", "account_1", { unitTests: 1 });
      writeExtraTestFile("account_templates", "account_1", "account_1_liquid_test_extra.yml", 1);
      writeWorkflow("workflow_1", { name: "Workflow 1", templates: { reconciliations: [], accounts: ["account_1"], exports: [] } });

      await stats.generateWorkflowOverview("2024-01-01", "workflow_1");

      const values = fs.readFileSync(path.join(tempDir, "stats", "workflow_1_stats.csv"), "utf-8").trim().split("\r\n")[1].split(";");
      // Account Templates - templates, - templates with yaml tests, - unit tests
      expect(values[13]).toBe("1");
      expect(values[15]).toBe("1");
      expect(values[16]).toBe("2");
    });

    it("should count the template towards at least two tests on its combined total", async () => {
      // One unit test per file, two files: the template has two unit tests
      writeTemplate("reconciliation_texts", "reconciliation_text_1", { unitTests: 1 });
      writeExtraTestFile("reconciliation_texts", "reconciliation_text_1", "extra_liquid_test.yml", 1);

      await stats.generateOverview("2024-01-01");

      const values = fs.readFileSync(path.join(tempDir, "stats", "overview.csv"), "utf-8").trim().split("\r\n")[1].split(";");
      // Reconciliations - templates with at least two tests
      expect(values[28]).toBe("1");
    });

    it("should never report more than 100% of the templates as covered", async () => {
      writeTemplate("reconciliation_texts", "reconciliation_text_1", { unitTests: 1 });
      writeExtraTestFile("reconciliation_texts", "reconciliation_text_1", "extra_liquid_test.yml", 1);
      writeExtraTestFile("reconciliation_texts", "reconciliation_text_1", "another_liquid_test.yml", 1);

      await stats.generateOverview("2024-01-01");

      const values = fs.readFileSync(path.join(tempDir, "stats", "overview.csv"), "utf-8").trim().split("\r\n")[1].split(";");
      // Reconciliations - templates with yaml tests (%)
      expect(Number(values[26])).toBe(100);
    });
  });

  // ─── generateOverview (whole repository) ───────────────────────────────────

  describe("generateOverview", () => {
    it("should count every template in the repository", async () => {
      writeTemplate("reconciliation_texts", "reconciliation_text_1", { unitTests: 2 });
      writeTemplate("reconciliation_texts", "reconciliation_text_2", { unitTests: 1 });
      writeTemplate("shared_parts", "shared_part_1");
      writeTemplate("account_templates", "account_1", { unitTests: 3 });
      writeTemplate("export_files", "export_1");

      await stats.generateOverview("2024-01-01");

      const csvPath = path.join(tempDir, "stats", "overview.csv");
      expect(fs.existsSync(csvPath)).toBe(true);
      const values = fs.readFileSync(csvPath, "utf-8").trim().split("\r\n")[1].split(";");
      // Reconciliations - templates, Reconciliations - unit tests
      expect(values[8]).toBe("2");
      expect(values[11]).toBe("3");
      expect(mockExit).not.toHaveBeenCalled();
    });

    it("should report a write failure instead of throwing", async () => {
      writeTemplate("reconciliation_texts", "reconciliation_text_1", { unitTests: 1 });
      const appendSpy = jest.spyOn(fs, "appendFileSync").mockImplementation(() => {
        const error = new Error("permission denied");
        error.code = "EACCES";
        throw error;
      });

      try {
        await expect(stats.generateOverview("2024-01-01")).resolves.not.toThrow();
        expect(consola.error).toHaveBeenCalledWith(expect.stringContaining("stats/overview.csv"));
        expect(consola.error).toHaveBeenCalledWith(expect.stringContaining("no permission to write to it"));
        expect(mockExit).not.toHaveBeenCalled();
      } finally {
        appendSpy.mockRestore();
      }
    });

    it("should append a row when run a second time", async () => {
      writeTemplate("reconciliation_texts", "reconciliation_text_1", { unitTests: 1 });

      await stats.generateOverview("2024-01-01");
      await stats.generateOverview("2024-02-01");

      const csv = fs.readFileSync(path.join(tempDir, "stats", "overview.csv"), "utf-8");
      expect(csv.trim().split("\r\n")).toHaveLength(3);
    });
  });
});
