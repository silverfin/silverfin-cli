/**
 * A firm's stored credential could not be used and was not renewed.
 *
 * This is a routine operational state, not a defect: the credential expired, or it was
 * advanced somewhere else and this copy is now history. It exists so `errorHandler` can
 * tell it apart from an unexpected crash and exit with a code a caller can branch on,
 * rather than printing a stack trace and asking for a bug report.
 */
class AuthFailureError extends Error {
  /**
   * @param {Number|String} firmId
   * @param {Error} [cause] the underlying error, kept for debug logging
   */
  constructor(firmId, cause = undefined) {
    super(`Authentication failed for firm ${firmId}`);
    this.name = "AuthFailureError";
    this.firmId = firmId;
    this.cause = AuthFailureError.#summarise(cause);
  }

  /**
   * Reduce an axios error to the few fields worth logging.
   *
   * Never keep the error itself: it carries `config.headers.Authorization` (and on staging a
   * `config.params.access_token`), so anything that inspects it - Node's own `[cause]` printer,
   * any util.inspect-based logger - writes a live token into the log. Scrubbed here rather than
   * at the call site so no future caller can reintroduce the leak.
   */
  static #summarise(cause) {
    if (!cause || typeof cause !== "object") return cause;
    return {
      status: cause.response?.status,
      statusText: cause.response?.statusText,
      method: cause.config?.method,
      url: cause.config?.url,
    };
  }
}

// A distinct exit code so a caller can tell "this firm's credential is stale" from
// "the CLI failed for some other reason", without parsing the log.
const EXIT_AUTH_FAILURE = 2;

module.exports = { AuthFailureError, EXIT_AUTH_FAILURE };
