const PDFGenerationService = require("../services/PDFGenerationService");

async function processCaseFormPdfJob(job) {
  const { caseFormId, user, options } = job.data || job;
  return PDFGenerationService.generate(caseFormId, user, job.req, options || {});
}

module.exports = { processCaseFormPdfJob };
