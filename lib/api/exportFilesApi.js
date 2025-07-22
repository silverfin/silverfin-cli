class ExportFilesApi {
  constructor(parentApi) {
    this.parentApi = parentApi;
  }

  async create(type, envId, attributes) {
    const response = await this.parentApi._makeRequest("post", type, envId, "export_files", attributes);
    return response.data;
  }

  async update(type, envId, exportFileId, attributes) {
    const response = await this.parentApi._makeRequest("post", type, envId, `export_files/${exportFileId}`, attributes);
    return response.data;
  }

  async read(type, envId, page = 1) {
    const response = await this.parentApi._makeRequest("get", type, envId, "export_files", null, { page, per_page: 200 });
    return response.data;
  }

  async readById(type, envId, exportFileId) {
    const response = await this.parentApi._makeRequest("get", type, envId, `export_files/${exportFileId}`);
    return response.data;
  }

  async findByName(type, envId, exportFileName, page = 1) {
    const exportFiles = await this.read(type, envId, page);

    if (exportFiles.length === 0) {
      return null;
    }

    const exportFile = exportFiles.find((element) => element.name_nl === exportFileName);
    if (exportFile) {
      return await this.readById(type, envId, exportFile.id);
    }

    return this.findByName(type, envId, exportFileName, page + 1);
  }

  async addSharedPart(type, envId, sharedPartId, exportFileId) {
    const response = await this.parentApi._makeRequest("post", type, envId, `export_files/${exportFileId}/shared_parts/${sharedPartId}`);
    return response.data;
  }

  async removeSharedPart(type, envId, sharedPartId, exportFileId) {
    const response = await this.parentApi._makeRequest("delete", type, envId, `export_files/${exportFileId}/shared_parts/${sharedPartId}`);
    return response.data;
  }
}

module.exports = { ExportFilesApi };