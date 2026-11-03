// What the AI is told for one batch of petition pages (Petition AI Review). Pure: builds strings and the response schema, no I/O.
// Page numbers are asked RELATIVE to the slice (1 = first page sent); code maps them to the real page, so the model never has to know them.
const { SEVERITIES, CATEGORIES, LIMITS } = require("./constants");

// Gemini response schema (OpenAPI subset). Kept small: every field the validator needs and nothing else.
const RESPONSE_SCHEMA = Object.freeze({
  type: "OBJECT",
  properties: {
    findings: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          page: { type: "INTEGER" },
          severity: { type: "STRING", enum: SEVERITIES },
          category: { type: "STRING", enum: CATEGORIES },
          excerpt: { type: "STRING" },
          found: { type: "STRING" },
          suggestion: { type: "STRING" },
          confidence: { type: "NUMBER" },
        },
        required: ["page", "severity", "category", "excerpt", "found"],
      },
    },
    unreadablePages: { type: "ARRAY", items: { type: "INTEGER" } },
  },
  required: ["findings"],
});

const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();

/** Case reference facts as plain lines. facts: { caseNumber, visaType, people: [{ role, name }], companies: [{ role, name }] } */
function factLines(facts = {}) {
  const lines = [];
  if (clean(facts.caseNumber)) lines.push(`Case number: ${clean(facts.caseNumber)}`);
  if (clean(facts.visaType)) lines.push(`Visa / petition type: ${clean(facts.visaType)}`);
  for (const person of facts.people || []) if (clean(person?.name)) lines.push(`${clean(person.role) || "Person"}: ${clean(person.name)}`);
  for (const company of facts.companies || []) if (clean(company?.name)) lines.push(`${clean(company.role) || "Company"}: ${clean(company.name)}`);
  return lines;
}

/** The fixed instruction for every call of a scan (rules + case facts). */
function buildSystemInstruction({ facts, ruleSet }) {
  const facts_ = factLines(facts);
  const addresses = (ruleSet?.expectedAddresses || []).map((item) => `- ${item.label ? `${item.label}: ` : ""}${item.address}`);
  const rules = (ruleSet?.rules || []).map((rule) => `- [${rule.severity}] ${rule.text}`);
  const terms = ruleSet?.prohibitedTerms?.length ? `Prohibited terms (flag each use as company_rule): ${ruleSet.prohibitedTerms.join("; ")}` : "";
  return [
    "You proof-read pages of a U.S. immigration petition prepared by Immiglance before it is filed. Report only real problems on the pages you are given.",
    "",
    "CASE REFERENCE FACTS (the truth to check against):",
    ...(facts_.length ? facts_ : ["(none supplied - do not report name or case-number mismatches)"]),
    "",
    "EXPECTED ADDRESSES (FedEx / filing / mailing):",
    ...(addresses.length ? addresses : ["(none supplied - do not report address mismatches)"]),
    "",
    "COMPANY RULES:",
    ...rules,
    terms,
    ruleSet?.disclaimer ? `Required company disclaimer wording (for reference): ${clean(ruleSet.disclaimer)}` : "",
    "",
    "CATEGORIES: typo (spelling, repeated or missing words, wrong punctuation), wrong_name (a name that disagrees with the case facts), address_mismatch, company_rule, consistency (dates, numbers, receipt numbers or facts that contradict each other), unreadable_page (the page is blank, illegible or cannot be read).",
    "SEVERITY: error = must be fixed before filing; warning = should be checked; info = minor style point.",
    "",
    "OUTPUT: strict JSON matching the schema. `page` is the page number WITHIN THE PAGES YOU WERE GIVEN (1 = the first page given). `excerpt` quotes the exact text with the problem (short). `found` says what is wrong, `suggestion` what it should be. `confidence` is 0-1.",
    `Report at most ${LIMITS.maxFindingsPerBatch} findings. If a page has no problem, report nothing for it. Never invent text that is not on the page. Legal citations, form numbers and quoted USCIS language are not typos.`,
  ].filter((line) => line !== "").join("\n");
}

/** The per-batch request text. mode "pdf": the slice is attached; mode "text": the extracted text of each page is included. */
function buildBatchPrompt({ batch, mode, pagesText = [] }) {
  const count = batch.to - batch.from + 1;
  if (mode === "pdf") return `The attached PDF holds ${count} page(s) of the petition (pages 1-${count} of this attachment). Review every page and return the findings JSON.`;
  const body = pagesText.map((item, index) => `=== PAGE ${index + 1} ===\n${String(item?.text || "").trim() || "(no text could be extracted from this page)"}`).join("\n\n");
  return `Below is the extracted text of ${count} page(s) of the petition (layout and images are lost; do not report formatting). Review every page and return the findings JSON.\n\n${body}`;
}

/** Second chance after an answer that was not valid JSON. */
function buildRepairPrompt(badText) {
  return `Your previous answer was not valid JSON for the required schema. Return ONLY the corrected JSON object {"findings":[...],"unreadablePages":[...]} with no other text. Previous answer:\n${String(badText || "").slice(0, 6000)}`;
}

module.exports = { RESPONSE_SCHEMA, buildSystemInstruction, buildBatchPrompt, buildRepairPrompt, factLines };
