// EB-1A (Extraordinary Ability) — self-petitioned, single-person visa. Unlike
// h1b.js/l1a.js/p.js/o1.js/eb1b.js (all employer-sponsored, all split into
// employer/employee checklists), there is no petitioner side here at all —
// every item below is the beneficiary's own evidence, targetRole "client"
// throughout. Deliberately NOT registered in
// ../modules/employment-workflow/questionnaires/registry.js (that registry is
// for employer-sponsored visas only) — this file is consumed directly by
// ../config/visaChecklists.js's generateChecklist() instead.
//
// Modeled as 10 independent evidentiary criteria (8 CFR 204.5(h)(3)), verbatim
// from the business's own EB1-A Checklist ("you must include evidence [of] 3
// of the below listed criteria... or comparable evidence if any of the
// criteria do not readily apply"), not the 4-item placeholder table this
// visa type fell back to before (visaChecklists.js's old "EB-1A" entry).

function matches(value) {
  return /eb[\s-]?1[\s-]?a\b/i.test(String(value || ""));
}

function slug(value) {
  return String(value).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 60);
}

const MIN_CRITERIA_REQUIRED = 3;
const TOTAL_CRITERIA = 10;

// fieldSpecific: true only for #9/#10 — inherently tied to artistic/
// performing-arts fields, not universally applicable (spec explicitly warns
// against making these mandatory for e.g. software engineers/researchers).
const EB1A_CRITERIA = [
  {
    criterionId: "EB1A_CRITERION_1",
    number: 1,
    title: "Receipt of Lesser Nationally or Internationally Recognized Prizes or Awards",
    description: "Evidence of receipt of lesser nationally or internationally recognized prizes or awards for excellence.",
    fieldSpecific: false,
    items: [
      { name: "Copy of award and certificate", description: "Copy of the award/certificate itself." },
      { name: "Photos of receiving the award", description: "Photos of the beneficiary receiving the award." },
      { name: "Awarding authority's documentary proof of criteria", description: "Documentary proof from the awarding authority on the criteria used for presenting the prize." },
      { name: "Media articles or news releases about the award", description: "Media articles or news releases about receiving the award." },
    ],
  },
  {
    criterionId: "EB1A_CRITERION_2",
    number: 2,
    title: "Membership in Associations Demanding Outstanding Achievement",
    description: "Evidence of membership in associations in the field that demand outstanding achievement of their members.",
    fieldSpecific: false,
    items: [
      { name: "Association letter confirming membership", description: "Letter from the association confirming the beneficiary's membership." },
      { name: "Membership certificate or card", description: "Other documentary proof of membership, such as a certificate or card." },
      { name: "Association website listing", description: "Association's official website where the beneficiary's name is listed as a member." },
    ],
  },
  {
    criterionId: "EB1A_CRITERION_3",
    number: 3,
    title: "Published Material About the Beneficiary",
    description: "Evidence of published material about the beneficiary in professional or major trade publications or other major media.",
    fieldSpecific: false,
    items: [
      { name: "Media coverage about the beneficiary", description: "Newspaper, TV news coverage, or website publication about the beneficiary." },
      { name: "Copy of articles published about the beneficiary", description: "Copy of articles published about the beneficiary and their research/work." },
    ],
  },
  {
    criterionId: "EB1A_CRITERION_4",
    number: 4,
    title: "Participation as a Judge of the Work of Others",
    description: "Evidence that the beneficiary has been asked to judge the work of others, individually or on a panel.",
    fieldSpecific: false,
    items: [
      { name: "Photos of the judging event", description: "Photos of the event where the beneficiary was a judge." },
      {
        name: "Letter from organizers confirming judging role",
        description: "Letter from organizers confirming the beneficiary was asked to judge the work of others, individually or on a panel — should also identify the event, the criteria on which judges were selected, what was judged, how it was judged, and the impact of the judging.",
      },
    ],
  },
  {
    criterionId: "EB1A_CRITERION_5",
    number: 5,
    title: "Original Contributions of Major Significance",
    description: "Evidence of original scientific, scholarly, artistic, athletic, or business-related contributions of major significance to the field.",
    fieldSpecific: false,
    items: [
      { name: "Expert letters on the contribution to the field", description: "Letters from experts in the field stating how the beneficiary's work or research has contributed to the field." },
      { name: "Evidence the work/research is being used", description: "Letters from experts in the field stating how the work or research is being used in the field and its impact." },
      { name: "Evidence of patent(s) registered under the beneficiary's name", description: "Evidence of patent(s) registered under the beneficiary's name.", required: false },
    ],
  },
  {
    criterionId: "EB1A_CRITERION_6",
    number: 6,
    title: "Authorship of Scholarly Articles",
    description: "Evidence of authorship of scholarly articles in professional or major trade publications or other major media.",
    fieldSpecific: false,
    items: [
      { name: "Proof of authorship of scholarly articles", description: "Proof that articles or research work authored by the beneficiary were published in media or other publications, stating the beneficiary as the author." },
    ],
  },
  {
    criterionId: "EB1A_CRITERION_7",
    number: 7,
    title: "Leading or Critical Role in Distinguished Organizations",
    description: "Evidence of the beneficiary's performance of a leading or critical role in distinguished organizations.",
    fieldSpecific: false,
    items: [
      { name: "Employer letter describing role and duties", description: "Letter from the employer(s) stating the beneficiary's duties and role." },
    ],
  },
  {
    criterionId: "EB1A_CRITERION_8",
    number: 8,
    title: "High Salary or Other Significantly High Remuneration",
    description: "Evidence that the beneficiary commands a high salary or other significantly high remuneration in relation to others in the field.",
    fieldSpecific: false,
    items: [
      { name: "Employment verification letter (salary and job title)", description: "Employment verification letter stating the beneficiary's salary and job title." },
      { name: "Offer letter stating annual salary", description: "Offer letter from the employer stating the beneficiary's annual salary." },
      { name: "Income tax returns and W-2s (last 3 years)", description: "Income tax returns and W-2s for the last 3 years." },
    ],
  },
  {
    criterionId: "EB1A_CRITERION_9",
    number: 9,
    title: "Display of Work at Artistic Exhibitions or Showcases",
    description: "Evidence that the beneficiary's work has been displayed at artistic exhibitions or showcases.",
    fieldSpecific: true,
    items: [
      { name: "Exhibition invitation or catalog", description: "Exhibition invitation, program, or catalog naming the beneficiary.", required: false },
      { name: "Photos of displayed work", description: "Photos of the beneficiary's work as displayed at the exhibition/showcase.", required: false },
      { name: "Organizer letter confirming the exhibition", description: "Letter from the exhibition/showcase organizer confirming the beneficiary's participation.", required: false },
    ],
  },
  {
    criterionId: "EB1A_CRITERION_10",
    number: 10,
    title: "Commercial Successes in the Performing Arts",
    description: "Evidence of the beneficiary's commercial successes in the performing arts.",
    fieldSpecific: true,
    items: [
      { name: "Box-office or sales records", description: "Box-office records, ticket sales, or streaming/attendance figures.", required: false },
      { name: "Revenue or royalty documentation", description: "Revenue, royalty, or contract documentation showing commercial success.", required: false },
      { name: "Industry reports naming the beneficiary", description: "Industry reports or trade press covering the beneficiary's commercial success.", required: false },
    ],
  },
];

