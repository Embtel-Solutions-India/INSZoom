// Seeds active PackageDefinitions. Idempotent (upsert by `key`) — safe to
// re-run; never deletes or archives a definition it doesn't recognize.
// node src/modules/petition/seeds/packageDefinitions.seed.js
const mongoose = require("mongoose");
const env = require("../../../config/env");
const PackageDefinition = require("../../../models/PackageDefinition");

// Letter templates below are heading-only skeletons per the H-1B petition
// structure spec: headings/subheadings + «auto» structural merge fields
// (dates, addresses, names, job title, worksite, enclosure index, signature
// block) only - the system must NEVER auto-generate paragraph prose/legal
// argument. BLANK() renders the empty, editable body region the case
// manager fills in via the petition viewer's saveLetter before finalizing;
// it survives html-to-docx untouched (self-contained inline style, no
// dependency on an external <style> block) so the downloadable .docx opens
// with the heading in place and visible empty space to type under it.
function BLANK(hint) {
  return `<p style="border:1px dashed #94a3b8;padding:10px 12px;color:#64748b;font-style:italic;margin:6px 0 16px;">[${hint}]</p>`;
}

const H1B_COVER_LETTER = `<div>
  <p>{{filing.addressHtml}}</p>
  <p><strong>Re: Petition for a Nonimmigrant Worker (Form I-129) — {{beneficiary.fullName}}, H-1B Specialty Occupation Worker</strong><br/>
  Petitioner: {{petitioner.legalName}}<br/>
  Beneficiary: {{beneficiary.fullName}}</p>
  <p>Dear USCIS Officer,</p>
  <p>Enclosed please find the following documents in connection with the above case:</p>
  <ul>
    <li>Filing fee(s) as required for this classification</li>
    <li>Form G-1145, e-Notification of Application/Petition Acceptance</li>
    <li>Form I-129, Petition for a Nonimmigrant Worker, with H Classification Supplement and H-1B and H-1B1 Data Collection and Filing Fee Exemption Supplement</li>
    <li>Certified Labor Condition Application (ETA-9035) and prevailing wage documentation</li>
  </ul>
  <p><strong>Index of Exhibits</strong></p>
  {{exhibitIndexHtml}}
  ${BLANK("Optional: add a custom note for this filing here")}
  <p>Respectfully submitted,</p>
  <p>{{petitioner.signatoryName}}<br/>{{petitioner.signatoryTitle}}<br/>{{petitioner.legalName}}</p>
</div>`;

const H1B_SUPPORT_LETTER = `<div>
  <p>{{filing.addressHtml}}</p>
  <p><strong>Re: {{beneficiary.fullName}} — H-1B Specialty Occupation Support Letter</strong><br/>
  Petitioner: {{petitioner.legalName}}<br/>
  Beneficiary: {{beneficiary.fullName}}</p>
  <p>Dear USCIS Officer,</p>
  ${BLANK("Opening paragraph")}
  <h3>Petitioner Information</h3>
  ${BLANK("Describe the petitioning organization")}
  <h4>Offerings</h4>
  ${BLANK("Optional: describe products/services offered")}
  <h3>Beneficiary Information</h3>
  ${BLANK("Describe the beneficiary")}
  <h3>Educational Qualifications</h3>
  ${BLANK("Describe the beneficiary's educational qualifications")}
  <h3>Technical Skills</h3>
  ${BLANK("Describe the beneficiary's technical skills")}
  <h3>Summary of Beneficiary's Experience</h3>
  ${BLANK("Summarize the beneficiary's relevant experience")}
  <h3>Itinerary</h3>
  <table border="1" cellspacing="0" cellpadding="6" style="border-collapse:collapse;width:100%;">
    <thead><tr><th>Employer</th><th>Worksite / Project</th><th>Start</th><th>End</th></tr></thead>
    <tbody><tr><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td></tr></tbody>
  </table>
  <h3>Employer-Employee Relationship</h3>
  ${BLANK("Describe the right to control the beneficiary's work")}
  <h3>Specialty Occupation</h3>
  ${BLANK("Describe why the position is a specialty occupation")}
  <h3>Employer Certifications</h3>
  ${BLANK("Employer certification statements")}
  <p>Sincerely,</p>
  <p>{{petitioner.signatoryName}}<br/>{{petitioner.signatoryTitle}}</p>
</div>`;

