const SF = require("./api/sfApi");
const { consola } = require("consola");
const errorUtils = require("./utils/errorUtils");
const { UrlHandler } = require("./utils/urlHandler");

/**
 * Class to handle the generation and retrieval of export file instances.
 */
class ExportFileInstanceGenerator {
  #MAX_ATTEMPTS = 25;
  #INITIAL_WAIT = 1000; // in milliseconds
  #MAX_WAIT = 5000; // in milliseconds

  constructor(firmId, companyId, periodId, exportFileId) {
    if (!firmId || !companyId || !periodId || !exportFileId) {
      throw new Error("All parameters (firmId, companyId, periodId, exportFileId) are required.");
    }

    this.firmId = firmId;
    this.companyId = companyId;
    this.periodId = periodId;
    this.exportFileId = exportFileId;
  }

  /**
   * Generates an export file instance, handles validation errors, and opens the download URL.
   */
  async generateAndOpenFile() {
    try {
      const response = await this.#generateInstance();
      if (!response) {
        return;
      }

      this.#logValidationErrors(response);
      await this.#openUrl(response);
    } catch (error) {
      errorUtils.errorHandler(error);
    }
  }

  async #generateInstance() {
    try {
      const responseCreate = await SF.createExportFileInstance(this.firmId, this.companyId, this.periodId, this.exportFileId);
      if (!responseCreate || !responseCreate.id) {
        consola.error(`Failed to create export file instance. ${this.#details()}`);
        return false;
      }
      const exportFileInstanceId = responseCreate.id;
      consola.debug(`Export file instance created. ${this.#details(exportFileInstanceId)}`);

      let response;
      let attempts = 0;
      let wait = this.#INITIAL_WAIT;

      while (attempts < this.#MAX_ATTEMPTS) {
        await new Promise((resolve) => setTimeout(resolve, wait));

        response = await SF.getExportFileInstance(this.firmId, this.companyId, this.periodId, exportFileInstanceId);

        consola.debug(`Checking status of export file instance ${exportFileInstanceId}... Attempt ${attempts + 1} of ${this.#MAX_ATTEMPTS}`);

        if (response && response.state === "pending") {
          consola.debug(`Export file generation is still pending. ${this.#details(exportFileInstanceId)}`);
          attempts++;
          wait = Math.min(wait + 1000, this.#MAX_WAIT);
          continue;
        } else if (response && response.state === "created") {
          consola.success(`Export file generation completed successfully. ${this.#details(exportFileInstanceId)}`);
          return response;
        } else {
          consola.error(`Export file generation failed or encountered an unexpected state. ${this.#details(exportFileInstanceId)}`);
          return false;
        }
      }

      return false;
    } catch (error) {
      errorUtils.errorHandler(error);
    }
  }

  #details(exportFileInstanceId = null) {
    const message = `Firm ID: ${this.firmId}, Company ID: ${this.companyId}, Period ID: ${this.periodId}, Export File ID: ${this.exportFileId}`;
    return exportFileInstanceId ? `${message}, Export File Instance ID: ${exportFileInstanceId}` : message;
  }

  #logValidationErrors(response) {
    if (response && response.validation_errors && response.validation_errors.length > 0) {
      consola.warn(`Validation errors: ${response.validation_errors}`);
    }
  }

  async #openUrl(response) {
    if (response && response.content_url) {
      await new UrlHandler(response.content_url).openFile();
    } else {
      consola.error(`No download URL found in the response. ${this.#details()}`);
    }
  }
}

module.exports = { ExportFileInstanceGenerator };
