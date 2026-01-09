jest.mock("axios");
jest.mock("fs");
jest.mock("open", () => jest.fn());
jest.mock("consola");
jest.mock("../../../lib/utils/wslHandler");
jest.mock("../../../lib/utils/errorUtils");
jest.mock("os");

const axios = require("axios");
const fs = require("fs");
const open = require("open");
const { consola } = require("consola");
const { WSLHandler } = require("../../../lib/utils/wslHandler");
const errorUtils = require("../../../lib/utils/errorUtils");
const os = require("os");
const path = require("path");

const { UrlHandler } = require("../../../lib/utils/urlHandler");

describe("UrlHandler", () => {
  describe("constructor", () => {
    it("should create instance with valid url", () => {
      const url = "https://example.com/file.pdf";
      const handler = new UrlHandler(url);

      expect(handler.url).toBe(url);
      expect(handler.customFilename).toBeNull();
    });

    it("should create instance with url and custom filename", () => {
      const url = "https://example.com/file.pdf";
      const customFilename = "my-custom-file";
      const handler = new UrlHandler(url, customFilename);

      expect(handler.url).toBe(url);
      expect(handler.customFilename).toBe(customFilename);
    });

    it("should throw error when url is undefined", () => {
      expect(() => {
        new UrlHandler(undefined);
      }).toThrow("The 'url' parameter is required.");
    });

    it("should throw error when url is null", () => {
      expect(() => {
        new UrlHandler(null);
      }).toThrow("The 'url' parameter is required.");
    });

    it("should throw error when url is empty string", () => {
      expect(() => {
        new UrlHandler("");
      }).toThrow("The 'url' parameter is required.");
    });

    it("should throw error when url is not provided", () => {
      expect(() => {
        new UrlHandler();
      }).toThrow("The 'url' parameter is required.");
    });
  });

  describe("openFile", () => {
    const testUrl = "https://example.com/file.pdf";
    let originalExit;

    beforeEach(() => {
      jest.clearAllMocks();

      originalExit = process.exit;
      process.exit = jest.fn();

      errorUtils.errorHandler.mockImplementation(() => {
        process.exit(1);
        throw new Error("Process exited");
      });

      os.tmpdir.mockReturnValue("/tmp");
      fs.mkdirSync.mockImplementation(() => {});
      fs.writeFileSync.mockImplementation(() => {});
      fs.existsSync.mockReturnValue(false);
      WSLHandler.isWSL.mockReturnValue(false);
      open.mockResolvedValue(undefined);

      axios.get.mockResolvedValue({
        data: Buffer.from("mock file content"),
        headers: {
          "content-disposition": 'attachment; filename="document.pdf"',
        },
      });
    });

    afterEach(() => {
      process.exit = originalExit;
    });

    describe("successful download and open scenarios", () => {
      it("should download file with Content-Disposition filename and open it", async () => {
        const handler = new UrlHandler(testUrl);

        await handler.openFile();

        expect(axios.get).toHaveBeenCalledWith(testUrl, { responseType: "arraybuffer" });
        expect(fs.mkdirSync).toHaveBeenCalledWith(expect.stringContaining("silverfin"), { recursive: true });
        expect(fs.writeFileSync).toHaveBeenCalledWith(expect.stringContaining("document.pdf"), expect.any(Buffer));
        expect(open).toHaveBeenCalledWith(expect.stringContaining("document.pdf"));
        expect(consola.error).not.toHaveBeenCalled();
      });

      it("should download file with custom filename and inferred extension", async () => {
        axios.get.mockResolvedValue({
          data: Buffer.from("mock content"),
          headers: {
            "content-disposition": 'attachment; filename="original.pdf"',
          },
        });

        const handler = new UrlHandler(testUrl, "my-custom-file");

        await handler.openFile();

        expect(fs.writeFileSync).toHaveBeenCalledWith(expect.stringContaining("my-custom-file.pdf"), expect.any(Buffer));
      });

      it("should use timestamp filename when Content-Disposition is missing", async () => {
        const dateNowSpy = jest.spyOn(Date, "now").mockReturnValue(1234567890);

        axios.get.mockResolvedValue({
          data: Buffer.from("mock content"),
          headers: {},
        });

        const handler = new UrlHandler(testUrl);

        await handler.openFile();

        expect(fs.writeFileSync).toHaveBeenCalledWith(expect.stringContaining("1234567890.html"), expect.any(Buffer));

        dateNowSpy.mockRestore();
      });

      it("should use .html extension when Content-Disposition is missing", async () => {
        axios.get.mockResolvedValue({
          data: Buffer.from("mock content"),
          headers: {},
        });

        const handler = new UrlHandler(testUrl);

        await handler.openFile();

        const writeCall = fs.writeFileSync.mock.calls[0];
        const filePath = writeCall[0];
        expect(filePath).toMatch(/\.html$/);
      });
    });

    describe("Content-Disposition header parsing", () => {
      it("should parse filename from standard Content-Disposition format", async () => {
        axios.get.mockResolvedValue({
          data: Buffer.from("mock content"),
          headers: {
            "content-disposition": 'attachment; filename="document.pdf"',
          },
        });

        const handler = new UrlHandler(testUrl);

        await handler.openFile();

        expect(fs.writeFileSync).toHaveBeenCalledWith(expect.stringContaining("document.pdf"), expect.any(Buffer));
      });

      it("should parse filename from UTF-8 encoded Content-Disposition", async () => {
        axios.get.mockResolvedValue({
          data: Buffer.from("mock content"),
          headers: {
            "content-disposition": "attachment; filename*=UTF-8''document%20with%20spaces.pdf",
          },
        });

        const handler = new UrlHandler(testUrl);

        await handler.openFile();

        expect(fs.writeFileSync).toHaveBeenCalledWith(expect.stringContaining("document with spaces.pdf"), expect.any(Buffer));
      });

      it("should parse filename without quotes", async () => {
        axios.get.mockResolvedValue({
          data: Buffer.from("mock content"),
          headers: {
            "content-disposition": "attachment; filename=simple.txt",
          },
        });

        const handler = new UrlHandler(testUrl);

        await handler.openFile();

        expect(fs.writeFileSync).toHaveBeenCalledWith(expect.stringContaining("simple.txt"), expect.any(Buffer));
      });

      it("should parse filename with special characters", async () => {
        axios.get.mockResolvedValue({
          data: Buffer.from("mock content"),
          headers: {
            "content-disposition": 'attachment; filename="file-name_123.xlsx"',
          },
        });

        const handler = new UrlHandler(testUrl);

        await handler.openFile();

        expect(fs.writeFileSync).toHaveBeenCalledWith(expect.stringContaining("file-name_123.xlsx"), expect.any(Buffer));
      });

      it("should extract correct extension from Content-Disposition", async () => {
        const extensions = [
          { header: 'filename="test.pdf"', ext: ".pdf" },
          { header: 'filename="test.xlsx"', ext: ".xlsx" },
          { header: 'filename="test.docx"', ext: ".docx" },
          { header: 'filename="test.txt"', ext: ".txt" },
          { header: 'filename="test.zip"', ext: ".zip" },
        ];

        for (const { header, ext } of extensions) {
          jest.clearAllMocks();

          axios.get.mockResolvedValue({
            data: Buffer.from("mock content"),
            headers: {
              "content-disposition": `attachment; ${header}`,
            },
          });

          const handler = new UrlHandler(testUrl);
          await handler.openFile();

          const writeCall = fs.writeFileSync.mock.calls[0];
          const filePath = writeCall[0];
          expect(filePath).toMatch(new RegExp(`\\${ext}$`));
        }
      });
    });

    describe("unique filename generation", () => {
      it("should generate unique filename when file already exists", async () => {
        fs.existsSync
          .mockReturnValueOnce(true) // First file exists
          .mockReturnValueOnce(false); // Second filename available

        const handler = new UrlHandler(testUrl);

        await handler.openFile();

        expect(fs.writeFileSync).toHaveBeenCalledWith(expect.stringContaining("document (1).pdf"), expect.any(Buffer));
      });

      it("should increment counter for multiple existing files", async () => {
        fs.existsSync
          .mockReturnValueOnce(true) // document.pdf exists
          .mockReturnValueOnce(true) // document (1).pdf exists
          .mockReturnValueOnce(true) // document (2).pdf exists
          .mockReturnValueOnce(false); // document (3).pdf available

        const handler = new UrlHandler(testUrl);

        await handler.openFile();

        expect(fs.writeFileSync).toHaveBeenCalledWith(expect.stringContaining("document (3).pdf"), expect.any(Buffer));
      });

      it("should preserve extension when generating unique filename", async () => {
        axios.get.mockResolvedValue({
          data: Buffer.from("mock content"),
          headers: {
            "content-disposition": 'attachment; filename="report.xlsx"',
          },
        });

        fs.existsSync
          .mockReturnValueOnce(true) // report.xlsx exists
          .mockReturnValueOnce(false); // report (1).xlsx available

        const handler = new UrlHandler(testUrl);

        await handler.openFile();

        const writeCall = fs.writeFileSync.mock.calls[0];
        const filePath = writeCall[0];
        expect(filePath).toMatch(/report \(1\)\.xlsx$/);
        expect(filePath).not.toMatch(/report\.xlsx \(1\)/);
      });
    });

    describe("WSL vs non-WSL opening", () => {
      it("should open file using 'open' package when not in WSL", async () => {
        WSLHandler.isWSL.mockReturnValue(false);

        const handler = new UrlHandler(testUrl);

        await handler.openFile();

        expect(WSLHandler.isWSL).toHaveBeenCalled();
        expect(open).toHaveBeenCalledWith(expect.stringContaining("document.pdf"));
        expect(WSLHandler.open).not.toHaveBeenCalled();
      });

      it("should open file using WSLHandler when in WSL", async () => {
        WSLHandler.isWSL.mockReturnValue(true);
        WSLHandler.open.mockResolvedValue(undefined);

        const handler = new UrlHandler(testUrl);

        await handler.openFile();

        expect(WSLHandler.isWSL).toHaveBeenCalled();
        expect(WSLHandler.open).toHaveBeenCalledWith(expect.stringContaining("document.pdf"));
        expect(open).not.toHaveBeenCalled();
      });
    });

    describe("error handling", () => {
      it("should log error when axios download fails", async () => {
        const mockError = new Error("Network error");
        axios.get.mockRejectedValue(mockError);

        const handler = new UrlHandler(testUrl);

        await handler.openFile();

        expect(errorUtils.errorHandler).toHaveBeenCalledWith(mockError);
        expect(process.exit).toHaveBeenCalledWith(1);
        expect(fs.writeFileSync).not.toHaveBeenCalled();
        expect(open).not.toHaveBeenCalled();
      });

      it("should log error when file opening fails in non-WSL", async () => {
        const openError = new Error("Failed to open");
        open.mockRejectedValue(openError);
        WSLHandler.isWSL.mockReturnValue(false);

        const handler = new UrlHandler(testUrl);

        await handler.openFile();

        expect(consola.error).toHaveBeenCalledWith(expect.stringContaining("Failed to open URL"), openError);
      });

      it("should log error when WSLHandler.open fails", async () => {
        const wslError = new Error("WSL open failed");
        WSLHandler.isWSL.mockReturnValue(true);
        WSLHandler.open.mockRejectedValue(wslError);

        const handler = new UrlHandler(testUrl);

        await handler.openFile();

        expect(consola.error).toHaveBeenCalledWith(expect.stringContaining("Failed to open URL"), wslError);
      });

      it("should handle ENOENT error from errorHandler", async () => {
        const enoentError = new Error("ENOENT");
        enoentError.code = "ENOENT";
        enoentError.path = "/some/path";
        axios.get.mockRejectedValue(enoentError);

        const handler = new UrlHandler(testUrl);

        await handler.openFile();

        expect(errorUtils.errorHandler).toHaveBeenCalledWith(enoentError);
        expect(process.exit).toHaveBeenCalledWith(1);
      });

      it("should handle fs.mkdirSync failure gracefully", async () => {
        const mkdirError = new Error("Permission denied");
        fs.mkdirSync.mockImplementation(() => {
          throw mkdirError;
        });

        const handler = new UrlHandler(testUrl);

        await handler.openFile();

        expect(errorUtils.errorHandler).toHaveBeenCalledWith(mkdirError);
        expect(process.exit).toHaveBeenCalledWith(1);
        expect(fs.writeFileSync).not.toHaveBeenCalled();
      });

      it("should handle fs.writeFileSync failure gracefully", async () => {
        const writeError = new Error("Disk full");
        fs.writeFileSync.mockImplementation(() => {
          throw writeError;
        });

        const handler = new UrlHandler(testUrl);

        await handler.openFile();

        expect(errorUtils.errorHandler).toHaveBeenCalledWith(writeError);
        expect(process.exit).toHaveBeenCalledWith(1);
      });
    });

    describe("edge cases", () => {
      it("should handle very long filenames", async () => {
        const longFilename = "a".repeat(200) + ".pdf";
        axios.get.mockResolvedValue({
          data: Buffer.from("mock content"),
          headers: {
            "content-disposition": `attachment; filename="${longFilename}"`,
          },
        });

        const handler = new UrlHandler(testUrl);

        await handler.openFile();

        expect(fs.writeFileSync).toHaveBeenCalledWith(expect.stringContaining(longFilename), expect.any(Buffer));
      });

      it("should handle binary file data correctly", async () => {
        const binaryData = Buffer.from([0x00, 0x01, 0x02, 0xff, 0xfe]);
        axios.get.mockResolvedValue({
          data: binaryData,
          headers: {
            "content-disposition": 'attachment; filename="binary.bin"',
          },
        });

        const handler = new UrlHandler(testUrl);

        await handler.openFile();

        expect(fs.writeFileSync).toHaveBeenCalledWith(expect.stringContaining("binary.bin"), binaryData);
      });

      it("should handle empty file content", async () => {
        axios.get.mockResolvedValue({
          data: Buffer.from(""),
          headers: {
            "content-disposition": 'attachment; filename="empty.txt"',
          },
        });

        const handler = new UrlHandler(testUrl);

        await handler.openFile();

        expect(fs.writeFileSync).toHaveBeenCalledWith(expect.stringContaining("empty.txt"), expect.any(Buffer));
        expect(open).toHaveBeenCalled();
      });

      it("should use correct temp directory path", async () => {
        os.tmpdir.mockReturnValue("/custom/tmp");

        const handler = new UrlHandler(testUrl);

        await handler.openFile();

        expect(fs.mkdirSync).toHaveBeenCalledWith(path.resolve("/custom/tmp", "silverfin"), { recursive: true });
        expect(fs.writeFileSync).toHaveBeenCalledWith(expect.stringContaining(path.join("/custom/tmp", "silverfin")), expect.any(Buffer));
      });

      it("should handle URLs with query parameters", async () => {
        const urlWithParams = "https://example.com/file?token=abc123&user=test";

        const handler = new UrlHandler(urlWithParams);

        await handler.openFile();

        expect(axios.get).toHaveBeenCalledWith(urlWithParams, { responseType: "arraybuffer" });
      });

      it("should handle Content-Disposition with multiple parameters", async () => {
        axios.get.mockResolvedValue({
          data: Buffer.from("mock content"),
          headers: {
            "content-disposition": 'attachment; filename="report.pdf"; size=1024; creation-date="2024-01-01"',
          },
        });

        const handler = new UrlHandler(testUrl);

        await handler.openFile();

        expect(fs.writeFileSync).toHaveBeenCalledWith(expect.stringContaining("report.pdf"), expect.any(Buffer));
      });
    });
  });
});
