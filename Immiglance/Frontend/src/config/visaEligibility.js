/**
 * Visa-specific eligibility questionnaires (goal 5).
 * Each question is a weighted yes/no — a "yes" contributes its full weight to
 * the match score. computeMatch() returns a 0–100 percentage.
 *
 * Keys use the visa ids from visaConfig.js VISA_DETAILS. Visa ids without a
 * dedicated set fall back to GENERIC_ELIGIBILITY.
 */

export const GENERIC_ELIGIBILITY = {
  intro: "Answer a few questions to estimate your eligibility match.",
  questions: [
    { id: "passport",   text: "Do you hold a valid passport?", weight: 2 },
    { id: "funds",      text: "Can you show sufficient funds or financial support?", weight: 2 },
    { id: "ties",       text: "Do you have strong ties or a clear purpose for your stay?", weight: 2 },
    { id: "no_bars",    text: "Are you free of prior visa denials or immigration violations?", weight: 1 },
  ],
};

export const VISA_ELIGIBILITY = {
  "H-1B": {
    intro: "Answer a few H-1B questions to estimate your eligibility match.",
    questions: [
      { id: "degree",    text: "Do you have at least a bachelor's degree (or equivalent experience)?", weight: 3 },
      { id: "specialty", text: "Is the role a specialty occupation that requires that degree?", weight: 3 },
      { id: "sponsor",   text: "Do you have a U.S. employer willing to sponsor and file an LCA?", weight: 3 },
      { id: "wage",      text: "Will the position pay at or above the prevailing wage?", weight: 1 },
    ],
  },
  "L-1": {
    intro: "Answer a few L-1 questions to estimate your eligibility match.",
    questions: [
      { id: "employed",  text: "Have you worked for the company abroad for 1+ continuous year in the last 3 years?", weight: 3 },
      { id: "related",   text: "Is the U.S. entity a parent, branch, subsidiary, or affiliate of that company?", weight: 3 },
      { id: "role",      text: "Is your role managerial, executive, or specialized-knowledge?", weight: 2 },
      { id: "transfer",  text: "Is the company transferring you to a U.S. office?", weight: 2 },
    ],
  },
  "O-1": {
    intro: "Answer a few O-1 questions to estimate your eligibility match.",
    questions: [
      { id: "awards",    text: "Have you received nationally or internationally recognized awards?", weight: 3 },
      { id: "press",     text: "Has your work been featured in major media or publications?", weight: 2 },
      { id: "judging",   text: "Have you judged or reviewed the work of others in your field?", weight: 2 },
      { id: "letters",   text: "Can you obtain expert recommendation letters?", weight: 2 },
      { id: "salary",    text: "Do you command a high salary relative to peers?", weight: 1 },
    ],
  },
  "TN": {
    intro: "Answer a few TN questions to estimate your eligibility match.",
    questions: [
      { id: "citizen",   text: "Are you a citizen of Canada or Mexico?", weight: 3 },
      { id: "profession",text: "Is your occupation on the USMCA/NAFTA professionals list?", weight: 3 },
      { id: "degree",    text: "Do you have the required degree or credentials for that profession?", weight: 2 },
      { id: "offer",     text: "Do you have a U.S. job offer for that role?", weight: 2 },
    ],
  },
  "E-2": {
    intro: "Answer a few E-2 questions to estimate your eligibility match.",
    questions: [
      { id: "treaty",    text: "Are you a national of a country with an E-2 treaty with the U.S.?", weight: 3 },
      { id: "invest",    text: "Have you invested (or are investing) a substantial amount in a U.S. business?", weight: 3 },
      { id: "control",   text: "Will you own at least 50% or have operational control of the business?", weight: 2 },
      { id: "source",    text: "Can you document the lawful source of the invested funds?", weight: 2 },
    ],
  },
  "E-1": {
    intro: "Answer a few E-1 questions to estimate your eligibility match.",
    questions: [
      { id: "treaty",    text: "Are you a national of an E-1 treaty trader country?", weight: 3 },
      { id: "trade",     text: "Is there substantial and continuous trade between the U.S. and that country?", weight: 3 },
      { id: "majority",  text: "Is more than 50% of that trade between the U.S. and the treaty country?", weight: 2 },
    ],
  },
  "F-1": {
    intro: "Answer a few F-1 questions to estimate your eligibility match.",
    questions: [
      { id: "admit",     text: "Have you been admitted to a SEVP-approved school (I-20 issued)?", weight: 3 },
      { id: "funds",     text: "Can you show funds to cover tuition and living expenses?", weight: 3 },
      { id: "ties",      text: "Do you intend to return home after your studies (non-immigrant intent)?", weight: 2 },
      { id: "english",   text: "Do you meet the program's English proficiency requirements?", weight: 1 },
    ],
  },
  "J-1": {
    intro: "Answer a few J-1 questions to estimate your eligibility match.",
    questions: [
      { id: "sponsor",   text: "Do you have a designated J-1 program sponsor (DS-2019)?", weight: 3 },
      { id: "purpose",   text: "Is your purpose exchange, research, or training?", weight: 2 },
      { id: "funds",     text: "Can you show adequate financial support?", weight: 2 },
      { id: "english",   text: "Do you have sufficient English skills for the program?", weight: 1 },
    ],
  },
  "M-1": {
    intro: "Answer a few M-1 questions to estimate your eligibility match.",
    questions: [
      { id: "admit",     text: "Have you been accepted to a vocational/technical program (I-20)?", weight: 3 },
      { id: "funds",     text: "Can you fund the full course and your stay?", weight: 3 },
      { id: "ties",      text: "Do you intend to return home after the program?", weight: 2 },
    ],
  },
  "K-1": {
    intro: "Answer a few K-1 questions to estimate your eligibility match.",
    questions: [
      { id: "uscitizen", text: "Is your partner a U.S. citizen?", weight: 3 },
      { id: "met",       text: "Have you met in person within the last 2 years?", weight: 3 },
      { id: "intend",    text: "Do you intend to marry within 90 days of entry?", weight: 2 },
      { id: "free",      text: "Are both of you legally free to marry?", weight: 2 },
    ],
  },
  "IR-1/CR-1": {
    intro: "Answer a few spouse green-card questions to estimate your match.",
    questions: [
      { id: "married",   text: "Are you legally married to a U.S. citizen?", weight: 3 },
      { id: "bonafide",  text: "Can you prove a bona fide (genuine) marriage?", weight: 3 },
      { id: "support",   text: "Can your spouse meet the income requirement (I-864)?", weight: 2 },
    ],
  },
  "F2A": {
    intro: "Answer a few F2A questions to estimate your eligibility match.",
    questions: [
      { id: "sponsor",   text: "Is your sponsor a lawful permanent resident (green card holder)?", weight: 3 },
      { id: "relation",  text: "Are you their spouse or unmarried child under 21?", weight: 3 },
      { id: "support",   text: "Can the sponsor meet the income requirement?", weight: 2 },
    ],
  },
  "F2B": {
    intro: "Answer a few F2B questions to estimate your eligibility match.",
    questions: [
      { id: "sponsor",   text: "Is your sponsor a lawful permanent resident?", weight: 3 },
      { id: "relation",  text: "Are you their unmarried child aged 21 or older?", weight: 3 },
      { id: "support",   text: "Can the sponsor meet the income requirement?", weight: 2 },
    ],
  },
  "B-1/B-2": {
    intro: "Answer a few visitor visa questions to estimate your eligibility match.",
    questions: [
      { id: "purpose",   text: "Is your trip for tourism, medical care, or short business?", weight: 2 },
      { id: "funds",     text: "Can you fund the entire trip?", weight: 2 },
      { id: "ties",      text: "Do you have strong ties to your home country?", weight: 3 },
      { id: "return",    text: "Do you intend to return after a temporary stay?", weight: 2 },
    ],
  },
  "ESTA": {
    intro: "Answer a few ESTA questions to estimate your eligibility match.",
    questions: [
      { id: "vwp",       text: "Are you a citizen of a Visa Waiver Program country?", weight: 3 },
      { id: "short",     text: "Is your stay 90 days or fewer for tourism/business?", weight: 2 },
      { id: "epassport", text: "Do you have an e-passport (with a chip)?", weight: 2 },
      { id: "no_bars",   text: "Are you free of prior visa denials or VWP ineligibilities?", weight: 1 },
    ],
  },
  "H-2B": {
    intro: "Answer a few H-2B questions to estimate your eligibility match.",
    questions: [
      { id: "offer",     text: "Do you have a U.S. employer offering temporary/seasonal non-agricultural work?", weight: 3 },
      { id: "temporary", text: "Is the need temporary (one-time, seasonal, peak-load, or intermittent)?", weight: 3 },
      { id: "country",   text: "Are you from an H-2B-eligible country?", weight: 2 },
    ],
  },
  "EB-1": {
    intro: "Answer a few EB-1 questions to estimate your eligibility match.",
    questions: [
      { id: "acclaim",   text: "Do you have sustained national or international acclaim?", weight: 3 },
      { id: "evidence",  text: "Can you meet at least 3 of the 10 EB-1A criteria (or outstanding professor proof)?", weight: 3 },
      { id: "continue",  text: "Will you continue working in your area of expertise in the U.S.?", weight: 2 },
    ],
  },
  "EB-2 NIW": {
    intro: "Answer a few EB-2 NIW questions to estimate your eligibility match.",
    questions: [
      { id: "advanced",  text: "Do you hold an advanced degree or have exceptional ability?", weight: 3 },
      { id: "merit",     text: "Does your work have substantial merit and national importance?", weight: 3 },
      { id: "position",  text: "Are you well positioned to advance that work?", weight: 2 },
      { id: "waive",     text: "Would it benefit the U.S. to waive the job-offer/labor-cert requirement?", weight: 1 },
    ],
  },
  "EB-3": {
    intro: "Answer a few EB-3 questions to estimate your eligibility match.",
    questions: [
      { id: "offer",     text: "Do you have a permanent, full-time U.S. job offer?", weight: 3 },
      { id: "perm",      text: "Is the employer willing to sponsor a PERM labor certification?", weight: 3 },
      { id: "qualify",   text: "Do you meet the education/experience the role requires?", weight: 2 },
    ],
  },
  "EB-5": {
    intro: "Answer a few EB-5 questions to estimate your eligibility match.",
    questions: [
      { id: "capital",   text: "Can you invest the required capital ($800k TEA / $1.05M standard)?", weight: 3 },
      { id: "source",    text: "Can you document the lawful source of the funds?", weight: 3 },
      { id: "jobs",      text: "Will the investment create at least 10 full-time U.S. jobs?", weight: 2 },
      { id: "atrisk",    text: "Are the funds genuinely at risk in the enterprise?", weight: 1 },
    ],
  },
};

/** Get the eligibility set for a visa id (falls back to generic). */
export function getEligibility(visaType) {
  return VISA_ELIGIBILITY[visaType] || GENERIC_ELIGIBILITY;
}

/** Compute a 0–100 match percentage from yes/no answers keyed by question id. */
export function computeMatch(visaType, answers = {}) {
  const set = getEligibility(visaType);
  const totalWeight = set.questions.reduce((sum, q) => sum + q.weight, 0);
  if (!totalWeight) return 0;
  const earned = set.questions.reduce(
    (sum, q) => sum + (answers[q.id] === "yes" ? q.weight : 0),
    0
  );
  return Math.round((earned / totalWeight) * 100);
}
