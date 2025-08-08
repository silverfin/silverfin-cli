const { consola } = require("consola");
const axios = require("axios");
const { firmCredentials } = require("../../../lib/api/firmCredentials");
const { AxiosFactory } = require("../../../lib/api/internal/axiosFactory");
const AxiosMockAdapter = require("axios-mock-adapter");

jest.mock("consola");
jest.mock("../../../lib/api/firmCredentials", () => ({
  firmCredentials: {
    getHost: jest.fn(),
    getTokenPair: jest.fn(),
    storeNewTokenPair: jest.fn(),
    getPartnerCredentials: jest.fn(),
    storePartnerApiKey: jest.fn(),
  },
}));
jest.spyOn(axios, "create");
axios.get = jest.fn();
axios.post = jest.fn();

describe("AxiosFactory", () => {
  let axiosMockAdapter;
  let exitSpy;

  beforeEach(() => {
    jest.clearAllMocks();

    process.env.SF_BASIC_AUTH = "test_basic_auth";
    process.env.SF_API_CLIENT_ID = "test_client_id";
    process.env.SF_API_SECRET = "test_client_secret";
    exitSpy = jest.spyOn(process, "exit").mockImplementation((code) => {
      throw new Error(`Process.exit called with code ${code}`);
    });

    axiosMockAdapter = new AxiosMockAdapter(axios);
  });

  afterEach(() => {
    exitSpy.mockRestore();

    axiosMockAdapter.restore();
  });

  describe("Create Instance", () => {
    it("should throw an error for invalid type", () => {
      const mockHost = "https://test-api.com";
      firmCredentials.getHost.mockReturnValue(mockHost);
      const mockTokenPair = {
        accessToken: "stored-access",
        refreshToken: "stored-refresh",
      };
      firmCredentials.getTokenPair.mockReturnValue(mockTokenPair);

      expect(() => {
        AxiosFactory.createInstance("invalid", 123);
      }).toThrow("Process.exit called with code 1");

      expect(consola.error).toHaveBeenCalled();
      expect(exitSpy).toHaveBeenCalledWith(1);
    });
  });

  describe("Firm instance", () => {
    const firmId = 50000;
    const mockHost = "https://test-api.com";
    const mockTokenPair = {
      accessToken: "stored-access",
      refreshToken: "stored-refresh",
    };

    it("should create a valid instance", () => {
      firmCredentials.getHost.mockReturnValue(mockHost);
      firmCredentials.getTokenPair.mockReturnValue(mockTokenPair);

      const instance = AxiosFactory.createInstance("firm", firmId);

      expect(instance).toBeDefined();
      expect(instance.defaults.baseURL).toBe(`https://test-api.com/api/v4/f/50000`);
      expect(instance.defaults.headers.Authorization).toBe("Bearer stored-access");
    });

    it("should throw an error for missing tokens and terminate process", () => {
      firmCredentials.getHost.mockReturnValue(mockHost);
      firmCredentials.getTokenPair.mockReturnValue(null);

      expect(() => {
        AxiosFactory.createInstance("firm", firmId);
      }).toThrow("Process.exit called with code 1");

      expect(consola.error).toHaveBeenCalledWith("Missing authorization for firm id: 50000");
      expect(exitSpy).toHaveBeenCalledWith(1);
    });

    it("should refresh tokens on 401 Unauthorized error", async () => {
      const newTokenPair = {
        accessToken: "new-access",
        refreshToken: "new-refresh",
      };
      const newTokenPairResponse = {
        access_token: "new-access",
        refresh_token: "new-refresh",
      };

      firmCredentials.getHost.mockReturnValue(mockHost);
      firmCredentials.getTokenPair.mockReturnValueOnce(mockTokenPair); // original request
      firmCredentials.getTokenPair.mockReturnValueOnce(mockTokenPair); // refresh tokens
      firmCredentials.getTokenPair.mockReturnValueOnce(newTokenPair); // retry request

      const axiosInstance = AxiosFactory.createInstance("firm", firmId);

      expect(axiosInstance).toBeDefined();
      expect(axios.create).toHaveBeenCalled();

      axiosMockAdapter.onGet("/test-endpoint").reply((config) => {
        const token = config.headers.Authorization.split(" ")[1];

        if (token === "stored-access") {
          return [401, "Unauthorized"];
        } else if (token === "new-access") {
          return [200, "Success"];
        } else {
          throw new Error("Unexpected token");
        }
      });

      axiosMockAdapter.onPost(`${mockHost}/f/${firmId}/oauth/token`).reply(200, newTokenPairResponse);
      jest.spyOn(axiosInstance, "post");

      const response = await axiosInstance.get("/test-endpoint");

      expect(axiosMockAdapter.history.get.length).toBe(2);
      expect(axiosMockAdapter.history.post.length).toBe(1);

      expect(firmCredentials.storeNewTokenPair).toHaveBeenCalledWith(String(firmId), newTokenPairResponse);
      expect(response.data).toBe("Success");
    });

    it("should attempt to refresh tokens only once on 401 and terminate the process", async () => {
      firmCredentials.getHost.mockReturnValue(mockHost);
      firmCredentials.getTokenPair.mockReturnValue(mockTokenPair);

      const axiosInstance = AxiosFactory.createInstance("firm", firmId);

      expect(axiosInstance).toBeDefined();
      expect(axios.create).toHaveBeenCalled();

      axiosMockAdapter.onGet("/test-endpoint").reply(401, "Unauthorized");
      axiosMockAdapter.onPost(`${mockHost}/f/${firmId}/oauth/token`).reply(401, "Unauthorized");

      await expect(axiosInstance.get("/test-endpoint")).rejects.toThrow("Process.exit called with code 1");

      expect(axiosMockAdapter.history.get.length).toBe(1);
      expect(axiosMockAdapter.history.post.length).toBe(1);

      expect(firmCredentials.storeNewTokenPair).toHaveBeenCalledTimes(0);
      expect(exitSpy).toHaveBeenCalledWith(1);
      expect(consola.error).toHaveBeenCalledWith("Error refreshing credentials. Try running the authentication process again");
    });

    it("should throw any other response errors", async () => {
      firmCredentials.getHost.mockReturnValue(mockHost);
      firmCredentials.getTokenPair.mockReturnValue(mockTokenPair);

      const axiosInstance = AxiosFactory.createInstance("firm", firmId);

      expect(axiosInstance).toBeDefined();
      expect(axios.create).toHaveBeenCalled();

      axiosMockAdapter.onGet("/test-endpoint").reply(404, "Not found");
      axiosMockAdapter.onPost(`${mockHost}/f/${firmId}/oauth/token`).reply(400);

      await expect(axiosInstance.get("/test-endpoint")).rejects.toThrow();

      expect(axiosMockAdapter.history.get.length).toBe(1);
      expect(axiosMockAdapter.history.post.length).toBe(0);

      expect(firmCredentials.storeNewTokenPair).toHaveBeenCalledTimes(0);

      // Error is raised and not handled by AxiosFactory
      expect(exitSpy).toHaveBeenCalledTimes(0);
      expect(consola.error).toHaveBeenCalledTimes(0);
    });

    it("should throw the error again if there is no response", async () => {
      firmCredentials.getHost.mockReturnValue(mockHost);
      firmCredentials.getTokenPair.mockReturnValue(mockTokenPair);

      const axiosInstance = AxiosFactory.createInstance("firm", firmId);

      expect(axiosInstance).toBeDefined();
      expect(axios.create).toHaveBeenCalled();

      axiosMockAdapter.onGet("/test-endpoint").networkError();

      await expect(axiosInstance.get("/test-endpoint")).rejects.toThrow();

      expect(axiosMockAdapter.history.get.length).toBe(1);
      expect(axiosMockAdapter.history.post.length).toBe(0);

      // Error is raised and not handled by AxiosFactory
      expect(exitSpy).toHaveBeenCalledTimes(0);
      expect(consola.error).toHaveBeenCalledTimes(0);
    });
  });

  describe("Partner instance", () => {
    const mockHost = "https://test-api.com";
    const partnerId = 100;
    const mockPartnerTokens = {
      token: "stored-api-key",
    };

    it("should create a valid instance", () => {
      firmCredentials.getHost.mockReturnValue(mockHost);
      firmCredentials.getPartnerCredentials.mockReturnValue(mockPartnerTokens);

      const axiosInstance = AxiosFactory.createInstance("partner", partnerId);

      expect(axiosInstance).toBeDefined();
      expect(axiosInstance.defaults.baseURL).toBe(`https://test-api.com/api/partner/v1`);

      expect(axiosInstance.defaults.headers.Authorization).toBeUndefined();
    });

    it("should add partner_id and api_key to requests params", async () => {
      firmCredentials.getHost.mockReturnValue(mockHost);
      firmCredentials.getPartnerCredentials.mockReturnValue(mockPartnerTokens);

      const axiosInstance = AxiosFactory.createInstance("partner", partnerId);

      axiosMockAdapter.onGet("/test-endpoint").reply((config) => {
        expect(config.params).toHaveProperty("api_key", "stored-api-key");
        expect(config.params).toHaveProperty("partner_id", partnerId);

        return [200, "Success"];
      });
      jest.spyOn(axiosInstance, "get");

      const response = await axiosInstance.get("/test-endpoint");

      expect(response.data).toBe("Success");
    });

    it("should throw an error for missing API key and terminate process", () => {
      firmCredentials.getHost.mockReturnValue(mockHost);
      firmCredentials.getPartnerCredentials.mockReturnValue(null);

      expect(() => {
        AxiosFactory.createInstance("partner", partnerId);
      }).toThrow("Process.exit called with code 1");

      expect(consola.error).toHaveBeenCalledWith("Missing authorization for partner id: 100");
      expect(exitSpy).toHaveBeenCalledWith(1);
    });

    it("should refresh API key on 401 Unauthorized error", async () => {
      const newApiKey = "new-api-key";

      firmCredentials.getHost.mockReturnValue(mockHost);
      firmCredentials.getPartnerCredentials.mockReturnValueOnce(mockPartnerTokens); // original request
      firmCredentials.getPartnerCredentials.mockReturnValueOnce(mockPartnerTokens); // refresh request
      firmCredentials.getPartnerCredentials.mockReturnValueOnce({
        token: newApiKey,
      }); // new request

      const axiosInstance = AxiosFactory.createInstance("partner", partnerId);

      expect(axiosInstance).toBeDefined();
      expect(axios.create).toHaveBeenCalled();

      axiosMockAdapter.onGet("/test-endpoint").reply((config) => {
        const token = config.params.api_key;

        if (token === "stored-api-key") {
          return [401, "Unauthorized"];
        } else if (token === "new-api-key") {
          return [200, "Success"];
        } else {
          throw new Error("Unexpected token");
        }
      });

      axiosMockAdapter.onPost(`${mockHost}/api/partner/v1/refresh_api_key?api_key=stored-api-key`).reply(200, { api_key: newApiKey });
      jest.spyOn(axiosInstance, "post");

      const response = await axiosInstance.get("/test-endpoint");

      expect(axiosMockAdapter.history.get.length).toBe(2);
      expect(axiosMockAdapter.history.post.length).toBe(1);

      expect(firmCredentials.storePartnerApiKey).toHaveBeenCalledWith(partnerId, newApiKey);
      expect(response.data).toBe("Success");
    });

    it("should attempt to refresh API key only once on 401 and terminate the process", async () => {
      firmCredentials.getHost.mockReturnValue(mockHost);
      firmCredentials.getPartnerCredentials.mockReturnValue(mockPartnerTokens);

      const axiosInstance = AxiosFactory.createInstance("partner", partnerId);

      expect(axiosInstance).toBeDefined();
      expect(axios.create).toHaveBeenCalled();

      axiosMockAdapter.onGet("/test-endpoint").reply(401, "Unauthorized");
      axiosMockAdapter.onPost(`${mockHost}/api/partner/v1/refresh_api_key?api_key=stored-api-key`).reply(401, "Unauthorized");
      jest.spyOn(axiosInstance, "post");

      await expect(axiosInstance.get("/test-endpoint")).rejects.toThrow("Process.exit called with code 1");

      expect(axiosMockAdapter.history.get.length).toBe(1);
      expect(axiosMockAdapter.history.post.length).toBe(1);

      expect(firmCredentials.storeNewTokenPair).toHaveBeenCalledTimes(0);
      expect(exitSpy).toHaveBeenCalledWith(1);
      expect(consola.error).toHaveBeenCalledWith("Error refreshing credentials. Try running the authentication process again");
    });

    it("should throw any other response error", async () => {
      firmCredentials.getHost.mockReturnValue(mockHost);
      firmCredentials.getPartnerCredentials.mockReturnValue(mockPartnerTokens);

      const axiosInstance = AxiosFactory.createInstance("partner", partnerId);

      expect(axiosInstance).toBeDefined();
      expect(axios.create).toHaveBeenCalled();

      axiosMockAdapter.onGet("/test-endpoint").reply(404, "Not found");
      axiosMockAdapter.onPost(`${mockHost}/f/${partnerId}/oauth/token`).reply(400);

      await expect(axiosInstance.get("/test-endpoint")).rejects.toThrow();

      expect(axiosMockAdapter.history.get.length).toBe(1);
      expect(axiosMockAdapter.history.post.length).toBe(0);

      expect(firmCredentials.storeNewTokenPair).toHaveBeenCalledTimes(0);

      // Error is raised and not handled by AxiosFactory
      expect(exitSpy).toHaveBeenCalledTimes(0);
      expect(consola.error).toHaveBeenCalledTimes(0);
    });

    it("should throw the error again if there is no response", async () => {
      firmCredentials.getHost.mockReturnValue(mockHost);
      firmCredentials.getPartnerCredentials.mockReturnValue(mockPartnerTokens);

      const axiosInstance = AxiosFactory.createInstance("partner", partnerId);

      jest.spyOn(axiosInstance, "get");
      axiosInstance.post = jest.fn();

      expect(axiosInstance).toBeDefined();
      expect(axios.create).toHaveBeenCalled();

      axiosMockAdapter.onGet("/test-endpoint").networkError();

      await expect(axiosInstance.get("/test-endpoint")).rejects.toThrow();

      expect(axiosMockAdapter.history.get.length).toBe(1);
      expect(axiosMockAdapter.history.post.length).toBe(0);

      // Error is raised and not handled by AxiosFactory
      expect(exitSpy).toHaveBeenCalledTimes(0);
      expect(consola.error).toHaveBeenCalledTimes(0);
    });
  });

  describe("Staging environment", () => {
    const mockHost = "https://test-api.staging.getsilverfin.com";

    it("should raise an error if environment variable is not set", () => {
      const mockTokenPair = {
        accessToken: "stored-access",
        refreshToken: "stored-refresh",
      };
      delete process.env.SF_BASIC_AUTH;
      firmCredentials.getHost.mockReturnValue(mockHost);
      firmCredentials.getTokenPair.mockReturnValue(mockTokenPair);

      expect(() => {
        AxiosFactory.createInstance("firm", 123);
      }).toThrow("Process.exit called with code 1");

      expect(consola.error).toHaveBeenCalled();
      expect(exitSpy).toHaveBeenCalledWith(1);
    });

    it("should use basic auth for firm instance in staging", () => {
      const firmId = 50000;
      const mockTokenPair = {
        accessToken: "stored-access",
        refreshToken: "stored-refresh",
      };

      firmCredentials.getHost.mockReturnValue(mockHost);
      firmCredentials.getTokenPair.mockReturnValue(mockTokenPair);

      const axiosInstance = AxiosFactory.createInstance("firm", firmId);

      expect(axiosInstance).toBeDefined();
      expect(axiosInstance.defaults.baseURL).toBe(`https://test-api.staging.getsilverfin.com/api/v4/f/50000`);

      expect(axiosInstance.defaults.headers.Authorization).toBe("Basic test_basic_auth");
      expect(axiosInstance.defaults.params).toEqual({
        access_token: "stored-access",
      });
    });

    it("should use basic auth for partner instance in staging", () => {
      const partnerId = 100;
      const mockPartnerTokens = {
        token: "stored-api-key",
      };

      firmCredentials.getHost.mockReturnValue(mockHost);
      firmCredentials.getPartnerCredentials.mockReturnValue(mockPartnerTokens);

      const axiosInstance = AxiosFactory.createInstance("partner", partnerId);

      expect(axiosInstance).toBeDefined();
      expect(axiosInstance.defaults.baseURL).toBe(`https://test-api.staging.getsilverfin.com/api/partner/v1`);

      expect(axiosInstance.defaults.headers.Authorization).toBe("Basic test_basic_auth");
      expect(axiosInstance.defaults.params).toEqual({
        partner_id: partnerId,
        api_key: mockPartnerTokens.token,
      });
    });
  });

  describe("Create auth instance for firm", () => {
    const mockHost = "https://test-api.com";

    it("should not thrown an error for missing tokens", () => {
      firmCredentials.getHost.mockReturnValue(mockHost);
      firmCredentials.getTokenPair.mockReturnValue(null);

      const axiosInstance = AxiosFactory.createAuthInstanceForFirm(123);

      expect(axiosInstance).toBeDefined();
      expect(axios.create).toHaveBeenCalled();

      expect(consola.error).not.toHaveBeenCalled();
      expect(exitSpy).not.toHaveBeenCalled();
    });

    it("should not attempt to refresh tokens", async () => {
      firmCredentials.getHost.mockReturnValue(mockHost);

      const axiosInstance = AxiosFactory.createAuthInstanceForFirm(123);

      expect(axiosInstance).toBeDefined();
      expect(axios.create).toHaveBeenCalled();

      axiosMockAdapter.onGet("/test-endpoint").reply(401, "Unauthorized");
      jest.spyOn(axiosInstance, "post");

      await expect(axiosInstance.get("/test-endpoint")).rejects.toMatchObject({
        response: {
          status: 401,
        },
      });
      expect(firmCredentials.storeNewTokenPair).not.toHaveBeenCalled();
      expect(axiosInstance.post).not.toHaveBeenCalled();
    });

    it("should use basic auth for firm instance in staging", () => {
      const mockHost = "https://test-api.staging.getsilverfin.com";
      const firmId = 50000;
      firmCredentials.getHost.mockReturnValue(mockHost);

      const axiosInstance = AxiosFactory.createAuthInstanceForFirm(firmId);

      expect(axiosInstance).toBeDefined();
      expect(axiosInstance.defaults.baseURL).toBe(`https://test-api.staging.getsilverfin.com/api/v4/f/50000`);

      expect(axiosInstance.defaults.headers.Authorization).toBe("Basic test_basic_auth");
    });
  });
});
