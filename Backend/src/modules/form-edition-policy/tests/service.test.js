// Plan Rule D: the evidence workflow end to end, with an in-memory store and scripted fetchers (no database, no network).
const test = require("node:test");
const assert = require("node:assert/strict");
const H = require("./helpers");
const { build, template, user, admin, lead, submission, confirmation, okFetch, failFetch, pdfFetch, noPdf, QUOTE, edition } = H;

const rejects = async (promise, status, code) => {
  const error = await promise.then(() => null, (caught) => caught);
  assert.ok(error, "expected a rejection");
  assert.equal(error.status, status, error.message);
  assert.equal(error.code, code, error.message);
  return error;
};
const second = user("admin", "second-admin");
const decide = (service, who, evidenceCaseId, decision, extra = {}) => service.recordDecision(who, evidenceCaseId, { decision, confirmation: confirmation(decision), rationale: "Verified against the official USCIS notice.", ...extra });

// ---- roles: exactly admin and team_lead ----
test("ONLY admin and team_lead may use any part of the workflow; super_admin, case_manager, attorney, paralegal, finance, hr, client and no user are all refused", async () => {
  const { service } = build();
  const open = await service.submitEvidence(admin, submission());
  for (const role of ["super_admin", "case_manager", "attorney", "paralegal", "finance", "hr", "client", "reviewer", "employer", "professor"]) {
    const who = user(role);
    await rejects(service.submitEvidence(who, submission()), 403, "ROLE_NOT_ALLOWED");
    await rejects(service.recordDecision(who, open.evidenceCaseId, { decision: "held", confirmation: confirmation("held"), rationale: "long enough rationale" }), 403, "ROLE_NOT_ALLOWED");
    await rejects(service.getCase(who, open.evidenceCaseId), 403, "ROLE_NOT_ALLOWED");
    await rejects(service.listEditions(who), 403, "ROLE_NOT_ALLOWED");
    await rejects(service.gateCheck(who, "I-131", edition), 403, "ROLE_NOT_ALLOWED");
  }
  await rejects(service.submitEvidence(null, submission()), 403, "ROLE_NOT_ALLOWED");
  for (const allowed of [admin, lead]) await service.submitEvidence(allowed, submission());
});

// ---- submitting ----
test("submitting evidence fetches the source itself, stores an immutable snapshot, verifies, and writes three audit events (no decision yet)", async () => {
  const { service, store } = build();
  const result = await service.submitEvidence(admin, submission());
  assert.equal(result.verification.overall, "verified");
  assert.equal(result.snapshot.hash.length, 64);
  assert.equal(result.snapshot.finalUrl, "https://www.uscis.gov/i-131-alert");
  assert.deepEqual(store.events.map((event) => [event.seq, event.type]), [[1, "EVIDENCE_SUBMITTED"], [2, "SOURCE_FETCHED"], [3, "VERIFICATION_COMPLETED"]]);
  assert.ok(store.events.every((event) => event.evidenceCaseId === result.evidenceCaseId));
  assert.equal(store.decisions.size, 0, "submitting never writes a decision");
  assert.equal(result.gate.allowed, false);
  assert.deepEqual(result.gate.reasons, ["no_policy"], "evidence alone never authorizes anything");
  const submitted = store.events[0];
  assert.deepEqual([submitted.actor.userId, submitted.actor.role], ["user-admin", "admin"]);
  assert.equal(submitted.payload.quote, QUOTE);
  assert.equal(store.snapshots.length, 1);
  assert.match(store.snapshots[0].extractedText, /accept the 01\/20\/25 edition/);
});

test("invalid submissions are refused with every problem listed", async () => {
  const { service, store } = build();
  const error = await rejects(service.submitEvidence(admin, { formCode: "", editionIdentifier: "01/20/25", sourceUrl: "", quote: "too short", effectiveDate: "soon" }), 400, "INVALID_EVIDENCE");
  assert.equal(error.details.problems.length, 5);
  assert.equal(store.events.length, 0, "nothing is recorded for an invalid submission");
});

