// Mapping rules for a form whose PARTS belong to different people (petition forms: "Parts 1-4 are the petitioner, Part 5 the beneficiary"). A person decides which parts belong
// to which party (config/partyFormSpecs.js); this service does the rest by code:
//   - every box is placed in its Part / Section by the printed headings (PartLocatorService),
//   - a box's fact is recognised from its own name AND label (family name, date of birth, street, "Name of the Petitioner", ...), the same way for every form,
//   - inside one party's parts only the FIRST occurrence of each fact in reading order is mapped (the person's own block; later repeats - other names used, a spouse, a second
//     address - are somebody else's and are left to the case manager),
//   - a block that belongs to somebody else (a recruiter, a joint employer, an employer abroad) is never mapped, whatever party the section was given to,
//   - an address is taken from ONE block (the first street box and the boxes that follow it), never mixed from two.
// Pure: (template fields, part of each box, the spec) -> rules in the partyFieldRules.js shape. Nothing is guessed: a box whose name says nothing recognisable stays blank.
const R = (to, stems, options = {}) => ({ to, stems: [].concat(stems), ...options });

const NOT_THE_PERSON = /attorney|certifier|authorized|prepar|interpret|represent|signat|barcode|pdf417|bar ?number|statebar|additional|carrier|officer|decision/i;
// a block about somebody (or somewhere) else: its boxes look like the petitioner's own (a family name, a street) but are not
const OTHER_BLOCK_LABEL = /recruit|joint[ -]?employer|third[ -]?party|abroad|outside the united states|subject'?s name|spouse|parent|child|dependent|co-?sponsor|witness|physician/i;
const SKIP_TYPES = new Set(["checkbox", "radio", "signature", "button", "dropdown_multi"]);

// the fact a box names, from its own name with the Part / Section / Line / Item markers removed
function tokenOf(stem) {
  // markers are removed on the ORIGINAL spelling: "Line10DateofBirth" -> "DateofBirth" (a lower-case line suffix such as the "a" of "Line3aFamilyName" is only a suffix when a new
  // word starts right after it), and only then is the rest lower-cased. A supplement's own prefix before the Line marker ("TASupLine5_Email", "HSupLine2_FamilyName") is dropped too.
  let text = String(stem || "").replace(/^(?:part|pt|p|sec|section|s)\d+(?=[A-Za-z_])/i, "").replace(/^pg\d+/i, "").replace(/^_+/, "");
  const afterLine = /^.*Line\d+[a-z]?_(.+)$/.exec(text);
  if (afterLine) text = afterLine[1];
  text = text.replace(/^(?:Line|line|Item|item)\d+(?:[a-z](?=[A-Z_]|$))?/, "").replace(/^(?:Line|line|Item|item)(?=[A-Z_])/, "").replace(/^_+/, "");
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
  // a trailing digit is only the form's own box counter (DaytimePhoneNumber3, ...1_Part8); USCIS also calls the mobile number the "safe" phone
  ["mobilePhone", /^(mobile(tele)?phone(number)?|safephonenumber)\d*(part\d+)?$/],
  ["phone", /^(daytime)?(tele)?phone(number)?\d*(part\d+)?$/],
  // an organisation filing as the petitioner: its name and EIN (applied to a petitioner group only - never to a beneficiary or a joint sponsor). A bare "tax number" is NOT an EIN (it is
  // often the individual taxpayer number, ITIN).
  ["name", /^(companyororgname|companyororganizationname|companyname|organizationname|nameofcompany|nameoforganization)$/],
  ["ein", /^(ein|irstaxnumber|federaltaxnumber|employeridentificationnumber)$/],
  ["ADDR.line1", /^(streetnumname|streetnumbername|streetnumberandname|street|streetnumandname|streetname)$/],
  ["ADDR.line2", /^aptsteflr(number)?$/],
  ["ADDR.city", /^(cityortown|citytown|city)$/],
  ["ADDR.state", /^state$/],
  ["ADDR.zip", /^(zipcode|zip)$/],
  ["ADDR.country", /^country$/],
];

