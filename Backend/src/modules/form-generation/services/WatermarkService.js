class WatermarkService {
  static normalize(text) {
    if (!text) return "";
    return String(text).trim().toUpperCase();
  }

  static async apply(buffer, watermark) {
    const label = this.normalize(watermark);
    if (!label) return buffer;
    let pdfLib;
    try {
      pdfLib = require("pdf-lib");
    } catch (error) {
      const missing = new Error("pdf-lib dependency is required to watermark generated PDFs");
      missing.status = 501;
      throw missing;
    }
    const { PDFDocument, StandardFonts, rgb, degrees } = pdfLib;
    const pdf = await PDFDocument.load(buffer);
    const font = await pdf.embedFont(StandardFonts.HelveticaBold);
    pdf.getPages().forEach((page) => {
      const { width, height } = page.getSize();
      page.drawText(label, {
        x: width * 0.18,
        y: height * 0.45,
        size: 52,
        font,
        color: rgb(0.8, 0.8, 0.8),
        opacity: 0.25,
        rotate: degrees(35),
      });
    });
    return Buffer.from(await pdf.save());
  }
}

module.exports = WatermarkService;
