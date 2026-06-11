jest.mock("consola");
jest.mock("../../../lib/api/firmCredentials", () => ({
  firmCredentials: {
    getPartnerCredentials: jest.fn(),
  },
}));

describe("apiUtils", () => {
  let apiUtils;
  let consola;
  let mockExit;
  let firmCredentialsModule;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetModules();

    // Mock process.exit before re-requiring apiUtils
    mockExit = jest.spyOn(process, "exit").mockImplementation(() => {});

    // Re-require so env variables take effect
    jest.mock("consola");
    jest.mock("../../../lib/api/firmCredentials", () => ({
      firmCredentials: {
        getPartnerCredentials: jest.fn(),
      },
    }));
    apiUtils = require("../../../lib/utils/apiUtils");
    consola = require("consola");
    firmCredentialsModule = require("../../../lib/api/firmCredentials");
  });

  afterEach(() => {
    mockExit.mockRestore();
  });

  // ─── checkRequiredEnvVariables ────────────────────────────────────────────

  describe("checkRequiredEnvVariables", () => {
    it("should not call process.exit when both env variables are present", () => {
      process.env.SF_API_CLIENT_ID = "test_client_id";
      process.env.SF_API_SECRET = "test_secret";

      apiUtils.checkRequiredEnvVariables();

      expect(mockExit).not.toHaveBeenCalled();

      delete process.env.SF_API_CLIENT_ID;
      delete process.env.SF_API_SECRET;
    });

    it("should call process.exit(1) and log errors when SF_API_CLIENT_ID is missing", () => {
      delete process.env.SF_API_CLIENT_ID;
      process.env.SF_API_SECRET = "test_secret";

      apiUtils.checkRequiredEnvVariables();

      expect(consola.error).toHaveBeenCalled();
      expect(mockExit).toHaveBeenCalledWith(1);

      delete process.env.SF_API_SECRET;
    });

    it("should call process.exit(1) and log errors when both env variables are missing", () => {
      delete process.env.SF_API_CLIENT_ID;
      delete process.env.SF_API_SECRET;

      apiUtils.checkRequiredEnvVariables();

      expect(consola.error).toHaveBeenCalled();
      expect(mockExit).toHaveBeenCalledWith(1);
    });
  });

  // ─── responseSuccessHandler ───────────────────────────────────────────────

  describe("responseSuccessHandler", () => {
    it("should log debug message when response has a status", () => {
      const response = {
        status: 200,
        statusText: "OK",
        config: { method: "GET", url: "/api/test" },
      };

      apiUtils.responseSuccessHandler(response);

      expect(consola.debug).toHaveBeenCalled();
    });

    it("should not throw when response is undefined", () => {
      expect(() => apiUtils.responseSuccessHandler(undefined)).not.toThrow();
      expect(consola.debug).not.toHaveBeenCalled();
    });

    it("should not throw when response has no status", () => {
      expect(() => apiUtils.responseSuccessHandler({})).not.toThrow();
      expect(consola.debug).not.toHaveBeenCalled();
    });
  });

  // ─── responseErrorHandler ─────────────────────────────────────────────────

  describe("responseErrorHandler", () => {
    it("should log error and return undefined for 404 response", async () => {
      const error = {
        response: {
          status: 404,
          statusText: "Not Found",
          config: { method: "GET", url: "/api/test" },
          data: { error: "Not found" },
        },
      };

      const result = await apiUtils.responseErrorHandler(error);

      expect(consola.error).toHaveBeenCalled();
      expect(result).toBeUndefined();
      expect(mockExit).not.toHaveBeenCalled();
    });

    it("should log error and return undefined for 400 response", async () => {
      const error = {
        response: {
          status: 400,
          statusText: "Bad Request",
          config: { method: "POST", url: "/api/test" },
          data: { error: "Bad request" },
        },
      };

      const result = await apiUtils.responseErrorHandler(error);

      expect(consola.error).toHaveBeenCalled();
      expect(result).toBeUndefined();
      expect(mockExit).not.toHaveBeenCalled();
    });

    it("should log error and call process.exit(1) for 422 response (then rethrows since exit is mocked)", async () => {
      const error = {
        response: {
          status: 422,
          statusText: "Unprocessable Entity",
          config: { method: "POST", url: "/api/test" },
          data: { errors: ["Validation failed"] },
        },
      };

      // With mocked process.exit, execution continues to `throw error`
      await expect(apiUtils.responseErrorHandler(error)).rejects.toMatchObject({ response: { status: 422 } });

      expect(consola.error).toHaveBeenCalled();
      expect(mockExit).toHaveBeenCalledWith(1);
    });

    it("should log debug and NOT call process.exit for 401 response (rethrows after logging)", async () => {
      const error = {
        response: {
          status: 401,
          statusText: "Unauthorized",
          config: { method: "GET", url: "/api/test" },
          data: { error: "Unauthorized" },
        },
      };

      // 401 logs debug then falls through to `throw error` — expect it to throw
      await expect(apiUtils.responseErrorHandler(error)).rejects.toMatchObject({ response: { status: 401 } });

      expect(consola.debug).toHaveBeenCalled();
      expect(mockExit).not.toHaveBeenCalled();
    });

    it("should log error and call process.exit for 403 response (then rethrows since exit is mocked)", async () => {
      const error = {
        response: {
          status: 403,
          statusText: "Forbidden",
          config: { method: "GET", url: "/api/test" },
          data: { error: "Forbidden" },
        },
      };

      // With mocked process.exit, execution continues to `throw error`
      await expect(apiUtils.responseErrorHandler(error)).rejects.toMatchObject({ response: { status: 403 } });

      expect(consola.error).toHaveBeenCalled();
      expect(mockExit).toHaveBeenCalledWith(1);
    });

    it("should rethrow error when there is no response property (unhandled error)", async () => {
      const error = new Error("Network error");

      await expect(apiUtils.responseErrorHandler(error)).rejects.toThrow("Network error");
      expect(mockExit).not.toHaveBeenCalled();
    });
  });

  // ─── checkAuthorizePartners ───────────────────────────────────────────────

  describe("checkAuthorizePartners", () => {
    it("should call firmCredentials.getPartnerCredentials and return its result", () => {
      const mockCredentials = { access_token: "partner_token_123" };
      firmCredentialsModule.firmCredentials.getPartnerCredentials.mockReturnValue(mockCredentials);

      const result = apiUtils.checkAuthorizePartners(42);

      expect(firmCredentialsModule.firmCredentials.getPartnerCredentials).toHaveBeenCalledWith(42);
      expect(result).toEqual(mockCredentials);
    });
  });
});
