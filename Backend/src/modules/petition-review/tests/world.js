// Shared fixtures of the petition-review tests: people, cases, and an in-memory stand-in for the data layer + side effects.
const { createPetitionReviewService } = require("../petitionReview.service");

const U = { cm: "u-cm", lead: "u-lead", client: "u-client", petitioner: "u-pet", beneficiary: "u-ben", employer: "u-emp", employee: "u-emp2", attorney: "u-att", other: "u-other" };
const users = {
  [U.cm]: { _id: U.cm, name: "Casey Manager", email: "cm@firm.test", role: "case_manager" },
  [U.client]: { _id: U.client, name: "Sam Single", email: "sam@x.test", role: "client" },
  [U.petitioner]: { _id: U.petitioner, name: "Pat Petitioner", email: "pat@x.test", role: "client" },
  [U.beneficiary]: { _id: U.beneficiary, name: "Ben Beneficiary", email: "ben@x.test", role: "beneficiary" },
  [U.employer]: { _id: U.employer, name: "Erin Employer", email: "erin@corp.test", role: "client" },
  [U.employee]: { _id: U.employee, name: "Eli Employee", email: "eli@corp.test", role: "employee" },
  [U.attorney]: { _id: U.attorney, name: "Alex Attorney", email: "alex@law.test", role: "attorney" },
  [U.other]: { _id: U.other, name: "Olive Other", email: "o@x.test", role: "client" },
  [U.lead]: { _id: U.lead, name: "Lee Lead", email: "lead@firm.test", role: "team_lead" },
};
const cases = {
  team: { _id: "c-team", caseNumber: "T-1", user: U.other, caseStructure: "single", caseRole: "single", assignedCaseManager: U.cm, assignedTeamLead: U.lead, attorneyAccess: [] },
  single: { _id: "c-single", caseNumber: "S-1", user: U.client, caseStructure: "single", caseRole: "single", assignedCaseManager: U.cm, attorneyAccess: [{ status: "active", attorneyId: U.attorney }] },
  family: { _id: "c-family", caseNumber: "F-1", user: U.petitioner, petitionerUser: U.petitioner, beneficiaryUser: U.beneficiary, caseStructure: "family", caseRole: "principal", assignedCaseManager: U.cm, attorneyAccess: [] },
  employerPrincipal: { _id: "c-emp", caseNumber: "E-1", user: U.employer, employerUser: U.employer, caseStructure: "employer_employee", caseRole: "principal", assignedCaseManager: U.cm },
  employee: { _id: "c-emp-child", caseNumber: "E-1-A", user: U.employee, employeeUser: U.employee, parentCase: "c-emp", caseStructure: "employer_employee", caseRole: "employee", assignedCaseManager: U.cm, attorneyAccess: [{ status: "active", attorneyId: U.attorney }, { status: "revoked", attorneyId: "u-gone" }] },
};
const PETITION = "petition_manual_upload";

function makeWorld() {
  const documents = {
    d1: { _id: "d1", caseId: "c-single", documentType: PETITION, originalName: "Petition.pdf", mimeType: "application/pdf", createdAt: new Date("2026-10-20") },
    d2: { _id: "d2", caseId: "c-family", documentType: PETITION, originalName: "Family Petition.pdf", createdAt: new Date("2026-10-21") },
    d3: { _id: "d3", caseId: "c-emp-child", documentType: PETITION, originalName: "H1B Petition.pdf", createdAt: new Date("2026-10-22") },
    d4: { _id: "d4", caseId: "c-team", documentType: PETITION, originalName: "Team Petition.pdf", createdAt: new Date("2026-10-23") },
    dx: { _id: "dx", caseId: "c-single", documentType: "passport", originalName: "Passport.pdf" },
  };
  const reviews = new Map();
  const claimed = new Set();
  const messages = [];
  let seq = 0;
  const sent = { emails: [], events: [], bells: [], feedback: [], timeline: [] };
  const data = {
    getCase: async (id) => Object.values(cases).find((row) => row._id === String(id)) || null,
    getCases: async (ids) => Object.values(cases).filter((row) => ids.map(String).includes(row._id)),
    getUser: async (id) => users[String(id)] || null,
    getDocument: async (id) => documents[String(id)] || null,
    listPetitionDocuments: async (caseId) => Object.values(documents).filter((row) => row.caseId === String(caseId) && row.documentType === PETITION),
    readDocumentBuffer: async (document) => Buffer.from(`PDF of ${document._id}`),
    getReview: async (id) => reviews.get(String(id)) || null,
    getReviews: async (ids) => ids.map((id) => reviews.get(String(id))).filter(Boolean),
    release: async (documentId, caseId, which, { sentBy, note, at }) => {
      const review = reviews.get(documentId) || { documentId, caseId, attorneyReview: {}, clientReview: {} };
      review[which] = { sentAt: at, sentBy, note, count: (review[which].count || 0) + 1 };
      reviews.set(documentId, review);
      return review;
    },
    releasedToClientForCases: async (caseIds) => [...reviews.values()].filter((review) => caseIds.map(String).includes(String(review.caseId)) && review.clientReview?.sentAt),
    casesOfUser: async (userId) => {
      const own = Object.values(cases).filter((row) => [row.user, row.employerUser, row.petitionerUser].includes(userId));
      const kids = Object.values(cases).filter((row) => own.some((parent) => parent._id === row.parentCase));
      return [...own, ...kids];
    },
    listMessages: async (documentId, { limit }) => messages.filter((row) => row.documentId === documentId).slice(-limit),
    recentMessages: async (ids, n) => new Map(ids.map((id) => [String(id), messages.filter((row) => row.documentId === String(id)).slice(-n)])),
    countMessages: async (ids) => new Map(ids.map((id) => [String(id), messages.filter((row) => row.documentId === String(id)).length])),
    countUnread: async (ids, userId) => new Map(ids.map((id) => [String(id), messages.filter((row) => row.documentId === String(id) && row.authorId !== userId && !row.readBy.includes(userId)).length])),
    findMessageByClientId: async (documentId, authorId, clientMessageId) => messages.find((row) => row.documentId === documentId && row.authorId === authorId && row.clientMessageId === clientMessageId) || null,
    insertMessage: async (row) => { const saved = { _id: `m${++seq}`, createdAt: new Date(2026, 9, 28, 10, seq), readBy: [row.authorId], ...row }; messages.push(saved); return saved; },
    claimFirstFeedbackNotice: async (documentId) => { if (claimed.has(documentId)) return false; claimed.add(documentId); return true; },
    markRead: async (documentId, userId) => messages.filter((row) => row.documentId === documentId).forEach((row) => { if (!row.readBy.includes(userId)) row.readBy.push(userId); }),
  };
  const service = createPetitionReviewService({
    data,
    logger: { error() {}, info() {}, warn() {} },
    now: () => new Date("2026-10-28T12:00:00Z"),
    emailService: { sendTemplateEmail: async (key, options) => { sent.emails.push({ key, ...options }); return { sent: true }; } },
    gateway: { emitToUser: (id, event, payload) => { sent.events.push({ id: String(id), event, payload }); } },
    canAccessCase: () => true,
    teamIds: (row) => [row.assignedCaseManager, row.assignedTeamLead].filter(Boolean),
    portalUrl: (portal) => `https://${portal}.example.test`,
    createNotification: async (payload) => { sent.bells.push(payload); },
    createFeedback: async (args) => { sent.feedback.push(args); },
    recordTimeline: async (event) => { sent.timeline.push(event); },
  });
  return { service, data, sent, reviews, messages };
}

module.exports = { U, users, cases, PETITION, makeWorld };
