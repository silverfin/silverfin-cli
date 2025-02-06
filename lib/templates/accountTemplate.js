const fs = require("fs");
const fsUtils = require("../utils/fsUtils");
const templateUtils = require("../utils/templateUtils");
const { consola } = require("consola");

class AccountTemplate {
  static CONFIG_ITEMS = ["name_en", "name_fr", "name_nl", "externally_managed", "account_range", "mapping_list_ranges", "published", "hide_code"];
  static TEMPLATE_TYPE = "accountTemplate";
  static TEMPLATE_FOLDER = fsUtils.FOLDERS[this.TEMPLATE_TYPE];
  constructor() {}

  /**
   * Process the response provided by the Silverfin API and store every detail in its corresponding file (liquid files, config file, etc)
   * @param {string} type The type of the template (firm or partner)
   * @param {string} envId The id of the environment (firm or partner)
   * @param {object} template The object to be processed and saved
   */
  static save(type, envId, template) {
    // NL must be enabled in "Advanced Settings" in Silverfin
    if (templateUtils.missingNameNL(template)) return false;
    if (templateUtils.missingLiquidCode(template)) return false;
    if (!templateUtils.checkValidName(template?.name_nl, this.TEMPLATE_TYPE)) return false;

    const name = template.name_nl;
    fsUtils.createTemplateFolders(this.TEMPLATE_TYPE, name);

    // Liquid files
    const mainPart = template.text;
    const textParts = templateUtils.filterParts(template);
    fsUtils.createTemplateFiles(this.TEMPLATE_TYPE, name, mainPart, textParts);

    // Liquid Test YAML
    let testContent = "# Add your Liquid Tests here";
    fsUtils.createLiquidTestFiles(this.TEMPLATE_TYPE, name, testContent);

    // Config Json File
    let existingConfig = fsUtils.readConfig(this.TEMPLATE_TYPE, name);
    const configDetails = this.#prepareConfigDetails(type, envId, template, existingConfig);

    const addNewId = (currentType, typeCheck, envId, template) => (currentType == typeCheck ? { [envId]: template.id } : {});

    const configContent = {
      id: { ...existingConfig?.id, ...addNewId(type, "firm", envId, template) },
      partner_id: {
        ...existingConfig?.partner_id,
        ...addNewId(type, "partner", envId, template),
      },
      test: `tests/${name}_liquid_test.yml`,
      ...configDetails,
    };

    fsUtils.writeConfig(this.TEMPLATE_TYPE, name, configContent);

    return true;
  }

  /**
   * Read all necessary files and prepare the object to be sent to the Silverfin API
   * @param {string} name The name of the template to read
   * @returns {object} The object to be sent to the Silverfin API
   */
  static read(name) {
    if (!templateUtils.checkValidName(name, this.TEMPLATE_TYPE)) return false;
    fsUtils.createTemplateFolders(this.TEMPLATE_TYPE, name);
    // Config.json
    const templateConfig = fsUtils.readConfig(this.TEMPLATE_TYPE, name);
    let template = this.#filterConfigItems(templateConfig);
    // Liquid
    this.#createMainLiquid(name);
    template.text = this.#readMainLiquid(name, templateConfig);
    template.text_parts = this.#readPartsLiquid(name, templateConfig);

    return template;
  }

  /** Update template's id for the corresponding firm in template's config file */
  static updateTemplateId(type, envId, name, templateId) {
    let templateConfig = fsUtils.readConfig(this.TEMPLATE_TYPE, name);
    fsUtils.setTemplateId(type, envId, templateConfig, templateId);
    fsUtils.writeConfig(this.TEMPLATE_TYPE, name, templateConfig);
  }

  static #prepareConfigDetails(type, envId, template, existingConfig = {}) {
    const attributes = this.CONFIG_ITEMS.reduce((acc, attribute) => {
      if (template.hasOwnProperty(attribute)) {
        acc[attribute] = template[attribute];
      } else if (existingConfig?.hasOwnProperty(attribute)) {
        acc[attribute] = existingConfig[attribute];
      }

      return acc;
    }, {});

    // We need to also create the mapping_list_ranges, which could be different per firm & partner

