// Hardcoded DEFAULT quiz + scoring config — the fallback questionEngine/
// scoring.service fall back to when no active DB row exists for a visa
// pathway, AND the source data the one-time seed script upserts from. Ship
// this so the public quiz is never in a state with no questions and no
// scoring rules, even on a brand-new database.
//
// VISA_PATHWAYS is the full public catalog, grouped into six categories
// (the `category` field) that the frontend's category → visa picker reads
// directly off this list. VISA_QUIZ_CONTENT holds each visa's own generic
// eligibility questions/tier rules/alternatives — these are intentionally
// lightweight, plain-language screening questions (not exhaustive,
// regulation-citation-mapped criteria) so every visa is at least functional
// out of the box; staff can author a more detailed DB-backed
// QuizDefinition/ScoringConfig per visaPathway via the admin CRUD to
// supersede any of these at any time (see questionEngine.service.js).
//
// O-1A/EB-1A are the exception: they keep the original detailed 8-criterion
// set mapping 1:1 to the O-1A/EB-1A "extraordinary ability" regulatory
// criteria (8 CFR 214.2(o)(3)(iii) / 204.5(h)(3)) — the same pathway the
// PRD's Section 6 scoring table (4+→A, 3→B, 2→C, 0-1→D) is written against.

const DEFAULT_VISA_PATHWAY = "O-1A";

const VISA_PATHWAYS = [
  { key: "H-1B", label: "H-1B — Specialty Occupation Worker", category: "work" },
  { key: "L-1A", label: "L-1A — Intracompany Transferee (Manager/Executive)", category: "work" },
  { key: "L-1B", label: "L-1B — Intracompany Transferee (Specialized Knowledge)", category: "work" },
  { key: "TN", label: "TN — NAFTA/USMCA Professional (Canada/Mexico)", category: "work" },
  { key: "E-3", label: "E-3 — Australian Specialty Occupation Worker", category: "work" },

  { key: "K-1", label: "K-1 — Fiancé(e) Visa", category: "family" },
  { key: "K-3", label: "K-3 — Spouse of a U.S. Citizen (Nonimmigrant)", category: "family" },
  { key: "CR-1/IR-1", label: "CR-1/IR-1 — Spouse of a U.S. Citizen (Green Card)", category: "family" },
  { key: "F2A", label: "F2A — Spouse/Child of a Green Card Holder", category: "family" },

  { key: "EB-1B", label: "EB-1B — Outstanding Professor or Researcher", category: "green_card" },
  { key: "EB-1C", label: "EB-1C — Multinational Manager or Executive (Green Card)", category: "green_card" },
  { key: "EB-2", label: "EB-2 — Advanced Degree / Exceptional Ability", category: "green_card" },
  { key: "EB-2 NIW", label: "EB-2 NIW — National Interest Waiver", category: "green_card" },
  { key: "EB-3", label: "EB-3 — Skilled Worker or Professional", category: "green_card" },

  { key: "E-2", label: "E-2 — Treaty Investor", category: "investor" },
  { key: "EB-5", label: "EB-5 — Immigrant Investor", category: "investor" },

  { key: "O-1A", label: "O-1A — Extraordinary Ability (Sciences, Business, Education, Athletics)", category: "extraordinary_ability" },
  { key: "O-1B", label: "O-1B — Extraordinary Ability (Arts, Motion Picture or TV)", category: "extraordinary_ability" },
  { key: "P-1", label: "P-1 — Internationally Recognized Athlete or Entertainer", category: "extraordinary_ability" },
  { key: "EB-1A", label: "EB-1A — Extraordinary Ability Green Card", category: "extraordinary_ability" },

  { key: "B-1/B-2", label: "B-1/B-2 — Business or Tourist Visitor", category: "temporary" },
  { key: "J-1", label: "J-1 — Exchange Visitor", category: "temporary" },
  { key: "F-1", label: "F-1 — Student", category: "temporary" },
];

const DEFAULT_PROFILE_QUESTIONS = [
  {
    key: "field",
    label: "What field or industry do you work in?",
    type: "text",
    required: true,
  },
  {
    key: "currentStatus",
    label: "What is your current visa/immigration status?",
    type: "select",
    options: ["F-1 (Student)", "H-1B", "L-1", "O-1", "TN", "J-1", "B-1/B-2", "Other / None"],
    required: true,
  },
  {
    key: "goal",
    label: "What's your primary goal?",
    type: "select",
    options: ["Work authorization now", "Green card / permanent residence", "Explore my options"],
    required: true,
  },
];

