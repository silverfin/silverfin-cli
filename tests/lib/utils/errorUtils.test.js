jest.mock("consola");

const { consola } = require("consola");
const errorUtils = require("../../../lib/utils/errorUtils");
const { WORKFLOWS_FOLDER } = require("../../../lib/utils/constants");

describe("utils/errorUtils", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ─── missingHandle ─────────────────────────────────────────────────────────

  describe("missingHandle", () => {
    it("should name the label and mention an unset variable", () => {
      errorUtils.missingHandle("workflow handle");
      expect(consola.error).toHaveBeenCalledWith(expect.stringContaining("No workflow handle was provided"));
      expect(consola.error).toHaveBeenCalledWith(expect.stringContaining("variable you passed is set"));
    });

    it("should suggest the command which lists the handles available", () => {
      errorUtils.missingHandle("workflow handle", "silverfin stats --since 2024-01-31 --workflow");
      expect(consola.log).toHaveBeenCalledWith(expect.stringContaining("To see the workflow handles available"));
      expect(consola.log).toHaveBeenCalledWith(expect.stringContaining("silverfin stats --since 2024-01-31 --workflow"));
    });

    it("should ask for a valid handle when no command is suggested", () => {
      errorUtils.missingHandle("workflow handle");
      expect(consola.log).toHaveBeenCalledWith("Please provide a valid workflow handle");
    });

    it("should return false", () => {
      expect(errorUtils.missingHandle("workflow handle")).toBe(false);
    });
  });

  // ─── invalidHandleFormat ───────────────────────────────────────────────────

  describe("invalidHandleFormat", () => {
    it("should name the handle and the label", () => {
      errorUtils.invalidHandleFormat("../escape", "workflow handle");
      expect(consola.error).toHaveBeenCalledWith(expect.stringContaining('Invalid workflow handle "../escape"'));
    });

    it("should say what a handle cannot contain", () => {
      errorUtils.invalidHandleFormat("sub/handle", "workflow handle");
      expect(consola.error).toHaveBeenCalledWith(expect.stringContaining("cannot contain slashes"));
    });

    it("should suggest the command which lists the handles available", () => {
      errorUtils.invalidHandleFormat("../escape", "reconciliation handle", "silverfin get-reconciliation-id --all");
      expect(consola.log).toHaveBeenCalledWith(expect.stringContaining("To see the reconciliation handles available"));
      expect(consola.log).toHaveBeenCalledWith(expect.stringContaining("silverfin get-reconciliation-id --all"));
    });

    it("should ask for a valid handle when no command is suggested", () => {
      errorUtils.invalidHandleFormat("../escape", "workflow handle");
      expect(consola.log).toHaveBeenCalledWith("Please provide a valid workflow handle");
    });

    it("should return false", () => {
      expect(errorUtils.invalidHandleFormat("../escape", "workflow handle")).toBe(false);
    });
  });

  // ─── Workflow folder naming ────────────────────────────────────────────────

  // The folder the messages point the user at must stay the folder fsUtils reads from,
  // so both take it from lib/utils/constants.js
  describe("workflow messages", () => {
    it("should point at the workflows folder fsUtils reads from", () => {
      errorUtils.noWorkflowsStored();
      expect(consola.error).toHaveBeenCalledWith(expect.stringContaining(`./${WORKFLOWS_FOLDER}`));
    });

    it("should point at the workflow file inside that folder", () => {
      errorUtils.unparsableWorkflow("workflow_a", "Unexpected end of JSON input");
      expect(consola.log).toHaveBeenCalledWith(expect.stringContaining(`./${WORKFLOWS_FOLDER}/workflow_a.json`));
    });
  });
});
