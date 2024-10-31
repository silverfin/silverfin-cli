const fs = require("fs");
const path = require("path");

jest.mock("fs");

const { firmCredentials } = require("../../../lib/api/firmCredentials");

describe("FirmCredentials", () => {
  let mockConfig;

  beforeEach(() => {
    jest.clearAllMocks();
    mockConfig = {
      defaultFirmIDs: {},
      host: "https://live.getsilverfin.com",
    };

    fs.existsSync.mockReturnValue(true);
    fs.readFileSync.mockReturnValue(JSON.stringify(mockConfig));
    jest.resetModules();

    firmCredentials.loadCredentials();
  });

  describe("setHost and getHost", () => {
    it("should set and get the host correctly", () => {
      const testHost = "https://test.getsilverfin.com";

      let writtenData;
      fs.writeFileSync.mockImplementation((_, data) => {
        writtenData = JSON.parse(data);
      });

      firmCredentials.setHost(testHost);

      expect(fs.writeFileSync).toHaveBeenCalledWith(
        expect.any(String),
        JSON.stringify({ defaultFirmIDs: {}, host: testHost }, null, 2),
        "utf8",
        expect.any(Function)
      );

      expect(writtenData.host).toBe(testHost);
      expect(firmCredentials.getHost()).toBe(testHost);
    });

    it("should return environment variable host if set", () => {
      const envHost = "https://env.getsilverfin.com";
      process.env.SF_HOST = envHost;
      fs.readFileSync.mockReturnValue(
        JSON.stringify({
          host: "https://stored-host.getsilverfin.com",
        })
      );
      firmCredentials.setHost("https://new-host.getsilverfin.com");

      expect(firmCredentials.getHost()).toBe(envHost);

      delete process.env.SF_HOST;
    });

    it("should return default host if not set", () => {
      delete process.env.SF_HOST;
      fs.readFileSync.mockReturnValue(JSON.stringify({}));
      jest.resetModules();

      expect(firmCredentials.getHost()).toBe("https://live.getsilverfin.com");
    });
  });
});
