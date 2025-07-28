const { consola } = require("consola");
const { AxiosFactory } = require("./axiosFactory");

class BaseApi {
  #responseSuccessHandler(response) {
    if (response?.status) {
      consola.debug(
        `Response Status: ${response.status} (${response?.statusText}) - method: ${response?.config?.method || response?.method} - url: ${response?.config?.url || response?.url}`
      );
    }
  }

  async _responseErrorHandler(error) {
    if (error && error.response) {
      consola.debug(`Response Status: ${error.response.status} (${error.response.statusText}) - method: ${error.response.config.method} - url: ${error.response.config.url}`);
    }
    if (error?.response) {
      // Valid Request. Not Found
      if (error.response.status === 404) {
        consola.error(`Response Error (404): ${JSON.stringify(error.response.data.error)}`);
        return;
      }
      // Bad Request
      if (error.response.status === 400) {
        consola.error(`Response Error (400): ${JSON.stringify(error.response.data.error)}`);
        return;
      }
      // Unprocessable Entity
      if (error.response.status === 422) {
        consola.error(`Response Error (422): ${JSON.stringify(error.response.data)}`, "\n", `You don't have the rights to update the previous parameters`);
        process.exit(1);
      }
      if (error.response.status === 401) {
        consola.debug(`Response Error (401): ${JSON.stringify(error.response.data)}`);
      }
      // Forbidden
      if (error.response.status === 403) {
        consola.error("Error (403): Forbidden access. Terminating process");
        process.exit(1);
      }
    }
    // Not handled
    throw error;
  }

  async _makeRequest(method, type, envId, endpoint, data = null, params = null, config = null) {
    const instance = AxiosFactory.createInstance(type, envId);
    try {
      const requestConfig = { ...config };
      if (params) requestConfig.params = params;

      let response;
      switch (method.toLowerCase()) {
        case "get":
          response = await instance.get(endpoint, requestConfig);
          break;
        case "post":
          response = await instance.post(endpoint, data, requestConfig);
          break;
        case "delete":
          response = await instance.delete(endpoint, requestConfig);
          break;
        default: {
          const error = new Error(`Unsupported HTTP method: ${method}`);
          return await this._responseErrorHandler(error);
        }
      }

      this.#responseSuccessHandler(response);
      return response;
    } catch (error) {
      return await this._responseErrorHandler(error);
    }
  }
}

module.exports = { BaseApi };