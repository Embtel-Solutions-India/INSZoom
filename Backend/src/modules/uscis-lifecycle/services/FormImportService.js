const crypto = require("crypto");
const USCISFormImporterService = require("../../uscis-form-import/services/USCISFormImporterService");

class FormImportService {
  static checksum(buffer) {
    return crypto.createHash("sha256").update(buffer).digest("hex");
  }

  static async download(url, artifactType = "form") {
    const result = await USCISFormImporterService.downloadOfficialPdf(url, artifactType);
    return result.buffer;
  }

  static async extractPdfFields(buffer) {
    return USCISFormImporterService.scanner.scan(buffer);
  }

  static async importOfficialForm(payload = {}, user, req) {
    const input = {
      ...payload,
      formType: payload.formType || payload.formCode || payload.formNumber,
      pdfUrl: payload.pdfUrl || payload.officialPdfUrl,
      instructionsPdfUrl: payload.instructionsPdfUrl,
      sourcePageUrl: payload.pageUrl || payload.sourcePageUrl,
      pageUrl: payload.pageUrl || payload.sourcePageUrl,
      source: payload.source || "uscis_sync",
      provider: "uscis",
      status: payload.status || "review",
    };
    const result = payload.pdfBuffer
      ? await USCISFormImporterService.importFromBuffer(payload.pdfBuffer, input, user, req)
      : await USCISFormImporterService.importFromUrl(input, user, req);
    return result.template;
  }
}

module.exports = FormImportService;
