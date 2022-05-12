const axios = require("axios");
require("dotenv").config();

axiosConfig = function () {
  return {
    baseURL: `https://live.getsilverfin.com/api/v4/f/${process.env.SF_FIRM_ID}`,
    headers: { Authorization: `Bearer ${process.env.SF_ACCESS_TOKEN}` },
  };
};

fetchReconciliationTexts = function (page = 1) {
  return axios.get(`reconciliations`, {
    params: { page: page, per_page: 200 },
    ...axiosConfig(),
  });
};

findReconciliationText = async function (handle, page = 1) {
  return fetchReconciliationTexts(page).then((response) => {
    reconciliations = response.data;
    if (reconciliations.length == 0) {
      return;
    }

    reconciliationText = reconciliations.find(
      (element) => element["handle"] === handle
    );
    if (reconciliationText) {
      return reconciliationText;
    } else {
      return findReconciliationText(handle, page + 1);
    }
  });
};

updateReconciliationText = function (id, attributes) {
  return axios.post(`reconciliations/${id}`, attributes, axiosConfig());
};

module.exports = {
  fetchReconciliationTexts,
  updateReconciliationText,
  findReconciliationText,
};
