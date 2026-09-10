jest.mock("consola");

const { consola } = require("consola");
const errorUtils = require("../../../lib/utils/errorUtils");
const { WORKFLOWS_FOLDER } = require("../../../lib/utils/constants");
const { AuthFailureError } = require("../../../lib/utils/authError");

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

  // ─── errorHandler ──────────────────────────────────────────────────────────

  describe("errorHandler", () => {
    let exitSpy;
    let stderrSpy;

    beforeEach(() => {
      jest.clearAllMocks();
      exitSpy = jest.spyOn(process, "exit").mockImplementation(() => {});
      stderrSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    });

    afterEach(() => {
      exitSpy.mockRestore();
      stderrSpy.mockRestore();
    });

    it("exits 2 on an auth failure, so a caller can tell a stale credential from a crash", () => {
      errorUtils.errorHandler(new AuthFailureError(542));
      expect(exitSpy).toHaveBeenCalledWith(2);
    });

    it("names the firm and points at re-authorising, instead of asking for a bug report", () => {
      errorUtils.errorHandler(new AuthFailureError(542));
      expect(consola.error).toHaveBeenCalledWith(expect.stringContaining("542"));
      expect(consola.error).toHaveBeenCalledWith(expect.stringContaining("silverfin authorize"));
    });

    it("prints no stack trace for an auth failure - an expired credential is not a CLI bug", () => {
      errorUtils.errorHandler(new AuthFailureError(542));
      const printed = stderrSpy.mock.calls.flat().join("\n");
      expect(printed).not.toContain("Please open an issue");
    });

    it("still exits 1 for a missing path", () => {
      const error = new Error("nope");
      error.code = "ENOENT";
      error.path = "/tmp/missing";
      errorUtils.errorHandler(error);
      expect(exitSpy).toHaveBeenCalledWith(1);
    });

    it("still reports an unknown error as a bug, exiting 1", () => {
      errorUtils.errorHandler(new Error("something unexpected"));
      const printed = stderrSpy.mock.calls.flat().join("\n");
      expect(printed).toContain("Please open an issue");
      expect(exitSpy).toHaveBeenCalledWith(1);
    });
  });
});
