// Live updates for an open USCIS form (socket only). When a team member changes a form (a saved field, a section, a review decision, a lock, a reset ...), every other
// team member who currently has that form OPEN gets a small "this form changed" event and refreshes the form in the background.
//
// Safety design - this must never affect saving, autofill, editing or download:
//   - it is a response-finished hook: the event is emitted AFTER the HTTP response was sent, only for a successful (2xx) change, so it cannot delay or fail a save;
//   - everything is wrapped in try / catch and logs nothing that could throw; with no socket server (tests, scripts, a worker process) it does nothing;
//   - the event carries NO form data (only ids, the actor's name and what kind of change): the other screen re-reads the form through the normal, access-checked API;
//   - only sockets that joined the form's room receive it, and joining re-checks case access, the forms:read permission and that the form belongs to the case.
const mongoose = require("mongoose");

const EVENT = "caseForm:updated";
const roomOf = (caseFormId) => `caseForm:${caseFormId}`;
const isId = (value) => mongoose.Types.ObjectId.isValid(String(value || ""));

/**
 * May this socket user watch this case form? Pure apart from the injected loaders. Resolves { ok: true } or { ok: false, code }.
 * Same rules as opening the form: forms:read permission, case access, and the form must belong to the case.
 */
async function authorizeJoin({ user, caseId, caseFormId }, deps = {}) {
  const { Case = require("../../models/Case"), CaseForm = require("../../models/CaseForm"), caseService = require("../cases/case.service"), hasPermission = require("../authorization/rbac.service").hasPermission } = deps;
  if (!user || !isId(caseId) || !isId(caseFormId)) return { ok: false, code: "INVALID_REQUEST" };
  if (!hasPermission(user, "forms:read")) return { ok: false, code: "FORM_ACCESS_DENIED" };
  const caseData = await Case.findById(caseId).lean();
  if (!caseData || !caseService.canAccessCase(user, caseData)) return { ok: false, code: "FORM_ACCESS_DENIED" };
  const form = await CaseForm.findOne({ _id: caseFormId, caseId }).select("_id").lean();
  if (!form) return { ok: false, code: "FORM_NOT_FOUND" };
  return { ok: true };
}

const actorNameOf = (user) => [user?.firstName, user?.lastName].filter(Boolean).join(" ").trim() || user?.name || user?.email || "A team member";

/** The kind of change, from the route: .../workspace/field -> "field", .../workspace/decision -> "decision", .../autosave -> "autosave". */
function kindOf(path = "") {
  const parts = String(path).split("?")[0].split("/").filter(Boolean);
  return parts.slice(-1)[0] || "change";
}

/** Builds the event for a finished request (pure). */
function buildEvent(req) {
  return {
    caseId: String(req.params.caseId),
    caseFormId: String(req.params.formId),
    actorId: req.user?._id ? String(req.user._id) : null,
    actorName: actorNameOf(req.user),
    kind: kindOf(req.originalUrl || req.path),
    fieldName: typeof req.body?.fieldName === "string" ? req.body.fieldName.slice(0, 200) : undefined,
    at: new Date().toISOString(),
  };
}

/**
 * Express middleware for `/case/:caseId/:formId/*`: after a successful change (anything but GET / HEAD / OPTIONS) broadcast the event to the form's room.
 * `emit` is injectable for tests; by default it uses the realtime gateway.
 */
function broadcastCaseFormChanges({ emit } = {}) {
  return (req, res, next) => {
    if (["GET", "HEAD", "OPTIONS"].includes(req.method) || !isId(req.params?.formId)) return next();
    res.once("finish", () => {
      try {
        if (res.statusCode < 200 || res.statusCode >= 300) return;
        const send = emit || require("../realtime/realtime.gateway").emitToCaseForm;
        send(req.params.formId, EVENT, buildEvent(req));
      } catch {
        // a live-update failure must never matter to the save that already succeeded
      }
    });
    return next();
  };
}

module.exports = { EVENT, roomOf, authorizeJoin, buildEvent, kindOf, actorNameOf, broadcastCaseFormChanges };
