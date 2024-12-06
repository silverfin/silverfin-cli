const { firmCredentials } = require("../../../lib/api/firmCredentials");
const axios = require("axios");
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

jest.mock("axios");
jest.mock("open");
jest.mock("consola");

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
    axios.mockResolvedValueOnce(mockTokenResponse); // For token request
    axios.get.mockResolvedValueOnce(mockFirmResponse); // For firm name request

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

      expect(axios).toHaveBeenCalledWith(
        expect.objectContaining({
          method: "POST",
          url: expect.stringContaining("api.test.com/f/123/oauth/token"),
        })
      );
      expect(axios.get).toHaveBeenCalledWith("/user/firm");

      expect(firmCredentials.storeNewTokenPair).toHaveBeenCalledWith(
        mockFirmId,
        mockTokenResponse.data
      );

      expect(consola.error).not.toHaveBeenCalled();
    });
  });

  it("should succesfully store new tokens when they exist", async () => {
    await SilverfinAuthorizer.authorizeFirm(mockFirmId);

    expect(open).toHaveBeenCalledWith(
      expect.stringContaining("api.test.com/f/123/oauth/authorize")
    );

    expect(axios).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "POST",
        url: expect.stringContaining("api.test.com/f/123/oauth/token"),
      })
    );
    expect(axios.get).toHaveBeenCalledWith("/user/firm");

    expect(firmCredentials.storeNewTokenPair).toHaveBeenCalledWith(
      mockFirmId,
      mockTokenResponse.data
    );

    expect(consola.error).not.toHaveBeenCalled();
  });

  it("should handle missing firm id", async () => {
    mockPrompt.mockReset();
    mockPrompt.mockReturnValueOnce(""); // First prompt for firm ID

    await expect(async () => {
      await SilverfinAuthorizer.authorizeFirm();
    }).rejects.toThrow("Process.exit called with code 1");

    expect(mockPrompt).toHaveBeenNthCalledWith(1, "Enter the firm ID: ");

    expect(open).not.toHaveBeenCalled();

    expect(axios).not.toHaveBeenCalled();

    expect(firmCredentials.storeNewTokenPair).not.toHaveBeenCalled();

    expect(consola.error).toHaveBeenCalledWith(
      "Firm ID is missing. Please provide a valid one."
    );
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("should handle response errors", async () => {
    axios.mockReset();
    axios.mockRejectedValueOnce({
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
    axios.get.mockReset();
    axios.get.mockRejectedValueOnce(new Error("Failed to get firm name"));

    await SilverfinAuthorizer.authorizeFirm(mockFirmId);

    expect(consola.error).not.toHaveBeenCalled();

    expect(firmCredentials.storeNewTokenPair).toHaveBeenCalledWith(
      mockFirmId,
      mockTokenResponse.data
    );
  });
});
