const { CwdValidator } = require("../../../lib/cli/cwdValidator");
const { consola } = require("consola");
const fs = require("fs");
const path = require("path");

jest.mock("consola", () => ({
  consola: {
    warn: jest.fn(),
  },
}));

jest.mock("fs");

const originalCwd = process.cwd;

describe("CwdValidator", () => {
  describe("run", () => {
    let mockCurrentDir;

    beforeEach(() => {
      jest.clearAllMocks();
      mockCurrentDir = "/test/dir";
      process.cwd = jest.fn().mockReturnValue(mockCurrentDir);
      fs.existsSync.mockReturnValue(false);
    });

    afterEach(() => {
      process.cwd = originalCwd;
    });

    it("should not display a warning if .git directory exists", () => {
      fs.existsSync.mockReturnValue(true); // .git exists

      CwdValidator.run();

      expect(fs.existsSync).toHaveBeenCalledWith(path.join(mockCurrentDir, ".git"));
      expect(consola.warn).not.toHaveBeenCalled();
    });

    it("should warn about known directories", () => {
      fs.existsSync.mockReturnValue(false);
      const mockCurrentDir = "/test/dir/reconciliation_texts/handle";
      process.cwd = jest.fn().mockReturnValue(mockCurrentDir);

      CwdValidator.run();

      expect(fs.existsSync).toHaveBeenCalledWith(path.join(mockCurrentDir, ".git"));
      expect(consola.warn).toHaveBeenCalledWith(
        `Please, double check that you are executing "silverfin" CLI in the correct directory. Your current directory is "${mockCurrentDir}". You are running "silverfin" from the "reconciliation_texts" directory, this could have unexpected consequences.`
      );
    });

    it("should display a warning if .git directory does not exist", () => {
      fs.existsSync.mockReturnValue(false);

      CwdValidator.run();

      expect(fs.existsSync).toHaveBeenCalledWith(path.join(mockCurrentDir, ".git"));
      expect(consola.warn).toHaveBeenCalledWith(
        `Please, double check that you are executing "silverfin" CLI in the correct directory. Your current directory is "${mockCurrentDir}".`
      );
    });
  });
});
