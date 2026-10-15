// Release 0b-1 (plan Rule D): the evidence-resolution workflow. NOT wired into any activation / promotion / migration path.
//
//   submitEvidence  - an admin / team lead submits a CLAIM (official uscis.gov url, edition, dates, verbatim quote). The SYSTEM fetches the url with
//                     the redirect-safe fetcher, stores an immutable snapshot, and verifies the claim. No decision is written here.
//   recordDecision  - the reviewer EXPLICITLY CONFIRMS a decision (accepted / not accepted / held) for the named edition next to the quote and the
//                     verification results. Only then is the one decision row written and the gate re-run.
//
// Hard rules enforced here (and again at the route and in the Admin screen): exactly the roles admin and team_lead (never super_admin); an
// "accepted" decision needs verified evidence AND a decider different from the submitter (four-eyes); a quote the system did not find in its own
// snapshot can never set accepted; an explicitly not_accepted edition can never be marked accepted by these roles; no decision without the
// explicit confirmation; every step is an immutable audit event (+ a best-effort copy in AuditLog).

const crypto = require("crypto");
const { fetchOfficialSource } = require("./OfficialSourceFetcher");
const { htmlToText, collapseWhitespace } = require("./htmlText");
const { verifyEvidence } = require("./EvidenceVerifier");
const gate = require("./EditionPolicyGate");
const C = require("./editionPolicy.constants");

const isoDay = (value) => {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
};
const sha256 = (data) => crypto.createHash("sha256").update(data).digest("hex");
const idOf = (value) => (value === undefined || value === null ? "" : String(value._id || value));

function httpError(status, message, code, details) {
  const error = new Error(message);
  error.status = status;
  if (code) error.code = code;
  if (details) error.details = details;
  return error;
}

function assertRole(user) {
  // exact match, re-checked here even though the route already guards it: super_admin and every other role are refused
  if (!user || !C.EVIDENCE_ROLES.includes(user.role)) throw httpError(403, "Only an admin or team lead can submit or confirm edition evidence", "ROLE_NOT_ALLOWED");
}

// serializes work per key inside this process (no unique index exists until the index script is run; see FormEditionDecision)
const chains = new Map();
function withLock(key, task) {
  const previous = chains.get(key) || Promise.resolve();
  const run = previous.then(task);
  const tail = run.catch(() => null);
  chains.set(key, tail);
  tail.then(() => { if (chains.get(key) === tail) chains.delete(key); });
  return run;
}

function validateSubmission(input = {}) {
  const formCode = String(input.formCode || "").trim();
  const editionIdentifier = String(input.editionIdentifier || "").trim();
  const sourceUrl = String(input.sourceUrl || "").trim();
  const quote = collapseWhitespace(input.quote);
  const problems = [];
  if (!formCode) problems.push("formCode is required");
  if (!C.EDITION_IDENTIFIER_PATTERN.test(editionIdentifier) || Number.isNaN(Date.parse(editionIdentifier))) problems.push("editionIdentifier must be the edition date as YYYY-MM-DD");
  if (!sourceUrl) problems.push("sourceUrl is required");
  if (quote.length < C.LIMITS.quoteMin) problems.push(`the verbatim quote must be at least ${C.LIMITS.quoteMin} characters (the exact sentence(s) from the official source)`);
  if (quote.length > C.LIMITS.quoteMax) problems.push(`the verbatim quote must be at most ${C.LIMITS.quoteMax} characters`);
  const claimedDates = {};
  for (const name of ["effectiveDate", "rejectionDate", "graceUntil"]) {
    const value = input[name] ? String(input[name]).trim() : "";
    if (!value) { claimedDates[name] = null; continue; }
    if (!C.EDITION_IDENTIFIER_PATTERN.test(value) || Number.isNaN(Date.parse(value))) problems.push(`${name} must be a date as YYYY-MM-DD`);
    claimedDates[name] = value;
  }
  if (problems.length) throw httpError(400, problems.join("; "), "INVALID_EVIDENCE", { problems });
  return { formCode, editionIdentifier, sourceUrl, quote, claimedDates };
}

/**
 * Builds the service. Everything with a side effect is injected so tests run with no database and no network:
 *   store (see EditionPolicyStore), fetchHtml / fetchPdf (the official-source fetcher), now(), newId(), auditSink(event) (secondary AuditLog copy)
 */
