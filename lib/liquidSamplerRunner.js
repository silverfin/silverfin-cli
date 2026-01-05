const { UrlHandler } = require("./utils/urlHandler");
const errorUtils = require("./utils/errorUtils");
const { spinner } = require("./cli/spinner");
const SF = require("./api/sfApi");
const fsUtils = require("./utils/fsUtils");
const { consola } = require("consola");

const { ReconciliationText } = require("./templates/reconciliationText");
const { AccountTemplate } = require("./templates/accountTemplate");
const { SharedPart } = require("./templates/sharedPart");

/**
 * Class to run liquid samplers for partner templates
 */
class LiquidSamplerRunner {
  constructor(partnerId) {
    this.partnerId = partnerId;
  }

  /**
   * Run liquid sampler for partner templates
   * @param {Object} templateHandles - Object containing arrays of template identifiers
   * @param {Array<string>} templateHandles.reconciliationTexts - Array of reconciliation text handles
   * @param {Array<string>} templateHandles.accountTemplates - Array of account template names
   * @param {Array<string>} templateHandles.sharedParts - Array of shared part names
   * @returns {Promise<void>}
   */
  async run(templateHandles = {}) {
    try {
      // Validate at least one template specified
      const { reconciliationTexts = [], accountTemplates = [], sharedParts = [] } = templateHandles;
      if (reconciliationTexts.length === 0 && accountTemplates.length === 0 && sharedParts.length === 0) {
        consola.error("You need to specify at least one template using -h, -at, or -s");
        process.exit(1);
      }

      // Build payload
      const samplerParams = await this.#buildSamplerParams(templateHandles);

      consola.info(`Starting sampler run with ${samplerParams.templates.length} template(s)...`);

      // Start sampler run
      const samplerResponse = await SF.createSamplerRun(this.partnerId, samplerParams);
      const samplerId = samplerResponse.data.id || samplerResponse.data;

      if (!samplerId) {
        consola.error("Failed to start sampler run - no ID returned");
        process.exit(1);
      }

      consola.info(`Sampler run started with ID: ${samplerId}`);

      // Poll for completion
      const samplerRun = await this.#fetchAndWaitSamplerResult(samplerId);

      // Process results
      await this.#handleSamplerResponse(samplerRun);
    } catch (error) {
      errorUtils.errorHandler(error);
    }
  }

  /**
   * Fetch the status of an existing sampler run
   * @param {string} samplerId - The sampler run ID
   * @returns {Promise<void>}
   */
  async checkStatus(samplerId) {
    try {
      consola.info(`Fetching status for sampler run ID: ${samplerId}`);

      const response = await SF.readSamplerRun(this.partnerId, samplerId);

      await this.#handleSamplerResponse(response.data);
    } catch (error) {
      errorUtils.errorHandler(error);
    }
  }

  /**
   * Build sampler parameters from local template files
   * @param {Object} templateHandles - Object containing arrays of template identifiers
   * @param {Array<string>} templateHandles.reconciliationTexts - Array of reconciliation text handles
   * @param {Array<string>} templateHandles.accountTemplates - Array of account template names
   * @param {Array<string>} templateHandles.sharedParts - Array of shared part names
   * @returns {Object} Sampler payload with templates array
   */
  async #buildSamplerParams(templateHandles = {}) {
    const templates = [];
    const { reconciliationTexts = [], accountTemplates = [], sharedParts = [] } = templateHandles;

    // Process reconciliation texts
    for (const handle of reconciliationTexts) {
      const templateType = "reconciliationText";
      const configPresent = fsUtils.configExists(templateType, handle);

      if (!configPresent) {
        consola.error(`Config file for reconciliation text "${handle}" not found`);
        process.exit(1);
      }

      const config = fsUtils.readConfig(templateType, handle);

      // Validate partner_id exists in config
      if (!config.partner_id || !config.partner_id[this.partnerId]) {
        consola.error(`Template '${handle}' has no partner_id entry for partner ${this.partnerId}. Import the template to this partner first.`);
        process.exit(1);
      }

      const templateId = config.partner_id[this.partnerId];
      const templateContent = ReconciliationText.read(handle);

      templates.push({
        type: "Global::Partner::ReconciliationText",
        id: String(templateId),
        text: templateContent.text,
        text_parts: templateContent.text_parts,
      });
    }