const H1B_POSITION_DESCRIPTION = `<div>
  <p><strong>TO WHOM IT MAY CONCERN</strong></p>
  <p>Position Description – {{job.title}}</p>
  <p>Name of Employee: {{beneficiary.fullName}}</p>
  <h4>Skills Required</h4>
  ${BLANK("List required skills")}
  <h4>Duties</h4>
  <table border="1" cellspacing="0" cellpadding="6" style="border-collapse:collapse;width:100%;">
    <thead><tr><th>Approximate % Time</th><th>Job Duties</th></tr></thead>
    <tbody><tr><td>&nbsp;</td><td>&nbsp;</td></tr></tbody>
  </table>
  <p>Duties performed at: {{job.worksite.address}}</p>
  ${BLANK("Control/supervision statements")}
  <p>{{petitioner.signatoryName}}<br/>{{petitioner.signatoryTitle}}</p>
</div>`;

const H1B_ITINERARY = `<div>
  <p><strong>ITINERARY</strong></p>
  <p>Name of employee: {{beneficiary.fullName}} &nbsp; Work-site address: {{job.worksite.address}} &nbsp; Job title: {{job.title}}</p>
  <h4>Tasks</h4>
  ${BLANK("List tasks")}
  <p>Start day of work: &nbsp; End day of work: &nbsp;</p>
  ${BLANK("Supervision/control statement")}
</div>`;

const GENERIC_COVER_LETTER = `<div>
  <p>{{filing.addressHtml}}</p>
  <p>Re: {{case.visaType}} Petition — {{beneficiary.fullName}}</p>
  <p>Dear Officer:</p>
  <p>{{petitioner.legalName}} respectfully submits this petition on behalf of {{beneficiary.fullName}}.</p>
  <h3>Index of Exhibits</h3>
  {{exhibitIndexHtml}}
  <p>Respectfully submitted,</p>
  <p>{{petitioner.signatoryName}}</p>
</div>`;

