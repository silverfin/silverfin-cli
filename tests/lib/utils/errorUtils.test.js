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

  // ─── Credentials file ──────────────────────────────────────────────────────

  describe("credentialsFileNotLoaded", () => {
    it("should name the path and the reason", () => {
      errorUtils.credentialsFileNotLoaded("/home/.silverfin/config.json", "the file is not valid JSON (Unexpected token o)");
      expect(consola.error).toHaveBeenCalledWith(expect.stringContaining("/home/.silverfin/config.json"));
      expect(consola.error).toHaveBeenCalledWith(expect.stringContaining("the file is not valid JSON"));
    });

    it("should say saving is blocked until the file is fixed", () => {
      errorUtils.credentialsFileNotLoaded("/home/.silverfin/config.json", "the file could not be read");
      expect(consola.log).toHaveBeenCalledWith(expect.stringContaining("Fix"));
    });

    it("should warn that a restored backup's tokens may already be dead, not just say to restore one", () => {
      // Silverfin rotates a refresh token the moment the new one is used - a restored backup can
      // hold a pair the server already invalidated, so "restore" alone is misleading advice here.
      errorUtils.credentialsFileNotLoaded("/home/.silverfin/config.json", "the file could not be read");
      expect(consola.log).toHaveBeenCalledWith(expect.stringContaining("re-authoriz"));
    });

    it("should return false", () => {
      expect(errorUtils.credentialsFileNotLoaded("/home/.silverfin/config.json", "the file could not be read")).toBe(false);
    });
  });

  describe("credentialsFileNotSaved", () => {
    it("should name the path and say the last load failed", () => {
      errorUtils.credentialsFileNotSaved("/home/.silverfin/config.json");
      expect(consola.error).toHaveBeenCalledWith(expect.stringContaining("/home/.silverfin/config.json"));
      expect(consola.error).toHaveBeenCalledWith(expect.stringContaining("the last load failed"));
    });

    it("should return false", () => {
      expect(errorUtils.credentialsFileNotSaved("/home/.silverfin/config.json")).toBe(false);
    });

    it("should warn that a restored backup's tokens may already be dead", () => {
      errorUtils.credentialsFileNotSaved("/home/.silverfin/config.json");
      expect(consola.log).toHaveBeenCalledWith(expect.stringContaining("re-authoriz"));
    });

    it("should not claim a refresh just happened - this message also fires for --set-firm/--set-host/authorize-partner, none of which refresh anything", () => {
      errorUtils.credentialsFileNotSaved("/home/.silverfin/config.json");
      expect(consola.log).toHaveBeenCalledWith(expect.not.stringContaining("the refresh this run just performed"));
    });
  });

  describe("credentialsFileWriteFailed", () => {
    it("should name the path and the underlying error", () => {
      errorUtils.credentialsFileWriteFailed("/home/.silverfin/config.json", new Error("EACCES: permission denied"));
      expect(consola.error).toHaveBeenCalledWith(expect.stringContaining("/home/.silverfin/config.json"));
      expect(consola.error).toHaveBeenCalledWith(expect.stringContaining("EACCES: permission denied"));
    });

    it("should return false", () => {
      expect(errorUtils.credentialsFileWriteFailed("/home/.silverfin/config.json", new Error("EACCES"))).toBe(false);
    });
  });
});
