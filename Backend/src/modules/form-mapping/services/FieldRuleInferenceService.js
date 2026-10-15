// Deterministic mapping-rule inference for a form that has no authored rules (partyFieldRules.js). Pure code - a dictionary of USCIS field-name conventions plus
// guards, no AI and no label guessing. It is deliberately CONSERVATIVE: a field is mapped only when its name unambiguously names a personal fact of the filer,
// and anything doubtful is left for the case manager (listed in graph.intentionallyUnmapped) instead of risking a wrong value on the PDF.
//
// Scope: the filer's own identity block (Part 1 / Pt1 / P1 - "Information About You" on USCIS forms), mapped to the generic applicant root beneficiary.*
// (PartyAliasService fills it from person.* for every case type). Never inferred, by design:
//   - addresses (mailing vs physical vs foreign cannot be told apart from the name alone),
//   - anything naming another person (spouse, parent, child, sponsor, employer, attorney, preparer, interpreter, signatory, ...),
//   - signature / date-signed / barcode / checkbox / additional-information / page-part-item number fields,
//   - a second occurrence of the same fact on a later line (e.g. "other names used") - only the first line of each fact is the filer's own.
// A form whose own rules are authored always wins over inference (partyFieldRules.js).
const R = (to, stems, options = {}) => ({ to, stems: [].concat(stems), inferred: true, ...options });

// semantic token (lower-cased, separators removed) -> [canonical path, rule options]
const DICTIONARY = [
  [/^(familyname|lastname|surname)$/, "beneficiary.lastName"],
  [/^(givenname|firstname)$/, "beneficiary.firstName"],
  [/^middlename$/, "beneficiary.middleName"],
  [/^(dateofbirth|dob|birthdate)$/, "beneficiary.dateOfBirth"],
  [/^countryofbirth$/, "beneficiary.countryOfBirth", { transform: { type: "country" } }],
  [/^(countryofcitizenship|countryofnationality|citizenship)$/, "beneficiary.countryOfCitizenship", { transform: { type: "country" } }],
  [/^(alienregistrationnumber|aliennumber|anumber|alienno)$/, "beneficiary.alienRegistrationNumber", { transform: { type: "alienNumber" } }],
  [/^(ssn|socialsecuritynumber)$/, "beneficiary.ssn", { transform: { type: "ssn" } }],
  [/^(uscisonlineacctnumber|uscisonlineaccountnumber|onlineaccountnumber)$/, "beneficiary.uscisOnlineAccountNumber", { transform: { type: "digits" } }],
  [/^(emailaddress|email)$/, "beneficiary.email"],
  [/^(daytimetelephonenumber|daytimephonenumber|applicantdaytimephonenumber|daytimetelephone)\d*$/, "beneficiary.primaryPhone", { transform: { type: "phone" } }],
  [/^(mobiletelephonenumber|mobilephonenumber|applicantmobilephonenumber)\d*$/, "beneficiary.mobilePhone", { transform: { type: "phone" } }],
];

const OTHER_PERSON = /prepar|interpret|attorney|represent|signat|sign|spouse|parent|child|dependent|sponsor|employer|company|organi[sz]ation|petitioner|beneficiary|principal|relative|household|barcode|pdf417|additional|pagenumber|partnumber|itemnumber|other|prior|previous|alias|maiden/i;

const lastSegment = (name) => String(name || "").split(".").pop().replace(/\[\d+\]$/, "");
// "Part1_Line2a_FamilyName" / "Pt1Line2a_FamilyName" / "P2_L2_FamilyName" / "P2_3_FamilyName" / "PtAILine4_LastName" (Part A.I, Roman numeral) ->
// { part: sortable number, line: 2.01, token: "familyname" }
const ROMAN = { I: 1, II: 2, III: 3, IV: 4, V: 5, VI: 6, VII: 7, VIII: 8, IX: 9, X: 10, XI: 11, XII: 12 };
function parse(stem) {
  const parts = stem.split("_");
  // prefix Part|Pt|P, an optional section letter (A, B, ...), then an Arabic or Roman part number that is not glued to more digits / letters of a longer word
  const partMatch = /^(?:Part|Pt|P)([A-Z]?)(\d+|XII|XI|X|IX|VIII|VII|VI|V|IV|III|II|I)(?=Line|Item|L\d|_|\d|$)/.exec(stem) || /^(?:part|pt|p)()(\d+)(?![0-9])/i.exec(stem);
  const number = partMatch ? (/^\d+$/.test(partMatch[2]) ? Number(partMatch[2]) : ROMAN[partMatch[2]]) : NaN;
  const section = partMatch && partMatch[1] ? partMatch[1].charCodeAt(0) - 64 : 0; // Part A.I sorts before Part B.I
  const rest = partMatch ? stem.slice(partMatch[0].length) : stem;
  const lineMatch = /(?:Line|Item|L)0?(\d+)([a-z]?)(?![a-z])/i.exec(rest) || /_(\d+)([a-z]?)_/.exec(stem);
  const token = parts[parts.length - 1].toLowerCase().replace(/[^a-z0-9]/g, "");
  const line = lineMatch ? Number(lineMatch[1]) + (lineMatch[2] ? (lineMatch[2].toLowerCase().charCodeAt(0) - 96) / 100 : 0) : Infinity;
  return { part: Number.isFinite(number) ? section * 100 + number : Infinity, line, token };
}

// template: a USCISFormTemplate (or anything MappingGraphService.getTemplateFields understands). Returns rules in the partyFieldRules.js shape.
// The filer's own block is the LOWEST-numbered part that holds a family-name field (Part 1 on most forms, Part 2 on others); inside it only the first line of
// each fact counts. Part numbers are compared as numbers, so "P10" is never mistaken for "P1".
function inferRules(template, getTemplateFields) {
  const usable = getTemplateFields(template)
    .map((field) => ({ field, stem: lastSegment(field.targetPdfField), type: String(field.type || "").toLowerCase() }))
    .filter(({ stem, type }) => stem && !["checkbox", "radio", "signature", "button", "dropdown"].includes(type) && !OTHER_PERSON.test(stem))
    .map((item) => ({ ...item, ...parse(item.stem) }));
  const identityPart = Math.min(...usable.filter((item) => /^(familyname|lastname|surname)$/.test(item.token) && Number.isFinite(item.part)).map((item) => item.part));
  if (!Number.isFinite(identityPart)) return [];
  const candidates = new Map(); // canonical path -> best { line, stems, options }
  for (const item of usable.filter((entry) => entry.part === identityPart)) {
    const entry = DICTIONARY.find(([pattern]) => pattern.test(item.token));
    if (!entry) continue;
    const [, to, options = {}] = entry;
    const best = candidates.get(to);
    if (!best || item.line < best.line) candidates.set(to, { line: item.line, stems: new Set([item.stem]), options });
    else if (item.line === best.line) best.stems.add(item.stem); // the same line repeated (e.g. on the additional-information page) is the same fact
  }
  return [...candidates.entries()].map(([to, best]) => R(to, [...best.stems], best.options));
}

module.exports = { inferRules, DICTIONARY };