test("a quote that is not on the official page stays unverifiable and cannot be accepted", async () => {
  const { service } = build();
  const result = await service.submitEvidence(admin, submission({ quote: "USCIS will accept the 01/20/25 edition of Form I-131 for filing until 2030." }));
  assert.equal(result.verification.overall, "unverifiable");
  await rejects(decide(service, second, result.evidenceCaseId, "accepted"), 422, "EVIDENCE_NOT_VERIFIED");
});

test("a source that cannot be fetched is recorded (events, violations) but leaves no snapshot and stays held", async () => {
  const { service, store } = build({ html: failFetch("content type text/plain is not accepted here", [{ type: "host_not_uscis", url: "https://evil.example.com/x", hop: 1 }]) });
  const result = await service.submitEvidence(admin, submission());
  assert.equal(result.verification.overall, "unverifiable");
  assert.equal(result.snapshot, null);
  assert.equal(store.snapshots.length, 0);
  const fetched = store.events.find((event) => event.type === "SOURCE_FETCHED");
  assert.equal(fetched.payload.ok, false);
  assert.equal(fetched.payload.violations[0].type, "host_not_uscis");
  assert.equal(result.gate.allowed, false);
});

test("a page with no readable text is treated as not fetched", async () => {
  const { service } = build({ html: async (url) => ({ ok: true, finalUrl: url, status: 200, contentType: "text/html", chain: [], bytes: Buffer.from("<script>only()</script>"), violations: [], error: null }) });
  const result = await service.submitEvidence(admin, submission());
  assert.equal(result.snapshot, null);
  assert.equal(result.verification.overall, "unverifiable");
});

test("the official PDF is compared with the RAW-download checksum, never with the normalized stored copy's", async () => {
  const { service } = build();
  const result = await service.submitEvidence(admin, submission());
  assert.equal(result.verification.checks.find((item) => item.name === "pdf_checksum_matches").passed, true);
  // a template that only has the old lifecycle.sourceChecksum still works; one with only the normalized checksum cannot be compared at all
  const lifecycleOnly = build({ templates: [template({ importMetadata: { editionDateSource: "uscis_page" } })] });
  assert.equal((await lifecycleOnly.service.submitEvidence(admin, submission())).verification.checks.find((item) => item.name === "pdf_checksum_matches").passed, true);
  const normalizedOnly = build({ templates: [template({ importMetadata: { editionDateSource: "uscis_page" }, lifecycle: {} })] });
  const unverifiable = (await normalizedOnly.service.submitEvidence(admin, submission())).verification;
  assert.equal(unverifiable.checks.find((item) => item.name === "pdf_checksum_matches").passed, false);
  assert.equal(unverifiable.overall, "unverifiable");
});

test("template / PDF disagreement makes the evidence conflicting: backfilled date, other edition, PDF checksum mismatch", async () => {
  const backfilled = build({ templates: [template({ importMetadata: { editionDateSource: "version_backfill", checksum: template().importMetadata.checksum } })] });
  assert.equal((await backfilled.service.submitEvidence(admin, submission())).verification.overall, "conflicting");
  const otherPdf = build({ pdf: pdfFetch(Buffer.from("a different official pdf")) });
  assert.equal((await otherPdf.service.submitEvidence(admin, submission())).verification.overall, "conflicting");
  const unreachablePdf = build({ pdf: noPdf });
  assert.equal((await unreachablePdf.service.submitEvidence(admin, submission())).verification.overall, "unverifiable");
  const noTemplate = build({ templates: [] });
  assert.equal((await noTemplate.service.submitEvidence(admin, submission())).verification.overall, "unverifiable");
});

