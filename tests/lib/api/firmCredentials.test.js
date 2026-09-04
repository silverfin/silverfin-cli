const fs = require("fs");
const { consola } = require("consola");

jest.mock("fs");
jest.mock("consola");

jest.mock("os", () => ({
  homedir: jest.fn().mockReturnValue("/test/home"),
}));

// The module below instantiates a singleton at require-time (`new FirmCredentials()`), whose
// constructor calls `loadCredentials()`. Give the automocked fs sane defaults first, or that call
// hits `JSON.parse(undefined)` and now fails loudly via `process.exit` instead of the old silent
// `{}` fallback.
fs.existsSync.mockReturnValue(true);
fs.readFileSync.mockReturnValue(JSON.stringify({ defaultFirmIDs: {}, host: "https://live.getsilverfin.com" }));

const { firmCredentials } = require("../../../lib/api/firmCredentials");

describe("FirmCredentials", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("initialization", () => {
    let originalFsExistsSync;
    let originalFsReadFileSync;

    beforeEach(() => {
      jest.clearAllMocks();
      originalFsExistsSync = fs.existsSync;
      originalFsReadFileSync = fs.readFileSync;
    });

    afterEach(() => {
      fs.existsSync = originalFsExistsSync;
      fs.readFileSync = originalFsReadFileSync;
    });

    it("creates the .silverfin directory if it does not exist", () => {
      fs.existsSync = jest
        .fn()
        .mockReturnValueOnce(false) // Directory doesn't exist
        .mockReturnValueOnce(false); // File doesn't exist

      jest.isolateModules(() => {
        require("../../../lib/api/firmCredentials"); // Import the module, which will run the constructor
      });

      expect(fs.mkdirSync).toHaveBeenCalledWith("/test/home/.silverfin");
    });

    it("does not create the .silverfin directory if it already exists", () => {
      fs.existsSync = jest.fn().mockReturnValueOnce(true).mockReturnValueOnce(false);

      jest.isolateModules(() => {
        require("../../../lib/api/firmCredentials"); // Import the module, which will run the constructor
      });

      expect(fs.mkdirSync).not.toHaveBeenCalled();
    });

    it("creates the credentials file if it does not exist", () => {
      fs.existsSync = jest
        .fn()
        .mockReturnValueOnce(true) // Directory exists
        .mockReturnValueOnce(false); // File doesn't exist

      jest.isolateModules(() => {
        require("../../../lib/api/firmCredentials"); // Import the module, which will run the constructor
      });

      expect(fs.writeFileSync).toHaveBeenCalledWith(
        "/test/home/.silverfin/config.json",
        JSON.stringify(
          {
            defaultFirmIDs: {},
            host: "https://live.getsilverfin.com",
          },
          null,
          2
        ),
        "utf8"
      );
    });

    it("loads existing credentials if the file exists", () => {
      const mockCredentials = {
        firm123: { accessToken: "test-token", refreshToken: "test-refresh" },
        defaultFirmIDs: { testDir: 123 },
        host: "https://test.example.com",
      };

      fs.existsSync = jest
        .fn()
        .mockReturnValueOnce(true) // Directory exists
        .mockReturnValueOnce(true); // File exists

      fs.readFileSync = jest.fn().mockReturnValueOnce(JSON.stringify(mockCredentials));

      let testFirmCredentials;
      jest.isolateModules(() => {
        const module = require("../../../lib/api/firmCredentials"); // Import the module, which will run the constructor
        testFirmCredentials = module.firmCredentials;
      });

      expect(fs.readFileSync).toHaveBeenCalledWith("/test/home/.silverfin/config.json", "utf-8");
      expect(testFirmCredentials.data).toEqual(mockCredentials);
    });

    it("adds default values if they are missing from existing credentials", () => {
      const mockCredentials = {
        firm123: { accessToken: "test-token", refreshToken: "test-refresh" },
      };

      fs.existsSync = jest
        .fn()
        .mockReturnValueOnce(true) // Directory exists
        .mockReturnValueOnce(true); // File exists

      fs.readFileSync = jest.fn().mockReturnValueOnce(JSON.stringify(mockCredentials));

      let testFirmCredentials;
      jest.isolateModules(() => {
        const module = require("../../../lib/api/firmCredentials"); // Import the module, which will run the constructor
        testFirmCredentials = module.firmCredentials;
      });

      expect(testFirmCredentials.data).toHaveProperty("defaultFirmIDs", {});
      expect(testFirmCredentials.data).toHaveProperty("host", "https://live.getsilverfin.com");
      expect(testFirmCredentials.data.firm123).toEqual(mockCredentials.firm123);
    });
  });

  describe("loadCredentials", () => {
    beforeEach(() => {
      jest.clearAllMocks();
    });

    it("loads credentials from file successfully", () => {
      const initialCredentials = {
        firm123: { accessToken: "initial-token", refreshToken: "initial-refresh" },
        defaultFirmIDs: {},
        host: "https://initial.getsilverfin.com",
      };

      const newCredentials = {
        firm456: { accessToken: "new-token", refreshToken: "new-refresh" },
        defaultFirmIDs: { testDir: 456 },
        host: "https://new.getsilverfin.com",
      };

      let testFirmCredentials;
      jest.isolateModules(() => {
        fs.existsSync.mockReturnValue(true);
        fs.readFileSync.mockReturnValueOnce(JSON.stringify(initialCredentials));

        const module = require("../../../lib/api/firmCredentials");
        testFirmCredentials = module.firmCredentials;

        expect(testFirmCredentials.data).toEqual(initialCredentials);
      });

      fs.readFileSync.mockReturnValueOnce(JSON.stringify(newCredentials));

      testFirmCredentials.loadCredentials();

      expect(testFirmCredentials.data).toEqual(newCredentials);
    });

    it("logs an error and falls back to {} (without exiting) when the credentials file contains invalid JSON", () => {
      let testFirmCredentials;
      jest.isolateModules(() => {
        fs.existsSync.mockReturnValue(true);
        fs.readFileSync.mockReturnValueOnce(
          JSON.stringify({
            firm123: { accessToken: "initial-token", refreshToken: "initial-refresh" },
            defaultFirmIDs: {},
            host: "https://initial.getsilverfin.com",
          })
        );

        const module = require("../../../lib/api/firmCredentials");
        testFirmCredentials = module.firmCredentials;
      });

      const exitSpy = jest.spyOn(process, "exit").mockImplementation(() => {});

      fs.readFileSync.mockReturnValueOnce("not valid json{{{");
      testFirmCredentials.loadCredentials();

      expect(consola.error).toHaveBeenCalled();
      expect(exitSpy).not.toHaveBeenCalled();
      expect(testFirmCredentials.data).toEqual({ defaultFirmIDs: {}, host: "https://live.getsilverfin.com" });

      exitSpy.mockRestore();
    });

    it("logs an error and falls back to {} (without exiting) when the credentials file can't be read", () => {
      let testFirmCredentials;
      jest.isolateModules(() => {
        fs.existsSync.mockReturnValue(true);
        fs.readFileSync.mockReturnValueOnce(JSON.stringify({ defaultFirmIDs: {}, host: "https://initial.getsilverfin.com" }));

        const module = require("../../../lib/api/firmCredentials");
        testFirmCredentials = module.firmCredentials;
      });

      const exitSpy = jest.spyOn(process, "exit").mockImplementation(() => {});

      fs.readFileSync.mockImplementationOnce(() => {
        throw new Error("EACCES: permission denied");
      });
      testFirmCredentials.loadCredentials();

      expect(consola.error).toHaveBeenCalled();
      expect(exitSpy).not.toHaveBeenCalled();
      expect(testFirmCredentials.data).toEqual({ defaultFirmIDs: {}, host: "https://live.getsilverfin.com" });

      exitSpy.mockRestore();
    });

    it.each([["null", "null"], ["an array", "[]"], ["a number", "5"]])(
      "logs an error and falls back to {} when the credentials file parses to %s instead of an object",
      (_label, jsonBody) => {
        let testFirmCredentials;
        jest.isolateModules(() => {
          fs.existsSync.mockReturnValue(true);
          fs.readFileSync.mockReturnValueOnce(JSON.stringify({ defaultFirmIDs: {}, host: "https://initial.getsilverfin.com" }));

          const module = require("../../../lib/api/firmCredentials");
          testFirmCredentials = module.firmCredentials;
        });

        fs.readFileSync.mockReturnValueOnce(jsonBody);

        expect(() => testFirmCredentials.loadCredentials()).not.toThrow();

        expect(consola.error).toHaveBeenCalled();
        expect(testFirmCredentials.data).toEqual({ defaultFirmIDs: {}, host: "https://live.getsilverfin.com" });
      }
    );
  });

  describe("saveCredentials refusing to persist a failed load", () => {
    beforeEach(() => {
      jest.clearAllMocks();
    });

    it("refuses to write (and returns false), without exiting, if the last loadCredentials() call failed", () => {
      let testFirmCredentials;
      jest.isolateModules(() => {
        fs.existsSync.mockReturnValue(true);
        fs.readFileSync.mockReturnValueOnce(JSON.stringify({ defaultFirmIDs: {}, host: "https://initial.getsilverfin.com" }));

        const module = require("../../../lib/api/firmCredentials");
        testFirmCredentials = module.firmCredentials;
      });

      fs.readFileSync.mockReturnValueOnce("not valid json{{{");
      testFirmCredentials.loadCredentials();

      const exitSpy = jest.spyOn(process, "exit").mockImplementation(() => {});

      expect(testFirmCredentials.saveCredentials()).toBe(false);

      expect(exitSpy).not.toHaveBeenCalled();
      expect(fs.writeFileSync).not.toHaveBeenCalled();
      expect(consola.error).toHaveBeenCalledWith(expect.stringContaining("the last load failed"));

      exitSpy.mockRestore();
    });
  });

  describe("field preservation across a store -> save -> load cycle", () => {
    beforeEach(() => {
      jest.clearAllMocks();
    });

    it("keeps a per-firm field it doesn't recognize through storeNewTokenPair, saveCredentials, and loadCredentials", () => {
      const initialCredentials = {
        firm123: { accessToken: "old-token", refreshToken: "old-refresh", futureFlag: true },
        defaultFirmIDs: {},
        host: "https://test.getsilverfin.com",
      };

      let testFirmCredentials;
      let writtenData;

      jest.isolateModules(() => {
        fs.existsSync.mockReturnValue(true);
        fs.readFileSync.mockReturnValueOnce(JSON.stringify(initialCredentials));

        const module = require("../../../lib/api/firmCredentials");
        testFirmCredentials = module.firmCredentials;

        fs.writeFileSync.mockImplementation((_, data) => {
          writtenData = data;
        });

        testFirmCredentials.storeNewTokenPair("firm123", {
          access_token: "new-token",
          refresh_token: "new-refresh",
        });

        // Complete the cycle: load back exactly what was just written.
        fs.readFileSync.mockReturnValueOnce(writtenData);
        testFirmCredentials.loadCredentials();

        expect(testFirmCredentials.data.firm123).toEqual({
          accessToken: "new-token",
          refreshToken: "new-refresh",
          futureFlag: true,
        });
      });
    });
  });

  describe("saveCredentials", () => {
    beforeEach(() => {
      jest.clearAllMocks();
    });

    const initialCredentials = {
      firm123: { accessToken: "test-token", refreshToken: "test-refresh" },
      defaultFirmIDs: {},
      host: "https://test.getsilverfin.com",
    };

    const newCredentials = {
      firm456: { accessToken: "new-token", refreshToken: "new-refresh" },
      defaultFirmIDs: { testDir: 456 },
      host: "https://new.getsilverfin.com",
    };

    it("writes credentials to file successfully", () => {
      let testFirmCredentials;
      jest.isolateModules(() => {
        fs.existsSync.mockReturnValue(true);
        fs.readFileSync.mockReturnValueOnce(JSON.stringify(initialCredentials));

        const module = require("../../../lib/api/firmCredentials");
        testFirmCredentials = module.firmCredentials;

        expect(testFirmCredentials.data).toEqual(initialCredentials);

        testFirmCredentials.data = newCredentials;
        testFirmCredentials.saveCredentials();

        expect(fs.writeFileSync).toHaveBeenCalledWith("/test/home/.silverfin/config.json", JSON.stringify(newCredentials, null, 2), "utf8");
      });
    });

    it("handles file system error when saving credentials", () => {
      let testFirmCredentials;
      jest.isolateModules(() => {
        fs.existsSync.mockReturnValue(true);
        fs.readFileSync.mockReturnValueOnce(JSON.stringify({}));

        const module = require("../../../lib/api/firmCredentials");
        testFirmCredentials = module.firmCredentials;

        fs.writeFileSync.mockImplementationOnce(() => {
          throw new Error("Write file error");
        });

        expect(testFirmCredentials.saveCredentials()).toBe(false);

        expect(consola.error).toHaveBeenCalledWith(expect.stringContaining("could not be written: Write file error"));
      });
    });
  });

  describe("storePartnerApiKey", () => {
    beforeEach(() => {
      jest.clearAllMocks();
    });

    it("returns false, without throwing, when saveCredentials() fails", () => {
      let testFirmCredentials;
      jest.isolateModules(() => {
        fs.existsSync.mockReturnValue(true);
        fs.readFileSync.mockReturnValueOnce(JSON.stringify({ defaultFirmIDs: {}, host: "https://initial.getsilverfin.com" }));

        const module = require("../../../lib/api/firmCredentials");
        testFirmCredentials = module.firmCredentials;
      });

      // A failed load blocks saveCredentials() from persisting - storePartnerApiKey() must
      // surface that instead of reporting success.
      fs.readFileSync.mockReturnValueOnce("not valid json{{{");
      testFirmCredentials.loadCredentials();

      expect(testFirmCredentials.storePartnerApiKey("1234", "an-api-key", "Partner name")).toBe(false);
    });
  });

  describe("propagating a failed save", () => {
    beforeEach(() => {
      jest.clearAllMocks();
    });

    function firmCredentialsAfterAFailedLoad() {
      let testFirmCredentials;
      jest.isolateModules(() => {
        fs.existsSync.mockReturnValue(true);
        fs.readFileSync.mockReturnValueOnce(JSON.stringify({ defaultFirmIDs: {}, host: "https://initial.getsilverfin.com" }));

        const module = require("../../../lib/api/firmCredentials");
        testFirmCredentials = module.firmCredentials;
      });

      fs.readFileSync.mockReturnValueOnce("not valid json{{{");
      testFirmCredentials.loadCredentials();

      return testFirmCredentials;
    }

    it("storeNewTokenPair returns false when saveCredentials() fails", () => {
      const testFirmCredentials = firmCredentialsAfterAFailedLoad();
      expect(testFirmCredentials.storeNewTokenPair("firm123", { access_token: "a", refresh_token: "b" })).toBe(false);
    });

    it("storeFirmName returns false when saveCredentials() fails", () => {
      const testFirmCredentials = firmCredentialsAfterAFailedLoad();
      expect(testFirmCredentials.storeFirmName("firm123", "Test firm")).toBe(false);
    });

    it("setDefaultFirmId returns false when saveCredentials() fails", () => {
      const testFirmCredentials = firmCredentialsAfterAFailedLoad();
      expect(testFirmCredentials.setDefaultFirmId("firm123")).toBe(false);
    });

    it("setHost returns false when saveCredentials() fails", () => {
      const testFirmCredentials = firmCredentialsAfterAFailedLoad();
      expect(testFirmCredentials.setHost("https://new.getsilverfin.com")).toBe(false);
    });
  });

  describe("setHost and getHost", () => {
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

    it("should set and get the host correctly", () => {
      const testHost = "https://test.getsilverfin.com";

      let writtenData;
      fs.writeFileSync.mockImplementation((_, data) => {
        writtenData = JSON.parse(data);
      });

      firmCredentials.setHost(testHost);

      expect(fs.writeFileSync).toHaveBeenCalledWith(expect.any(String), JSON.stringify({ defaultFirmIDs: {}, host: testHost }, null, 2), "utf8");

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