// A supplement's header boxes are often named like a person's name box (Line1_FamilyName) but LABELLED for the whole petitioner / beneficiary ("Item 1: Enter Name of the Petitioner").
// The label decides, so the organisation's name never lands in a family-name box.
const PETITIONER_NAME_LABEL = /(name of (the )?(petitioner|employer)|(petitioner|employer)'?s? (full |printed )?name)/i;
const BENEFICIARY_NAME_LABEL = /(name of (the )?beneficiary|beneficiary'?s? (full )?name)/i;

function factOf(stem, label) {
  const text = String(label || "");
  if (PETITIONER_NAME_LABEL.test(text) && !OTHER_BLOCK_LABEL.test(text)) return "name";
  if (BENEFICIARY_NAME_LABEL.test(text) && !OTHER_BLOCK_LABEL.test(text)) return "fullName";
  const token = tokenOf(stem);
  for (const [fact, pattern] of FACTS) if (pattern.test(token)) return fact;
  // a box called just "Number" is the unit number when its label says so (I-134 "Enter the Apartment, Suite, or Floor Number")
  if (token === "number" && /apartment|suite|floor/i.test(text)) return "ADDR.line2";
  // a name box called just "Name" (I-821D "P1_Line3a_Name"): its own label says which part of the name it is
  if (token === "name") for (const [fact, , labelPattern] of FACTS) if (labelPattern && labelPattern.test(text)) return fact;
  return null;
}

const COMPANY_FACTS = new Set(["name", "ein"]); // only for a plain petitioner group
const BENEFICIARY_ONLY_FACTS = new Set(["fullName"]); // only for a plain beneficiary group
// a joint sponsor keeps ONE composite address answer ("mailingAddress"); the form's boxes are cut from it by the "address" transform
const ADDRESS_PART = { "ADDR.line1": "street", "ADDR.line2": "unitNumber", "ADDR.city": "city", "ADDR.state": "state", "ADDR.zip": "zip", "ADDR.country": "country" };
const FULL_NAME = { type: "concat", fields: ["beneficiary.firstName", "beneficiary.middleName", "beneficiary.lastName"], separator: " " };

// the canonical path of a fact for a party, or - with `root` (e.g. "petitioner.jointSponsor") - for the person that root stands for
function pathFor(party, fact, root) {
  if (root) {
    if (fact.startsWith("ADDR.")) return `${root}.mailingAddress`;
    return `${root}.${fact}`;
  }
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
const TRANSFORMS = { phone: { type: "phone" }, mobilePhone: { type: "phone" }, countryOfBirth: { type: "country" }, countryOfCitizenship: { type: "country" }, "ADDR.country": { type: "country" }, fullName: FULL_NAME };

// the printed item a box belongs to: "Item 7: ..." in its label, else the "Line7" of its name
function itemOf(field) {
  const fromLabel = /^\s*Item\s+(\d+)/i.exec(String(field.label || ""));
  if (fromLabel) return Number(fromLabel[1]);
  const fromName = /Line(\d+)/i.exec(stemOf(field.targetPdfField));
  return fromName ? Number(fromName[1]) : null;
}

/**
 * fields: MappingGraphService.getTemplateFields(template) ({ targetPdfField, label, type, pageNumber, y? }), in any order; partOf(field) -> part / section number (0 = above the first heading).
 * groups: [{ party: "petitioner" | "beneficiary", parts: [1, 2, ...], fallbackParty?, root?, fallbackRoot?, facts? }] - `root` ("petitioner.jointSponsor") maps the group to that person instead of
 * the party itself, `fallbackRoot` ("beneficiary.jointSponsor") is read when the first is blank, `facts` limits the group to those facts (a supplement header: names only).
 * Returns { rules, report } - report lists, per group, what was mapped and which parts held nothing recognisable.
 */
function inferRulesForParties(fields, partOf, groups, { order } = {}) {
  const flow = (a, b) => (order ? order(a, b) : (a.pageNumber || 0) - (b.pageNumber || 0) || topOf(b) - topOf(a));
  const candidates = fields
    .map((field) => ({ field, stem: stemOf(field.targetPdfField), part: partOf(field) }))
    .filter(({ field, stem }) => stem && !SKIP_TYPES.has(String(field.type || "").toLowerCase()) && !NOT_THE_PERSON.test(`${stem} ${field.label || ""}`));
  // an item whose boxes say they belong to somebody else (a recruiter, a joint employer, an employer abroad) is blocked as a WHOLE within its part: its family-name / street boxes have no such
  // wording of their own
  const blocked = new Set(candidates.filter(({ field }) => OTHER_BLOCK_LABEL.test(String(field.label || ""))).map((item) => `${item.part}|${itemOf(item.field)}`));
  const usable = candidates
    .filter((item) => !OTHER_BLOCK_LABEL.test(String(item.field.label || "")) && !(itemOf(item.field) !== null && blocked.has(`${item.part}|${itemOf(item.field)}`)))
    .sort((a, b) => flow(a.field, b.field));
  const rules = [];
  const report = [];
  for (const group of groups) {
    const companyOk = group.party === "petitioner" && !group.root;
    const beneficiaryOk = group.party === "beneficiary" && !group.root;
    const inParts = usable
      .filter((item) => group.parts.includes(item.part))
      .map((item) => ({ ...item, fact: factOf(item.stem, item.field.label) }))
      .filter((item) => item.fact && (companyOk || !COMPANY_FACTS.has(item.fact)) && (beneficiaryOk || !BENEFICIARY_ONLY_FACTS.has(item.fact)) && (!group.facts || group.facts.includes(item.fact)));
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
      const to = pathFor(group.party, fact, group.root);
      const transform = group.root && ADDRESS_PART[fact] ? { type: "address", part: ADDRESS_PART[fact] } : TRANSFORMS[fact];
      const fallback = group.fallbackRoot ? pathFor(group.party, fact, group.fallbackRoot) : group.fallbackParty ? pathFor(group.fallbackParty, fact) : undefined;
      // pinned to the EXACT box: several boxes of one page can share a name (the I-129 supplements repeat Line1_FamilyName for the petitioner's and the beneficiary's header), and a rule that
      // matched them all would put the petitioner's name in the beneficiary's box
      const boxIndex = /\[(\d+)\]$/.exec(String(item.field.targetPdfField || ""));
      const options = { pages: [item.field.pageNumber], ...(boxIndex ? { index: Number(boxIndex[1]) } : {}), ...(transform ? { transform } : {}), ...(fallback ? { fallback } : {}) };
      rules.push(R(to, item.stem, options));
      mapped.push(to);
    }
    report.push({ party: group.party, root: group.root, parts: group.parts, mapped, partsWithBoxes: [...new Set(inParts.map((item) => item.part))] });
  }
  return { rules, report };
}

module.exports = { inferRulesForParties, factOf, tokenOf, pathFor, itemOf };
