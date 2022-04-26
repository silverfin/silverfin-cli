const axios = require('axios')

axiosConfig = function() {
  return {
    baseURL: `https://live.getsilverfin.com/api/v4/f/${process.env.SF_FIRM_ID}`,
    headers: { Authorization: `Bearer ${process.env.SF_ACCESS_TOKEN}` }
  }
}

fetchReconciliationTexts = function() {
  return axios.get(`reconciliations`, axiosConfig())
}

updateReconciliationText = function(id, attributes) {
  return axios.post(`reconciliations`, attributes, axiosConfig())
}

module.exports = { fetchReconciliationTexts, updateReconciliationText }
