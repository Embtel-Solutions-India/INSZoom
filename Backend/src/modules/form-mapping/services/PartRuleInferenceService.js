// Mapping rules for a form whose PARTS belong to different people (petition forms: "Parts 1-4 are the petitioner, Part 5 the beneficiary"). A person decides which parts belong
// to which party (config/partyFormSpecs.js); this service does the rest by code:
//   - every box is placed in its Part by the printed headings (PartLocatorService),
//   - a box's fact is recognised from its own name (family name, date of birth, street, ...), the same way for every form,
//   - inside one party's parts only the FIRST occurrence of each fact in reading order is mapped (the person's own block; later repeats - other names used, a spouse, a second
//     address - are somebody else's and are left to the case manager),
//   - an address is taken from ONE block (the first street box and the boxes that follow it), never mixed from two.
// Pure: (template fields, part of each box, the spec) -> rules in the partyFieldRules.js shape. Nothing is guessed: a box whose name says nothing recognisable stays blank.
const R = (to, stems, options = {}) => ({ to, stems: [].concat(stems), ...options });

const NOT_THE_PERSON = /attorney|certifier|authorized|prepar|interpret|represent|signat|barcode|pdf417|bar ?number|statebar|additional|carrier|officer|decision/i;
const SKIP_TYPES = new Set(["checkbox", "radio", "signature", "button", "dropdown_multi"]);

// the fact a box names, from its own name with the Part / Line / Item markers removed
function tokenOf(stem) {
  // markers are removed on the ORIGINAL spelling: "Line10DateofBirth" -> "DateofBirth" (a lower-case line suffix such as the "a" of "Line3aFamilyName" is only a suffix when a new
  // word starts right after it), and only then is the rest lower-cased
  const text = String(stem || "").replace(/^(?:part|pt|p)\d+(?=[A-Za-z_])/i, "").replace(/^pg\d+/i, "").replace(/^_+/, "").replace(/^(?:Line|line|Item|item)\d+(?:[a-z](?=[A-Z_]|$))?/, "").replace(/^(?:Line|line|Item|item)(?=[A-Z_])/, "").replace(/^_+/, "");
  return text.toLowerCase().replace(/[^a-z0-9]/g, "");
}

// [fact, pattern on the token, optional label pattern when the name is just "Name"]
const FACTS = [
  ["lastName", /(familyname|lastname|surname)$/, /family name/i],
  ["firstName", /(givenname|firstname)$/, /given name/i],
  ["middleName", /middlename$/, /middle name/i],
  ["dateOfBirth", /^(dateofbirth|dob|birthdate)$/],
  ["countryOfBirth", /^country(of)?birth$/],
  ["placeOfBirth", /^placeofbirth$/],
  ["countryOfCitizenship", /^(countryof?citz(ornat)?|countryofcitizenship|citizenship|countryofnationality|countryofcitzornat)$/],
  ["aNumber", /(anumber|aliennumber|alienregistrationnumber)$/],
  ["ssn", /^(ssn|socialsecuritynumber)$/],
  ["email", /^e?mail(address)?$/],
  ["mobilePhone", /^mobile(tele)?phone(number)?$/],
  ["phone", /^(daytime)?(tele)?phone(number)?$/],
  ["ADDR.line1", /^(streetnumname|streetnumbername|streetnumberandname|street|streetnumandname)$/],
  ["ADDR.line2", /^aptsteflr(number)?$/],
  ["ADDR.city", /^(cityortown|citytown|city)$/],
  ["ADDR.state", /^state$/],
  ["ADDR.zip", /^(zipcode|zip)$/],
  ["ADDR.country", /^country$/],
];

function factOf(stem, label) {
  const token = tokenOf(stem);
  for (const [fact, pattern] of FACTS) if (pattern.test(token)) return fact;
  // a name box called just "Name" (I-821D "P1_Line3a_Name"): its own label says which part of the name it is
  if (token === "name") for (const [fact, , labelPattern] of FACTS) if (labelPattern && labelPattern.test(String(label || ""))) return fact;
  return null;
}

