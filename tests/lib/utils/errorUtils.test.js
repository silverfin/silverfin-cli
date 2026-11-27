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

    it("reports a 5xx with its status and firm, without asking for a bug report", () => {
      errorUtils.errorHandler(serverError(503, "Service Unavailable", { headers: { "X-Firm-ID": 542 } }));
      expect(consola.error).toHaveBeenCalledWith("The Silverfin API returned a server error 503 (Service Unavailable) for firm 542.");
      expect(stderrSpy.mock.calls.flat().join("\n")).not.toContain("Please open an issue");
      expect(exitSpy).toHaveBeenCalledWith(1);
    });
  });

  // ─── apiUnavailable ────────────────────────────────────────────────────────

  function axiosError(message, extra = {}) {
    const error = new Error(message);
    error.isAxiosError = true;
    return Object.assign(error, extra);
  }

  function serverError(status, statusText, config = {}) {
    return axiosError(`Request failed with status code ${status}`, { config, response: { status, statusText } });
  }

  describe("apiUnavailable", () => {
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

    it("names the partner of a partner request", () => {
      errorUtils.apiUnavailable(serverError(502, "Bad Gateway", { params: { partner_id: 7, api_key: "secret" } }));
      expect(consola.error).toHaveBeenCalledWith(expect.stringContaining("502 (Bad Gateway) for partner 7"));
    });

    it("suggests retrying a 5xx", () => {
      errorUtils.apiUnavailable(serverError(500, "Internal Server Error"));
      expect(consola.log).toHaveBeenCalledWith(expect.stringContaining("run the command again"));
    });

    it.each(["ENOTFOUND", "ECONNRESET", "ECONNABORTED", "ERR_NETWORK"])("reports the network error code %p and points at the connection", (code) => {
      errorUtils.apiUnavailable(axiosError("network down", { code, config: { headers: { "X-Firm-ID": 542 } } }));
      expect(consola.error).toHaveBeenCalledWith(`The Silverfin API could not be reached for firm 542: ${code}.`);
      expect(consola.log).toHaveBeenCalledWith(expect.stringContaining("VPN or proxy"));
      expect(exitSpy).toHaveBeenCalledWith(1);
    });

    it("keeps the stack trace for --verbose, and never the error itself (it holds the token)", () => {
      const error = serverError(503, "Service Unavailable", { headers: { Authorization: "Bearer secret" } });
      errorUtils.apiUnavailable(error);
      expect(consola.debug).toHaveBeenCalledWith(error.stack);
      const logged = JSON.stringify([consola.error.mock.calls, consola.log.mock.calls, consola.debug.mock.calls]);
      expect(logged).not.toContain("secret");
    });

    it("prints no stack trace without --verbose", () => {
      errorUtils.apiUnavailable(serverError(503, "Service Unavailable"));
      expect(stderrSpy).not.toHaveBeenCalled();
    });

    it("leaves an unhandled 4xx alone, so it is still reported as a bug", () => {
      expect(errorUtils.apiUnavailable(serverError(409, "Conflict"))).toBe(false);
      expect(exitSpy).not.toHaveBeenCalled();
    });

    it("leaves an error that is not from axios alone", () => {
      const error = new Error("socket hang up");
      error.code = "ECONNRESET";
      expect(errorUtils.apiUnavailable(error)).toBe(false);
      expect(exitSpy).not.toHaveBeenCalled();
    });

    it("is checked by uncaughtErrors, which the unhandledRejection handler calls", () => {
      errorUtils.uncaughtErrors(axiosError("getaddrinfo ENOTFOUND live.getsilverfin.com", { code: "ENOTFOUND" }));
      expect(consola.error).toHaveBeenCalledWith("The Silverfin API could not be reached: ENOTFOUND.");
      expect(stderrSpy.mock.calls.flat().join("\n")).not.toContain("Please open an issue");
    });
  });
});
