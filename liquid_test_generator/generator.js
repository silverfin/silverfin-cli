const SF = require('../api/sf_api');
const {config} = require('../api/auth');
const Utils = require('./utils');

// MainProcess
async function testGenerator(url) {

	// Liquid Test Object
	const liquidTestObject = Utils.createBaseLiquidTest(testName);
	
	// Get parameters from URL provided
	const parameters = Utils.extractURL(url);

	// Check if firm is authhorized
	if (!config.data.hasOwnProperty(parameters.firmId)) {
		throw `You have no authorization to access firm id ${parameters.firmId}`;
	};
	firmId = parameters.firmId;
	
	// Reconciled Status (CLI argument. True by default)
	liquidTestObject[testName].expectation.reconciled = reconciledStatus;

	// Get Reconciliation Details
	const responseDetails = await SF.getReconciliationDetails(parameters.companyId, parameters.ledgerId, parameters.reconciliationId);
	const reconciliationHandle = responseDetails.data.handle;

	// Get Workflow Information
	const starredStatus = {...SF.findReconciliationInWorkflow(reconciliationHandle, parameters.companyId, parameters.ledgerId, parameters.workflowId)}.starred

	// Get period data
	const responsePeriods = await SF.getPeriods(parameters.companyId);
	const currentPeriodData = SF.findPeriod(parameters.ledgerId, responsePeriods.data);

	// Set Current Period
	liquidTestObject[testName].context.period = String(currentPeriodData.fiscal_year.end_date);
	liquidTestObject[testName].data.periods[currentPeriodData.fiscal_year.end_date] = liquidTestObject[testName].data.periods['replace_period_name'];
	delete liquidTestObject[testName].data.periods['replace_period_name'];

	// Check Previous Period
	const currentPeriodIndex = responsePeriods.data.indexOf(currentPeriodData);
	const periodsMaxIndex = responsePeriods.data.length-1;
	if (currentPeriodIndex < periodsMaxIndex ) {
		const previousPeriodData = responsePeriods.data[currentPeriodIndex+1];
		if (previousPeriodData && previousPeriodData.fiscal_year.end_date != currentPeriodData.fiscal_year.end_date) {
			// Add empty previous period to Liquid Test
			liquidTestObject[testName].data.periods[previousPeriodData.fiscal_year.end_date] = null;       
		};
	};

	// Get all the text properties (Customs from current template)
	const responseCustom = await SF.getReconciliationCustom(parameters.companyId, parameters.ledgerId, parameters.reconciliationId);
	const currentReconCustom = Utils.processCustom(responseCustom.data);
	liquidTestObject[testName].data.periods[currentPeriodData.fiscal_year.end_date].reconciliations[reconciliationHandle] = {
		starred: starredStatus, 
		custom: currentReconCustom
	};
	
	// Get all the results generated in current template
	const responseResults = await SF.getReconciliationResults(parameters.companyId, parameters.ledgerId, parameters.reconciliationId);
	liquidTestObject[testName].expectation.results = responseResults.data;

	// Get the code of the template
	const reconciliationCode = await SF.findReconciliationText(reconciliationHandle);

	// Search for results from other reconciliations used in the liquid code (main and text_parts)
	let resultsObj;
	resultsObj = Utils.searchForResultsFromDependenciesInLiquid(reconciliationCode, reconciliationHandle);

	// Search for custom drops from other reconcilations used in the liquid code (main and text_parts)
	let customsObj;
	customsObj = Utils.searchForCustomsFromDependenciesInLiquid(reconciliationCode, reconciliationHandle);

	// Search for shared parts in the liquid code (main and text_parts)
	const sharedPartsUsed = Utils.lookForSharedPartsInLiquid(reconciliationCode, reconciliationHandle);
	if (sharedPartsUsed && sharedPartsUsed.length != 0) {
		for (sharedPartName of sharedPartsUsed) {
			// Look for shared part id
			let sharedPartResponse = await SF.findSharedPart(sharedPartName);
			let sharedPartId = sharedPartResponse.id;
			// Get shared part details
			let sharedPartDetails = await SF.fetchSharedPartById(sharedPartId);
			// Look for nested shared parts (in that case, add them to this same loop)
			let nestedSharedParts = Utils.lookForSharedPartsInLiquid(sharedPartDetails.data);
			for (nested of nestedSharedParts){
				if (!sharedPartsUsed.includes(nested)){
					sharedPartsUsed.push(nested);
				};
			};
			// Search for results from other reconciliations in shared part (we append to existing collection)
			resultsObj = Utils.searchForResultsFromDependenciesInLiquid(sharedPartDetails.data, sharedPartDetails.data.name, resultsObj);

			// Search for custom drops from other reconcilations in shared parts (we append to existing collection)
			customsObj = Utils.searchForCustomsFromDependenciesInLiquid(sharedPartDetails.data, sharedPartDetails.data.name, customsObj);
		};
	};
	
	// Get results from dependencies reconciliations
	if (Object.keys(resultsObj).length !== 0) {
		// Search in each reconciliation
		for (const [handle, resultsArray] of Object.entries(resultsObj)) {
			try {
				// Find reconciliation in Workflow to get id (depdeency template can be in a different Workflow)
				let reconciliation = await SF.findReconciliationInWorkflows(handle, parameters.companyId, parameters.ledgerId);
				if (reconciliation) {
					// Fetch results
					let reconciliationResults = await SF.getReconciliationResults(parameters.companyId, parameters.ledgerId, reconciliation.id);
					// Add handle and results block to Liquid Test
					liquidTestObject[testName].data.periods[currentPeriodData.fiscal_year.end_date].reconciliations[handle] = liquidTestObject[testName].data.periods[currentPeriodData.fiscal_year.end_date].reconciliations[handle] || {};
					liquidTestObject[testName].data.periods[currentPeriodData.fiscal_year.end_date].reconciliations[handle].results = liquidTestObject[testName].data.periods[currentPeriodData.fiscal_year.end_date].reconciliations[handle].results || {};
					// Search for results
					for (resultTag of resultsArray) {
						// Add result to Liquid Test
						liquidTestObject[testName].data.periods[currentPeriodData.fiscal_year.end_date].reconciliations[handle].results[resultTag] = reconciliationResults.data[resultTag];
					};
				};
			} catch (err) {
				console.error(err);
			};
		};
	};

	// We already got the text properties from current reconciliation
	if (customsObj.hasOwnProperty(reconciliationHandle)) {
		delete customsObj[reconciliationHandle];
	};

	// Get custom drops from dependency reconciliations
	if (Object.keys(customsObj).length !== 0) {
		// Search in each reconciliation
		for (const [handle, customsArray] of Object.entries(customsObj)) {
      try {
        // Find reconciliation in Workflow to get id (depdeency template can be in a different Workflow)
        let reconciliation = await SF.findReconciliationInWorkflows(handle, parameters.companyId, parameters.ledgerId);
		if (reconciliation) {
			// Fetch test properties
			let reconciliationCustomResponse = await SF.getReconciliationCustom(parameters.companyId, parameters.ledgerId, reconciliation.id);
			let reconciliationCustomDrops = Utils.processCustom(reconciliationCustomResponse.data);
			// Filter Customs
			let dropsKeys = Object.keys(reconciliationCustomDrops);
			const matchingKeys = dropsKeys.filter((key)=> customsArray.indexOf(key) !== -1);
			const filteredCustomDrops = {};
			for (key of matchingKeys){
				filteredCustomDrops[key] = reconciliationCustomDrops[key];
			};
			// Add handle to Liquid Test
			liquidTestObject[testName].data.periods[currentPeriodData.fiscal_year.end_date].reconciliations[handle] = liquidTestObject[testName].data.periods[currentPeriodData.fiscal_year.end_date].reconciliations[handle] || {};
			// Add custom drops
			liquidTestObject[testName].data.periods[currentPeriodData.fiscal_year.end_date].reconciliations[handle].custom = filteredCustomDrops;
		};
      }
      catch (err) {
        console.log(err);
      }
		};
	};

	// Get company drop used in the liquid code (main and text_parts)
	const companyObj = Utils.getCompanyDependencies(reconciliationCode, reconciliationHandle);
	
	if (companyObj.standardDropElements.length !== 0 || companyObj.customDropElements.length !== 0) {
		liquidTestObject[testName].data.company = {};
	}

	// Get Company Data - company drop
	if (companyObj.standardDropElements.length !== 0) {
		const responseCompanyDrop = await SF.getCompanyDrop(parameters.companyId);
		const companyData = responseCompanyDrop.data;   // { foo: bar, baz: bat ... }
		
		for (drop of companyObj.standardDropElements) {
			const [a, key] = drop.split('.'); // company.foo
			if (key in companyData) {
				// Add to Liquid Test
				liquidTestObject[testName].data.company[key] = companyData[key] 
			};
		};
	};
	
	// Get Company Data - custom drop
	if (companyObj.customDropElements.length !== 0) {
		const responseCompanyCustom = await SF.getCompanyCustom(parameters.companyId);
		const companyCustom = responseCompanyCustom.data; // [ { namespace: foo, key: bar, value: baz }... ]
		liquidTestObject[testName].data.company.custom = {};

		for (drop of companyObj.customDropElements) {
			const [a, b, namespace, key] = drop.split('.'); // company.custom.namespace.key
			let foundItem = companyCustom.find((element, index)=>{
				if (element.namespace == namespace && element.key == key) {
					return true;
				}
			})
			if (foundItem) {
				let namespaceKey = `${namespace}.${key}`;
				// Add to Liquid Test
				liquidTestObject[testName].data.company.custom[namespaceKey] = foundItem.value;
			}
		}
	};

	// Search for account ids in customs
	const accountIds = Utils.lookForAccountsIDs(liquidTestObject);
	if (accountIds.length != 0) {
		liquidTestObject[testName].data.periods[currentPeriodData.fiscal_year.end_date].accounts = {};
		for (accountId of accountIds) {
			accountId = accountId.replace("#","");
			// Current Period
			try {
				let accountResponse = await SF.getAccountDetails(parameters.companyId, parameters.ledgerId, accountId);
				// If value is zero it won't be found ?
				if (accountResponse) {
					liquidTestObject[testName].data.periods[currentPeriodData.fiscal_year.end_date].accounts[accountResponse.data.account.number] = {
						id: accountResponse.data.account.id,
						name: accountResponse.data.account.name,
						value: Number(accountResponse.data.value)
					};
				};
			}
			catch (error) {
				console.log(error);
			// Previous Period
			// Should we include this ?
			};
		};
	};

	// Save YAML
	Utils.exportYAML(reconciliationHandle, liquidTestObject);
};

module.exports = {
  testGenerator
};
