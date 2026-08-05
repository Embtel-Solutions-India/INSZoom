const passportExtractor = require("./passport-extractor.service");
const resumeExtractor = require("./resume-extractor.service");
const awardExtractor = require("./award-extractor.service");
const genericExtractor = require("./generic-extractor.service");

const EVIDENCE_HINTS = {
  publication: ["Publication", "Authorship"],
  award: ["Award"],
  patent: ["Patent", "Original Contribution"],
  membership: ["Membership"],
  press: ["Press"],
  salary: ["High Salary"],
  recommendation_letter: ["Critical Role", "Original Contribution"],
  degree: ["Education"],
  transcript: ["Education"],
  credential_evaluation: ["Education"],
  i20: ["Immigration", "Education"],
  passport: ["Identity"],
  driver_license: ["Identity"],
  visa: ["Immigration"],
  i94: ["Immigration"],
  lca: ["Employment"],
  resume: ["Employment", "Education"],
  birth_certificate: ["Civil", "Identity"],
  marriage_certificate: ["Civil"],
  divorce_certificate: ["Civil", "Legal"],
  employment_letter: ["Employment"],
  experience_letter: ["Employment"],
  employment_verification_letter: ["Employment"],
  offer_letter: ["Employment"],
  paystub: ["Employment", "Financial"],
  w2: ["Employment", "Financial"],
  tax_return: ["Financial"],
  bank_statement: ["Financial"],
  business_registration: ["Business"],
  business_license: ["Business"],
  articles_of_incorporation: ["Business"],
  organizational_chart: ["Business"],
  financial_statement: ["Business", "Financial"],
  company_document: ["Business"],
  uscis_notice: ["Immigration"],
  previous_uscis_form: ["Immigration"],
  approval_notice: ["Immigration"],
  rfe: ["Immigration", "Legal"],
  noid: ["Immigration", "Legal"],
  medical_examination: ["Medical"],
  police_certificate: ["Legal"],
  photograph: ["Identity"],
  supporting_evidence: ["Supporting Evidence"],
};

const EXTRACTOR_MAP = {
  passport: passportExtractor,
  resume: resumeExtractor,
  award: awardExtractor,
  visa: genericExtractor,
  i94: genericExtractor,
  driver_license: genericExtractor,
  degree: genericExtractor,
  lca: genericExtractor,
  i20: genericExtractor,
  credential_evaluation: genericExtractor,
  transcript: genericExtractor,
  publication: genericExtractor,
  patent: genericExtractor,
  membership: genericExtractor,
  press: genericExtractor,
  salary: genericExtractor,
  recommendation_letter: genericExtractor,
  birth_certificate: genericExtractor,
  marriage_certificate: genericExtractor,
  divorce_certificate: genericExtractor,
  employment_letter: genericExtractor,
  experience_letter: genericExtractor,
  employment_verification_letter: genericExtractor,
  offer_letter: genericExtractor,
  paystub: genericExtractor,
  w2: genericExtractor,
  tax_return: genericExtractor,
  bank_statement: genericExtractor,
  business_registration: genericExtractor,
  business_license: genericExtractor,
  articles_of_incorporation: genericExtractor,
  organizational_chart: genericExtractor,
  financial_statement: genericExtractor,
  company_document: genericExtractor,
  uscis_notice: genericExtractor,
  previous_uscis_form: genericExtractor,
  approval_notice: genericExtractor,
  rfe: genericExtractor,
  noid: genericExtractor,
  medical_examination: genericExtractor,
  police_certificate: genericExtractor,
  photograph: genericExtractor,
  supporting_evidence: genericExtractor,
  other: genericExtractor,
};

function getExtractor(documentType) {
  return EXTRACTOR_MAP[documentType] || genericExtractor;
}

async function extract({ document, buffer, documentType }) {
  const extractor = getExtractor(documentType);
  return extractor.extract({ document, buffer, documentType });
}

module.exports = {
  EVIDENCE_HINTS,
  EXTRACTOR_MAP,
  extract,
  getExtractor,
};
