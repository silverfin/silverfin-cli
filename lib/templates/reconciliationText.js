const fs = require("fs");
const fsUtils = require("../utils/fsUtils");
const templateUtils = require("../utils/templateUtils");
const { consola } = require("consola");

class ReconciliationText {
  // To be added: marketplace_template_id
  static CONFIG_ITEMS = [
    "handle",
    "name_en",
    "name_fr",
    "name_nl",
    "auto_hide_formula",
    "text_configuration",
    "virtual_account_number",
    "reconciliation_type",
    "public",
    "allow_duplicate_reconciliations",
    "is_active",
    "externally_managed",
    "published",
    "hide_code",
  ];
  static RECONCILIATION_TYPE_OPTIONS = [
    "reconciliation_not_necessary",
    "can_be_reconciled_without_data",
    "only_reconciled_with_data",
  ];
  static TEMPLATE_TYPE = "reconciliationText";
  static TEMPLATE_FOLDER = fsUtils.FOLDERS[this.TEMPLATE_TYPE];
  constructor() {}

  /**
   * Process the response provided by the Silverfin API and store every detail in its corresponding file (liquid files, config file, etc)
   * @param {number} firmId
   * @param {object} template
   */
  static async save(firmId, template) {
    if (this.#missingHandle(template)) return false;
    if (templateUtils.missingLiquidCode(template)) return false;
    if (!templateUtils.checkValidName(template.handle, this.TEMPLATE_TYPE))
      return false;
    if (!fsUtils.checkNameAligned(template.handle, this.TEMPLATE_TYPE))
      return false;

    const handle = template.handle;
    fsUtils.createTemplateFolders(this.TEMPLATE_TYPE, handle, true);

    // Liquid files
    const mainPart = template.text;
    const textParts = templateUtils.filterParts(template);
    fsUtils.createTemplateFiles(
      this.TEMPLATE_TYPE,
      handle,
      mainPart,
      textParts
    );

    // Liquid Test YAML
    let testContent = "# Add your Liquid Tests here";
    if (template.tests) {
      testContent = template.tests;
    }
    fsUtils.createLiquidTestFiles(this.TEMPLATE_TYPE, handle, testContent);

    // Config Json File
    let existingConfig = fsUtils.readConfig(this.TEMPLATE_TYPE, handle);
    const configDetails = this.#prepareConfigDetails(template, existingConfig);
    const configContent = {
      id: {
        ...existingConfig?.id,
        [firmId]: template.id,
      },
      partnerId: {
        ...existingConfig?.partnerId,
      },
      test: `tests/${handle}_liquid_test.yml`,
      ...configDetails,
    };
    fsUtils.writeConfig(this.TEMPLATE_TYPE, handle, configContent);

    return true;
  }

  /**
   * Read all necessary files and prepare the object to be sent to the Silverfin API
   * @param {string} handle The handle of the template to read
   * @returns {object} The object to be sent to the Silverfin API
   */
  static async read(handle) {
    if (!templateUtils.checkValidName(handle, this.TEMPLATE_TYPE)) return false;
    if (!fsUtils.checkNameAligned(handle, this.TEMPLATE_TYPE)) return false;
    fsUtils.createTemplateFolders(this.TEMPLATE_TYPE, handle, true);
    // Config.json
    let templateConfig = fsUtils.readConfig(this.TEMPLATE_TYPE, handle);
    templateConfig = this.#checkHandleAndNameInConfig(templateConfig, handle);
    let template = this.#filterConfigItems(templateConfig);
    template = this.#checkReconciliationType(template);
    // Liquid Tests
    templateConfig = this.#createLiquidTest(handle, templateConfig);
    // Liquid
    this.#createMainLiquid(handle);
    template.text = this.#readMainLiquid(handle, templateConfig);
    template.text_parts = this.#readPartsLiquid(handle, templateConfig);

    fsUtils.writeConfig(this.TEMPLATE_TYPE, handle, templateConfig);
    return template;
  }

  /** Update template's id for the corresponding firm in template's config file */
  static updateTemplateId(firmId, handle, templateId) {
    let templateConfig = fsUtils.readConfig(this.TEMPLATE_TYPE, handle);
    templateConfig.id[firmId] = templateId;
    fsUtils.writeConfig(this.TEMPLATE_TYPE, handle, templateConfig);
  }

  static #missingHandle(template) {
    if (!template.handle) {
      consola.warn(
        `Template with id "${template.id}" has no handle, add a handle before importing it from Silverfin. Skipped`
      );
      return true;
    }
    return false;
  }

