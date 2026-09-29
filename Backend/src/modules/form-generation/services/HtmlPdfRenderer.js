// Shared Puppeteer-backed HTML->PDF renderer. Both CoverLetterService (cover/
// support letters) and ExhibitService (exhibit dividers) need real CSS-driven
// PDF pages — pdf-lib alone can only draw plain text/shapes, not render HTML.
// One headless Chromium instance is launched lazily and reused across calls
// (a fresh launch per render is what makes naive Puppeteer usage slow), and
// closed via closeBrowser() on process shutdown so nodemon restarts don't
// leak a detached Chromium process.
let browserPromise = null;

async function getBrowser() {
  if (!browserPromise) {
    const puppeteer = require("puppeteer");
    browserPromise = puppeteer.launch({ headless: "new", args: ["--no-sandbox", "--disable-setuid-sandbox"] });
  }
  return browserPromise;
}

class HtmlPdfRenderer {
  // headerTemplate/footerTemplate are Puppeteer's page.pdf() HTML templates —
  // rendered outside the page's own body flow, once per printed page, which
  // is what makes a letterhead/footer repeat correctly across a multi-page
  // letter (CSS alone can't do this for print; Puppeteer's header/footer
  // slots are the actual mechanism Chromium's print pipeline exposes for it).
  static async render(html, { headerTemplate = "", footerTemplate = "", margin } = {}) {
    const browser = await getBrowser();
    const page = await browser.newPage();
    try {
      await page.setContent(html, { waitUntil: "networkidle0" });
      const displayHeaderFooter = Boolean(headerTemplate || footerTemplate);
      const buffer = await page.pdf({
        format: "Letter",
        printBackground: true,
        displayHeaderFooter,
        headerTemplate: headerTemplate || "<span></span>",
        footerTemplate: footerTemplate || "<span></span>",
        margin: margin || {
          top: displayHeaderFooter ? "110px" : "60px",
          bottom: displayHeaderFooter ? "70px" : "60px",
          left: "60px",
          right: "60px",
        },
      });
      return Buffer.from(buffer);
    } finally {
      await page.close();
    }
  }

  static async closeBrowser() {
    if (!browserPromise) return;
    const browser = await browserPromise;
    browserPromise = null;
    await browser.close().catch(() => null);
  }
}

process.on("exit", () => {
  // Best-effort only — an async close can't be awaited from a sync "exit"
  // handler; this just prevents a hard crash if it's called at shutdown.
  if (browserPromise) browserPromise.then((browser) => browser.close()).catch(() => null);
});

module.exports = HtmlPdfRenderer;
