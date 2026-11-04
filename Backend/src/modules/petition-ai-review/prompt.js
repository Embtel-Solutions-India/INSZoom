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
          section: { type: "STRING" },
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

// Today's date as YYYY-MM-DD (UTC). The model does not know the date by itself: without it, a petition dated last week was reported as
// "far in the future" in the first live scan (2026-11-04). A bad `today` falls back to the real date.
function isoDay(today) {
  const date = today instanceof Date && !Number.isNaN(today.getTime()) ? today : new Date();
  return date.toISOString().slice(0, 10);
}

/** The fixed instruction for every call of a scan (rules + case facts). `today` (optional) is the date the petition is reviewed. */
function buildSystemInstruction({ facts, ruleSet, today = new Date() }) {
  const facts_ = factLines(facts);
  const addresses = (ruleSet?.expectedAddresses || []).map((item) => `- ${item.label ? `${item.label}: ` : ""}${item.address}`);
  const rules = (ruleSet?.rules || []).map((rule) => `- [${rule.severity}] ${rule.text}`);
  const terms = ruleSet?.prohibitedTerms?.length ? `Prohibited terms (flag each use as company_rule): ${ruleSet.prohibitedTerms.join("; ")}` : "";
  return [
    "You proof-read pages of a U.S. immigration petition prepared by Immiglance before it is filed. Report only real problems on the pages you are given.",
    `TODAY'S DATE: ${isoDay(today)}. A petition is normally signed and dated shortly before filing, so dates up to today (and in the next few weeks) are NOT in the future; tax returns and financial statements for the year before this one may already exist. Flag a date only if it is after today by more than a few weeks, or contradicts another date in the petition.`,
    "",
    "CASE REFERENCE FACTS (the truth to check against):",
    ...(facts_.length ? facts_ : ["(none supplied - do not report name or case-number mismatches)"]),
    "",
    "EXPECTED ADDRESSES (FedEx / filing / mailing):",
    ...(addresses.length ? addresses : ["(none supplied - do not report address mismatches)"]),
    "",
    "COMPANY RULES:",
    ...rules,
    ruleSet && !ruleSet.brandCheck && ruleSet.legacyBrandNames?.length
      ? `- The petition is prepared by ${ruleSet.legacyBrandNames.at(-1)} (${ruleSet.legacyBrandNames.slice(0, -1).join(", ")}). That organisation name is CORRECT wherever it appears (preparer, G-28, contact or business name): never report it.`
      : "",
    terms,
    ruleSet?.disclaimer ? `Required company disclaimer wording (for reference): ${clean(ruleSet.disclaimer)}` : "",
    "",
    "CATEGORIES: typo (spelling, repeated or missing words, wrong punctuation), wrong_name (a name that disagrees with the case facts), address_mismatch, company_rule, consistency (dates, numbers, receipt numbers or facts that contradict each other), unreadable_page (the page is blank, illegible or cannot be read).",
    "SEVERITY: error = must be fixed before filing; warning = should be checked; info = minor style point.",
    "",
    "OUTPUT: strict JSON matching the schema. `page` is the page number WITHIN THE PAGES YOU WERE GIVEN (1 = the first page given). `section` names where on the page the problem is, as the page itself labels it (e.g. \"Part 1, Item 2.a\", \"Cover letter - Exhibit list\", \"Employment history\", \"Signature block\"; short). `excerpt` quotes the exact text with the problem (short). `found` says what is wrong, `suggestion` what it should be. `confidence` is 0-1.",
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