// ---- deciding ----
test("no decision without the explicit confirmation, and the confirmation must name the same decision, form and edition", async () => {
  const { service, store } = build();
  const { evidenceCaseId } = await service.submitEvidence(admin, submission());
  const base = { decision: "accepted", rationale: "Verified against the official USCIS notice." };
  await rejects(service.recordDecision(second, evidenceCaseId, base), 422, "CONFIRMATION_REQUIRED");
  await rejects(service.recordDecision(second, evidenceCaseId, { ...base, confirmation: { confirmed: false, decision: "accepted", formCode: "I-131", editionIdentifier: edition } }), 422, "CONFIRMATION_REQUIRED");
  await rejects(service.recordDecision(second, evidenceCaseId, { ...base, confirmation: confirmation("held") }), 422, "CONFIRMATION_MISMATCH");
  await rejects(service.recordDecision(second, evidenceCaseId, { ...base, confirmation: confirmation("accepted", { formCode: "I-765" }) }), 422, "CONFIRMATION_MISMATCH");
  await rejects(service.recordDecision(second, evidenceCaseId, { ...base, confirmation: confirmation("accepted", { editionIdentifier: "2026-09-18" }) }), 422, "CONFIRMATION_MISMATCH");
  await rejects(service.recordDecision(second, evidenceCaseId, { decision: "accepted", confirmation: confirmation("accepted") }), 400, "RATIONALE_REQUIRED");
  await rejects(service.recordDecision(second, evidenceCaseId, { decision: "grandfathered", confirmation: confirmation("grandfathered"), rationale: "long enough rationale" }), 400, "INVALID_DECISION");
  assert.equal(store.decisions.size, 0, "none of the refused attempts wrote a decision");
});

test("FOUR-EYES: the person who submitted the evidence cannot accept it; a different admin or team lead can", async () => {
  const { service } = build();
  const { evidenceCaseId } = await service.submitEvidence(admin, submission());
  await rejects(decide(service, admin, evidenceCaseId, "accepted"), 403, "FOUR_EYES_REQUIRED");
  const result = await decide(service, lead, evidenceCaseId, "accepted");
  assert.equal(result.decision.decision, "accepted");
});

test("restricting decisions (held, not_accepted) may be recorded by the submitter alone", async () => {
  const { service } = build();
  const held = await service.submitEvidence(admin, submission());
  assert.equal((await decide(service, admin, held.evidenceCaseId, "held")).decision.decision, "held");
  const notAccepted = await service.submitEvidence(admin, submission());
  assert.equal((await decide(service, admin, notAccepted.evidenceCaseId, "not_accepted")).decision.decision, "not_accepted");
});

test("an accepted decision: verified row, 90-day review date, gate re-run and ALLOWED, five audit events in order, explicit confirmation recorded", async () => {
  const { service, store, time } = build();
  const submitted = await service.submitEvidence(admin, submission({ effectiveDate: undefined }));
  const result = await decide(service, lead, submitted.evidenceCaseId, "accepted");
  const row = [...store.decisions.values()][0];
  assert.equal(store.decisions.size, 1);
  assert.deepEqual([row.formCode, row.editionIdentifier, row.decision, row.status, row.version], ["I-131", edition, "accepted", "verified", 1]);
  assert.equal(row.reviewBy.getTime() - time.now().getTime(), 90 * 24 * 60 * 60 * 1000);
  assert.deepEqual([row.decidedBy.userId, row.decidedBy.role], ["user-team_lead", "team_lead"]);
  assert.equal(row.quote, QUOTE);
  assert.equal(row.evidenceRefs.length, 1);
  assert.equal(row.evidenceRefs[0].snapshotHash, submitted.snapshot.hash);
  assert.equal(result.gate.allowed, true);
  assert.deepEqual(store.events.map((event) => event.type), ["EVIDENCE_SUBMITTED", "SOURCE_FETCHED", "VERIFICATION_COMPLETED", "DECISION_RECORDED", "GATE_RECALCULATED"]);
  assert.deepEqual(store.events.map((event) => event.seq), [1, 2, 3, 4, 5]);
  const recorded = store.events[3].payload;
  assert.equal(recorded.explicitConfirmation, true);
  assert.equal(recorded.quote, QUOTE);
  assert.equal(recorded.snapshotHash, submitted.snapshot.hash);
  assert.equal(recorded.verification, "verified");
  assert.equal(store.events[4].payload.result.allowed, true);
});