// Computed once at module load and stored directly on each item (rather than
// re-derived wherever a documentType is needed) — the client portal's upload
// control needs the exact same value toCaseChecklistItems() below puts on
// the real checklist item, so document.workflow.service.js's syncChecklist()
// fuzzy-matcher has an exact documentType to match against rather than a
// merely-similar one.
for (const criterion of EB1A_CRITERIA) {
  for (const item of criterion.items) {
    item.documentType = `${slug(criterion.criterionId)}_${slug(item.name)}`;
  }
}

function getCriterion(criterionId) {
  return EB1A_CRITERIA.find((criterion) => criterion.criterionId === criterionId) || null;
}

// Flattens EB1A_CRITERIA into Case.checklistItems templates (consumed by
// visaChecklists.js's generateChecklist(), same shape toChecklistItem() there
// expects) — every item carries criterionId, which is the one thing
// eb1b.js's equivalent criteria items never propagate onto a real checklist
// item today. Every item required:false (USCIS requires satisfying at least
// MIN_CRITERIA_REQUIRED criteria in aggregate, not every item within one —
// same convention eb1b.js's own criteria items use), single-party throughout
// (targetRole "client", no employer/employee split).
function toCaseChecklistItems() {
  const items = [];
  for (const criterion of EB1A_CRITERIA) {
    for (const item of criterion.items) {
      items.push({
        name: item.name,
        documentType: item.documentType,
        description: item.description,
        required: false,
        category: "evidence",
        targetRole: "client",
        status: "pending",
        criterionId: criterion.criterionId,
      });
    }
  }
  return items;
}

module.exports = {
  matches,
  slug,
  MIN_CRITERIA_REQUIRED,
  TOTAL_CRITERIA,
  EB1A_CRITERIA,
  getCriterion,
  toCaseChecklistItems,
};