    // Process account templates
    for (const name of accountTemplates) {
      const templateType = "accountTemplate";
      const configPresent = fsUtils.configExists(templateType, name);

      if (!configPresent) {
        consola.error(`Config file for account template "${name}" not found`);
        process.exit(1);
      }

      const config = fsUtils.readConfig(templateType, name);

      // Validate partner_id exists in config
      if (!config.partner_id || !config.partner_id[this.partnerId]) {
        consola.error(`Template '${name}' has no partner_id entry for partner ${this.partnerId}. Import the template to this partner first.`);
        process.exit(1);
      }

      const templateId = config.partner_id[this.partnerId];
      const templateContent = AccountTemplate.read(name);

      templates.push({
        type: "Global::Partner::AccountDetailTemplate",
        id: String(templateId),
        text: templateContent.text,
        text_parts: templateContent.text_parts,
      });
    }

    // Process shared parts
    for (const name of sharedParts) {
      const templateType = "sharedPart";
      const configPresent = fsUtils.configExists(templateType, name);

      if (!configPresent) {
        consola.error(`Config file for shared part "${name}" not found`);
        process.exit(1);
      }

      const config = fsUtils.readConfig(templateType, name);

      // Validate partner_id exists in config
      if (!config.partner_id || !config.partner_id[this.partnerId]) {
        consola.error(`Shared part '${name}' has no partner_id entry for partner ${this.partnerId}. Import the shared part to this partner first.`);
        process.exit(1);
      }

      const templateId = config.partner_id[this.partnerId];
      const templateContent = await SharedPart.read(name);

      templates.push({
        type: "Global::Partner::SharedPart",
        id: String(templateId),
        text: templateContent.text,
      });
    }

    return { templates };
  }

  /**
   * Poll for sampler run completion
   * @param {number} partnerId - The partner ID
   * @param {string} samplerId - The sampler run ID
   * @returns {Promise<Object>} The completed sampler run
   */
  async #fetchAndWaitSamplerResult(samplerId) {
    let samplerRun = { status: "pending" };
    const pollingDelay = 10000; // 10 seconds
    const waitingLimit = 2000000; // 2000 seconds

    spinner.spin("Running sampler...");
    let waitingTime = 0;

    while (samplerRun.status === "pending" || samplerRun.status === "running") {
      await new Promise((resolve) => setTimeout(resolve, pollingDelay));

      const response = await SF.readSamplerRun(this.partnerId, samplerId);
      samplerRun = response.data;

      waitingTime += pollingDelay;
      // pollingDelay *= 1.05;

      if (waitingTime >= waitingLimit) {
        spinner.stop();
        consola.error("Timeout. Try to run your sampler again");
        process.exit(1);
      }
    }

    spinner.stop();
    return samplerRun;
  }

  /**
   * Process and display sampler run results
   * @param {Object} response - The sampler run response
   */
  async #handleSamplerResponse(response) {
    if (!response || !response.status) {
      consola.error("Invalid sampler response");
      process.exit(1);
    }

    switch (response.status) {
      case "failed":
        consola.error(`Sampler run failed: ${response.error_message || "Unknown error"}`);
        break;

      case "completed":
        consola.success("Sampler run completed successfully");

        if (response && response.result_url) {
          await new UrlHandler(response.content_url).openFile();
        } else {
          consola.warn("No URL returned");
        }
        break;

      default:
        consola.error(`Unexpected sampler status: ${response.status}`);
        process.exit(1);
    }
  }
}

module.exports = { LiquidSamplerRunner };