test("effective / rejection / grace dates come from the claim that was verified against the quote, not from the decision request", async () => {
  const text = "USCIS will accept the 01/20/25 edition of Form I-131 for filing starting 03/01/2026. The earlier edition is not accepted after 06/01/2026.";
  const { service, store } = build({ html: okFetch(text) });
  const quote = "USCIS will accept the 01/20/25 edition of Form I-131 for filing starting 03/01/2026.";
  const submitted = await service.submitEvidence(admin, submission({ quote, effectiveDate: "2026-03-01" }));
  assert.equal(submitted.verification.overall, "verified");
  await service.recordDecision(second, submitted.evidenceCaseId, { decision: "accepted", confirmation: confirmation("accepted"), rationale: "Verified against the official USCIS notice.", effectiveDate: "2030-01-01", rejectionDate: "2030-02-02" });
  const row = [...store.decisions.values()][0];
  assert.equal(row.effectiveDate.toISOString().slice(0, 10), "2026-03-01");
  assert.equal(row.rejectionDate, null);
});

test("claimed dates that the quote does not contain make the evidence conflicting, so they can never be accepted", async () => {
  const { service } = build();
  const submitted = await service.submitEvidence(admin, submission({ effectiveDate: "2026-03-01" }));
  assert.equal(submitted.verification.overall, "conflicting");
  await rejects(decide(service, second, submitted.evidenceCaseId, "accepted"), 422, "EVIDENCE_NOT_VERIFIED");
});

test("only one decision per evidence case; new evidence is needed to change it", async () => {
  const { service } = build();
  const { evidenceCaseId } = await service.submitEvidence(admin, submission());
  await decide(service, admin, evidenceCaseId, "held");
  await rejects(decide(service, admin, evidenceCaseId, "held"), 409, "ALREADY_DECIDED");
});

test("an explicitly not_accepted edition can never be marked accepted by these roles; the gate blocks it", async () => {
  const { service } = build();
  const first = await service.submitEvidence(admin, submission());
  const blocked = await decide(service, admin, first.evidenceCaseId, "not_accepted");
  assert.equal(blocked.gate.allowed, false);
  assert.deepEqual(blocked.gate.reasons, ["not_accepted_by_uscis"]);
  const again = await service.submitEvidence(admin, submission());
  await rejects(decide(service, second, again.evidenceCaseId, "accepted"), 409, "NOT_ACCEPTED_LOCKED");
});

test("not_accepted must rest on a quote the system found that names the edition; held needs only a rationale", async () => {
  const unverified = build();
  const bad = await unverified.service.submitEvidence(admin, submission({ quote: "this sentence is definitely not on the official page" }));
  await rejects(decide(unverified.service, admin, bad.evidenceCaseId, "not_accepted"), 422, "EVIDENCE_NOT_VERIFIED");
  const held = await decide(unverified.service, admin, bad.evidenceCaseId, "held");
  assert.equal(held.gate.allowed, false);
  assert.ok(held.gate.reasons.includes("held"));
});

test("evidence older than the freshness window cannot be accepted: submit it again", async () => {
  const { service, time } = build();
  const { evidenceCaseId } = await service.submitEvidence(admin, submission());
  time.advance(25 * 60 * 60 * 1000);
  await rejects(decide(service, second, evidenceCaseId, "accepted"), 409, "EVIDENCE_STALE");
});

test("a later decision updates the SAME row (one row per edition) and bumps its version; evidence references accumulate", async () => {
  const { service, store } = build();
  const first = await service.submitEvidence(admin, submission());
  await decide(service, admin, first.evidenceCaseId, "held");
  const next = await service.submitEvidence(admin, submission());
  const result = await decide(service, second, next.evidenceCaseId, "accepted");
  assert.equal(store.decisions.size, 1, "exactly one row per { formCode, editionIdentifier }");
  assert.equal(result.decision.version, 2);
  assert.equal([...store.decisions.values()][0].evidenceRefs.length, 2);
  assert.equal(result.gate.allowed, true);
});

