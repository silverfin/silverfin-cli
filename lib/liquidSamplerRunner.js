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
  /**
   * @param {string|number} partnerId - The partner environment id
   * @param {Object} [options]
   * @param {boolean} [options.openReport] - Whether to download and open the report locally.
   *   Defaults to false in CI (process.env.CI), true otherwise. The report URL is always logged.
   */
  constructor(partnerId, options = {}) {
    this.partnerId = partnerId;
    this.openReport = options.openReport ?? !process.env.CI;
  }

  /**
   * Run liquid sampler for partner templates
   * @param {Object} templateHandles - Object containing arrays of template identifiers
   * @param {Array<string>} templateHandles.reconciliationTexts - Array of reconciliation text handles
   * @param {Array<string>} templateHandles.accountTemplates - Array of account template names
   * @param {Array<string>} templateHandles.sharedParts - Array of shared part names
   * @param {Array<number>} firmIds - Array of firm IDs to use in the sampler
   * @returns {Promise<void>}
   */
  async run(templateHandles = {}, firmIds = []) {
    try {
      // Build payload
      const samplerParams = await this.#buildSamplerParams(templateHandles, firmIds);

      consola.info(`Starting sampler run with ${samplerParams.templates.length} template(s)...`);

      // Start sampler run
      const samplerResponse = await SF.createSamplerRun(this.partnerId, samplerParams);

      if (!samplerResponse?.data?.id) {
        consola.error("Failed to start sampler run - no ID returned");
        if (samplerResponse?.data) {
          consola.error(`Response data: ${JSON.stringify(samplerResponse.data)}`);
        }
        process.exit(1);
      }

      const samplerId = samplerResponse.data.id;

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

      if (!response?.data?.status) {
        consola.error("Failed to fetch sampler run status. Is staging running?");
        process.exit(1);
      }

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
   * @param {Array<number>} firmIds - Array of firm IDs to use in the sampler
   * @returns {Object} Sampler payload with templates array
   */
  async #buildSamplerParams(templateHandles = {}, firmIds = []) {
    const templates = [];
    const { reconciliationTexts = [], accountTemplates = [], sharedParts = [] } = templateHandles;

    // Process reconciliation texts
    for (const handle of reconciliationTexts) {
      const templateId = this.#resolveTemplateId("reconciliationText", handle, "reconciliation text");
      const { text, text_parts } = await this.#readTemplateContent(ReconciliationText, handle, "reconciliation text");

      templates.push({
        type: "reconciliation_text",
        id: templateId,
        text,
        text_parts,
      });
    }

    // Process account templates
    for (const name of accountTemplates) {
      const templateId = this.#resolveTemplateId("accountTemplate", name, "account template");
      const { text, text_parts } = await this.#readTemplateContent(AccountTemplate, name, "account template");

      templates.push({
        type: "account_detail_template",
        id: templateId,
        text,
        text_parts,
      });
    }

    // Process shared parts
    for (const name of sharedParts) {
      const templateId = this.#resolveTemplateId("sharedPart", name, "shared part");
      const { text } = await this.#readTemplateContent(SharedPart, name, "shared part");

      templates.push({
        type: "shared_part",
        id: templateId,
        text,
      });
    }

    return { templates, firm_ids: firmIds };
  }

  /**
   * Resolve a template's partner-specific ID from its local config.
   * Exits the process with a helpful message if the config is missing or has
   * no partner_id entry for the current partner.
   * @param {string} templateType - Config type ("reconciliationText" | "accountTemplate" | "sharedPart")
   * @param {string} handle - Template handle/name
   * @param {string} label - Human-readable label used in error messages
   * @returns {string} The partner template ID
   */
  #resolveTemplateId(templateType, handle, label) {
    if (!fsUtils.configExists(templateType, handle)) {
      consola.error(`Config file for ${label} "${handle}" not found`);
      process.exit(1);
    }

    const config = fsUtils.readConfig(templateType, handle);

    if (!config.partner_id || !config.partner_id[this.partnerId]) {
      consola.error(`${label} '${handle}' has no partner_id entry for partner ${this.partnerId}. Import it to this partner first.`);
      process.exit(1);
    }

    return String(config.partner_id[this.partnerId]);
  }

  /**
   * Read a template's local content, exiting with a clear message if it
   * can't be read (e.g. an invalid handle makes `read` return false).
   * Awaiting is safe for both the synchronous (ReconciliationText,
   * AccountTemplate) and asynchronous (SharedPart) read implementations.
   * @param {Object} TemplateClass - Template class exposing a static `read`
   * @param {string} handle - Template handle/name
   * @param {string} label - Human-readable label used in error messages
   * @returns {Promise<Object>} The template content ({ text, text_parts? })
   */
  async #readTemplateContent(TemplateClass, handle, label) {
    const templateContent = await TemplateClass.read(handle);

    if (!templateContent) {
      consola.error(`Could not read ${label} "${handle}"`);
      process.exit(1);
    }

    return templateContent;
  }

  /**
   * Poll for sampler run completion
   * @param {string} samplerId - The sampler run ID
   * @returns {Promise<Object>} The completed sampler run
   */
  async #fetchAndWaitSamplerResult(samplerId) {
    let samplerRun = { status: "pending" };
    const pollingDelay = 15000; // 15 seconds
    const waitingLimit = 3600000; // 1 hour

    // The animated spinner writes a frame on every tick; without a TTY (e.g. CI)
    // that floods the captured log with thousands of lines. Use a single static
    // line there instead.
    const useSpinner = !process.env.CI;
    if (useSpinner) {
      spinner.spin("Running sampler...");
    } else {
      consola.info("Running sampler... (polling for completion)");
    }
    let waitingTime = 0;

    try {
      while (samplerRun.status === "pending" || samplerRun.status === "running") {
        // Pause the loop before polling again (setTimeout wrapped in a Promise so it can be awaited)
        await new Promise((resolve) => setTimeout(resolve, pollingDelay));

        // Poll for the sampler run status
        const response = await SF.readSamplerRun(this.partnerId, samplerId);
        samplerRun = response?.data;

        if (!samplerRun?.status) {
          // process.exit() bypasses the finally block, so stop the spinner explicitly here.
          spinner.stop();
          consola.error("Failed to fetch sampler run status. Is staging running?");
          process.exit(1);
        }

        waitingTime += pollingDelay;

        if (waitingTime >= waitingLimit) {
          // process.exit() bypasses the finally block, so stop the spinner explicitly here.
          spinner.stop();
          consola.error("Timeout. Try to fetch the status by using the --id flag, if not run your sampler again");
          process.exit(1);
        }
      }

      return samplerRun;
    } finally {
      spinner.stop();
    }
  }

  /**
   * Process and display sampler run results
   * @param {Object} response - The sampler run response
   */
  async #handleSamplerResponse(response) {
    switch (response.status) {
      case "failed":
        consola.error(`Sampler run failed: ${response.error_message || "Unknown error"}`);
        process.exit(1);
        break; // eslint-disable-line no-unreachable

      case "completed":
        consola.success("Sampler run completed successfully");

        if (response && response.result_url) {
          // Always surface the hosted report URL so it can be captured in CI
          // (e.g. echoed into $GITHUB_STEP_SUMMARY) without downloading anything.
          consola.success(`Sampler report: ${response.result_url}`);
          if (this.openReport) {
            await new UrlHandler(response.result_url).openFile();
          }
        } else {
          consola.warn("No URL returned");
        }
        break;

      case "pending":        
      case "running":
        consola.info(`Sampler run is still in progress. Current status: "${response.status}". Please check again later.`);
        break;

      default:
        consola.error(`Unexpected sampler status: ${response.status}`);
        process.exit(1);
    }
  }
}

module.exports = { LiquidSamplerRunner };
