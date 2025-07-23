const { SilverfinAuthorizer } = require("./silverfinAuthorizer");

class AuthenticationApi {
  constructor(parentApi) {
    this.parentApi = parentApi;
  }

  async authorizeFirm(firmId) {
    SilverfinAuthorizer.authorizeFirm(firmId);
  }

  async refreshFirmTokens(firmId) {
    return SilverfinAuthorizer.refreshFirm(firmId);
  }

  async refreshPartnerToken(partnerId) {
    return SilverfinAuthorizer.refreshPartner(partnerId);
  }
}

module.exports = { AuthenticationApi };