const open = require("open");
const path = require("path");
const axios = require("axios");
const { consola } = require("consola");
const errorUtils = require("./errorUtils");
const fs = require("fs");

/**
 * Class to handle URL operations such as downloading and opening files.
 */
class UrlHandler {
  constructor(url) {
    if (!url) {
      throw new Error("The 'url' parameter is required.");
    }
    this.url = url;
  }

  /** Opens the file from the URL in the default application.
   * Downloads the file to a temporary location before opening it.
   */
  async openFile() {
    try {
      const filePath = await this.#downloadFile();
      await open(filePath);
    } catch (error) {
      consola.error(`Failed to open URL: ${this.url}`, error);
    }
  }

  async #downloadFile() {
    try {
      const response = await axios.get(this.url, { responseType: "arraybuffer" });
      const contentDisposition = response.headers["content-disposition"];
      const fileExtension = contentDisposition ? this.#identifyExtension(contentDisposition) : "";
      const tempFilePath = path.resolve(require("os").tmpdir(), "silverfin", `${Date.now()}.${fileExtension}`);
      fs.mkdirSync(path.dirname(tempFilePath), { recursive: true });
      fs.writeFileSync(tempFilePath, response.data);

      return tempFilePath;
    } catch (error) {
      errorUtils.errorHandler(error);
    }
  }

  #identifyExtension(string) {
    if (!string) return null;
    const match = string.match(/filename[*]?=['"]?(?:[^'"]*\.)?([^.'";\s]+)['"]/i);
    return match ? match[1] : null;
  }
}

module.exports = { UrlHandler };