    /* 
      Mapping list ranges sample in config.json:
      ...
    "account_range": "280,282", // This is the "no mapping list" range
    "mapping_list_ranges": [
      {
        "partner_account_mapping_list_id": 2,
        "account_range": "280,282",
        "type": "partner",
        "env_id": "84"
      },
      {
        "account_mapping_list_id": 8957,
        "account_range": "280,282,284",
        "type": "firm",
        "env_id": "13827"
      }
    ],
    ...
    */

    const existingMappingRanges = existingConfig.mapping_list_ranges || [];
    const latestMappingListIds = template.mapping_list_ranges.map((range) => (type == "partner" ? range.partner_account_mapping_list_id : range.account_mapping_list_id));

    let updatedMappingRanges = [...existingMappingRanges];

    // Remove the mapping list ranges from this partner / firm env_id which are no longer part of the response
    updatedMappingRanges =
      updatedMappingRanges?.filter(
        (range) => latestMappingListIds.includes(type == "partner" ? range.partner_account_mapping_list_id : range.account_mapping_list_id) || range.env_id !== envId
      ) || [];

    for (let latestMappingListRange of template.mapping_list_ranges) {
      // Find the existing mapping list range, if any
      let existingIndex;

      if (type == "partner") {
        existingIndex = existingMappingRanges.findIndex(
          (existingMappingListRange) => existingMappingListRange.partner_account_mapping_list_id === latestMappingListRange.partner_account_mapping_list_id
        );
      } else {
        existingIndex = existingMappingRanges.findIndex(
          (existingMappingListRange) => existingMappingListRange.account_mapping_list_id === latestMappingListRange.account_mapping_list_id
        );
      }

      if (existingIndex !== -1) {
        // If it exists, update existing properties
        updatedMappingRanges[existingIndex] = {
          ...latestMappingListRange,
          type: type,
          env_id: envId,
        };
      } else {
        // If it doesn't exist, add a new object with the necessary properties
        updatedMappingRanges.push({
          ...latestMappingListRange,
          type: type,
          env_id: envId,
        });
      }
    }

    const textParts = templateUtils.filterParts(template);
    const configTextParts = Object.keys(textParts).reduce((acc, name) => {
      if (name) {
        acc[name] = `text_parts/${name}.liquid`;
      }
      return acc;
    }, {});
    return {
      ...attributes,
      text: "main.liquid",
      text_parts: configTextParts,
      mapping_list_ranges: updatedMappingRanges,
    };
  }

  static #filterConfigItems(templateConfig) {
    return this.CONFIG_ITEMS.reduce((acc, attribute) => {
      if (templateConfig.hasOwnProperty(attribute)) {
        acc[attribute] = templateConfig[attribute];
      }
      return acc;
    }, {});
  }

  static #createMainLiquid(name) {
    const relativePath = `./${this.TEMPLATE_FOLDER}/${name}`;
    if (!fs.existsSync(`${relativePath}/main.liquid`)) {
      fsUtils.createLiquidFile(relativePath, "main", "{% comment %} MAIN PART {% endcomment %}");
    }
  }

  static #readMainLiquid(name, templateConfig) {
    const mainPartPath = `./${this.TEMPLATE_FOLDER}/${name}/${templateConfig.text}`;
    return fs.readFileSync(mainPartPath, "utf-8");
  }

  static #readPartsLiquid(name, templateConfig) {
    const relativePath = `./${this.TEMPLATE_FOLDER}/${name}`;
    return Object.keys(templateConfig.text_parts).reduce((array, name) => {
      let path = `${relativePath}/${templateConfig.text_parts[name]}`;
      let content = fs.readFileSync(path, "utf-8");
      array.push({ name, content });
      return array;
    }, []);
  }
}

module.exports = { AccountTemplate };

// Example Silverfin Response
// {
//   "id": 100,
//   "marketplace_template_id": 25,
//   "account_range": null,
//   "text_configuration": null,
//   "name_en": Account template Name,
//   "text": "Liquid code",
//   "text_parts": [
//       {
//           "name": "part_1",
//           "content": "part 1 liquid code"
//       }
//   ],
//   "mapping_list_ranges": [],
//   "externally_managed": false
// }
