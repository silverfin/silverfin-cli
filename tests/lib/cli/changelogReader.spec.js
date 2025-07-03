const axios = require("axios");
const { consola } = require("consola");

jest.mock("axios");
jest.mock("consola");

const { ChangelogReader } = require("../../../lib/cli/changelogReader");

describe("ChangelogReader", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("fetchChanges", () => {
    it("should return undefined when changelog file doesn't exist (404 response)", async () => {
      axios.get.mockResolvedValueOnce({
        status: 404,
        data: "Not Found",
      });

      const result = await ChangelogReader.fetchChanges("1.0.0", "1.1.0");

      expect(result).toBeUndefined();
      expect(consola.debug).toHaveBeenCalledWith("Changelog file not found. The CHANGELOG.md file may have been moved or deleted from the repository.");
      expect(axios.get).toHaveBeenCalledWith("https://raw.githubusercontent.com/silverfin/silverfin-cli/main/CHANGELOG.md");
    });

    it("should return undefined when API call fails", async () => {
      axios.get.mockRejectedValueOnce(new Error("Network error"));

      const result = await ChangelogReader.fetchChanges("1.0.0", "1.1.0");

      expect(result).toBeUndefined();
      expect(consola.debug).toHaveBeenCalledWith("Failed to fetch changelog from GitHub");
    });

    it("should return undefined when response status is not 200", async () => {
      axios.get.mockResolvedValueOnce({
        status: 500,
        data: "Internal Server Error",
      });

      const result = await ChangelogReader.fetchChanges("1.0.0", "1.1.0");

      expect(result).toBeUndefined();
      expect(consola.debug).toHaveBeenCalledWith("Changelog file not found. The CHANGELOG.md file may have been moved or deleted from the repository.");
    });

    it("should return changelog content when changelog file exists and has new versions", async () => {
      const mockChangelog = `# Changelog

      All notable changes to this project will be documented in this file.

      ## [1.2.0] (05/08/2025)
      - New feature added
      - Bug fix implemented

      ## [1.1.0] (05/07/2025)
      - Minor improvements
      - Documentation updates

      ## [1.0.0] (05/06/2025)
      - Initial release`;

      axios.get.mockResolvedValueOnce({
        status: 200,
        data: mockChangelog,
      });

      const result = await ChangelogReader.fetchChanges("1.0.0", "1.2.0");

      expect(result).toBeDefined();
      expect(result).toContain("[1.2.0]");
      expect(result).toContain("[1.1.0]");
      expect(result).toContain("New feature added");
      expect(result).toContain("Minor improvements");
    });

    it("should return only versions between user version and update version", async () => {
      const mockChangelog = `# Changelog

      All notable changes to this project will be documented in this file.

      ## [1.3.0] (05/09/2025)
      - Latest feature

      ## [1.2.0] (05/08/2025)
      - New feature added

      ## [1.1.0] (05/07/2025)
      - Minor improvements

      ## [1.0.0] (05/06/2025)
      - Initial release`;

      axios.get.mockResolvedValueOnce({
        status: 200,
        data: mockChangelog,
      });

      const result = await ChangelogReader.fetchChanges("1.0.0", "1.2.0");

      expect(result).toBeDefined();
      expect(result).toContain("[1.2.0]");
      expect(result).toContain("[1.1.0]");
      expect(result).not.toContain("[1.3.0]");
      expect(result).not.toContain("[1.0.0]");
    });

    it("should return version content when no new versions are found (same version)", async () => {
      const mockChangelog = `# Changelog

      All notable changes to this project will be documented in this file.

      ## [1.0.0] (05/06/2025)
- Initial release`;

      axios.get.mockResolvedValueOnce({
        status: 200,
        data: mockChangelog,
      });

      const result = await ChangelogReader.fetchChanges("1.0.0", "1.0.0");

      expect(result).toBe("[1.0.0] (05/06/2025)\n- Initial release");
    });

    it("should return undefined when update version is not found in changelog", async () => {
      const mockChangelog = `# Changelog

All notable changes to this project will be documented in this file.

## [1.0.0] (05/06/2025)
- Initial release`;

      axios.get.mockResolvedValueOnce({
        status: 200,
        data: mockChangelog,
      });

      const result = await ChangelogReader.fetchChanges("1.0.0", "2.0.0");

      expect(result).toBe("");
      expect(consola.debug).toHaveBeenCalledWith(
        "Version 2.0.0 not found in the changelog. This might indicate that the changelog hasn't been updated yet for this version, or the version format is incorrect (should be ## [version] (date))."
      );
    });

    it("should handle changelog with incorrect format gracefully", async () => {
      const mockChangelog = `# Changelog

All notable changes to this project will be documented in this file.

## 1.2.0 (05/08/2025)
- Missing brackets in version format

## [1.1.0] (05/07/2025)
- Correct format

## [1.0.0] (05/06/2025)
- Initial release`;

      axios.get.mockResolvedValueOnce({
        status: 200,
        data: mockChangelog,
      });

      const result = await ChangelogReader.fetchChanges("1.0.0", "1.2.0");

      // Should return empty string when update version format is incorrect
      expect(result).toBe("");
      expect(consola.debug).toHaveBeenCalledWith(
        "Version 1.2.0 not found in the changelog. This might indicate that the changelog hasn't been updated yet for this version, or the version format is incorrect (should be ## [version] (date))."
      );
    });

    it("should handle changelog with malformed version sections", async () => {
      const mockChangelog = `# Changelog

      All notable changes to this project will be documented in this file.

      ## [1.2.0] (05/08/2025)
      - New feature added

      ## [1.1.0
      - Malformed version header

      ## [1.0.0] (05/06/2025)
      - Initial release`;

      axios.get.mockResolvedValueOnce({
        status: 200,
        data: mockChangelog,
      });

      const result = await ChangelogReader.fetchChanges("1.0.0", "1.2.0");

      // Should handle malformed sections gracefully
      expect(result).toBeDefined();
      expect(result).toContain("1.2.0");
      expect(result).toContain("1.1.0");
    });

    it("should handle empty changelog content", async () => {
      const mockChangelog = `# Changelog

      All notable changes to this project will be documented in this file.`;

      axios.get.mockResolvedValueOnce({
        status: 200,
        data: mockChangelog,
      });

      const result = await ChangelogReader.fetchChanges("1.0.0", "1.1.0");

      expect(result).toBe("");
    });

    it("should handle changelog with only header and no version sections", async () => {
      const mockChangelog = `# Changelog

      All notable changes to this project will be documented in this file.

      Some other content without version headers`;

      axios.get.mockResolvedValueOnce({
        status: 200,
        data: mockChangelog,
      });

      const result = await ChangelogReader.fetchChanges("1.0.0", "1.1.0");

      expect(result).toBe("");
    });

    it("should return content in correct order (newest to oldest)", async () => {
      const mockChangelog = `# Changelog

      All notable changes to this project will be documented in this file.

      ## [1.3.0] (05/09/2025)
      - Latest feature

      ## [1.2.0] (05/08/2025)
      - New feature added

      ## [1.1.0] (05/07/2025)
      - Minor improvements

      ## [1.0.0] (05/06/2025)
      - Initial release`;

      axios.get.mockResolvedValueOnce({
        status: 200,
        data: mockChangelog,
      });

      const result = await ChangelogReader.fetchChanges("1.0.0", "1.3.0");

      expect(result).toBeDefined();
      // Should maintain order from changelog (newest first)
      const lines = result.split("\n");
      const version1Index = lines.findIndex((line) => line.includes("[1.3.0]"));
      const version2Index = lines.findIndex((line) => line.includes("[1.2.0]"));
      const version3Index = lines.findIndex((line) => line.includes("[1.1.0]"));

      expect(version1Index).toBeLessThan(version2Index);
      expect(version2Index).toBeLessThan(version3Index);
    });
  });
});
