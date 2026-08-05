const reportService = require("./report.service");

function sendData(res, data) {
  res.json({ success: true, data });
}

async function cases(req, res, next) {
  try {
    sendData(res, await reportService.getCaseReport(req.query));
  } catch (error) {
    next(error);
  }
}

async function financial(req, res, next) {
  try {
    sendData(res, await reportService.getFinancialReport(req.query));
  } catch (error) {
    next(error);
  }
}

async function users(req, res, next) {
  try {
    sendData(res, await reportService.getUserReport(req.query));
  } catch (error) {
    next(error);
  }
}

async function companies(req, res, next) {
  try {
    sendData(res, await reportService.getCompanyReport(req.query));
  } catch (error) {
    next(error);
  }
}

async function ocr(req, res, next) {
  try {
    sendData(res, await reportService.getOcrReport(req.query));
  } catch (error) {
    next(error);
  }
}

async function workflows(req, res, next) {
  try {
    sendData(res, await reportService.getWorkflowReport(req.query));
  } catch (error) {
    next(error);
  }
}

async function audit(req, res, next) {
  try {
    sendData(res, await reportService.getAuditReport(req.query));
  } catch (error) {
    next(error);
  }
}

async function run(req, res, next) {
  try {
    const result = await reportService.runReport(req.body.reportType || req.params.reportType, { ...req.query, ...(req.body.filters || {}) }, req);
    res.status(201).json({ success: true, data: result.data, execution: result.execution });
  } catch (error) {
    next(error);
  }
}

async function exportReport(req, res, next) {
  try {
    const format = req.query.format || "csv";
    const result = await reportService.runReport(req.params.reportType, { ...req.query, format }, req);
    if (format === "json") return res.json({ success: true, data: result.data, execution: result.execution });
    const rows = reportService.flattenReport(result.data);
    if (format === "xlsx") {
      res.setHeader("Content-Type", "application/vnd.ms-excel");
      res.setHeader("Content-Disposition", `attachment; filename=${req.params.reportType}-report.xls`);
      return res.send(reportService.toExcelHtml(rows, `${req.params.reportType} report`));
    }
    if (format === "pdf") {
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename=${req.params.reportType}-report.pdf`);
      return res.send(reportService.toSimplePdf(rows, `${req.params.reportType} report`));
    }
    const csv = reportService.toCsv(rows);
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename=${req.params.reportType}-report.csv`);
    return res.send(csv);
  } catch (error) {
    next(error);
  }
}

async function listExecutions(req, res, next) {
  try {
    const result = await reportService.listExecutions(req.query);
    res.json({ success: true, ...result });
  } catch (error) {
    next(error);
  }
}

async function listTemplates(req, res, next) {
  try {
    sendData(res, await reportService.listTemplates(req.query));
  } catch (error) {
    next(error);
  }
}

async function createTemplate(req, res, next) {
  try {
    const template = await reportService.createTemplate(req.body, req.user._id);
    res.status(201).json({ success: true, data: template });
  } catch (error) {
    next(error);
  }
}

async function updateTemplate(req, res, next) {
  try {
    const template = await reportService.updateTemplate(req.params.id, req.body, req.user._id);
    if (!template) return res.status(404).json({ success: false, message: "Report template not found" });
    res.json({ success: true, data: template });
  } catch (error) {
    next(error);
  }
}

async function listEod(req, res, next) {
  try {
    const result = await reportService.listEodReports(req.query, req.user);
    res.json({ success: true, ...result });
  } catch (error) {
    next(error);
  }
}

async function createEod(req, res, next) {
  try {
    const report = await reportService.createEodReport(req.body, req.user, req);
    res.status(201).json({ success: true, data: report });
  } catch (error) {
    next(error);
  }
}

async function updateEod(req, res, next) {
  try {
    const report = await reportService.updateEodReport(req.params.id, req.body, req);
    if (!report) return res.status(404).json({ success: false, message: "EOD report not found" });
    res.json({ success: true, data: report });
  } catch (error) {
    next(error);
  }
}

async function reviewEod(req, res, next) {
  try {
    const report = await reportService.reviewEodReport(req.params.id, req.body, req);
    if (!report) return res.status(404).json({ success: false, message: "EOD report not found" });
    res.json({ success: true, data: report });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  audit,
  cases,
  companies,
  createEod,
  createTemplate,
  exportReport,
  financial,
  listEod,
  listExecutions,
  listTemplates,
  ocr,
  reviewEod,
  run,
  updateEod,
  updateTemplate,
  users,
  workflows,
};