const SCALE_LABELS = ["None", "Developing", "Solid", "Strong"];

const DEFAULT_CRITERIA_QUESTIONS = [
  {
    key: "awards",
    label: "Nationally or internationally recognized awards for excellence",
    uscisCriterion: "Receipt of nationally/internationally recognized prizes or awards for excellence",
    helpText: "Major field-specific awards, competitive grants, or honors recognized outside your immediate workplace.",
    answerScale: { min: 0, max: 3 },
    scaleLabels: SCALE_LABELS,
  },
  {
    key: "memberships",
    label: "Membership in associations that require outstanding achievement",
    uscisCriterion: "Membership in associations requiring outstanding achievement of members",
    helpText: "Selective professional associations judged by recognized experts, not open membership.",
    answerScale: { min: 0, max: 3 },
    scaleLabels: SCALE_LABELS,
  },
  {
    key: "published_material",
    label: "Published material about you and your work in professional or major media",
    uscisCriterion: "Published material about the beneficiary in professional or major trade publications or major media",
    helpText: "Articles, profiles, or features about you specifically (not ones you authored).",
    answerScale: { min: 0, max: 3 },
    scaleLabels: SCALE_LABELS,
  },
  {
    key: "judging",
    label: "Experience judging the work of others in your field",
    uscisCriterion: "Participation as a judge of the work of others",
    helpText: "Peer review, competition judging, grant review panels, thesis committees.",
    answerScale: { min: 0, max: 3 },
    scaleLabels: SCALE_LABELS,
  },
  {
    key: "original_contributions",
    label: "Original scientific, scholarly, artistic, or business-related contributions of major significance",
    uscisCriterion: "Original contributions of major significance to the field",
    helpText: "Patents, novel methods, or work that changed practice in your field, with evidence of impact.",
    answerScale: { min: 0, max: 3 },
    scaleLabels: SCALE_LABELS,
  },
  {
    key: "scholarly_articles",
    label: "Authorship of scholarly articles in professional journals or major media",
    uscisCriterion: "Authorship of scholarly articles in the field, in professional journals or other major media",
    helpText: "Peer-reviewed publications, conference proceedings, or major trade/media articles you authored.",
    answerScale: { min: 0, max: 3 },
    scaleLabels: SCALE_LABELS,
  },
  {
    key: "critical_role",
    label: "Critical or essential role for a distinguished organization",
    uscisCriterion: "Performance of a leading or critical role for an organization with a distinguished reputation",
    helpText: "A role where your contribution was essential to the organization's success, at a reputable organization.",
    answerScale: { min: 0, max: 3 },
    scaleLabels: SCALE_LABELS,
  },
  {
    key: "high_remuneration",
    label: "High salary or remuneration relative to others in the field",
    uscisCriterion: "Command of a high salary or other significantly high remuneration relative to others in the field",
    helpText: "Compensation demonstrably above peers, supported by comparative wage data.",
    answerScale: { min: 0, max: 3 },
    scaleLabels: SCALE_LABELS,
  },
];

// Section 6 defaults — first matching rule wins, ordered by tier strength.
const DEFAULT_TIER_RULES = [
  { tier: "A", minCriteriaMet: 4, maxCriteriaMet: null, pathwayString: "O-1A now; EB-1A in parallel", routing: "direct_priority" },
  { tier: "B", minCriteriaMet: 3, maxCriteriaMet: 3, pathwayString: "O-1A with targeted evidence development", routing: "direct" },
  { tier: "C", minCriteriaMet: 2, maxCriteriaMet: 2, pathwayString: "EB-2 NIW assessment + 6–12 month evidence plan", routing: "strategy_queue" },
  { tier: "D", minCriteriaMet: 0, maxCriteriaMet: 1, pathwayString: "EB-2 NIW / L-1A / E-2 pathway review", routing: "nurture" },
];

const DEFAULT_ALTERNATIVE_PATHWAYS = ["EB-2 NIW", "L-1A", "E-2"];

const DEFAULT_SCORING_CONFIG = {
  visaPathway: DEFAULT_VISA_PATHWAY,
  filingStrengthThreshold: 2,
  developableThreshold: 1,
  tierRules: DEFAULT_TIER_RULES,
  criterionWeights: {},
};