  static #prepareConfigDetails(template, existingConfig = {}) {
    const attributes = this.CONFIG_ITEMS.reduce((acc, attribute) => {
      if (template.hasOwnProperty(attribute)) {
        acc[attribute] = template[attribute];
      } else if (existingConfig?.hasOwnProperty(attribute)) {
        acc[attribute] = existingConfig[attribute];
      }
      return acc;
    }, {});
    const textParts = templateUtils.filterParts(template);
    const configTextParts = Object.keys(textParts).reduce((acc, name) => {
      if (name) {
        acc[name] = `text_parts/${name}.liquid`;
      }
      return acc;
    }, {});
    return { ...attributes, text: "main.liquid", text_parts: configTextParts };
  }

  static #filterConfigItems(templateConfig) {
    return this.CONFIG_ITEMS.reduce((acc, attribute) => {
      if (templateConfig.hasOwnProperty(attribute)) {
        acc[attribute] = templateConfig[attribute];
      }
      return acc;
    }, {});
  }

  static #checkReconciliationType(attributes) {
    if (
      !this.RECONCILIATION_TYPE_OPTIONS.includes(attributes.reconciliation_type)
    ) {
      consola.warn(
        `Wrong reconciliation type. It must be one of the following: ${this.RECONCILIATION_TYPE_OPTIONS.join(
          ", "
        )}. Skipping it's definition.`
      );
      delete attributes.reconciliation_type;
    }
    return attributes;
  }

  static #createMainLiquid(handle) {
    const relativePath = `./${this.TEMPLATE_FOLDER}/${handle}`;
    if (!fs.existsSync(`${relativePath}/main.liquid`)) {
      fsUtils.createLiquidFile(
        relativePath,
        "main",
        "{% comment %} MAIN PART {% endcomment %}"
      );
    }
  }

  static #readMainLiquid(handle, templateConfig) {
    const mainPartPath = `./${this.TEMPLATE_FOLDER}/${handle}/${templateConfig.text}`;
    return fs.readFileSync(mainPartPath, "utf-8");
  }

  static #readPartsLiquid(handle, templateConfig) {
    const relativePath = `./${this.TEMPLATE_FOLDER}/${handle}`;
    return Object.keys(templateConfig.text_parts).reduce((array, name) => {
      let path = `${relativePath}/${templateConfig.text_parts[name]}`;
      let content = fs.readFileSync(path, "utf-8");
      array.push({ name, content });
      return array;
    }, []);
  }

  // Write handle & names if they are missing in the config
  static #checkHandleAndNameInConfig(templateConfig, templateHandle) {
    // name_nl is required by Silverfin
    const items = ["handle", "name_en", "name_nl"];
    items.forEach((item) => {
      if (!templateConfig[item]) {
        templateConfig[item] = templateHandle;
      }
    });
    return templateConfig;
  }

  static #createLiquidTest(handle, templateConfig) {
    // Liquid Test YAML
    let testContent = "# Add your Liquid Tests here";
    fsUtils.createLiquidTestFiles(this.TEMPLATE_TYPE, handle, testContent);
    if (!templateConfig.test) {
      templateConfig.test = `tests/${handle}_liquid_test.yml`;
    }
    return templateConfig;
  }
}

module.exports = { ReconciliationText };