const DEFINITIONS = [
  {
    key: "H-1B",
    visaType: "H-1B",
    displayName: "H-1B Specialty Occupation Petition",
    status: "active",
    version: 1,
    requiredForms: [{ formCode: "I-129", required: true, supplements: ["H_CLASSIFICATION", "DATA_COLLECTION"] }],
    requiredCertifications: [{ key: "LCA", label: "Certified LCA (ETA-9035)", documentType: "lca_certified", required: true }],
    letterSlots: [
      { key: "support_letter", label: "Support Letter", placement: "front_matter", templateKey: "h1b_support_letter", required: true },
      // Keyed distinctly from exhibitTaxonomy's own "position_description"
      // bucket below (which classifies UPLOADED offer/employment-agreement
      // exhibits, per the spec's own §A item 4 distinction between those
      // uploaded signed docs and this drafted "To Whom It May Concern"
      // skeleton letter) - same key on both would collide in
      // FilingPackageService's pageMap (section vs. exhibit entries keyed
      // by the same string).
      { key: "position_description_letter", label: "Position Description", placement: "front_matter", templateKey: "h1b_position_description", required: true },
      { key: "itinerary", label: "Itinerary", placement: "front_matter", templateKey: "h1b_itinerary", required: true },
      { key: "personal_statement", label: "Personal Statement", placement: "front_matter", templateKey: "", required: false },
      { key: "expert_letter", label: "Expert Opinion Letters", placement: "exhibit", templateKey: "", required: false },
      { key: "reference_letter", label: "Reference Letters", placement: "exhibit", templateKey: "", required: false },
    ],
    exhibitTaxonomy: [
      // H-1B Registration Selection Notice (I-797C) - Phase H6. Static
      // required:false here since exhibitTaxonomy has no per-case
      // conditional concept; PetitionValidationService enforces the real
      // "required only for a New/cap filing" rule directly (mirrors how
      // this same file's own capSelectionNoticeRequired flag is computed).
      { key: "cap_selection_notice", label: "H-1B Registration Selection Notice (I-797C)", documentTypes: ["cap_selection_notice"], required: false, order: 5 },
      { key: "degree", label: "Degree / Diploma", documentTypes: ["degree"], required: true, order: 10 },
      { key: "transcripts", label: "Transcripts", documentTypes: ["transcript"], required: true, order: 20 },
      { key: "credential_eval", label: "Credential Evaluation", documentTypes: ["credential_evaluation"], required: false, order: 30 },
      { key: "resume", label: "Resume", documentTypes: ["resume", "cv"], required: true, order: 40 },
      { key: "passport", label: "Passport Bio Page", documentTypes: ["passport"], required: true, order: 50 },
      { key: "prior_i797", label: "Prior I-797 Approvals", documentTypes: ["approval_notice", "previous_uscis_form"], required: false, order: 60 },
      { key: "company_incorporation", label: "Company Incorporation Documents", documentTypes: ["articles_of_incorporation", "business_registration"], required: true, order: 70 },
      { key: "company_tax", label: "Company Tax Returns", documentTypes: ["tax_return"], required: true, order: 80 },
      { key: "org_chart", label: "Organizational Chart", documentTypes: ["organizational_chart"], required: false, order: 90 },
      { key: "position_description", label: "Position Description", documentTypes: ["employment_letter", "offer_letter"], required: true, order: 100 },
    ],
    templates: [
      { key: "h1b_cover_letter", kind: "cover_letter", format: "html", content: H1B_COVER_LETTER },
      { key: "h1b_support_letter", kind: "letter", format: "html", content: H1B_SUPPORT_LETTER },
      { key: "h1b_position_description", kind: "letter", format: "html", content: H1B_POSITION_DESCRIPTION },
      { key: "h1b_itinerary", kind: "letter", format: "html", content: H1B_ITINERARY },
    ],
    coverLetterTemplateKey: "h1b_cover_letter",
    filingAddressKey: "i129_h1b",
    ordering: {
      presentation: ["cover_letter", "support_letter", "position_description_letter", "itinerary", "personal_statement", "certification", "form", "exhibit"],
      mailing: ["cover_letter", "g28", "form", "certification", "support_letter", "position_description_letter", "itinerary", "exhibit"],
    },
  },
  {
    key: "L-1A",
    visaType: "L-1A",
    displayName: "L-1A Intracompany Transferee Petition",
    status: "active",
    version: 1,
    requiredForms: [{ formCode: "I-129", required: true, supplements: ["L_CLASSIFICATION"] }],
    requiredCertifications: [],
    letterSlots: [
      { key: "support_letter", label: "Support Letter", placement: "front_matter", templateKey: "generic_support_letter", required: true },
      { key: "expert_letter", label: "Expert Opinion Letters", placement: "exhibit", templateKey: "", required: false },
      { key: "reference_letter", label: "Reference Letters", placement: "exhibit", templateKey: "", required: false },
    ],
    exhibitTaxonomy: [
      { key: "passport", label: "Passport Bio Page", documentTypes: ["passport"], required: true, order: 10 },
      { key: "resume", label: "Resume", documentTypes: ["resume", "cv"], required: true, order: 20 },
      { key: "company_incorporation", label: "Company Incorporation Documents (Foreign & U.S.)", documentTypes: ["articles_of_incorporation", "business_registration"], required: true, order: 30 },
      { key: "company_tax", label: "Company Tax Returns", documentTypes: ["tax_return"], required: true, order: 40 },
      { key: "org_chart", label: "Organizational Chart", documentTypes: ["organizational_chart"], required: true, order: 50 },
      { key: "position_description", label: "Position Description", documentTypes: ["employment_letter", "offer_letter"], required: true, order: 60 },
    ],
    templates: [
      { key: "generic_cover_letter", kind: "cover_letter", format: "html", content: GENERIC_COVER_LETTER },
      { key: "generic_support_letter", kind: "letter", format: "html", content: H1B_SUPPORT_LETTER },
    ],
    coverLetterTemplateKey: "generic_cover_letter",
    filingAddressKey: "i129_l1",
    ordering: {
      presentation: ["cover_letter", "support_letter", "personal_statement", "certification", "form", "exhibit"],
      mailing: ["cover_letter", "g28", "form", "certification", "support_letter", "exhibit"],
    },
  },
  {
    key: "O-1",
    visaType: "O-1",
    displayName: "O-1 Extraordinary Ability Petition",
    status: "active",
    version: 1,
    requiredForms: [{ formCode: "I-129", required: true, supplements: ["O_CLASSIFICATION"] }],
    requiredCertifications: [],
    letterSlots: [
      { key: "support_letter", label: "Support Letter", placement: "front_matter", templateKey: "generic_support_letter", required: true },
      { key: "expert_letter", label: "Expert Opinion Letters", placement: "exhibit", templateKey: "", required: true },
      { key: "reference_letter", label: "Reference Letters", placement: "exhibit", templateKey: "", required: true },
    ],
    exhibitTaxonomy: [
      { key: "passport", label: "Passport Bio Page", documentTypes: ["passport"], required: true, order: 10 },
      { key: "resume", label: "Resume / CV", documentTypes: ["resume", "cv"], required: true, order: 20 },
      { key: "awards", label: "Awards", documentTypes: ["award"], required: false, order: 30 },
      { key: "press", label: "Press / Publications", documentTypes: ["press", "publication"], required: false, order: 40 },
      { key: "membership", label: "Membership Evidence", documentTypes: ["membership"], required: false, order: 50 },
      { key: "position_description", label: "Position Description / Itinerary", documentTypes: ["employment_letter", "offer_letter"], required: true, order: 60 },
    ],
    templates: [
      { key: "generic_cover_letter", kind: "cover_letter", format: "html", content: GENERIC_COVER_LETTER },
      { key: "generic_support_letter", kind: "letter", format: "html", content: H1B_SUPPORT_LETTER },
    ],
    coverLetterTemplateKey: "generic_cover_letter",
    filingAddressKey: "i129_o1",
    ordering: {
      presentation: ["cover_letter", "support_letter", "personal_statement", "certification", "form", "exhibit"],
      mailing: ["cover_letter", "g28", "form", "certification", "support_letter", "exhibit"],
    },
  },
  {
    key: "I-130",
    visaType: "IR-1",
    visaTypes: ["IR-1", "CR-1"],
    displayName: "I-130 Petition for Alien Relative",
    status: "active",
    version: 1,
    requiredForms: [{ formCode: "I-130", required: true, supplements: [] }, { formCode: "I-130A", required: false, supplements: [] }],
    requiredCertifications: [],
    letterSlots: [
      { key: "personal_statement", label: "Personal Statement", placement: "front_matter", templateKey: "", required: false },
    ],
    exhibitTaxonomy: [
      { key: "proof_of_status", label: "Proof of Petitioner Status", documentTypes: ["passport", "birth_certificate", "current_visa"], required: true, order: 10 },
      { key: "proof_of_relationship", label: "Proof of Relationship (Marriage/Birth Certificates, Photos, Joint Accounts)", documentTypes: ["marriage_certificate", "birth_certificate", "photo", "financial_document"], required: true, order: 20 },
    ],
    templates: [{ key: "generic_cover_letter", kind: "cover_letter", format: "html", content: GENERIC_COVER_LETTER }],
    coverLetterTemplateKey: "generic_cover_letter",
    filingAddressKey: "i130",
    ordering: {
      presentation: ["cover_letter", "personal_statement", "form", "exhibit"],
      mailing: ["cover_letter", "g28", "form", "exhibit"],
    },
  },
  {
    key: "I-140-EB2",
    visaType: "EB2",
    displayName: "I-140 Petition — EB-2",
    status: "active",
    version: 1,
    requiredForms: [{ formCode: "I-140", required: true, supplements: [] }],
    requiredCertifications: [{ key: "PERM", label: "Approved PERM (ETA-9089)", documentType: "perm_certified", required: true }],
    letterSlots: [
      { key: "support_letter", label: "Support Letter", placement: "front_matter", templateKey: "generic_support_letter", required: false },
    ],
    exhibitTaxonomy: [
      { key: "ability_to_pay", label: "Ability to Pay", documentTypes: ["tax_return", "financial_statement"], required: true, order: 10 },
      { key: "beneficiary_qualifications", label: "Beneficiary Qualifications", documentTypes: ["degree", "transcript", "experience_letter"], required: true, order: 20 },
    ],
    templates: [
      { key: "generic_cover_letter", kind: "cover_letter", format: "html", content: GENERIC_COVER_LETTER },
      { key: "generic_support_letter", kind: "letter", format: "html", content: H1B_SUPPORT_LETTER },
    ],
    coverLetterTemplateKey: "generic_cover_letter",
    filingAddressKey: "i140",
    ordering: {
      presentation: ["cover_letter", "support_letter", "certification", "form", "exhibit"],
      mailing: ["cover_letter", "g28", "form", "certification", "support_letter", "exhibit"],
    },
  },
  {
    key: "I-140-EB3",
    visaType: "EB3",
    displayName: "I-140 Petition — EB-3",
    status: "active",
    version: 1,
    requiredForms: [{ formCode: "I-140", required: true, supplements: [] }],
    requiredCertifications: [{ key: "PERM", label: "Approved PERM (ETA-9089)", documentType: "perm_certified", required: true }],
    letterSlots: [
      { key: "support_letter", label: "Support Letter", placement: "front_matter", templateKey: "generic_support_letter", required: false },
    ],
    exhibitTaxonomy: [
      { key: "ability_to_pay", label: "Ability to Pay", documentTypes: ["tax_return", "financial_statement"], required: true, order: 10 },
      { key: "beneficiary_qualifications", label: "Beneficiary Qualifications", documentTypes: ["degree", "transcript", "experience_letter"], required: true, order: 20 },
    ],
    templates: [
      { key: "generic_cover_letter", kind: "cover_letter", format: "html", content: GENERIC_COVER_LETTER },
      { key: "generic_support_letter", kind: "letter", format: "html", content: H1B_SUPPORT_LETTER },
    ],
    coverLetterTemplateKey: "generic_cover_letter",
    filingAddressKey: "i140",
    ordering: {
      presentation: ["cover_letter", "support_letter", "certification", "form", "exhibit"],
      mailing: ["cover_letter", "g28", "form", "certification", "support_letter", "exhibit"],
    },
  },
];

async function seedPackageDefinitions() {
  const results = [];
  for (const definition of DEFINITIONS) {
    const doc = await PackageDefinition.findOneAndUpdate(
      { key: definition.key },
      { $set: definition },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    results.push({ key: doc.key, id: doc._id });
  }
  console.log("Package definitions seeded:");
  results.forEach((entry) => console.log(`  ${entry.key} (${entry.id})`));
  return results;
}

module.exports = seedPackageDefinitions;

if (require.main === module) {
  mongoose
    .connect(env.mongoUri)
    .then(() => seedPackageDefinitions())
    .then(() => mongoose.disconnect())
    .then(() => process.exit(0))
    .catch((error) => {
      console.error("Failed to seed package definitions:", error);
      process.exit(1);
    });
}
