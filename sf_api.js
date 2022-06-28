const axios = require('axios')
require("dotenv").config();

const missingVariables =  ['SF_ACCESS_TOKEN', 'SF_FIRM_ID'].filter((key) => !process.env[key])

if (missingVariables.length && process.argv[2] !== "help") {
  throw `Missing configuration variables: ${missingVariables}, call export ${missingVariables[0]}=... before`
}

axios.defaults.baseURL = `${process.env.SF_HOST || 'https://live.getsilverfin.com'}/api/v4/f/${process.env.SF_FIRM_ID}`
axios.defaults.headers.common['Authorization'] = `Bearer ${process.env.SF_ACCESS_TOKEN}`

const fetchReconciliationTexts = function(page = 1) {
  return axios.get(`reconciliations`, { params: { page: page, per_page: 200 } })
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
  return axios.post(`reconciliations/${id}`, attributes)
}


const fetchSharedParts = function(page = 1) {
  return axios.get(`shared_parts`, { params: { page: page, per_page: 200 }})
}

const fetchSharedPartById = function(id) {
  return axios.get(`shared_parts/${id}`)
}

const findSharedPart = async function (name, page = 1) {
  return fetchSharedParts(page).then((response) => {
    sharedParts = response.data
    if (sharedParts.lenght == 0) {
      return;
    }

    sharedPart = sharedParts.find((element) => element['name'] === name)
    if (sharedPart) {
      return sharedPart;
    } else {
      return findSharedPart(name, page + 1);
    }
  })
}

const createTestRun = function(attributes) {
  return axios.post('reconciliations/test', attributes)
}

const fetchTestRun = function(id) {
  return axios.get(`reconciliations/test_runs/${id}`)
 }

module.exports = { fetchReconciliationTexts, updateReconciliationText, findReconciliationText, fetchSharedParts, fetchSharedPartById, findSharedPart, fetchTestRun, createTestRun }