function createEvidenceService({ store, fetchHtml, fetchPdf, now = () => new Date(), newId = () => crypto.randomUUID(), auditSink = null } = {}) {
  if (!store) throw new Error("createEvidenceService needs a store");
  const html = fetchHtml || ((url) => fetchOfficialSource(url, { accept: "html" }));
  const pdf = fetchPdf || ((url) => fetchOfficialSource(url, { accept: "pdf" }));

  const gateFor = (formCode, editionIdentifier) => gate.check(formCode, editionIdentifier, { store, now: now() });

  async function writeEvent(caseState, type, payload, actor) {
    caseState.seq += 1;
    const event = await store.insertEvent({
      evidenceCaseId: caseState.id, seq: caseState.seq, type, formCode: caseState.formCode, editionIdentifier: caseState.editionIdentifier,
      actor: { userId: actor.userId, role: actor.role, label: actor.label }, payload, at: now(),
    });
    if (auditSink) { try { await auditSink(event); } catch { /* the secondary copy is best-effort; the permanent record above already exists */ } }
    return event;
  }

  /** The template of this exact edition, preferring the live one. */
  async function findTemplate(formCode, editionIdentifier) {
    const matches = (await store.findTemplates(formCode)).filter((template) => isoDay(template.editionDate) === editionIdentifier);
    const rank = { active: 0, review: 1, draft: 2, pending_review: 3, retired: 4, archived: 5 };
    return matches.sort((a, b) => (rank[a.status] ?? 9) - (rank[b.status] ?? 9))[0] || null;
  }

  async function submitEvidence(user, input) {
    assertRole(user);
    const submission = validateSubmission(input);
    const actor = { userId: user._id, role: user.role };
    const caseState = { id: newId(), seq: 0, formCode: submission.formCode, editionIdentifier: submission.editionIdentifier };

    await writeEvent(caseState, "EVIDENCE_SUBMITTED", { sourceUrl: submission.sourceUrl, claimedEdition: submission.editionIdentifier, claimedDates: submission.claimedDates, quote: submission.quote }, actor);

    // the SYSTEM fetches the claim's source through the redirect-safe fetcher
    const fetched = await html(submission.sourceUrl);
    let snapshot = null;
    let snapshotRow = null;
    if (fetched.ok) {
      const text = htmlToText(fetched.bytes.toString("utf8")).slice(0, C.LIMITS.snapshotTextMax);
      if (text) {
        snapshotRow = await store.insertSnapshot({
          sourceUrl: submission.sourceUrl, finalUrl: fetched.finalUrl, redirectChain: fetched.chain, httpStatus: fetched.status, contentType: fetched.contentType,
          fetchedAt: now(), snapshotHash: sha256(text), extractedText: text, textLength: text.length,
          fetchedBy: { userId: user._id, role: user.role }, evidenceCaseId: caseState.id,
        });
        snapshot = { finalUrl: fetched.finalUrl, redirectChain: fetched.chain, fetchedAt: snapshotRow.fetchedAt, extractedText: text, snapshotHash: snapshotRow.snapshotHash, id: idOf(snapshotRow) };
      }
    }
    await writeEvent(caseState, "SOURCE_FETCHED", {
      ok: Boolean(snapshot), finalUrl: fetched.finalUrl, redirectChain: fetched.chain, httpStatus: fetched.status, contentType: fetched.contentType,
      snapshotId: snapshot ? snapshot.id : null, snapshotHash: snapshot ? snapshot.snapshotHash : null, fetchedAt: snapshot ? snapshot.fetchedAt : null,
      violations: fetched.violations || [], error: fetched.error || (fetched.ok && !snapshot ? "the page has no readable text" : null),
    }, { userId: null, role: "system", label: "system:official_source_fetch" });

    // artifacts held by the system: the template of this exact edition and the checksum of the official PDF
    const template = await findTemplate(submission.formCode, submission.editionIdentifier);
    let artifact = null;
    if (template) {
      // The checksum of the RAW file as downloaded from USCIS (importMetadata.checksum, same as lifecycle.sourceChecksum). NOT artifacts.form.checksum:
      // that one is the sha256 of the qpdf-normalized copy the app stores, which can never equal the official download.
      const stored = template.importMetadata?.checksum || template.lifecycle?.sourceChecksum || null;
      let fetchedChecksum = null;
      if (stored && template.officialPdfUrl) {
        const downloaded = await pdf(template.officialPdfUrl);
        if (downloaded.ok && downloaded.bytes) fetchedChecksum = sha256(downloaded.bytes);
      }
      artifact = {
        template: true, editionDate: isoDay(template.editionDate), editionDateSource: template.importMetadata?.editionDateSource || null,
        publishedEditionDate: isoDay(template.importMetadata?.publishedEditionDate), pdfChecksumStored: stored, pdfChecksumFetched: fetchedChecksum,
      };
    }

    const verification = verifyEvidence({ submission, snapshot, artifact, now: now() });
    await writeEvent(caseState, "VERIFICATION_COMPLETED", { overall: verification.overall, checks: verification.checks, failed: verification.failed, snapshotHash: snapshot ? snapshot.snapshotHash : null }, { userId: null, role: "system", label: "system:verification" });

    return {
      evidenceCaseId: caseState.id, formCode: submission.formCode, editionIdentifier: submission.editionIdentifier, verification,
      snapshot: snapshot ? { id: snapshot.id, hash: snapshot.snapshotHash, finalUrl: snapshot.finalUrl, fetchedAt: snapshot.fetchedAt, textLength: snapshot.extractedText.length } : null,
      gate: await gateFor(submission.formCode, submission.editionIdentifier),
    };
  }

  /** Rebuilds an evidence case from its immutable events. */
  async function loadCase(evidenceCaseId) {
    const events = await store.listEvents(String(evidenceCaseId || ""));
    if (!events.length) throw httpError(404, "Evidence case not found", "EVIDENCE_NOT_FOUND");
    const byType = (type) => events.find((event) => event.type === type);
    const submitted = byType("EVIDENCE_SUBMITTED");
    if (!submitted) throw httpError(404, "Evidence case not found", "EVIDENCE_NOT_FOUND");
    const fetched = byType("SOURCE_FETCHED");
    const verification = byType("VERIFICATION_COMPLETED");
    return {
      events, submitted, fetched, verification, decided: byType("DECISION_RECORDED"),
      formCode: submitted.formCode, editionIdentifier: submitted.editionIdentifier, seq: events[events.length - 1].seq,
    };
  }

  async function getCase(user, evidenceCaseId) {
    assertRole(user);
    const found = await loadCase(evidenceCaseId);
    const snapshotId = found.fetched?.payload?.snapshotId;
    const snapshot = snapshotId ? await store.findSnapshot(snapshotId) : null;
    return {
      evidenceCaseId: String(evidenceCaseId), formCode: found.formCode, editionIdentifier: found.editionIdentifier,
      submittedBy: found.submitted.actor, claim: found.submitted.payload, verification: found.verification?.payload || null,
      snapshot: snapshot ? { id: idOf(snapshot), hash: snapshot.snapshotHash, finalUrl: snapshot.finalUrl, fetchedAt: snapshot.fetchedAt, textLength: snapshot.textLength, redirectChain: snapshot.redirectChain } : null,
      decisionRecorded: Boolean(found.decided), decision: found.decided?.payload || null,
      events: found.events.map((event) => ({ seq: event.seq, type: event.type, at: event.at, actor: event.actor })),
      gate: await gateFor(found.formCode, found.editionIdentifier),
    };
  }

  async function recordDecision(user, evidenceCaseId, input = {}) {
    assertRole(user);
    const preview = await loadCase(evidenceCaseId); // only to know which edition to lock
    return withLock(`${preview.formCode}|${preview.editionIdentifier}`, async () => {
      const found = await loadCase(evidenceCaseId); // re-read INSIDE the lock so two concurrent decisions cannot both pass the "already decided" check
      const decision = input.decision;
      if (!C.RECORDABLE_DECISIONS.includes(decision)) throw httpError(400, `decision must be one of: ${C.RECORDABLE_DECISIONS.join(", ")}`, "INVALID_DECISION");
      // the reviewer must EXPLICITLY CONFIRM the decision for THIS edition (it is shown next to the quote and the verification results)
      const confirmation = input.confirmation || {};
      if (confirmation.confirmed !== true) throw httpError(422, "The decision must be explicitly confirmed", "CONFIRMATION_REQUIRED");
      if (confirmation.decision !== decision || confirmation.formCode !== found.formCode || confirmation.editionIdentifier !== found.editionIdentifier) {
        throw httpError(422, "The confirmation must name the same decision, form and edition as the decision being recorded", "CONFIRMATION_MISMATCH");
      }
      const rationale = String(input.rationale || "").trim();
      if (rationale.length < 10) throw httpError(400, "A rationale (at least 10 characters) is required", "RATIONALE_REQUIRED");
      if (rationale.length > C.LIMITS.rationaleMax) throw httpError(400, `The rationale must be at most ${C.LIMITS.rationaleMax} characters`, "RATIONALE_TOO_LONG");
      if (found.decided) throw httpError(409, "A decision was already recorded for this evidence case; submit new evidence to change it", "ALREADY_DECIDED");

      const checks = Object.fromEntries((found.verification?.payload?.checks || []).map((item) => [item.name, item.passed]));
      const overall = found.verification?.payload?.overall;
      const existing = await store.findDecision(found.formCode, found.editionIdentifier);

      if (existing?.decision === "not_accepted" && decision === "accepted") {
        throw httpError(409, "This edition is explicitly not accepted; an admin or team lead cannot mark it accepted", "NOT_ACCEPTED_LOCKED");
      }
      if (decision === "accepted") {
        if (overall !== C.VERIFICATION_RESULTS.VERIFIED) throw httpError(422, `An accepted decision needs verified evidence (this case is ${overall || "unverified"})`, "EVIDENCE_NOT_VERIFIED");
        // four-eyes: the person who submitted the evidence cannot also be the one who accepts the edition
        if (idOf(user._id) === idOf(found.submitted.actor?.userId)) throw httpError(403, "An accepted decision must be made by a different admin or team lead than the one who submitted the evidence", "FOUR_EYES_REQUIRED");
        const fetchedAt = found.fetched?.payload?.fetchedAt ? new Date(found.fetched.payload.fetchedAt).getTime() : 0;
        if (now().getTime() - fetchedAt > C.FRESHNESS_WINDOW_MS) throw httpError(409, "The evidence snapshot is too old to rely on; submit the evidence again", "EVIDENCE_STALE");
      }
      if (decision === "not_accepted" && !(checks.quote_verbatim && checks.edition_in_snapshot)) {
        throw httpError(422, "A not-accepted decision must rest on a quote the system found in the official source that names this edition", "EVIDENCE_NOT_VERIFIED");
      }

      const claimed = found.submitted.payload.claimedDates || {};
      const decidedAt = now();
      const restrictsOnly = C.RESTRICTING_DECISIONS.includes(decision);
      const row = {
        formCode: found.formCode,
        editionIdentifier: found.editionIdentifier,
        decision,
        status: decision === "held" ? "unverified" : "verified",
        effectiveDate: claimed.effectiveDate ? new Date(claimed.effectiveDate) : null,
        rejectionDate: claimed.rejectionDate ? new Date(claimed.rejectionDate) : null,
        graceUntil: claimed.graceUntil ? new Date(claimed.graceUntil) : null,
        evidenceRefs: [...(existing?.evidenceRefs || []), { sourceId: found.fetched?.payload?.snapshotId || null, snapshotHash: found.fetched?.payload?.snapshotHash || null, evidenceCaseId: String(evidenceCaseId), recordedAt: decidedAt }],
        decidedBy: { userId: user._id, role: user.role },
        decidedAt,
        reviewBy: decision === "held" ? null : new Date(decidedAt.getTime() + C.REVIEW_WINDOW_DAYS * 24 * 60 * 60 * 1000),
        holdReason: decision === "held" ? rationale : "",
        rationale,
        quote: found.submitted.payload.quote,
      };
      const saved = await store.saveDecision(row, existing ? existing.version : null);

      const actor = { userId: user._id, role: user.role };
      const state = { id: String(evidenceCaseId), seq: found.seq, formCode: found.formCode, editionIdentifier: found.editionIdentifier };
      await writeEvent(state, "DECISION_RECORDED", {
        decision, effectiveDate: claimed.effectiveDate || null, rejectionDate: claimed.rejectionDate || null, graceUntil: claimed.graceUntil || null,
        quote: found.submitted.payload.quote, rationale, explicitConfirmation: true, restrictsOnly,
        snapshotHash: found.fetched?.payload?.snapshotHash || null, verification: overall, decisionVersion: saved.version,
      }, actor);
      const result = await gateFor(found.formCode, found.editionIdentifier);
      await writeEvent(state, "GATE_RECALCULATED", { inputs: { formCode: found.formCode, editionIdentifier: found.editionIdentifier }, result, decisionVersion: saved.version }, { userId: null, role: "system", label: "system:gate" });
      return { evidenceCaseId: String(evidenceCaseId), decision: saved, gate: result };
    });
  }

  /** Every stored edition with its decision and what the gate says now (one pass, no per-row queries). */
  async function listEditions(user) {
    assertRole(user);
    const [templates, decisions] = await Promise.all([store.listTemplates(), store.listDecisions()]);
    const byKey = new Map(decisions.map((row) => [`${row.formCode}|${row.editionIdentifier}`, row]));
    const memory = { findDecision: async (formCode, edition) => byKey.get(`${formCode}|${edition}`) || null };
    const at = now();
    const rows = [];
    for (const template of templates) {
      const editionIdentifier = isoDay(template.editionDate);
      const trusted = template.importMetadata?.editionDateSource !== "version_backfill";
      const row = editionIdentifier ? byKey.get(`${template.formCode}|${editionIdentifier}`) : null;
      rows.push({
        formCode: template.formCode, version: template.version, templateStatus: template.status, mappingStatus: template.mappingStatus || null,
        editionIdentifier, editionDateTrusted: Boolean(editionIdentifier) && trusted, canSubmitEvidence: Boolean(editionIdentifier),
        live: template.status === "active", awaitingPromotion: ["draft", "review", "pending_review"].includes(template.status),
        officialPdfUrl: template.officialPdfUrl || null, sourcePageUrl: template.lifecycle?.sourcePageUrl || null,
        decision: row ? { decision: row.decision, status: row.status, decidedAt: row.decidedAt, reviewBy: row.reviewBy, effectiveDate: row.effectiveDate, rejectionDate: row.rejectionDate, graceUntil: row.graceUntil, holdReason: row.holdReason, version: row.version } : null,
        gate: editionIdentifier ? await gate.check(template.formCode, editionIdentifier, { store: memory, now: at }) : await gate.check(template.formCode, "", { store: memory, now: at }),
      });
    }
    return rows.sort((a, b) => a.formCode.localeCompare(b.formCode) || String(b.editionIdentifier).localeCompare(String(a.editionIdentifier)));
  }

  async function gateCheck(user, formCode, editionIdentifier) {
    assertRole(user);
    return gateFor(String(formCode || ""), String(editionIdentifier || ""));
  }

  return { submitEvidence, recordDecision, getCase, listEditions, gateCheck, assertRole };
}

// The application's instance: Mongoose-backed, with a best-effort copy of every event in the existing AuditLog.
let defaultService = null;
let serviceOverride = null; // tests only: lets the end-to-end test drive the real HTTP handlers with an in-memory store
function setServiceForTests(service) { serviceOverride = service; }
function getService() {
  if (serviceOverride) return serviceOverride;
  if (!defaultService) {
    const { mongoStore } = require("./EditionPolicyStore");
    const AuditLog = require("../../models/AuditLog");
    defaultService = createEvidenceService({
      store: mongoStore,
      auditSink: (event) => AuditLog.create({
        userId: event.actor?.userId || undefined, userRole: event.actor?.role, action: event.type, entityType: "FormEditionDecision",
        entityId: `${event.formCode}|${event.editionIdentifier}`, changes: { evidenceCaseId: event.evidenceCaseId, seq: event.seq, payload: event.payload },
        source: "api", severity: event.type === "DECISION_RECORDED" ? "high" : "low", description: `Form edition evidence: ${event.type}`,
      }),
    });
  }
  return defaultService;
}

module.exports = { createEvidenceService, getService, setServiceForTests, validateSubmission, httpError, isoDay };
