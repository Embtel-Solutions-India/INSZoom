const dataRightsService = require("./dataRights.service");

function isStaff(user) {
  return ["super_admin", "admin"].includes(user?.role);
}

async function createRequest(req, res, next) {
  try {
    const { type, reason, subjectUserId: bodySubjectUserId } = req.body || {};

    // Self-only for non-staff: a client omitting subjectUserId (or passing
    // their own) requests against themselves; passing a DIFFERENT id must be
    // rejected outright, never silently coerced back to their own id — a
    // coercion here would hide the violation instead of reporting it.
    let subjectUserId = req.user._id;
    if (bodySubjectUserId) {
      if (isStaff(req.user)) {
        subjectUserId = bodySubjectUserId;
      } else if (String(bodySubjectUserId) !== String(req.user._id)) {
        return res.status(403).json({ success: false, message: "You may only request your own data" });
      }
    }

    const request = await dataRightsService.createRequest({
      subjectUserId,
      type,
      requestedBy: req.user._id,
      reason,
    });
    res.status(201).json({ success: true, data: request });
  } catch (error) {
    next(error);
  }
}

async function listRequests(req, res, next) {
  try {
    const data = await dataRightsService.listRequests(req.query);
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
}

async function approve(req, res, next) {
  try {
    const data = await dataRightsService.approve(req.params.id, req.user, req);
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
}

async function reject(req, res, next) {
  try {
    const data = await dataRightsService.reject(req.params.id, req.user, req.body?.reason, req);
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
}

async function downloadExport(req, res, next) {
  try {
    const buffer = await dataRightsService.getExportArtifact(req.params.id, req.user);
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Content-Disposition", `attachment; filename="data-export-${req.params.id}.json"`);
    res.send(buffer);
  } catch (error) {
    next(error);
  }
}

module.exports = { createRequest, listRequests, approve, reject, downloadExport };
