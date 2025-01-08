const fs = require("fs");
const fsUtils = require("../utils/fsUtils");
const templateUtils = require("../utils/templateUtils");
const SF = require("../api/sfApi");
const { default: consola } = require("consola");

class SharedPart {
  static CONFIG_ITEMS = ["name", "externally_managed", "hide_code"];
  static TEMPLATE_TYPE = "sharedPart";
  static TEMPLATE_FOLDER = fsUtils.FOLDERS[this.TEMPLATE_TYPE];
  constructor() {}

  /**
   * Process the response provided by the Silverfin API and store every detail in its corresponding file (liquid files, config file, etc)
   * @param {string} type firm or partner
   * @param {number} envId  The id of the firm or partner environment where the template is going to be imported fro
   * @param {object} template The template object provided by the Silverfin API
   */
  static async save(type, envId, template) {
    if (!templateUtils.checkValidName(template.name, this.TEMPLATE_TYPE))
      return false;

    fsUtils.createSharedPartFolders(template.name);

    // Liquid File
    const relativePath = `./${this.TEMPLATE_FOLDER}/${template.name}`;
    fsUtils.createLiquidFile(relativePath, template.name, template.text);

    // Config Json File
    let existingConfig = fsUtils.readConfig(this.TEMPLATE_TYPE, template.name);

    let usedIn = await this.#processUsedIn(
      type,
      envId,
      template.used_in,
      existingConfig
    );

    const addNewId = (currentType, typeCheck, envId, template) =>
      currentType == typeCheck ? { [envId]: template.id } : {};

    const config = {
      id: { ...existingConfig?.id, ...addNewId(type, "firm", envId, template) },
      partner_id: {
        ...existingConfig?.partner_id,
        ...addNewId(type, "partner", envId, template),
      },
      name: template.name,
      text: `${template.name}.liquid`,
      used_in: usedIn,
      externally_managed: template.externally_managed,
    };

    fsUtils.writeConfig(this.TEMPLATE_TYPE, template.name, config);

    return true;
  }

  static async read(name) {
    if (!templateUtils.checkValidName(name, this.TEMPLATE_TYPE)) return false;
    fsUtils.createSharedPartFolders(name);
    // Config.json
    const templateConfig = fsUtils.readConfig(this.TEMPLATE_TYPE, name);
    let template = this.#filterConfigItems(templateConfig);
    // Liquid File
    this.#createMainLiquid(name);
    template.text = this.#readMainLiquid(name, templateConfig);
    return template;
  }

  /** Update template's id for the corresponding firm in template's config file */
  static updateTemplateId(type, envId, name, templateId) {
    let templateConfig = fsUtils.readConfig(this.TEMPLATE_TYPE, name);
    fsUtils.setTemplateId(type, envId, templateConfig, templateId)
    
    fsUtils.writeConfig(this.TEMPLATE_TYPE, name, templateConfig);
  }

  static async #processUsedIn(type, envId, templateUsedIn, existingConfig) {
    // Adjust IDs and find templates handle
    let usedIn = existingConfig.used_in ? existingConfig.used_in : [];
    // Remove old format IDs
    // OLD: "id": 1234
    // NEW: "id": { "100": 1234 }
    usedIn = usedIn.filter((template) => typeof template.id !== "number");

    for (let template of templateUsedIn) {
      template = this.checkTemplateType(template);
      const handle = await this.#findTemplateHandle(type, envId, template);
      if (!handle) continue;

      // Check if there's already an existing used_in configuration for other firms/partners
      const templateExistingInConfig = usedIn.findIndex(
        (existingUsedTemplate) => existingUsedTemplate.handle == handle
      );
      let existingUsedTemplate = usedIn[templateExistingInConfig];

      if (existingUsedTemplate) {
        // Template already exists in usedIn array
        if (type === "firm") {
          existingUsedTemplate.id = {
            ...existingUsedTemplate.id,
            [envId]: template.id,
          };
        }

        if (type === "partner") {
          existingUsedTemplate.partner_id = {
            ...existingUsedTemplate.partner_id,
            [envId]: template.id,
          };
        }
      } else {
        // Template doesn't exist in usedIn array yet
        const usedTemplate = {
          id: {},
          partner_id: {},
          handle,
          type: template.type,
        };

        if (type === "firm") {
          usedTemplate.id[envId] = template.id;
        }

        if (type === "partner") {
          usedTemplate.partner_id[envId] = template.id;
        }

        usedIn.push(usedTemplate);
      }
    }

    return usedIn;
  }

  static async #findTemplateHandle(type, envId, template) {
    // Search in repository
    let handle = fsUtils.findHandleByID(
      type,
      envId,
      template.type,
      template.id
    );

    if (!handle) {
      const handle_attribute =
        templateUtils.TEMPLATES_NAME_ATTRIBUTE[template.type];
      switch (template.type) {
        case "reconciliationText":
          let reconciliationText = await SF.readReconciliationTextById(
            type,
            envId,
            template.id
          );

          if (reconciliationText) {
            handle = reconciliationText.data[handle_attribute];
          }
          break;
        case "exportFile":
          let exportFile = await SF.readExportFileById(
            type,
            envId,
            template.id
          );
          if (exportFile) {
            handle = exportFile[handle_attribute];
          }
          break;
        case "accountTemplate":
          let accountTemplate = await SF.readAccountTemplateById(
            type,
            envId,
            template.id
          );

          if (accountTemplate) {
            handle = accountTemplate?.name_nl;
          }
          break;
      }
    }

    return handle;
  }

  static #createMainLiquid(name) {
    const relativePath = `./${this.TEMPLATE_FOLDER}/${name}`;
    if (!fs.existsSync(`${relativePath}/${name}.liquid`)) {
      fsUtils.createLiquidFile(
        relativePath,
        name,
        "{% comment %} MAIN PART {% endcomment %}"
      );
    }
  }

  static #readMainLiquid(name) {
    const mainPartPath = `./${this.TEMPLATE_FOLDER}/${name}/${name}.liquid`;
    return fs.readFileSync(mainPartPath, "utf-8");
  }

  static #filterConfigItems(templateConfig) {
    return this.CONFIG_ITEMS.reduce((acc, attribute) => {
      if (templateConfig.hasOwnProperty(attribute)) {
        acc[attribute] = templateConfig[attribute];
      }
      return acc;
    }, {});
  }

  /** For legacy compatibility. Originally we stored `type` as `reconciliation` or 'account_detail_template', but it should aligned to `reconciliationText` & 'accountTemplate' */
  static checkTemplateType(template) {
    if (fsUtils.TEMPLATE_TYPES.includes(template.type)) {
      return template;
    }
    template.type = templateUtils.TEMPLATE_MAP_TYPES[template.type];
    return template;
  }
}

module.exports = { SharedPart };