// ── Generic per-visa content (all visas other than O-1A/EB-1A) ──────────
// Every entry uses the same 0–3 answerScale/scaleLabels as the extraordinary-
// ability set above, and the same proportional tier-rule shape rescaled to
// 5 questions instead of 8, so scoring.service.js/recommendation.service.js/
// Lead.js/quiz.routes.js (all of which assume a 0–3 integer scale) need no
// changes to support any of these.

function buildCriteriaQuestions(items) {
  return items.map(({ key, label, helpText }) => ({
    key,
    label,
    helpText,
    answerScale: { min: 0, max: 3 },
    scaleLabels: SCALE_LABELS,
  }));
}

function buildTierRules(shortName) {
  return [
    { tier: "A", minCriteriaMet: 4, maxCriteriaMet: null, pathwayString: `${shortName} looks well-supported on paper — ready to move toward a full case review and filing`, routing: "direct_priority" },
    { tier: "B", minCriteriaMet: 3, maxCriteriaMet: 3, pathwayString: `${shortName} is promising, with some evidence or documentation gaps worth closing first`, routing: "direct" },
    { tier: "C", minCriteriaMet: 2, maxCriteriaMet: 2, pathwayString: `${shortName} eligibility looks uncertain — a deeper case review is recommended before filing`, routing: "strategy_queue" },
    { tier: "D", minCriteriaMet: 0, maxCriteriaMet: 1, pathwayString: `${shortName} doesn't look like a strong fit yet — consider the alternative pathways below`, routing: "nurture" },
  ];
}

