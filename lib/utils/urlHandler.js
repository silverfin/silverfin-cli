const open = require("open");
const path = require("path");
const axios = require("axios");
const { consola } = require("consola");
const errorUtils = require("./errorUtils");
const fs = require("fs");
const { WSLHandler } = require("./wslHandler");

/**
 * Class to handle URL operations such as downloading and opening files.
 */
class UrlHandler {
  constructor(url, customFilename = null) {
    if (!url) {
      throw new Error("The 'url' parameter is required.");
    }
    this.url = url;
    this.customFilename = customFilename;
  }

  /** Opens the file from the URL in the default application.
   * Downloads the file to a temporary location before opening it.
   */
  async openFile() {
    try {
      const filePath = await this.#downloadFile();
      await this.#openLocalFile(filePath);
    } catch (error) {
      consola.error(`Failed to open URL: ${this.url}`, error);
    }
  }

  async #openLocalFile(filePath) {
    if (WSLHandler.isWSL()) {
      await WSLHandler.open(filePath);
    } else {
      await open(filePath);
    }
  }

  async #downloadFile() {
    try {
      const response = await axios.get(this.url, { responseType: "arraybuffer" });
      const contentDisposition = response.headers["content-disposition"];

      let filename;
      const fileExtension = contentDisposition ? this.#identifyFileExtension(contentDisposition) : "html";

      if (this.customFilename) {
        // Use custom filename with inferred extension
        filename = `${this.customFilename}.${fileExtension}`;
      } else {
        // Try to infer filename from response, fall back to timestamp
        const inferredFilename = contentDisposition ? this.#identifyFilename(contentDisposition) : null;
        filename = inferredFilename || `${Date.now()}.${fileExtension}`;
      }

      const tempDir = path.resolve(require("os").tmpdir(), "silverfin");
      fs.mkdirSync(tempDir, { recursive: true });

      const tempFilePath = this.#getUniqueFilePath(tempDir, filename);
      fs.writeFileSync(tempFilePath, response.data);

      return tempFilePath;
    } catch (error) {
      errorUtils.errorHandler(error);
    }
  }

  #getUniqueFilePath(directory, filename) {
    const ext = path.extname(filename);
    const nameWithoutExt = path.basename(filename, ext);
    let filePath = path.resolve(directory, filename);
    let counter = 1;

    // If file exists, append (1), (2), etc. until we find a unique name
    while (fs.existsSync(filePath)) {
      const uniqueFilename = `${nameWithoutExt} (${counter})${ext}`;
      filePath = path.resolve(directory, uniqueFilename);
      counter++;
    }

    return filePath;
  }

  #identifyFilename(string) {
    if (!string) return null;
    // Match full filename from content-disposition header
    // Handles: filename="file.ext", filename*=UTF-8''file.ext, filename=file.ext
    const match = string.match(/filename[*]?=['"]?(?:UTF-8'')?([^'";\s]+)['";\s]?/i);
    return match ? decodeURIComponent(match[1]) : null;
  }

  #identifyFileExtension(string) {
    if (!string) return null;
    const match = string.match(/filename[*]?=['"]?(?:[^'"]*\.)?([^.'";\s]+)['"]/i);
    return match ? match[1] : null;
  }
}

module.exports = { UrlHandler };
