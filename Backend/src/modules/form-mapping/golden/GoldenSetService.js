// The golden-set review: progress, a reviewer's answers, sign-off, spreadsheet export. Only the named reviewer(s) can answer or sign off; reading is for staff roles.
// Everything a person sees is the plain-language wording of the draft - the technical details of an entry never leave the server.
const defaultDraft = () => require("./goldenSet.draft.json");
const { summarize, checkAgainstPlan } = require("./buildDraft");

const VERDICTS = ["right", "wrong", "unsure"];
const VERDICT_LABEL = { right: "Right", wrong: "Wrong", unsure: "Not sure" };
const SIGN_OFF_STATEMENT = "I have checked every answer in this golden set against the official USCIS form and confirm that the answers marked Right are correct.";

const httpError = (status, message, code) => Object.assign(new Error(message), { status, code });

/** The reviewer address(es): GOLDEN_SET_REVIEWERS (comma separated), default admin@immiglance.com. */
function reviewerEmails(env = process.env) {
  return String(env.GOLDEN_SET_REVIEWERS || "admin@immiglance.com").split(",").map((email) => email.trim().toLowerCase()).filter(Boolean);
}

function createGoldenSetService({ draft = defaultDraft(), Review = require("../../../models/GoldenSetReview"), SignOff = require("../../../models/GoldenSetSignOff"), reviewers = reviewerEmails, now = () => new Date() } = {}) {
  const entries = draft.entries;
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  const canReview = (user) => reviewers().includes(String(user?.email || "").toLowerCase());

  // an answer counts only while the entry still says what it said when it was reviewed
  async function validReviews() {
    const rows = await Review.find({}).lean();
    const valid = new Map();
    for (const row of rows) {
      const entry = byId.get(row.entryId);
      if (entry && entry.contentHash === row.contentHash) valid.set(row.entryId, row);
    }
    return { valid, stale: rows.length - valid.size };
  }

  const present = (entry, review) => ({
    id: entry.id, ref: entry.ref, formCode: entry.formCode, formName: entry.formName, familyLabel: entry.familyLabel, heldOut: entry.heldOut, where: entry.where, boxLabel: entry.boxLabel,
    boxKind: entry.boxKind, belongsTo: entry.belongsTo, fillsWith: entry.fillsWith, writtenAs: entry.writtenAs, onlyWhen: entry.onlyWhen, ifEmpty: entry.ifEmpty, appearsTimes: entry.appearsTimes,
    example: entry.example, sentence: entry.sentence,
    review: review ? { verdict: review.verdict, correction: review.correction, note: review.note, reviewerEmail: review.reviewerEmail, reviewedAt: review.reviewedAt } : null,
  });

  async function currentSignOff() {
    const latest = await SignOff.findOne({}).sort({ signedAt: -1 }).lean();
    if (!latest) return null;
    return { signedAt: latest.signedAt, reviewerEmail: latest.reviewerEmail, counts: latest.counts, upToDate: latest.entriesChecksum === draft.entriesChecksum };
  }

  async function summary(user) {
    const { valid, stale } = await validReviews();
    const counts = { right: 0, wrong: 0, unsure: 0, unanswered: 0 };
    const perForm = {};
    const rightEntries = [];
    for (const entry of entries) {
      const review = valid.get(entry.id);
      counts[review ? review.verdict : "unanswered"] += 1;
      const form = (perForm[entry.formCode] ||= { formCode: entry.formCode, formName: entry.formName, familyLabel: entry.familyLabel, heldOut: entry.heldOut, total: 0, answered: 0, right: 0, wrong: 0, unsure: 0 });
      form.total += 1;
      if (review) { form.answered += 1; form[review.verdict] += 1; }
      if (review?.verdict === "right") rightEntries.push(entry);
    }
    const verified = summarize(rightEntries);
    const plan = checkAgainstPlan(verified);
    const blockers = [];
    if (counts.unanswered) blockers.push(`${counts.unanswered} box(es) have no answer yet`);
    if (counts.unsure) blockers.push(`${counts.unsure} box(es) are marked "Not sure" - find out and change them to Right or Wrong`);
    if (!plan.ok) blockers.push(`the entries marked Right do not yet reach the plan's minimum: ${Object.entries(plan.results).filter(([, ok]) => !ok).map(([name]) => name).join("; ")}`);
    return {
      title: draft.title, note: draft.note, total: entries.length, counts, answered: entries.length - counts.unanswered, staleAnswers: stale, entriesChecksum: draft.entriesChecksum,
      perForm: Object.values(perForm), verified: { total: verified.total, byKind: verified.byKind, byFamily: verified.byFamily }, plan, canSignOff: blockers.length === 0, blockers,
      reviewers: reviewers(), you: { email: user?.email || null, canReview: canReview(user) }, signOff: await currentSignOff(),
    };
  }

  async function list({ formCode, status, search, offset = 0, limit = 50 } = {}) {
    const { valid } = await validReviews();
    const term = String(search || "").trim().toLowerCase();
    const wanted = entries.filter((entry) => {
      if (formCode && entry.formCode !== String(formCode).toUpperCase()) return false;
      const review = valid.get(entry.id);
      if (status === "unanswered" && review) return false;
      if (["right", "wrong", "unsure"].includes(status) && review?.verdict !== status) return false;
      if (term && !`${entry.boxLabel} ${entry.fillsWith} ${entry.sentence} ${entry.where}`.toLowerCase().includes(term)) return false;
      return true;
    });
    const start = Math.max(0, Number(offset) || 0);
    const size = Math.min(200, Math.max(1, Number(limit) || 50));
    return { total: wanted.length, offset: start, limit: size, entries: wanted.slice(start, start + size).map((entry) => present(entry, valid.get(entry.id))) };
  }

  async function setReview(entryId, { verdict, correction = "", note = "" } = {}, user) {
    if (!canReview(user)) throw httpError(403, `Only ${reviewers().join(" / ")} can answer the golden set review`, "NOT_THE_REVIEWER");
    const entry = byId.get(entryId);
    if (!entry) throw httpError(404, "That golden-set entry does not exist", "ENTRY_NOT_FOUND");
    if (!VERDICTS.includes(verdict)) throw httpError(400, 'The answer must be "right", "wrong" or "unsure"', "BAD_VERDICT");
    const fix = String(correction || "").trim();
    if (verdict === "wrong" && fix.length < 3) throw httpError(400, 'When you answer "Wrong", say what the box should be filled with', "CORRECTION_REQUIRED");
    const row = await Review.findOneAndUpdate(
      { entryId },
      { $set: { contentHash: entry.contentHash, formCode: entry.formCode, verdict, correction: verdict === "wrong" ? fix : "", note: String(note || "").trim().slice(0, 2000), reviewerEmail: String(user.email).toLowerCase(), reviewer: user._id, reviewedAt: now() } },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    ).lean();
    return present(entry, row);
  }

  async function signOff(user, { confirm } = {}) {
    if (!canReview(user)) throw httpError(403, `Only ${reviewers().join(" / ")} can sign off the golden set`, "NOT_THE_REVIEWER");
    if (confirm !== true) throw httpError(400, "Sign-off must be confirmed explicitly", "CONFIRM_REQUIRED");
    const status = await summary(user);
    if (!status.canSignOff) throw httpError(409, `The golden set cannot be signed off yet: ${status.blockers.join("; ")}`, "NOT_READY");
    const { valid } = await validReviews();
    const verifiedByKind = {};
    const verifiedByForm = {};
    for (const entry of entries) {
      if (valid.get(entry.id)?.verdict !== "right") continue;
      verifiedByKind[entry.boxKind] = (verifiedByKind[entry.boxKind] || 0) + 1;
      verifiedByForm[entry.formCode] = (verifiedByForm[entry.formCode] || 0) + 1;
    }
    const row = await SignOff.create({ reviewerEmail: String(user.email).toLowerCase(), reviewer: user._id, signedAt: now(), entriesChecksum: draft.entriesChecksum, counts: { total: status.total, right: status.counts.right, wrong: status.counts.wrong }, verifiedByKind, verifiedByForm, statement: SIGN_OFF_STATEMENT });
    return { signedAt: row.signedAt, reviewerEmail: row.reviewerEmail, counts: row.counts };
  }

  /** Every entry with the reviewer's answer written in words, for the spreadsheet export. */
  async function exportRows() {
    const { valid } = await validReviews();
    return entries.map((entry) => {
      const review = valid.get(entry.id);
      return { ...entry, technical: undefined, verdictLabel: review ? VERDICT_LABEL[review.verdict] : "", correction: review?.correction || "", note: review?.note || "" };
    });
  }

  return { summary, list, setReview, signOff, exportRows, canReview, entryCount: entries.length };
}

let shared;
const getGoldenSetService = () => (shared ||= createGoldenSetService());

module.exports = { createGoldenSetService, getGoldenSetService, reviewerEmails, VERDICTS, VERDICT_LABEL, SIGN_OFF_STATEMENT };