const VISA_QUIZ_CONTENT = {
  "H-1B": {
    criteriaQuestions: buildCriteriaQuestions([
      { key: "specialtyJobOffer", label: "A U.S. employer job offer requiring at least a bachelor's degree in a specific specialty field", helpText: "The role itself must normally require specialized, degree-level knowledge." },
      { key: "degreeMatch", label: "A bachelor's degree (or higher, or equivalent work experience) directly related to that specialty", helpText: "USCIS looks for a direct, demonstrable link between your credential and the job duties." },
      { key: "employerSponsorship", label: "An employer willing and able to sponsor and file the H-1B petition", helpText: "The employer, not you, is the official H-1B petitioner." },
      { key: "capStrategy", label: "A plan for the annual H-1B registration/lottery, or a cap-exempt employer (university, nonprofit/government research)", helpText: "Most H-1Bs are subject to the annual lottery unless the employer is cap-exempt." },
      { key: "statusMaintenance", label: "Current lawful status that would allow an in-country change of status, if applicable", helpText: "Relevant if you're already in the U.S. in another status." },
    ]),
    tierRules: buildTierRules("H-1B"),
    alternativePathways: ["O-1A", "TN", "L-1A"],
  },
  "L-1A": {
    criteriaQuestions: buildCriteriaQuestions([
      { key: "qualifyingRelationship", label: "A qualifying relationship between the U.S. company and a related foreign company (parent, subsidiary, affiliate, or branch)", helpText: "Ownership/control ties between the two entities must be documented." },
      { key: "oneYearForeignEmployment", label: "At least 1 continuous year of employment abroad with that related company within the last 3 years", helpText: "This foreign employment must directly precede the transfer." },
      { key: "managerialRole", label: "A managerial or executive role abroad, and a managerial/executive role lined up in the U.S.", helpText: "Both the foreign and U.S. roles need to be genuinely managerial/executive in nature, not just titled that way." },
      { key: "companyOperational", label: "The U.S. entity is (or will be) doing business and can support a managerial/executive position", helpText: "New-office petitions face extra scrutiny on this point." },
      { key: "transferPlan", label: "A clear plan/timeline for the intracompany transfer, including any new-office considerations", helpText: "Especially important if the U.S. office is newly established." },
    ]),
    tierRules: buildTierRules("L-1A"),
    alternativePathways: ["L-1B", "E-2", "O-1A"],
  },
  "L-1B": {
    criteriaQuestions: buildCriteriaQuestions([
      { key: "qualifyingRelationship", label: "A qualifying relationship between the U.S. company and a related foreign company", helpText: "Ownership/control ties between the two entities must be documented." },
      { key: "oneYearForeignEmployment", label: "At least 1 continuous year of employment abroad with that related company within the last 3 years", helpText: "This foreign employment must directly precede the transfer." },
      { key: "specializedKnowledge", label: "Specialized knowledge of the company's products, processes, or procedures that is uncommon in the industry", helpText: "The knowledge should be genuinely proprietary/advanced, not just general industry experience." },
      { key: "roleContinuity", label: "A specialized-knowledge role lined up in the U.S. that relies on that same expertise", helpText: "The U.S. role should clearly require the specialized knowledge gained abroad." },
      { key: "companyOperational", label: "The U.S. entity is (or will be) doing business and can support the position", helpText: "New-office petitions face extra scrutiny on this point." },
    ]),
    tierRules: buildTierRules("L-1B"),
    alternativePathways: ["L-1A", "H-1B"],
  },
  "TN": {
    criteriaQuestions: buildCriteriaQuestions([
      { key: "citizenship", label: "Canadian or Mexican citizenship", helpText: "TN status is only available to citizens of Canada or Mexico under USMCA." },
      { key: "tnOccupationMatch", label: "A job offer in an occupation listed under the USMCA professional occupations list", helpText: "Only specific listed professions qualify (e.g., engineer, scientist, accountant)." },
      { key: "credentialMatch", label: "The specific degree or license required for that occupation under USMCA", helpText: "Each listed occupation has its own minimum credential requirement." },
      { key: "jobOfferInHand", label: "A concrete U.S. job offer or contract, not just general interest", helpText: "TN requires an actual prearranged position, not speculative job-seeking." },
      { key: "temporaryIntent", label: "Intent to work temporarily rather than immigrate permanently", helpText: "TN is a nonimmigrant category and requires temporary intent." },
    ]),
    tierRules: buildTierRules("TN"),
    alternativePathways: ["H-1B", "E-3"],
  },
  "E-3": {
    criteriaQuestions: buildCriteriaQuestions([
      { key: "citizenship", label: "Australian citizenship", helpText: "E-3 status is only available to Australian citizens." },
      { key: "specialtyJobOffer", label: "A U.S. employer job offer in a specialty occupation requiring a bachelor's degree or higher", helpText: "Similar specialty-occupation standard to H-1B." },
      { key: "degreeMatch", label: "A degree (or equivalent) directly related to that specialty occupation", helpText: "USCIS looks for a direct link between your credential and the job duties." },
      { key: "laborConditionApplication", label: "An employer willing to file a Labor Condition Application (LCA) in support", helpText: "E-3 requires a certified LCA, similar to H-1B." },
      { key: "temporaryIntent", label: "Intent to work temporarily rather than immigrate permanently", helpText: "E-3 is a nonimmigrant category and requires temporary intent." },
    ]),
    tierRules: buildTierRules("E-3"),
    alternativePathways: ["H-1B", "TN"],
  },

  "K-1": {
    criteriaQuestions: buildCriteriaQuestions([
      { key: "genuineRelationship", label: "A genuine, bona fide relationship with your U.S. citizen fiancé(e)", helpText: "USCIS looks for real evidence of an ongoing relationship, not just a formal engagement." },
      { key: "metInPerson", label: "Met in person within the last 2 years (or qualify for a waiver/exemption)", helpText: "Limited exemptions exist for cultural/religious/hardship reasons." },
      { key: "intentToMarry", label: "Both parties are free to marry and intend to marry within 90 days of entry to the U.S.", helpText: "Any prior marriages must be legally terminated." },
      { key: "sponsorEligibility", label: "The U.S. citizen sponsor meets the income and domicile requirements", helpText: "The petitioner must generally meet 100% of the federal poverty guidelines and maintain a U.S. domicile." },
      { key: "priorHistoryResolved", label: "No unresolved legal barriers to marriage (e.g., prior divorces finalized)", helpText: "Documentation of prior marriage terminations is required." },
    ]),
    tierRules: buildTierRules("K-1"),
    alternativePathways: ["K-3", "CR-1/IR-1"],
  },
  "K-3": {
    criteriaQuestions: buildCriteriaQuestions([
      { key: "validMarriage", label: "A legally valid marriage to a U.S. citizen", helpText: "The marriage must be recognized as valid where it took place." },
      { key: "pendingImmigrantPetition", label: "An I-130 immigrant petition already filed (or about to be filed) on the spouse's behalf", helpText: "K-3 is designed to shorten separation while the underlying I-130 processes." },
      { key: "genuineRelationship", label: "Evidence of a genuine, bona fide marital relationship (not solely for immigration benefit)", helpText: "Joint documentation (finances, residence, photos) helps establish this." },
      { key: "sponsorEligibility", label: "The U.S. citizen spouse meets the income/domicile requirements to sponsor", helpText: "Similar affidavit-of-support requirements as other family petitions." },
      { key: "noDisqualifyingIssues", label: "No unresolved immigration violations, criminal issues, or prior fraud findings", helpText: "These can significantly complicate or delay a case." },
    ]),
    tierRules: buildTierRules("K-3"),
    alternativePathways: ["CR-1/IR-1", "K-1"],
  },
  "CR-1/IR-1": {
    criteriaQuestions: buildCriteriaQuestions([
      { key: "validMarriage", label: "A legally valid, bona fide marriage to a U.S. citizen", helpText: "The marriage must be recognized as valid where it took place." },
      { key: "genuineRelationship", label: "Documented evidence of a genuine shared life (joint finances, residence, etc.)", helpText: "This is the core focus of consular/USCIS review for spousal cases." },
      { key: "sponsorEligibility", label: "The U.S. citizen spouse meets income/domicile sponsorship requirements", helpText: "An affidavit of support is required from the petitioning spouse." },
      { key: "admissibility", label: "No immigration, criminal, or health-related admissibility concerns", helpText: "Certain grounds of inadmissibility may require a waiver." },
      { key: "lengthOfMarriage", label: "Clarity on whether the marriage is under or over 2 years old at approval (affects conditional vs. permanent green card)", helpText: "Marriages under 2 years old at approval result in a 2-year conditional green card." },
    ]),
    tierRules: buildTierRules("CR-1/IR-1"),
    alternativePathways: ["K-3", "F2A"],
  },
  "F2A": {
    criteriaQuestions: buildCriteriaQuestions([
      { key: "qualifyingRelationship", label: "A legally valid marriage to (or being the unmarried child under 21 of) a lawful permanent resident", helpText: "F2A covers spouses and unmarried minor children of green card holders." },
      { key: "priorityDateAwareness", label: "Awareness that F2A has a visa-category wait time (not immediate like a U.S. citizen's spouse)", helpText: "Unlike immediate relatives of U.S. citizens, F2A is subject to annual numerical limits." },
      { key: "genuineRelationship", label: "Evidence of a genuine, bona fide relationship or parent-child relationship", helpText: "Documentation supporting the family relationship is required." },
      { key: "sponsorEligibility", label: "The green-card-holder petitioner meets the income/domicile requirements", helpText: "An affidavit of support is required from the petitioning permanent resident." },
      { key: "admissibility", label: "No immigration, criminal, or health-related admissibility concerns", helpText: "Certain grounds of inadmissibility may require a waiver." },
    ]),
    tierRules: buildTierRules("F2A"),
    alternativePathways: ["CR-1/IR-1"],
  },

  "EB-1B": {
    criteriaQuestions: buildCriteriaQuestions([
      { key: "internationalRecognition", label: "International recognition as outstanding in a specific academic field", helpText: "This is a high bar — recognition should extend beyond your own institution." },
      { key: "yearsExperience", label: "At least 3 years of teaching or research experience in that academic field", helpText: "Experience gained during doctoral study can sometimes count." },
      { key: "qualifyingOffer", label: "A qualifying offer: a tenured/tenure-track teaching position, or a permanent research position", helpText: "The offering institution/employer must meet specific requirements." },
      { key: "evidenceOfOutstanding", label: "Documented evidence such as major awards, published work, judging others' work, or original contributions", helpText: "USCIS requires evidence meeting at least 2 of several regulatory criteria." },
      { key: "employerSponsorship", label: "An employer prepared to file the petition (no labor certification required for this category)", helpText: "EB-1B skips the PERM labor certification step required for EB-2/EB-3." },
    ]),
    tierRules: buildTierRules("EB-1B"),
    alternativePathways: ["EB-1A", "EB-2 NIW"],
  },
  "EB-1C": {
    criteriaQuestions: buildCriteriaQuestions([
      { key: "qualifyingRelationship", label: "A qualifying relationship between the U.S. company and a related foreign company", helpText: "Ownership/control ties between the two entities must be documented." },
      { key: "oneYearForeignEmployment", label: "At least 1 year of employment abroad in a managerial/executive capacity with that related company within the last 3 years", helpText: "This foreign employment must directly precede the transfer/petition." },
      { key: "managerialRoleUS", label: "A managerial or executive role in the U.S. company", helpText: "The U.S. role must be genuinely managerial/executive, not just titled that way." },
      { key: "companyOperational", label: "The U.S. entity has been doing business for at least 1 year and can support the role", helpText: "This is generally a higher bar than the L-1A new-office standard." },
      { key: "employerSponsorship", label: "An employer prepared to file the immigrant petition (no labor certification required)", helpText: "EB-1C skips the PERM labor certification step required for EB-2/EB-3." },
    ]),
    tierRules: buildTierRules("EB-1C"),
    alternativePathways: ["L-1A", "EB-1A"],
  },
  "EB-2": {
    criteriaQuestions: buildCriteriaQuestions([
      { key: "advancedDegreeOrExceptional", label: "An advanced degree (master's+) or a bachelor's plus 5 years of progressive experience, OR exceptional ability in your field", helpText: "Either route independently qualifies for the EB-2 classification." },
      { key: "jobOfferAndLaborCert", label: "A qualifying job offer and employer willing to pursue PERM labor certification (unless pursuing an NIW)", helpText: "Standard EB-2 requires labor certification; the NIW route waives this." },
      { key: "fieldRelevance", label: "The role/job offer matches your degree or exceptional-ability field", helpText: "A mismatch between the job and your credentials weakens the case." },
      { key: "evidenceOfAbility", label: "Documented evidence of exceptional ability (licenses, salary, membership, recognition), if not relying on the advanced degree route", helpText: "Only needed if qualifying via the exceptional-ability standard." },
      { key: "priorityDateOutlook", label: "Awareness of current EB-2 visa bulletin wait times for your country of chargeability", helpText: "Wait times vary significantly by country of birth." },
    ]),
    tierRules: buildTierRules("EB-2"),
    alternativePathways: ["EB-2 NIW", "EB-3"],
  },
  "EB-2 NIW": {
    criteriaQuestions: buildCriteriaQuestions([
      { key: "substantialMerit", label: "Work of substantial merit and national importance to the U.S.", helpText: "The first prong of the Dhanasar national-interest-waiver test." },
      { key: "wellPositioned", label: "You are well positioned to advance that proposed endeavor (based on your record, education, track record)", helpText: "The second prong — evidence you're positioned to succeed, not just that the idea is good." },
      { key: "benefitOfWaiver", label: "It would benefit the U.S. to waive the standard job offer/labor certification requirement in your case", helpText: "The third prong — a balancing test in your favor." },
      { key: "advancedDegreeOrExceptional", label: "An advanced degree (or bachelor's + progressive experience) or exceptional ability underlying the endeavor", helpText: "The baseline EB-2 classification requirement still applies before the waiver analysis." },
      { key: "evidenceOfImpact", label: "Documented evidence of impact: publications, funding, adoption of your work, media coverage, etc.", helpText: "Concrete, verifiable evidence carries far more weight than a narrative alone." },
    ]),
    tierRules: buildTierRules("EB-2 NIW"),
    alternativePathways: ["EB-2", "EB-1A"],
  },
  "EB-3": {
    criteriaQuestions: buildCriteriaQuestions([
      { key: "qualifyingJobOffer", label: "A permanent, full-time U.S. job offer from an employer willing to sponsor", helpText: "The offer must be genuine and permanent, not temporary." },
      { key: "laborCertification", label: "Employer willing to pursue PERM labor certification (test of the U.S. labor market)", helpText: "This step confirms no qualified, willing U.S. workers are available." },
      { key: "educationExperienceMatch", label: "A bachelor's degree, or 2+ years of training/experience, matching the job requirements", helpText: "The exact sub-category (skilled worker, professional, other worker) depends on this." },
      { key: "wageMatch", label: "The offered wage meets or exceeds the prevailing wage for the role/location", helpText: "Required as part of the labor certification process." },
      { key: "priorityDateOutlook", label: "Awareness of current EB-3 visa bulletin wait times for your country of chargeability", helpText: "Wait times vary significantly by country of birth." },
    ]),
    tierRules: buildTierRules("EB-3"),
    alternativePathways: ["EB-2", "H-1B"],
  },

  "E-2": {
    criteriaQuestions: buildCriteriaQuestions([
      { key: "treatyCountryNationality", label: "Nationality of a country that has an E-2 treaty with the U.S.", helpText: "E-2 eligibility is tied to your nationality, not your country of residence." },
      { key: "substantialInvestment", label: "A substantial capital investment already made or actively being made in a real U.S. business", helpText: "\"Substantial\" is judged relative to the total cost of that particular business." },
      { key: "atRiskCapital", label: "The invested funds are your own (or lawfully sourced), and are genuinely at risk in the business", helpText: "Funds must be irrevocably committed and lawfully obtained." },
      { key: "operatingBusiness", label: "The business is a real, operating commercial enterprise (not idle/speculative investment)", helpText: "Passive investments like undeveloped land or stocks generally don't qualify." },
      { key: "developAndDirect", label: "You will develop and direct the business (majority ownership or operational control)", helpText: "E-2 requires more than a passive financial stake." },
    ]),
    tierRules: buildTierRules("E-2"),
    alternativePathways: ["EB-5", "L-1A"],
  },
  "EB-5": {
    criteriaQuestions: buildCriteriaQuestions([
      { key: "qualifyingInvestment", label: "A qualifying capital investment amount ($800k in a targeted employment/rural area, or $1.05M otherwise)", helpText: "Amounts are set by statute and adjusted periodically." },
      { key: "lawfulSourceOfFunds", label: "Documented lawful source and path of the invested funds", helpText: "This is one of the most heavily scrutinized parts of an EB-5 case." },
      { key: "jobCreation", label: "The investment will create at least 10 full-time jobs for qualifying U.S. workers", helpText: "Direct or indirect (regional center) job creation, depending on the investment structure." },
      { key: "newCommercialEnterprise", label: "Investment in a new commercial enterprise (or qualifying troubled business/regional center project)", helpText: "Specific structuring rules apply depending on the type of enterprise." },
      { key: "activeInvolvement", label: "Understanding of the direct vs. regional-center investment path and the involvement each requires", helpText: "Regional center investments generally require less day-to-day involvement." },
    ]),
    tierRules: buildTierRules("EB-5"),
    alternativePathways: ["E-2"],
  },

  "O-1B": {
    criteriaQuestions: buildCriteriaQuestions([
      { key: "extraordinaryAchievement", label: "A record of extraordinary achievement (arts) or extraordinary achievement/recognition (motion picture/TV) in your field", helpText: "Motion picture/TV uses a slightly higher \"extraordinary achievement\" standard than other arts." },
      { key: "criticalAcclaim", label: "Evidence such as lead/starring roles, critical reviews, major awards, or significant box-office/ratings success", helpText: "USCIS requires evidence meeting several of a defined set of regulatory criteria." },
      { key: "recognitionByOthers", label: "Recognition from organizations, critics, or industry experts in your field", helpText: "Independent, third-party recognition carries more weight than self-promotion." },
      { key: "usEngagement", label: "A specific U.S. project, engagement, or itinerary that requires your expertise", helpText: "O-1 status is tied to a specific event, project, or itinerary, not open-ended employment." },
      { key: "petitionerAgent", label: "A U.S. employer, agent, or petitioner able to file on your behalf", helpText: "Individuals cannot self-petition for O-1 status." },
    ]),
    tierRules: buildTierRules("O-1B"),
    alternativePathways: ["O-1A", "P-1"],
  },
  "P-1": {
    criteriaQuestions: buildCriteriaQuestions([
      { key: "internationalRecognition", label: "International recognition as an athlete, or as part of an entertainment group with sustained international acclaim", helpText: "P-1 has a somewhat lower bar than O-1 but still requires real international recognition." },
      { key: "eventOrEngagement", label: "A specific competition, event, or engagement in the U.S. requiring your participation", helpText: "P-1 status is tied to a specific event/season, not open-ended employment." },
      { key: "recordOfAchievement", label: "Documented record of significant achievement (rankings, awards, media coverage)", helpText: "Objective evidence (rankings, contracts, press) is weighted heavily." },
      { key: "teamOrGroupContinuity", label: "For groups: at least 75% of members have been part of the group for 1+ year (if applicable)", helpText: "Only relevant for entertainment groups, not individual athletes." },
      { key: "petitionerSponsor", label: "A U.S. employer, team, or sponsoring organization able to file the petition", helpText: "Individuals cannot self-petition for P-1 status." },
    ]),
    tierRules: buildTierRules("P-1"),
    alternativePathways: ["O-1A", "O-1B"],
  },

  "B-1/B-2": {
    criteriaQuestions: buildCriteriaQuestions([
      { key: "visitPurpose", label: "A clear, temporary purpose for the visit (tourism, family visit, or specific short-term business activities)", helpText: "B-1 covers business activities; B-2 covers tourism/pleasure/medical visits." },
      { key: "noUSEmployment", label: "No intent to work or be employed by a U.S. entity during the stay", helpText: "B-1/B-2 does not authorize U.S. employment." },
      { key: "tiesAbroad", label: "Strong ties abroad (job, family, property) showing intent to return home", helpText: "This is central to overcoming the presumption of immigrant intent." },
      { key: "financialSupport", label: "Sufficient funds to cover the trip without unauthorized U.S. employment", helpText: "You should be able to show how the trip will be funded." },
      { key: "admissibility", label: "No prior overstays, visa violations, or admissibility concerns", helpText: "Prior violations can significantly affect future visa applications." },
    ]),
    tierRules: buildTierRules("B-1/B-2"),
    alternativePathways: ["J-1"],
  },
  "J-1": {
    criteriaQuestions: buildCriteriaQuestions([
      { key: "sponsorProgram", label: "Acceptance into a designated exchange visitor program (student, scholar, intern, trainee, au pair, etc.)", helpText: "J-1 requires sponsorship by a State Department-designated program sponsor." },
      { key: "programFit", label: "The program category matches your actual activity (research, study, training, etc.)", helpText: "Mismatches between the category and actual activity can cause compliance issues." },
      { key: "fundingProof", label: "Proof of sufficient funding for the program duration (personal, sponsor, or program funding)", helpText: "Program sponsors typically require documented proof of funding." },
      { key: "homeResidencyAwareness", label: "Awareness of whether the 2-year home-residency requirement applies to your category/funding source", helpText: "Some J-1 categories/funding sources trigger a 2-year home-country residency requirement before certain future visas/green cards." },
      { key: "tiesAbroad", label: "Intent and ties supporting return home after the program (unless pursuing a subsequent lawful status change)", helpText: "J-1 is a temporary exchange category by design." },
    ]),
    tierRules: buildTierRules("J-1"),
    alternativePathways: ["F-1"],
  },
  "F-1": {
    criteriaQuestions: buildCriteriaQuestions([
      { key: "schoolAcceptance", label: "Acceptance (Form I-20) from a SEVP-certified U.S. school for a full course of study", helpText: "The school must be SEVP-certified to issue the I-20 needed for F-1 status." },
      { key: "financialProof", label: "Proof of sufficient funds to cover tuition and living expenses for at least the first year", helpText: "This is required to obtain the I-20 and for the visa interview." },
      { key: "academicPreparation", label: "Academic/English-language preparation appropriate for the intended program", helpText: "Schools may require standardized test scores or English proficiency evidence." },
      { key: "tiesAbroad", label: "Ties abroad and intent to depart after completing studies (or transitioning status lawfully)", helpText: "F-1 requires nonimmigrant intent at the time of application, similar to other temporary categories." },
      { key: "priorStatusHistory", label: "No prior status violations or unauthorized employment issues", helpText: "Prior violations can complicate a new F-1 application." },
    ]),
    tierRules: buildTierRules("F-1"),
    alternativePathways: ["J-1", "H-1B"],
  },

  "O-1A": {
    criteriaQuestions: DEFAULT_CRITERIA_QUESTIONS,
    tierRules: DEFAULT_TIER_RULES,
    alternativePathways: DEFAULT_ALTERNATIVE_PATHWAYS,
  },
  "EB-1A": {
    criteriaQuestions: DEFAULT_CRITERIA_QUESTIONS,
    tierRules: DEFAULT_TIER_RULES,
    alternativePathways: DEFAULT_ALTERNATIVE_PATHWAYS,
  },
};

module.exports = {
  DEFAULT_VISA_PATHWAY,
  VISA_PATHWAYS,
  DEFAULT_PROFILE_QUESTIONS,
  DEFAULT_CRITERIA_QUESTIONS,
  DEFAULT_TIER_RULES,
  DEFAULT_ALTERNATIVE_PATHWAYS,
  DEFAULT_SCORING_CONFIG,
  VISA_QUIZ_CONTENT,
};
