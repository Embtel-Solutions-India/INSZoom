// Phase 7.8 simulation: the OLD edition of a small, synthetic USCIS-style form built with pdf-lib (labeled synthetic everywhere it is reported; it is not a real USCIS file).
// Flat field names on purpose: pdf-lib mutants set the partial name (see test-utils/editionMutants.js), so hierarchical names would double the path.
//   page 1: identity boxes (some mapped to the canonical profile, some typed by a person only) - page 2: tick boxes, a radio group and a drop-down.
//   Pt1_CountryOfBirth has /MaxLen 8 and Pt1_Notes /MaxLen 5: the product has NO character limit, so answers far longer than that must survive the whole chain.
//   Pt1_ReadOnly carries the read-only flag USCIS sets on boxes its script switches on: it must still accept and keep a value.
const { PDFDocument, PDFName, PDFString, StandardFonts } = require("pdf-lib");

const LABELS = Object.freeze({
  Pt1_FamilyName: "Family Name (Last Name)", Pt1_GivenName: "Given Name (First Name)", Pt1_Dob: "Date of Birth", Pt1_CountryOfBirth: "Country of Birth", Pt1_Notes: "Additional Information",
  Pt1_ReadOnly: "USCIS Reference (switched on by script)", Pt1_Obsolete: "Obsolete Item", Pt2_Married_Yes: "Are you married? Yes", Pt2_Married_No: "Are you married? No", Pt2_Status: "Marital Status", Pt2_Visa: "Visa Classification",
});

const MAPPED_TO = Object.freeze({
  Pt1_FamilyName: "person.lastName",
  Pt1_GivenName: "person.firstName",
  Pt1_Dob: "person.dob",
  Pt1_CountryOfBirth: "person.countryOfBirth",
});

/** The typed answers every synthetic case form carries on the OLD edition, keyed by PDF field name. */
const ANSWERS = Object.freeze({
  Pt1_FamilyName: "Diaz",
  Pt1_GivenName: "Ana",
  Pt1_Dob: "01/02/1990",
  Pt1_CountryOfBirth: `LONG-COUNTRY-${"x".repeat(300)}`,
  Pt1_Notes: `LONG-NOTES-${"n".repeat(600)}`,
  Pt1_ReadOnly: "kept in a read-only-by-USCIS box",
  Pt1_Obsolete: "answer in a box the new edition may drop",
  Pt2_Married_Yes: "Yes",
  Pt2_Status: "Married",
  Pt2_Visa: "H1B",
});

async function buildBaseEdition() {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page1 = doc.addPage([612, 792]);
  const page2 = doc.addPage([612, 792]);
  page1.drawText("Form SIM-1  Edition 01/01/25  Page 1 of 2", { x: 40, y: 760, size: 9, font });
  page2.drawText("Form SIM-1  Edition 01/01/25  Page 2 of 2", { x: 40, y: 760, size: 9, font });
  const form = doc.getForm();
  // USCIS AcroForms carry a /TU tooltip on every box (the printed label); a renamed box keeps it, which is how an edition change is recognised across a rename
  const tooltip = (field, label) => { field.acroField.dict.set(PDFName.of("TU"), PDFString.of(label)); return field; };
  const text = (name, page, y, extra = {}) => {
    const field = form.createTextField(name);
    if (extra.maxLength) field.setMaxLength(extra.maxLength);
    field.addToPage(page, { x: 50, y, width: 240, height: 22 });
    if (extra.readOnly) field.enableReadOnly();
    return tooltip(field, LABELS[name]);
  };
  text("Pt1_FamilyName", page1, 700);
  text("Pt1_GivenName", page1, 660);
  text("Pt1_Dob", page1, 620);
  text("Pt1_CountryOfBirth", page1, 580, { maxLength: 8 });
  text("Pt1_Notes", page1, 540, { maxLength: 5 });
  text("Pt1_ReadOnly", page1, 500, { readOnly: true });
  text("Pt1_Obsolete", page1, 460);
  const yes = form.createCheckBox("Pt2_Married_Yes");
  yes.addToPage(page2, { x: 50, y: 700, width: 14, height: 14 });
  tooltip(yes, LABELS.Pt2_Married_Yes);
  const no = form.createCheckBox("Pt2_Married_No");
  no.addToPage(page2, { x: 120, y: 700, width: 14, height: 14 });
  tooltip(no, LABELS.Pt2_Married_No);
  const radio = form.createRadioGroup("Pt2_Status");
  radio.addOptionToPage("Single", page2, { x: 50, y: 650, width: 14, height: 14 });
  radio.addOptionToPage("Married", page2, { x: 120, y: 650, width: 14, height: 14 });
  tooltip(radio, LABELS.Pt2_Status);
  const dropdown = form.createDropdown("Pt2_Visa");
  dropdown.addOptions(["H1B", "L1", "O1"]);
  dropdown.addToPage(page2, { x: 50, y: 600, width: 160, height: 22 });
  tooltip(dropdown, LABELS.Pt2_Visa);
  return Buffer.from(await doc.save({ useObjectStreams: false }));
}

module.exports = { buildBaseEdition, MAPPED_TO, ANSWERS, LABELS };
