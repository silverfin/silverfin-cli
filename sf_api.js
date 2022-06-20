const axios = require('axios')
require("dotenv").config();

axiosConfig = function() {
  return {
    baseURL: `https://live.getsilverfin.com/api/v4/f/${process.env.SF_FIRM_ID}`,
    headers: { Authorization: `Bearer ${process.env.SF_ACCESS_TOKEN}` }
  }
}

const fetchReconciliationTexts = function(page = 1) {
  return axios.get(`reconciliations`, { params: { page: page, per_page: 200 }, ...axiosConfig() })
}

const findReconciliationText = async function (handle, page = 1) {
  return fetchReconciliationTexts(page).then((response) => {
    reconciliations = response.data
    if (reconciliations.length == 0) {
      return;
    }

    reconciliationText = reconciliations.find((element) => element['handle'] === handle)
    if (reconciliationText) {
      return reconciliationText;
    } else {
      return findReconciliationText(handle, page + 1);
    }
  })
}

const updateReconciliationText = function(id, attributes) {
  return axios.post(`reconciliations/${id}`, attributes, axiosConfig())
}

const createTestRun = function(attributes) {
  return axios.post('reconciliations/test', attributes, axiosConfig())
}

const fetchTestRun = function(id) {
  return axios.get(`reconciliations/test_runs/${id}`, axiosConfig())
 }

module.exports = { fetchReconciliationTexts, updateReconciliationText, findReconciliationText, fetchTestRun, createTestRun }
