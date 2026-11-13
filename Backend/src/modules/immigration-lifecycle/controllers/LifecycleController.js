const Case = require("../../../models/Case");
const caseService = require("../../cases/case.service");
const ApprovalService = require("../services/ApprovalService");
const CaseStatusService = require("../services/CaseStatusService");
const DeadlineService = require("../services/DeadlineService");
const FilingService = require("../services/FilingService");
const ImmigrationTimelineService = require("../services/ImmigrationTimelineService");
const LifecycleDashboardService = require("../services/LifecycleDashboardService");
const RFEService = require("../services/RFEService");
const SubmissionTrackingService = require("../services/SubmissionTrackingService");
const TrackingService = require("../services/TrackingService");

function respond(res, status, payload) {
  return res.status(status).json({ success: status < 400, ...payload });
}

function handle(res, error) {
  return respond(res, error.status || error.statusCode || 500, { message: error.message || "Lifecycle request failed" });
}

async function loadCase(caseId, user) {
  const caseData = await Case.findById(caseId).populate("beneficiary");
  if (!caseData) throw Object.assign(new Error("Case not found"), { status: 404 });
  if (!caseService.canAccessCase(user, caseData)) throw Object.assign(new Error("Access denied"), { status: 403 });
  return caseData;
}

exports.file = async (req, res) => {
  try {
    respond(res, 201, { filing: await FilingService.file(await loadCase(req.params.caseId, req.user), req.body || {}, req.user, req) });
  } catch (error) {
    handle(res, error);
  }
};

exports.receipt = async (req, res) => {
  try {
    respond(res, 201, { receipt: await SubmissionTrackingService.recordReceipt(await loadCase(req.params.caseId, req.user), req.body || {}, req.user, req) });
  } catch (error) {
    handle(res, error);
  }
};

exports.rfe = async (req, res) => {
  try {
    respond(res, 201, { rfe: await RFEService.create(await loadCase(req.params.caseId, req.user), req.body || {}, req.user, req) });
  } catch (error) {
    handle(res, error);
  }
};

exports.approval = async (req, res) => {
  try {
    respond(res, 201, { approval: await ApprovalService.approve(await loadCase(req.params.caseId, req.user), req.body || {}, req.user, req) });
  } catch (error) {
    handle(res, error);
  }
};

exports.denial = async (req, res) => {
  try {
    respond(res, 201, { denial: await ApprovalService.deny(await loadCase(req.params.caseId, req.user), req.body || {}, req.user, req) });
  } catch (error) {
    handle(res, error);
  }
};

exports.status = async (req, res) => {
  try {
    const caseData = await loadCase(req.params.caseId, req.user);
    if (req.method === "POST") {
      const event = await CaseStatusService.updateStatus(caseData, req.body || {}, req.user, req);
      return respond(res, 201, { status: event });
    }
    return respond(res, 200, { status: caseData.receiptTracking, lifecycleStatus: caseData.immigrationLifecycle?.filingStatus, history: caseData.immigrationLifecycle?.governmentStatusHistory || [] });
  } catch (error) {
    handle(res, error);
  }
};

exports.timeline = async (req, res) => {
  try {
    respond(res, 200, { timeline: ImmigrationTimelineService.list(await loadCase(req.params.caseId, req.user)) });
  } catch (error) {
    handle(res, error);
  }
};

exports.deadlines = async (req, res) => {
  try {
    const caseData = await loadCase(req.params.caseId, req.user);
    DeadlineService.generateFromCase(caseData, req.user);
    caseData.immigrationLifecycle.futureRecommendations = DeadlineService.futureRecommendations(caseData);
    await caseData.save();
    respond(res, 200, { deadlines: caseData.immigrationLifecycle?.deadlines || [], upcoming: DeadlineService.upcoming(caseData), futureRecommendations: caseData.immigrationLifecycle.futureRecommendations });
  } catch (error) {
    handle(res, error);
  }
};

exports.dashboard = async (req, res) => {
  try {
    respond(res, 200, { dashboard: await LifecycleDashboardService.dashboard(req.user, req.query) });
  } catch (error) {
    handle(res, error);
  }
};

// PUT /cases/:caseId/tracking/fedex { trackingNumber } - the FedEx number of the filed petition (asked when the case moves to Submitted (FedEx)); sets only the carrier and the number.
exports.fedexTracking = async (req, res) => {
  try {
    const caseData = await loadCase(req.params.caseId, req.user);
    const filing = await TrackingService.setFedexNumber(caseData, req.body?.trackingNumber, req.user, req, req.body?.amount);
    return respond(res, 200, { filing });
  } catch (error) {
    handle(res, error);
  }
};

// PUT /cases/:caseId/tracking/receipt { receiptNumber } - the USCIS receipt number of a case submitted online (asked when the case moves to Submitted and the team says "online"); quiet like the FedEx one.
exports.receiptTracking = async (req, res) => {
  try {
    const caseData = await loadCase(req.params.caseId, req.user);
    const filing = await TrackingService.setReceiptNumber(caseData, req.body?.receiptNumber, req.user, req);
    return respond(res, 200, { filing });
  } catch (error) {
    handle(res, error);
  }
};

exports.tracking = async (req, res) => {
  try {
    const caseData = await loadCase(req.params.caseId, req.user);
    if (req.method === "PUT") {
      return respond(res, 200, { tracking: await TrackingService.save(caseData, req.body || {}, req.user, req) });
    }
    const result = await TrackingService.get(caseData);
    // the FedEx amount is internal: only the internal team's roles are sent it
    if (TrackingService.canSeeFedexAmount(req.user)) result.fedexAmount = await TrackingService.getFedexAmount(caseData._id);
    return respond(res, 200, result);
  } catch (error) {
    handle(res, error);
  }
};
