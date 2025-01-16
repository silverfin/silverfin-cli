const { firmCredentials } = require("../../../lib/api/firmCredentials");
const { AxiosFactory } = require("../../../lib/api/axiosFactory");
const open = require("open");
const { consola } = require("consola");

const mockPrompt = jest.fn();
jest.mock("prompt-sync", () => {
  return () => mockPrompt;
});

const { SilverfinAuthorizer } = require("../../../lib/api/silverfinAuthorizer"); // it has to be after mock prompt

jest.mock("../../../lib/api/firmCredentials", () => ({
  firmCredentials: {
    getHost: jest.fn(),
    getTokenPair: jest.fn(),
    storeNewTokenPair: jest.fn(),
    getPartnerCredentials: jest.fn(),
    storePartnerApiKey: jest.fn(),
  },
}));

jest.mock("../../../lib/api/axiosFactory", () => ({
  AxiosFactory: {
    createInstance: jest.fn(),
    createAuthInstanceForFirm: jest.fn(),
  },
}));

jest.mock("open");
jest.mock("consola");

let mockAxiosInstance;

describe("SilverfinAuthorizer", () => {
  let exitSpy;
  const mockStoredFirmId = "5000";
  const mockFirmId = "123";
  const mockAuthCode = "auth_code_123";
  const mockTokenResponse = {
    data: {
      access_token: "mock_access_token",
      refresh_token: "mock_refresh_token",
      expires_in: 7200,
    },
  };
  const mockFirmResponse = {
    data: {
      name: "Test Firm",
    },
  };
  const mockPartnerId = "500";
  const mockPartnerStoredToken = {
    id: 500,
    name: "Partner-Name",
    token: "stored-token",
  };

  beforeEach(() => {
    jest.clearAllMocks();

    firmCredentials.getHost.mockReturnValue("https://api.test.com");
    process.env.SF_API_CLIENT_ID = "test_client_id";
    process.env.SF_API_SECRET = "test_secret";

    // Mock prompt responses
    mockPrompt
      .mockReturnValueOnce(mockFirmId) // First prompt for firm ID
      .mockReturnValueOnce(mockAuthCode); // Second prompt for auth code

    // Mock axios responses
    mockAxiosInstance = {
      post: jest.fn(),
      get: jest.fn(),
    };
    mockAxiosInstance.post.mockResolvedValue(mockTokenResponse);
    mockAxiosInstance.get.mockResolvedValue(mockFirmResponse);
    AxiosFactory.createInstance.mockReturnValue(mockAxiosInstance);
    AxiosFactory.createAuthInstanceForFirm.mockReturnValue(mockAxiosInstance);

    // Mock process.exit
    exitSpy = jest.spyOn(process, "exit").mockImplementation((code) => {
      throw new Error(`Process.exit called with code ${code}`);
    });
  });

  afterEach(() => {
    exitSpy.mockRestore();
  });

  describe("authorizeFirm", () => {
    it("should successfully store new tokens when they dont exist", async () => {
      await SilverfinAuthorizer.authorizeFirm(mockStoredFirmId);

      expect(mockPrompt).toHaveBeenNthCalledWith(
        1,
        "Enter the firm ID (leave blank to use 5000): ",
        { value: "5000" }
      );
      expect(mockPrompt).toHaveBeenNthCalledWith(
        2,
        "Enter your API authorization code: ",
        { echo: "*" }
      );

      expect(open).toHaveBeenCalledWith(
        expect.stringContaining("api.test.com/f/123/oauth/authorize")
      );

      expect(AxiosFactory.createAuthInstanceForFirm).toHaveBeenCalledWith(
        mockFirmId
      );

      expect(mockAxiosInstance.post).toHaveBeenCalledWith(
        expect.stringContaining("api.test.com/f/123/oauth/token")
      );

      expect(mockAxiosInstance.get).toHaveBeenCalledWith("/user/firm");

      expect(firmCredentials.storeNewTokenPair).toHaveBeenCalledWith(
        mockFirmId,
        mockTokenResponse.data
      );

      expect(consola.error).not.toHaveBeenCalled();
    });

    it("should succesfully store new tokens when they exist", async () => {
      await SilverfinAuthorizer.authorizeFirm(mockFirmId);

      expect(open).toHaveBeenCalledWith(
        expect.stringContaining("api.test.com/f/123/oauth/authorize")
      );

      expect(mockAxiosInstance.post).toHaveBeenCalledWith(
        expect.stringContaining("api.test.com/f/123/oauth/token")
      );

      expect(mockAxiosInstance.get).toHaveBeenCalledWith("/user/firm");

      expect(firmCredentials.storeNewTokenPair).toHaveBeenCalledWith(
        mockFirmId,
        mockTokenResponse.data
      );

      expect(consola.error).not.toHaveBeenCalled();
    });

    it("should raise an error when firm id is missing", async () => {
      mockPrompt.mockReset();
      mockPrompt.mockReturnValueOnce(""); // First prompt for firm ID

      await expect(async () => {
        await SilverfinAuthorizer.authorizeFirm();
      }).rejects.toThrow("Process.exit called with code 1");

      expect(mockPrompt).toHaveBeenNthCalledWith(1, "Enter the firm ID: ");

      expect(open).not.toHaveBeenCalled();

      expect(AxiosFactory.createAuthInstanceForFirm).not.toHaveBeenCalled();
      expect(AxiosFactory.createInstance).not.toHaveBeenCalled();

      expect(firmCredentials.storeNewTokenPair).not.toHaveBeenCalled();

      expect(consola.error).toHaveBeenCalledWith(
        "Firm ID is missing. Please provide a valid one."
      );
      expect(exitSpy).toHaveBeenCalledWith(1);
    });

    it("should handle response errors", async () => {
      mockAxiosInstance.post.mockReset();
      mockAxiosInstance.post.mockRejectedValueOnce({
        response: {
          status: 400,
          statusText: "Bad Request",
          data: {
            error_description:
              "The provided authorization grant is invalid, expired, revoked, does not match the redirection URI used in the authorization request, or was issued to another client.",
          },
        },
      });

      await expect(async () => {
        await SilverfinAuthorizer.authorizeFirm(mockFirmId);
      }).rejects.toThrow("Process.exit called with code 1");

      expect(consola.error).toHaveBeenCalledWith(
        "Response Status: 400 (Bad Request)"
      );
      expect(consola.error).toHaveBeenCalledWith(
        'Error description: "The provided authorization grant is invalid, expired, revoked, does not match the redirection URI used in the authorization request, or was issued to another client."'
      );

      expect(firmCredentials.storeNewTokenPair).not.toHaveBeenCalled();
    });

    it("should not raise errors when getting the firm name fails", async () => {
      mockAxiosInstance.get.mockReset();
      mockAxiosInstance.get.mockRejectedValueOnce(
        new Error("Failed to get firm name")
      );

      await SilverfinAuthorizer.authorizeFirm(mockFirmId);

      expect(consola.error).not.toHaveBeenCalled();

      expect(firmCredentials.storeNewTokenPair).toHaveBeenCalledWith(
        mockFirmId,
        mockTokenResponse.data
      );
    });
  });

  describe("refreshFirm", () => {
    it("should store provided tokens", async () => {
      const mockTokenPair = {
        accessToken: "stored-access",
        refreshToken: "stored-refresh",
      };
      firmCredentials.getTokenPair.mockReturnValue(mockTokenPair);

      await SilverfinAuthorizer.refreshFirm(mockFirmId);

      expect(mockAxiosInstance.post).toHaveBeenCalledWith(
        "https://api.test.com/f/123/oauth/token",
        {
          client_id: "test_client_id",
          client_secret: "test_secret",
          redirect_uri: "urn%3Aietf%3Awg%3Aoauth%3A2.0%3Aoob",
          grant_type: "refresh_token",
          refresh_token: "stored-refresh",
          access_token: "stored-access",
        }
      );

      expect(consola.error).not.toHaveBeenCalled();

      expect(firmCredentials.storeNewTokenPair).toHaveBeenCalledWith(
        mockFirmId,
        mockTokenResponse.data
      );
    });

    it("should raise an error when there are no previous tokens", async () => {
      firmCredentials.getTokenPair.mockReturnValue(null);

      await expect(async () => {
        await SilverfinAuthorizer.refreshFirm(mockFirmId);
      }).rejects.toThrow("Process.exit called with code 1");

      expect(mockAxiosInstance.post).not.toHaveBeenCalled();
      expect(mockAxiosInstance.get).not.toHaveBeenCalled();

      expect(consola.error).toHaveBeenCalledWith(
        "Firm 123 is not authorized. Please authorize the firm first"
      );

      expect(firmCredentials.storeNewTokenPair).not.toHaveBeenCalled();
    });

    it("should handle response errors", async () => {
      const mockTokenPair = {
        accessToken: "stored-access",
        refreshToken: "stored-refresh",
      };
      firmCredentials.getTokenPair.mockReturnValue(mockTokenPair);
      mockAxiosInstance.post.mockReset();
      mockAxiosInstance.post.mockRejectedValueOnce({
        response: {
          status: 401,
          statusText: "Unauthorized",
          data: {
            error_description: "Invalid refresh token",
          },
        },
      });

      await expect(async () => {
        await SilverfinAuthorizer.refreshFirm(mockFirmId);
      }).rejects.toThrow("Process.exit called with code 1");

      expect(consola.error).toHaveBeenCalledWith(
        "Response Status: 401 (Unauthorized)",
        "\nError description: Invalid refresh token",
        "\nError refreshing the tokens. Try running the authentication process again"
      );

      expect(firmCredentials.storeNewTokenPair).not.toHaveBeenCalled();
    });
  });

  describe("refreshPartner", () => {
    it("should store the new API key", async () => {
      firmCredentials.getPartnerCredentials.mockReturnValue(
        mockPartnerStoredToken
      );
      const mockTokenResponse = {
        data: {
          api_key: "new-api-key",
        },
      };
      mockAxiosInstance.post.mockReset();
      mockAxiosInstance.post.mockResolvedValueOnce(mockTokenResponse);

      await SilverfinAuthorizer.refreshPartner(mockPartnerId);

      expect(mockAxiosInstance.post).toHaveBeenCalledWith(
        "https://api.test.com/api/partner/v1/refresh_api_key?api_key=stored-token"
      );

      expect(consola.error).not.toHaveBeenCalled();

      expect(firmCredentials.storePartnerApiKey).toHaveBeenCalledWith(
        mockPartnerId,
        mockTokenResponse.data.api_key,
        mockPartnerStoredToken.name
      );
    });

    it("should raise an error when there are no previous tokens", async () => {
      firmCredentials.getPartnerCredentials.mockReturnValue(null);

      await expect(async () => {
        await SilverfinAuthorizer.refreshPartner("partner_123");
      }).rejects.toThrow("Process.exit called with code 1");

      expect(mockAxiosInstance.post).not.toHaveBeenCalled();
      expect(mockAxiosInstance.get).not.toHaveBeenCalled();

      expect(consola.error).toHaveBeenCalledWith(
        "Partner partner_123 is not authorized. Please authorize the partner first"
      );

      expect(firmCredentials.storePartnerApiKey).not.toHaveBeenCalled();
    });

    it("should handle response errors", async () => {
      firmCredentials.getPartnerCredentials.mockReturnValue(
        mockPartnerStoredToken
      );
      mockAxiosInstance.post.mockReset();
      mockAxiosInstance.post.mockRejectedValueOnce({
        response: {
          status: 401,
          statusText: "Unauthorized",
        },
      });

      await expect(async () => {
        await SilverfinAuthorizer.refreshPartner(mockPartnerId);
      }).rejects.toThrow("Process.exit called with code 1");

      expect(consola.error).toHaveBeenCalledWith(
        "Response Status: 401 (Unauthorized). An error occurred trying to refresh the partner API key"
      );

      expect(firmCredentials.storePartnerApiKey).not.toHaveBeenCalled();
    });
  });
});
