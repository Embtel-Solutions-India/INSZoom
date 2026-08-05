const beneficiaryService = require("./beneficiary.service");

async function getBeneficiaries(req, res, next) {
  try {
    const result = await beneficiaryService.listBeneficiaries(req.query, req.user);
    res.json({ success: true, ...result });
  } catch (error) {
    next(error);
  }
}

async function getBeneficiary(req, res, next) {
  try {
    const beneficiary = await beneficiaryService.getAccessibleBeneficiaryOrThrow(req.params.id, req.user);
    res.json({ success: true, beneficiary });
  } catch (error) {
    next(error);
  }
}

async function createBeneficiary(req, res, next) {
  try {
    const beneficiary = await beneficiaryService.createBeneficiary(req.body, req.user, req);
    res.status(201).json({ success: true, beneficiary });
  } catch (error) {
    next(error);
  }
}

async function updateBeneficiary(req, res, next) {
  try {
    const beneficiary = await beneficiaryService.updateBeneficiary(req.params.id, req.body, req.user, req);
    res.json({ success: true, beneficiary });
  } catch (error) {
    next(error);
  }
}

async function updateStatus(req, res, next) {
  try {
    const beneficiary = await beneficiaryService.updateBeneficiary(req.params.id, { status: req.body.status }, req.user, req);
    res.json({ success: true, beneficiary });
  } catch (error) {
    next(error);
  }
}

async function deleteBeneficiary(req, res, next) {
  try {
    const beneficiary = await beneficiaryService.updateBeneficiary(req.params.id, { status: "archived" }, req.user, req);
    res.json({ success: true, message: "Beneficiary archived successfully", beneficiary });
  } catch (error) {
    next(error);
  }
}

async function getMyBeneficiary(req, res, next) {
  try {
    const beneficiary = await beneficiaryService.getMyBeneficiary(req.user, req);
    res.json({ success: true, beneficiary });
  } catch (error) {
    next(error);
  }
}

async function saveMyBeneficiary(req, res, next) {
  try {
    const beneficiary = await beneficiaryService.getMyBeneficiary(req.user, req);
    const updated = await beneficiaryService.updateBeneficiary(beneficiary._id, req.body, req.user, req);
    res.json({ success: true, beneficiary: updated });
  } catch (error) {
    next(error);
  }
}

async function getDashboard(req, res, next) {
  try {
    const dashboard = await beneficiaryService.getDashboard(req.user, req);
    res.json({ success: true, ...dashboard });
  } catch (error) {
    next(error);
  }
}

async function addNote(req, res, next) {
  try {
    const beneficiary = await beneficiaryService.addNote(req.params.id, req.body, req.user, req);
    res.json({ success: true, beneficiary });
  } catch (error) {
    next(error);
  }
}

async function getTimeline(req, res, next) {
  try {
    const beneficiary = await beneficiaryService.getAccessibleBeneficiaryOrThrow(req.params.id, req.user);
    res.json({ success: true, timeline: beneficiary.timeline, activityHistory: beneficiary.activityHistory, auditHistory: beneficiary.auditHistory });
  } catch (error) {
    next(error);
  }
}

async function getRelated(req, res, next) {
  try {
    const related = await beneficiaryService.getRelated(req.params.id, req.user);
    res.json({ success: true, ...related });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  addNote,
  createBeneficiary,
  deleteBeneficiary,
  getBeneficiary,
  getBeneficiaries,
  getDashboard,
  getMyBeneficiary,
  getRelated,
  getTimeline,
  saveMyBeneficiary,
  updateBeneficiary,
  updateStatus,
};
