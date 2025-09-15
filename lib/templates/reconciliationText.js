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
    "name_de",
    "name_da",
    "name_se",
    "name_fi",
    "description_en",
    "description_fr",
    "description_nl",
    "auto_hide_formula",
    "virtual_account_number",
    "reconciliation_type",
    "public",
    "allow_duplicate_reconciliations",
    "is_active",
    "externally_managed",
    "published",
    "hide_code",
    "use_full_width",
    "downloadable_as_docx",
    "test_firm_id",
  ];
  static RECONCILIATION_TYPE_OPTIONS = ["reconciliation_not_necessary", "can_be_reconciled_without_data", "only_reconciled_with_data"];
  static EXTERNALLY_MANAGED_ITEMS = ["downloadable_as_docx"];
  static TEMPLATE_TYPE = "reconciliationText";
  static TEMPLATE_FOLDER = fsUtils.FOLDERS[this.TEMPLATE_TYPE];
  constructor() {}

  /**
   * Process the response provided by the Silverfin API and store every detail in its corresponding file (liquid files, config file, etc)
   * @param {string} type firm or partner
   * @param {number} envId  The id of the firm or partner environment where the template is going to be imported from
   * @param {object} template The template object provided by the Silverfin API
   */
  static async save(type, envId, template) {
    if (this.#missingHandle(template)) return false;
    if (templateUtils.missingLiquidCode(template)) return false;
    if (!templateUtils.checkValidName(template.handle, this.TEMPLATE_TYPE)) return false;

    const handle = template.handle;
    fsUtils.createTemplateFolders(this.TEMPLATE_TYPE, handle, true);

    // Liquid files
    const mainPart = template.text;
    const textParts = templateUtils.filterParts(template);
    fsUtils.createTemplateFiles(this.TEMPLATE_TYPE, handle, mainPart, textParts);

    // Liquid Test YAML
    let testContent = "# Add your Liquid Tests here";
    if (template.tests) {
      testContent = template.tests;
    }
    fsUtils.createLiquidTestFiles(this.TEMPLATE_TYPE, handle, testContent);

    // Fetch existing config file
    const existingConfig = fsUtils.readConfig(this.TEMPLATE_TYPE, handle);
    const configDetails = this.#prepareConfigDetails(template, existingConfig);
    const addNewId = (currentType, typeCheck, envId, template) => (currentType == typeCheck ? { [envId]: template.id } : {});

    const configContent = {
      id: { ...existingConfig?.id, ...addNewId(type, "firm", envId, template) },
      partner_id: {
        ...existingConfig?.partner_id,
        ...addNewId(type, "partner", envId, template),
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
  static read(handle) {
    if (!templateUtils.checkValidName(handle, this.TEMPLATE_TYPE)) return false;
    fsUtils.createTemplateFolders(this.TEMPLATE_TYPE, handle, true);

    // Config.json
    let templateConfig = fsUtils.readConfig(this.TEMPLATE_TYPE, handle);
    const originalConfig = { ...templateConfig };
    templateConfig = this.#checkHandleAndNameInConfig(templateConfig, handle);

    let template = this.#filterConfigItems(templateConfig);
    template = this.#checkReconciliationType(template);
    // Liquid Tests
    templateConfig = this.#createLiquidTest(handle, templateConfig);
    // Liquid
    this.#createMainLiquid(handle);
    template.text = this.#readMainLiquid(handle, templateConfig);
    template.text_parts = this.#readPartsLiquid(handle, templateConfig);

    this.#updateConfigIfChanged(originalConfig, templateConfig, handle);

    return template;
  }

  /** Update template's id for the corresponding firm in template's config file */
  static updateTemplateId(type, envId, handle, templateId) {
    const templateConfig = fsUtils.readConfig(this.TEMPLATE_TYPE, handle);
    fsUtils.setTemplateId(type, envId, templateConfig, templateId);
    fsUtils.writeConfig(this.TEMPLATE_TYPE, handle, templateConfig);
  }

  static #missingHandle(template) {
    if (!template.handle) {
      consola.warn(`Template with id "${template.id}" has no handle, add a handle before importing it from Silverfin. Skipped`);
      return true;
    }
    return false;
  }

  static #prepareConfigDetails(template, existingConfig = {}) {
    const attributes = this.CONFIG_ITEMS.reduce((acc, attribute) => {
      if (Object.hasOwn(template, attribute)) {
        acc[attribute] = template[attribute];
      } else if (existingConfig && Object.hasOwn(existingConfig, attribute)) {
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
    const skippedItems = [];

    const filteredConfig = this.CONFIG_ITEMS.reduce((acc, attribute) => {
      // Skip externally managed items if externally_managed is false
      if (this.EXTERNALLY_MANAGED_ITEMS.includes(attribute) && templateConfig.externally_managed === false) {
        skippedItems.push(attribute);
        return acc;
      }

      if (Object.hasOwn(templateConfig, attribute)) {
        acc[attribute] = templateConfig[attribute];
      }
      return acc;
    }, {});

    if (skippedItems.length > 0) {
      consola.warn(`The following attributes were skipped because they can only be updated when the template is externally managed: ${skippedItems.join(", ")}.`);
    }
    return filteredConfig;
  }

  static #updateConfigIfChanged(originalConfig, currentConfig, handle) {
    if (JSON.stringify(originalConfig) !== JSON.stringify(currentConfig)) {
      fsUtils.writeConfig(this.TEMPLATE_TYPE, handle, currentConfig);
    }
  }

  static #checkReconciliationType(template) {
    if (!this.RECONCILIATION_TYPE_OPTIONS.includes(template.reconciliation_type)) {
      consola.warn(`Wrong reconciliation type. It must be one of the following: ${this.RECONCILIATION_TYPE_OPTIONS.join(", ")}. Skipping its definition.`);
      delete template.reconciliation_type;
    }
    return template;
  }

  static #createMainLiquid(handle) {
    const relativePath = `./${this.TEMPLATE_FOLDER}/${handle}`;
    if (!fs.existsSync(`${relativePath}/main.liquid`)) {
      fsUtils.createLiquidFile(relativePath, "main", "{% comment %} MAIN PART {% endcomment %}");
    }
  }

  static #readMainLiquid(handle, templateConfig) {
    const mainPartPath = `./${this.TEMPLATE_FOLDER}/${handle}/${templateConfig.text}`;
    return fs.readFileSync(mainPartPath, "utf-8");
  }

  static #readPartsLiquid(handle, templateConfig) {
    const relativePath = `./${this.TEMPLATE_FOLDER}/${handle}`;
    return Object.keys(templateConfig.text_parts).reduce((array, name) => {
      const path = `${relativePath}/${templateConfig.text_parts[name]}`;
      const content = fs.readFileSync(path, "utf-8");
      array.push({ name, content });
      return array;
    }, []);
  }

  // Write handle & names if they are missing in the config
  static #checkHandleAndNameInConfig(templateConfig, templateHandle) {
    // only populate handle and name_nl automatically if they are missing in the config
    if (!templateConfig.handle) {
      templateConfig.handle = templateHandle;
    }
    if (!templateConfig.name_nl) {
      templateConfig.name_nl = templateHandle;

    return templateConfig;
  }

  static #populateMissingDescriptionLocales(templateConfig) {
    if (templateConfig.description && !templateConfig.description_nl) {
      templateConfig.description_nl = templateConfig.description;
      templateConfig.description_en = templateConfig.description;
      templateConfig.description_fr = templateConfig.description;
      delete templateConfig.description;

      // Write updated config back to file
      consola.debug(`Template ${templateConfig.handle}: adjusting description fields in config.json`);
      fsUtils.writeConfig(this.TEMPLATE_TYPE, templateConfig.handle, templateConfig);
    }
    return templateConfig;
  }

  static #createLiquidTest(handle, templateConfig) {
    // Liquid Test YAML
    const testContent = "# Add your Liquid Tests here";
    fsUtils.createLiquidTestFiles(this.TEMPLATE_TYPE, handle, testContent);
    if (!templateConfig.test) {
      templateConfig.test = `tests/${handle}_liquid_test.yml`;
    }
    return templateConfig;
  }
}

module.exports = { ReconciliationText };

// Example Silverfin Response
// {
//   "id": 150,
//   "marketplace_template_id": 30,
//   "handle": "reconciliation_handle",
//   "name_en": "Reconciliation Text Name",
//   "name_fr": "Nom du texte de rapprochement",
//   "name_nl": "Afstemming tekst naam",
//   "description_en": "Description of the reconciliation text",
//   "description_fr": "Description du texte de rapprochement",
//   "description_nl": "Beschrijving van de afstemming tekst",
//   "auto_hide_formula": "A1 > 0",
//   "virtual_account_number": "1234",
//   "reconciliation_type": "can_be_reconciled_without_data",
//   "public": true,
//   "allow_duplicate_reconciliations": false,
//   "is_active": true,
//   "externally_managed": false,
//   "published": true,
//   "hide_code": false,
//   "use_full_width": true,
//   "downloadable_as_docx": false,
//   "text": "Liquid code",
//   "text_parts": [
//       {
//           "name": "part_1",
//           "content": "part 1 liquid code"
//       }
//   ]
// }
