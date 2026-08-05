const USCISScannerService = require("../modules/uscis-lifecycle/services/USCISScannerService");

module.exports = {
  scanAllForms: (options, user, req) => USCISScannerService.scanAll(options, user, req),
  scanSingleForm: (formConfig, user, req) => USCISScannerService.scanForm(formConfig, user, req),
};
