const companyService = require("./company.service");

async function getCompanies(req, res, next) {
  try {
    const result = await companyService.listCompanies(req.query, req.user);
    res.json({ success: true, ...result });
  } catch (error) {
    next(error);
  }
}

async function getCompany(req, res, next) {
  try {
    const company = await companyService.getCompanyOrThrow(req.params.id, req.user);
    res.json({ success: true, company });
  } catch (error) {
    next(error);
  }
}

async function createCompany(req, res, next) {
  try {
    const company = await companyService.createCompany(req.body, req.user, req);
    res.status(201).json({ success: true, company });
  } catch (error) {
    next(error);
  }
}

async function updateCompany(req, res, next) {
  try {
    const company = await companyService.updateCompany(req.params.id, req.body, req.user, req);
    res.json({ success: true, company });
  } catch (error) {
    next(error);
  }
}

async function deleteCompany(req, res, next) {
  try {
    const company = await companyService.archiveCompany(req.params.id, req.user, req);
    res.json({ success: true, message: "Company archived successfully", company });
  } catch (error) {
    next(error);
  }
}

async function updateStatus(req, res, next) {
  try {
    const company = await companyService.updateStatus(req.params.id, req.body.status, req.user, req);
    res.json({ success: true, company });
  } catch (error) {
    next(error);
  }
}

async function addNote(req, res, next) {
  try {
    const company = await companyService.addNote(req.params.id, req.body, req.user, req);
    res.json({ success: true, company });
  } catch (error) {
    next(error);
  }
}

async function getRelated(req, res, next) {
  try {
    const related = await companyService.getRelated(req.params.id, req.user);
    res.json({ success: true, ...related });
  } catch (error) {
    next(error);
  }
}

async function getDashboard(req, res, next) {
  try {
    const companyId = req.params.id || req.user.companyId;
    if (!companyId) return res.status(404).json({ success: false, message: "Company not found" });
    const dashboard = await companyService.getDashboard(companyId, req.user);
    res.json({ success: true, ...dashboard, totalCases: dashboard.stats.cases, urgentCases: dashboard.companyCasesList });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  addNote,
  createCompany,
  deleteCompany,
  getCompany,
  getCompanies,
  getDashboard,
  getRelated,
  updateCompany,
  updateStatus,
};