test("two decisions racing for the same edition are serialized: both succeed in turn, never two rows", async () => {
  const { service, store } = build();
  const a = await service.submitEvidence(admin, submission());
  const b = await service.submitEvidence(admin, submission());
  const results = await Promise.all([decide(service, second, a.evidenceCaseId, "accepted"), decide(service, lead, b.evidenceCaseId, "held")]);
  assert.equal(store.decisions.size, 1);
  assert.deepEqual(results.map((item) => item.decision.version).sort(), [1, 2]);
});

test("a decision made after the row changed underneath it is refused (optimistic concurrency), not silently overwritten", async () => {
  const { service, store } = build();
  const { evidenceCaseId } = await service.submitEvidence(admin, submission());
  const realSave = store.saveDecision;
  store.saveDecision = async () => { const error = new Error("changed"); error.status = 409; error.code = "DECISION_VERSION_CONFLICT"; throw error; };
  await rejects(decide(service, admin, evidenceCaseId, "held"), 409, "DECISION_VERSION_CONFLICT");
  store.saveDecision = realSave;
});

// ---- reading ----
test("getCase and listEditions show the case, the verification, the gate and every stored edition", async () => {
  const { service } = build({ templates: [template(), template({ _id: "tpl2", version: "2026-09-18", editionDate: new Date("2026-09-18T00:00:00Z"), status: "review", importMetadata: { editionDateSource: "version_backfill" } }), template({ _id: "tpl3", formCode: "I-90", editionDate: null, status: "active" })] });
  const submitted = await service.submitEvidence(admin, submission());
  const shown = await service.getCase(lead, submitted.evidenceCaseId);
  assert.equal(shown.verification.overall, "verified");
  assert.equal(shown.decisionRecorded, false);
  assert.deepEqual(shown.events.map((event) => event.type), ["EVIDENCE_SUBMITTED", "SOURCE_FETCHED", "VERIFICATION_COMPLETED"]);
  assert.equal(shown.snapshot.hash, submitted.snapshot.hash);
  await rejects(service.getCase(admin, "nope"), 404, "EVIDENCE_NOT_FOUND");

  const rows = await service.listEditions(admin);
  assert.equal(rows.length, 3);
  const live = rows.find((row) => row.formCode === "I-131" && row.live);
  assert.deepEqual([live.editionIdentifier, live.canSubmitEvidence, live.gate.allowed, live.gate.reasons], [edition, true, false, ["no_policy"]]);
  const pending = rows.find((row) => row.awaitingPromotion);
  assert.equal(pending.editionDateTrusted, false, "a backfilled edition date is flagged as untrusted");
  const noDate = rows.find((row) => row.formCode === "I-90");
  assert.deepEqual([noDate.editionIdentifier, noDate.canSubmitEvidence, noDate.gate.reasons], [null, false, ["invalid_edition_identifier"]]);
  await decide(service, second, submitted.evidenceCaseId, "accepted");
  assert.equal((await service.listEditions(admin)).find((row) => row.formCode === "I-131" && row.live).gate.allowed, true);
});

// ---- audit ----
test("every event is also copied to the secondary audit sink, and a failing sink never breaks the workflow", async () => {
  const copies = [];
  const ok = build({ auditSink: async (event) => { copies.push(event.type); } });
  const submitted = await ok.service.submitEvidence(admin, submission());
  await decide(ok.service, second, submitted.evidenceCaseId, "accepted");
  assert.deepEqual(copies, ["EVIDENCE_SUBMITTED", "SOURCE_FETCHED", "VERIFICATION_COMPLETED", "DECISION_RECORDED", "GATE_RECALCULATED"]);
  const failing = build({ auditSink: async () => { throw new Error("audit log down"); } });
  const result = await failing.service.submitEvidence(admin, submission());
  assert.equal(result.verification.overall, "verified");
  assert.equal(failing.store.events.length, 3, "the permanent record was still written");
});

test("OUTCOME_RECORDED is never written in 0b-1 (no entry point acts on the gate yet)", async () => {
  const { service, store } = build();
  const submitted = await service.submitEvidence(admin, submission());
  await decide(service, second, submitted.evidenceCaseId, "accepted");
  assert.equal(store.events.some((event) => event.type === "OUTCOME_RECORDED"), false);
});
