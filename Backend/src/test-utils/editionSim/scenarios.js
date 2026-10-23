// Phase 7.8 simulation: the EDITION scenarios. Each one turns the OLD synthetic edition (basePdf.js) into a NEW edition with one kind of change and says what a correct pipeline
// must do with the answers on the old edition:
//   dest:     { oldPdfName: newPdfName | null } - where each typed answer must end up (null = the new edition has no such box: the answer must be ARCHIVED with a reason, never lost)
//             boxes not listed keep their name.
//   either:   answers that may be carried (possibly converted) OR archived, but never lost or put in a wrong box (type changes).
//   blank:    new boxes that have no source and must simply stay blank while the edition is released (owner decision 2026-10-23).
//   pdfNotes: things the PDF cannot show although the database keeps the value (reported, not counted as loss).
//   expectOutcome: what the pipeline honestly does today with the engine ON - autonomous (released, every case form moved) | parked (released, a case form that cannot be moved safely waits on the old edition, nothing lost) | held (not released; the live edition is untouched).
// All scenarios are SYNTHETIC (pdf-lib mutants); the real USCIS pairs are listed in test-utils/fixtures/editions/MANIFEST.json and used by the replay / matcher tests.
const { PDFDocument } = require("pdf-lib");
const mutants = require("../editionMutants");

const load = (bytes) => PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
const save = async (doc) => Buffer.from(await doc.save({ useObjectStreams: false }));
const buf = (result) => result.buffer;

const SHIFT = { Pt1_FamilyName: "Pt3_FamilyName", Pt1_GivenName: "Pt3_GivenName", Pt1_Dob: "Pt3_Dob", Pt1_CountryOfBirth: "Pt3_CountryOfBirth", Pt1_Notes: "Pt3_Notes", Pt1_ReadOnly: "Pt3_ReadOnly", Pt1_Obsolete: "Pt3_Obsolete" };

const EDITION_SCENARIOS = [
  { id: "unchanged", expectOutcome: "autonomous", label: "unchanged edition (only the date moved)", synthetic: true, mutate: async (old) => old, dest: {}, expectReleased: true },
  { id: "renamed_boxes", expectOutcome: "autonomous", label: "two boxes renumbered by line (Pt1_FamilyName -> Pt1Line1a_FamilyName), same printed words", synthetic: true,
    mutate: async (old) => buf(await mutants.renameFields(old, { Pt1_FamilyName: "Pt1Line1a_FamilyName", Pt1_GivenName: "Pt1Line1b_GivenName" })),
    dest: { Pt1_FamilyName: "Pt1Line1a_FamilyName", Pt1_GivenName: "Pt1Line1b_GivenName" }, expectReleased: true },
  { id: "renamed_boxes_new_words", expectOutcome: "parked", label: "two boxes renamed with DIFFERENT words (Family Name -> Last Name): cannot be proven to be the same box", synthetic: true,
    mutate: async (old) => buf(await mutants.renameFields(old, { Pt1_FamilyName: "Pt1_LastName", Pt1_GivenName: "Pt1_FirstName" })),
    dest: { Pt1_FamilyName: "Pt1_LastName", Pt1_GivenName: "Pt1_FirstName" }, expectReleased: true, knownLimit: "a rename that changes the words is not provable; the case form is parked on the old edition, nothing is lost" },
  { id: "renumbered_part_shift", expectOutcome: "held", label: "part 1 became part 3 (every page-1 box renamed)", synthetic: true,
    mutate: async (old) => buf(await mutants.renameFields(old, SHIFT)), dest: SHIFT, expectReleased: true,
    knownLimit: "the matcher now PROVES most shifted boxes (high confidence, reason section_heading_changed) but a matcher rename is carried as needs_review, never active; here EVERY mapped box shifted, so no active edge is left to activate and the edition is held. Letting high-confidence renames be active is the owner's decision" },
  { id: "inserted_page", expectOutcome: "autonomous", label: "a page with a heading inserted (no new box)", synthetic: true,
    mutate: async (old) => buf(await mutants.insertPage(old, { index: 1, headingText: "Additional Information" })), dest: {}, expectReleased: true },
  { id: "inserted_unregistered_supplement", expectOutcome: "autonomous", label: "an unregistered supplement page with a new box inserted", synthetic: true,
    mutate: async (old) => buf(await mutants.insertPage(old, { index: 1, headingText: "Supplement Z to Form SIM-1", fieldName: "Z_Extra" })), dest: {}, blank: ["Z_Extra"], expectReleased: true },
  { id: "removed_field", expectOutcome: "parked", label: "one box removed", synthetic: true,
    mutate: async (old) => buf(await mutants.removeFields(old, ["Pt1_Obsolete"])), dest: { Pt1_Obsolete: null }, expectReleased: true },
  { id: "radio_options_changed", expectOutcome: "parked", label: "a radio group's choices changed (Married -> Wed)", synthetic: true,
    mutate: async (old) => buf(await mutants.changeRadioOptions(old, { groupName: "Pt2_Status", options: ["Single", "Wed"] })), dest: {}, pdfNotes: ["Pt2_Status: the old choice is not on the new radio group, so the PDF cannot show it (the database keeps it)"], expectReleased: true },
  { id: "type_changed", expectOutcome: "autonomous", label: "a tick box became a text box", synthetic: true,
    mutate: async (old) => {
      const doc = await load(old);
      const form = doc.getForm();
      const box = form.getCheckBox("Pt2_Married_Yes");
      const rect = box.acroField.getWidgets()[0].getRectangle();
      form.removeField(box);
      const text = form.createTextField("Pt2_Married_Yes");
      text.addToPage(doc.getPages()[1], { x: rect.x, y: rect.y, width: 120, height: 20 });
      return save(doc);
    }, dest: {}, either: ["Pt2_Married_Yes"], expectReleased: true },
  { id: "box_added_no_source", expectOutcome: "autonomous", label: "a new box with no source added to page 1", synthetic: true,
    mutate: async (old) => {
      const doc = await load(old);
      doc.getForm().createTextField("Pt1_BrandNew").addToPage(doc.getPages()[0], { x: 320, y: 700, width: 200, height: 22 });
      return save(doc);
    }, dest: {}, blank: ["Pt1_BrandNew"], expectReleased: true },
];

module.exports = { EDITION_SCENARIOS };
