const axios = require("axios");
const { consola } = require("consola");

jest.mock(
  "../../../package.json",
  () => ({
    version: "1.0.0",
    repository: { url: "test-url" },
  }),
  { virtual: true }
);

const mockExecFn = jest.fn();

jest.mock("axios");
jest.mock("consola");
jest.mock("util", () => ({
  ...jest.requireActual("util"),
  promisify: jest.fn(() => mockExecFn),
}));
jest.mock("child_process", () => ({
  exec: jest.fn(),
}));

const { CliUpdater } = require("../../../lib/cli/cliUpdater");

describe("CliUpdater", () => {
  describe("checkVersions", () => {
    beforeEach(() => {
      jest.clearAllMocks();
    });

    it("should not display update message when latest version equals current version", async () => {
      const latestVersion = "1.0.0";
      axios.get.mockResolvedValueOnce({
        status: 200,
        data: { version: latestVersion },
      });

      await CliUpdater.checkVersions();

      expect(consola.log).not.toHaveBeenCalledWith(expect.stringMatching(/new version available/i));
    });

    it("should display an update message when a newer version is available", async () => {
      const latestVersion = "1.0.1";
      axios.get.mockResolvedValueOnce({
        status: 200,
        data: { version: latestVersion },
      });

      await CliUpdater.checkVersions();

      expect(consola.log).toHaveBeenCalledWith(expect.stringMatching(/new version available/i));
    });

    it("should not display any message when API call fails", async () => {
      axios.get.mockRejectedValueOnce(new Error("API error"));

      await CliUpdater.checkVersions();

      expect(consola.log).not.toHaveBeenCalled();
      expect(consola.debug).not.toHaveBeenCalled();
    });
  });

  describe("performUpdate", () => {
    const UPDATE_COMMAND = `sudo npm install -g test-url`;
    const VERSION_COMMAND = `silverfin --version`;
    beforeEach(() => {
      jest.clearAllMocks();
    });

    it("should run the update command and show a success message", async () => {
      mockExecFn.mockImplementation((command) => {
        if (command === UPDATE_COMMAND) {
          return Promise.resolve({ stdout: "success", stderr: "" });
        } else if (command === VERSION_COMMAND) {
          return Promise.resolve({ stdout: "1.1.0", stderr: "" });
        }
        return Promise.reject(new Error(`Unexpected command: ${command}`));
      });

      await CliUpdater.performUpdate();

      expect(mockExecFn).toHaveBeenCalledWith(UPDATE_COMMAND);
      expect(mockExecFn).toHaveBeenCalledWith(VERSION_COMMAND);
      expect(consola.success).toHaveBeenCalledWith(expect.stringMatching(/succesfully updated to version 1.1.0/));
    });

    it("should handle update failure and show error message", async () => {
      mockExecFn.mockImplementation((command) => {
        if (command === "sudo npm install -g test-url") {
          return Promise.reject(new Error("Installation failed"));
        }
        return Promise.reject(new Error(`Unexpected command: ${command}`));
      });

      await CliUpdater.performUpdate();

      expect(mockExecFn).toHaveBeenCalledWith("sudo npm install -g test-url");
      expect(consola.error).toHaveBeenCalledWith(expect.stringMatching(/Update of Silverfin CLI failed/));
    });
  });
});