// the canonical path of a fact for a party
function pathFor(party, fact) {
  if (fact.startsWith("ADDR.")) {
    const part = fact.slice(5);
    return party === "petitioner" ? `petitioner.address.${part}` : `beneficiary.usMailingAddress.${part}`;
  }
  if (fact === "aNumber") return party === "petitioner" ? "petitioner.aNumber" : "beneficiary.alienRegistrationNumber";
  if (fact === "phone") return party === "petitioner" ? "petitioner.phone" : "beneficiary.primaryPhone";
  return `${party}.${fact}`;
}

const topOf = (field) => field.coordinates?.boundingBox?.top ?? field.y ?? 0;
const ADDRESS_BAND_PT = 110;
const stemOf = (pdfField) => String(pdfField || "").split(".").pop().replace(/\[\d+\]$/, "");
const TRANSFORMS = { phone: { type: "phone" }, mobilePhone: { type: "phone" }, countryOfBirth: { type: "country" }, countryOfCitizenship: { type: "country" }, "ADDR.country": { type: "country" } };

/**
 * fields: MappingGraphService.getTemplateFields(template) ({ targetPdfField, label, type, pageNumber, y? }), in any order; partOf(field) -> part number (0 = unknown).
 * groups: [{ party: "petitioner" | "beneficiary", parts: [1, 2, ...], fallbackParty?: "petitioner" | "beneficiary" }].
 * Returns { rules, report } - report lists, per group, what was mapped and which parts held nothing recognisable.
 */
function inferRulesForParties(fields, partOf, groups, { order } = {}) {
  const flow = (a, b) => (order ? order(a, b) : (a.pageNumber || 0) - (b.pageNumber || 0) || topOf(b) - topOf(a));
  const usable = fields
    .map((field) => ({ field, stem: stemOf(field.targetPdfField), part: partOf(field) }))
    .filter(({ field, stem }) => stem && !SKIP_TYPES.has(String(field.type || "").toLowerCase()) && !NOT_THE_PERSON.test(`${stem} ${field.label || ""}`))
    .sort((a, b) => flow(a.field, b.field));
  const rules = [];
  const report = [];
  for (const group of groups) {
    const inParts = usable.filter((item) => group.parts.includes(item.part)).map((item) => ({ ...item, fact: factOf(item.stem, item.field.label) })).filter((item) => item.fact);
    const taken = new Map(); // fact -> the first box of that fact in reading order
    for (const item of inParts) if (!item.fact.startsWith("ADDR.") && !taken.has(item.fact)) taken.set(item.fact, item);
    // one address block: the first street box, and for every other address fact the box NEAREST to it on the same page (within ADDRESS_BAND_PT vertically) - never a box from
    // another address on the form
    const street = inParts.find((item) => item.fact === "ADDR.line1");
    if (street) {
      taken.set("ADDR.line1", street);
      const near = (item) => Math.abs(topOf(item.field) - topOf(street.field)) * 2 + Math.abs((item.field.coordinates?.boundingBox?.left ?? 0) - (street.field.coordinates?.boundingBox?.left ?? 0));
      const block = inParts.filter((item) => item.fact.startsWith("ADDR.") && item !== street && item.field.pageNumber === street.field.pageNumber && Math.abs(topOf(item.field) - topOf(street.field)) <= ADDRESS_BAND_PT);
      for (const item of block.sort((a, b) => near(a) - near(b))) if (!taken.has(item.fact)) taken.set(item.fact, item);
    }
    const mapped = [];
    for (const [fact, item] of taken) {
      const to = pathFor(group.party, fact);
      const options = { pages: [item.field.pageNumber], ...(TRANSFORMS[fact] ? { transform: TRANSFORMS[fact] } : {}), ...(group.fallbackParty ? { fallback: pathFor(group.fallbackParty, fact) } : {}) };
      rules.push(R(to, item.stem, options));
      mapped.push(to);
    }
    report.push({ party: group.party, parts: group.parts, mapped, partsWithBoxes: [...new Set(inParts.map((item) => item.part))] });
  }
  return { rules, report };
}

module.exports = { inferRulesForParties, factOf, tokenOf, pathFor };
