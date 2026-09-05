const fs = require("fs");
const { consola } = require("consola");

jest.mock("fs");
jest.mock("consola");

jest.mock("os", () => ({
  homedir: jest.fn().mockReturnValue("/test/home"),
}));

// The module below instantiates a singleton at require-time (`new FirmCredentials()`), whose
// constructor calls `loadCredentials()`. Give the automocked fs sane defaults first, or that call
// hits `JSON.parse(undefined)`, logging a load-failure error on every test in this file for no
// reason relevant to what each test actually checks.
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

    it("replaces a present but non-object defaultFirmIDs instead of crashing later on it", () => {
      const mockCredentials = { defaultFirmIDs: null, host: "https://test.getsilverfin.com" };

      fs.existsSync = jest.fn().mockReturnValueOnce(true).mockReturnValueOnce(true);
      fs.readFileSync = jest.fn().mockReturnValueOnce(JSON.stringify(mockCredentials));

      let testFirmCredentials;
      jest.isolateModules(() => {
        const module = require("../../../lib/api/firmCredentials");
        testFirmCredentials = module.firmCredentials;
      });

      expect(testFirmCredentials.data).toHaveProperty("defaultFirmIDs", {});
      expect(() => testFirmCredentials.setDefaultFirmId("firm123")).not.toThrow();
    });

    it("replaces a present but non-string host instead of letting it reach getHost()", () => {
      const mockCredentials = { defaultFirmIDs: {}, host: null };

      fs.existsSync = jest.fn().mockReturnValueOnce(true).mockReturnValueOnce(true);
      fs.readFileSync = jest.fn().mockReturnValueOnce(JSON.stringify(mockCredentials));

      let testFirmCredentials;
      jest.isolateModules(() => {
        const module = require("../../../lib/api/firmCredentials");
        testFirmCredentials = module.firmCredentials;
      });

      expect(testFirmCredentials.getHost()).toBe(testFirmCredentials.SF_DEFAULT_HOST);
      // Unlike a missing host (legacy compatibility, silent), a *present* invalid value being
      // replaced - and then persisted on the next save - must not happen without a word: it
      // discards whatever staging/custom host was actually configured.
      expect(consola.warn).toHaveBeenCalledWith(expect.stringContaining("host"));
    });

    it("stays silent when host is simply missing (legacy compatibility, not a corruption)", () => {
      const mockCredentials = { defaultFirmIDs: {} };

      fs.existsSync = jest.fn().mockReturnValueOnce(true).mockReturnValueOnce(true);
      fs.readFileSync = jest.fn().mockReturnValueOnce(JSON.stringify(mockCredentials));

      jest.isolateModules(() => {
        require("../../../lib/api/firmCredentials");
      });

      expect(consola.warn).not.toHaveBeenCalled();
    });

    it("replaces a present but non-object partnerCredentials instead of crashing read paths on it", () => {
      const mockCredentials = { defaultFirmIDs: {}, host: "https://test.getsilverfin.com", partnerCredentials: null };

      fs.existsSync = jest.fn().mockReturnValueOnce(true).mockReturnValueOnce(true);
      fs.readFileSync = jest.fn().mockReturnValueOnce(JSON.stringify(mockCredentials));

      let testFirmCredentials;
      jest.isolateModules(() => {
        const module = require("../../../lib/api/firmCredentials");
        testFirmCredentials = module.firmCredentials;
      });

      expect(testFirmCredentials.data).toHaveProperty("partnerCredentials", {});
      expect(() => testFirmCredentials.listAuthorizedPartners()).not.toThrow();
      expect(testFirmCredentials.listAuthorizedPartners()).toEqual([]);
    });

    it("drops a present but non-object entry inside partnerCredentials instead of crashing read paths on it", () => {
      const mockCredentials = {
        defaultFirmIDs: {},
        host: "https://test.getsilverfin.com",
        partnerCredentials: { 1: null, 2: { name: "Good Partner", token: "abc" } },
      };

      fs.existsSync = jest.fn().mockReturnValueOnce(true).mockReturnValueOnce(true);
      fs.readFileSync = jest.fn().mockReturnValueOnce(JSON.stringify(mockCredentials));

      let testFirmCredentials;
      jest.isolateModules(() => {
        const module = require("../../../lib/api/firmCredentials");
        testFirmCredentials = module.firmCredentials;
      });

      expect(() => testFirmCredentials.listAuthorizedPartners()).not.toThrow();
      expect(testFirmCredentials.listAuthorizedPartners()).toEqual([{ id: "2", name: "Good Partner" }]);

      const exitSpy = jest.spyOn(process, "exit").mockImplementation((code) => {
        throw new Error(`Process.exit called with code ${code}`);
      });
      // A dropped (malformed) entry must read as "not authorized", not silently succeed with no token.
      expect(() => testFirmCredentials.getPartnerCredentials("1")).toThrow("Process.exit called with code 1");
      exitSpy.mockRestore();
    });

    it("drops a present but non-object per-firm record instead of crashing config --list-all", () => {
      const mockCredentials = {
        defaultFirmIDs: {},
        host: "https://test.getsilverfin.com",
        12345: null,
        67890: { accessToken: "a", refreshToken: "b", firmName: "Good Firm" },
      };

      fs.existsSync = jest.fn().mockReturnValueOnce(true).mockReturnValueOnce(true);
      fs.readFileSync = jest.fn().mockReturnValueOnce(JSON.stringify(mockCredentials));

      let testFirmCredentials;
      jest.isolateModules(() => {
        const module = require("../../../lib/api/firmCredentials");
        testFirmCredentials = module.firmCredentials;
      });

      expect(() => testFirmCredentials.listAuthorizedFirms()).not.toThrow();
      expect(testFirmCredentials.listAuthorizedFirms()).toEqual([["67890", "Good Firm"]]);
      expect(testFirmCredentials.getTokenPair("12345")).toBeNull();
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

    it("repairs a malformed shape on a reload too, not only on the constructor's first load", () => {
      let testFirmCredentials;
      jest.isolateModules(() => {
        fs.existsSync.mockReturnValue(true);
        fs.readFileSync.mockReturnValueOnce(JSON.stringify({ defaultFirmIDs: {}, host: "https://initial.getsilverfin.com" }));

        const module = require("../../../lib/api/firmCredentials");
        testFirmCredentials = module.firmCredentials;
      });

      // A file hand-edited between two loadCredentials() calls - not just the constructor's own.
      fs.readFileSync.mockReturnValueOnce(
        JSON.stringify({ defaultFirmIDs: null, partnerCredentials: null, host: "https://reloaded.getsilverfin.com" })
      );
      testFirmCredentials.loadCredentials();

      expect(testFirmCredentials.data.defaultFirmIDs).toEqual({});
      expect(() => testFirmCredentials.setDefaultFirmId("firm123")).not.toThrow();
      expect(() => testFirmCredentials.listAuthorizedPartners()).not.toThrow();
    });

    it("does not silently switch a staging user to production when a later load fails", () => {
      let testFirmCredentials;
      jest.isolateModules(() => {
        fs.existsSync.mockReturnValue(true);
        fs.readFileSync.mockReturnValueOnce(JSON.stringify({ defaultFirmIDs: {}, host: "https://my-staging.getsilverfin.com" }));

        const module = require("../../../lib/api/firmCredentials");
        testFirmCredentials = module.firmCredentials;
      });

      fs.readFileSync.mockReturnValueOnce("not valid json{{{");
      testFirmCredentials.loadCredentials();

      // The old staging host is gone either way (the whole in-memory state resets on a failed
      // load) - what must never happen is silently asserting the live production host instead.
      expect(testFirmCredentials.getHost()).not.toBe(testFirmCredentials.SF_DEFAULT_HOST);
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
      expect(testFirmCredentials.data).toEqual({ defaultFirmIDs: {} });

      exitSpy.mockRestore();
    });

    it("never puts a snippet of the corrupted file's content into the user-visible error message", () => {
      // On this Node's V8, JSON.parse's own error message embeds a snippet of the invalid input
      // (e.g. `Unexpected token 'o', "not valid j"... is not valid JSON`) - and this file's
      // content is the credentials themselves, so that snippet could be a fragment of a real
      // access/refresh token. consola.debug(err) is fine (that's the existing -v convention);
      // the default-visible consola.error/consola.log must not repeat it.
      let testFirmCredentials;
      jest.isolateModules(() => {
        fs.existsSync.mockReturnValue(true);
        fs.readFileSync.mockReturnValueOnce(JSON.stringify({ defaultFirmIDs: {}, host: "https://initial.getsilverfin.com" }));

        const module = require("../../../lib/api/firmCredentials");
        testFirmCredentials = module.firmCredentials;
      });

      // V8 only embeds a short prefix of the input in the error message, so the "secret" has to
      // sit at the very start to actually exercise the leak (matching a real truncated write).
      const secretLikeCorruption = 'secret-token-abc123{{{"';
      fs.readFileSync.mockReturnValueOnce(secretLikeCorruption);
      testFirmCredentials.loadCredentials();

      for (const call of consola.error.mock.calls) {
        expect(call.join(" ")).not.toContain("secret-tok");
      }
      for (const call of consola.log.mock.calls) {
        expect(call.join(" ")).not.toContain("secret-tok");
      }
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
      expect(testFirmCredentials.data).toEqual({ defaultFirmIDs: {} });

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
        expect(testFirmCredentials.data).toEqual({ defaultFirmIDs: {} });
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

    it("keeps an unrecognized top-level scalar field through a load, not just per-firm fields", () => {
      // #checkDefaultValues() must not treat "unknown, not an object" the same as "malformed" -
      // a future top-level flag (e.g. a schema version) is neither a firm record nor corrupt.
      const initialCredentials = {
        someTopLevelFlag: true,
        defaultFirmIDs: {},
        host: "https://test.getsilverfin.com",
      };

      let testFirmCredentials;
      jest.isolateModules(() => {
        fs.existsSync.mockReturnValue(true);
        fs.readFileSync.mockReturnValueOnce(JSON.stringify(initialCredentials));

        const module = require("../../../lib/api/firmCredentials");
        testFirmCredentials = module.firmCredentials;

        expect(testFirmCredentials.data.someTopLevelFlag).toBe(true);
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

    it("replaces a present but non-object partnerCredentials instead of crashing", () => {
      let testFirmCredentials;
      jest.isolateModules(() => {
        fs.existsSync.mockReturnValue(true);
        fs.readFileSync.mockReturnValueOnce(
          JSON.stringify({ defaultFirmIDs: {}, host: "https://initial.getsilverfin.com", partnerCredentials: null })
        );

        const module = require("../../../lib/api/firmCredentials");
        testFirmCredentials = module.firmCredentials;
      });

      // Guard against the pre-fix behavior actually terminating the test worker.
      const exitSpy = jest.spyOn(process, "exit").mockImplementation((code) => {
        throw new Error(`Process.exit called with code ${code}`);
      });

      expect(() => testFirmCredentials.storePartnerApiKey("1234", "an-api-key", "Partner name")).not.toThrow();
      expect(exitSpy).not.toHaveBeenCalled();
      expect(testFirmCredentials.data.partnerCredentials).toEqual({ 1234: { name: "Partner name", token: "an-api-key" } });

      exitSpy.mockRestore();
    });
  });

  describe("storeNewTokenPair and storeFirmName replacing a malformed existing entry", () => {
    beforeEach(() => {
      jest.clearAllMocks();
    });

    it("storeNewTokenPair does not crash when the firm's existing entry is a truthy scalar", () => {
      // `this.data[firmId] || {}` only replaces a falsy entry - "x" is truthy, so under strict
      // mode `this.data[firmId].accessToken = ...` throws "Cannot create property on string".
      let testFirmCredentials;
      jest.isolateModules(() => {
        fs.existsSync.mockReturnValue(true);
        fs.readFileSync.mockReturnValueOnce(JSON.stringify({ defaultFirmIDs: {}, host: "https://test.getsilverfin.com", 12345: "x" }));

        const module = require("../../../lib/api/firmCredentials");
        testFirmCredentials = module.firmCredentials;

        expect(() => testFirmCredentials.storeNewTokenPair("12345", { access_token: "a", refresh_token: "b" })).not.toThrow();
        expect(testFirmCredentials.data["12345"]).toEqual({ accessToken: "a", refreshToken: "b" });
      });
    });

    it("storeNewTokenPair does not silently drop the write when the firm's existing entry is an array", () => {
      // An array entry doesn't crash the assignment (arrays are objects), but JSON.stringify
      // drops non-index properties on arrays - the write would "succeed" while losing the tokens.
      let testFirmCredentials;
      let writtenData;
      jest.isolateModules(() => {
        fs.existsSync.mockReturnValue(true);
        fs.readFileSync.mockReturnValueOnce(JSON.stringify({ defaultFirmIDs: {}, host: "https://test.getsilverfin.com", 12345: [] }));

        const module = require("../../../lib/api/firmCredentials");
        testFirmCredentials = module.firmCredentials;

        fs.writeFileSync.mockImplementation((_, data) => {
          writtenData = data;
        });

        testFirmCredentials.storeNewTokenPair("12345", { access_token: "a", refresh_token: "b" });

        expect(JSON.parse(writtenData)["12345"]).toEqual({ accessToken: "a", refreshToken: "b" });
      });
    });

    it("storeFirmName does not crash when the firm's existing entry is a truthy scalar", () => {
      let testFirmCredentials;
      jest.isolateModules(() => {
        fs.existsSync.mockReturnValue(true);
        fs.readFileSync.mockReturnValueOnce(JSON.stringify({ defaultFirmIDs: {}, host: "https://test.getsilverfin.com", 12345: "x" }));

        const module = require("../../../lib/api/firmCredentials");
        testFirmCredentials = module.firmCredentials;

        expect(() => testFirmCredentials.storeFirmName("12345", "Test Firm")).not.toThrow();
        expect(testFirmCredentials.data["12345"]).toEqual({ firmName: "Test Firm" });
      });
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

  describe("listAuthorizedFirms", () => {
    beforeEach(() => {
      jest.clearAllMocks();
    });

    it("does not list the host key as a firm (pre-existing gap, unrelated to malformed data)", () => {
      const mockCredentials = {
        defaultFirmIDs: {},
        host: "https://test.getsilverfin.com",
        12345: { accessToken: "a", refreshToken: "b", firmName: "Good Firm" },
      };

      fs.existsSync = jest.fn().mockReturnValueOnce(true).mockReturnValueOnce(true);
      fs.readFileSync = jest.fn().mockReturnValueOnce(JSON.stringify(mockCredentials));

      let testFirmCredentials;
      jest.isolateModules(() => {
        const module = require("../../../lib/api/firmCredentials");
        testFirmCredentials = module.firmCredentials;
      });

      expect(testFirmCredentials.listAuthorizedFirms()).toEqual([["12345", "Good Firm"]]);
    });

    it("does not list a preserved top-level scalar field as a firm", () => {
      // #dropNullEntries deliberately keeps an unrecognized top-level field that isn't null (a
      // future flag, say) - listAuthorizedFirms() must not then display it as a nameless firm.
      const mockCredentials = {
        defaultFirmIDs: {},
        host: "https://test.getsilverfin.com",
        someTopLevelFlag: true,
        12345: { accessToken: "a", refreshToken: "b", firmName: "Good Firm" },
      };

      fs.existsSync = jest.fn().mockReturnValueOnce(true).mockReturnValueOnce(true);
      fs.readFileSync = jest.fn().mockReturnValueOnce(JSON.stringify(mockCredentials));

      let testFirmCredentials;
      jest.isolateModules(() => {
        const module = require("../../../lib/api/firmCredentials");
        testFirmCredentials = module.firmCredentials;
      });

      expect(testFirmCredentials.listAuthorizedFirms()).toEqual([["12345", "Good Firm"]]);
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
