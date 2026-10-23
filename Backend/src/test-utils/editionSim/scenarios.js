// Phase 7.8 simulation: the EDITION scenarios. Each one turns the OLD synthetic edition (basePdf.js) into a NEW edition with one kind of change and says what a correct pipeline
// must do with the answers on the old edition:
//   dest:     { oldPdfName: newPdfName | null } - where each typed answer must end up (null = the new edition has no such box: the answer must be ARCHIVED with a reason, never lost)
//             boxes not listed keep their name.
//   either:   answers that may be carried (possibly converted) OR archived, but never lost or put in a wrong box (type changes).
//   blank:    new boxes that have no source and must simply stay blank while the edition is released (owner decision 2026-10-23).
//   pdfNotes: things the PDF cannot show although the database keeps the value (reported, not counted as loss).
// All scenarios are SYNTHETIC (pdf-lib mutants); the real USCIS pairs are listed in test-utils/fixtures/editions/MANIFEST.json and used by the replay / matcher tests.
const { PDFDocument } = require("pdf-lib");
const mutants = require("../editionMutants");

const load = (bytes) => PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
const save = async (doc) => Buffer.from(await doc.save({ useObjectStreams: false }));
const buf = (result) => result.buffer;

const SHIFT = { Pt1_FamilyName: "Pt3_FamilyName", Pt1_GivenName: "Pt3_GivenName", Pt1_Dob: "Pt3_Dob", Pt1_CountryOfBirth: "Pt3_CountryOfBirth", Pt1_Notes: "Pt3_Notes", Pt1_ReadOnly: "Pt3_ReadOnly", Pt1_Obsolete: "Pt3_Obsolete" };

const EDITION_SCENARIOS = [
  { id: "unchanged", label: "unchanged edition (only the date moved)", synthetic: true, mutate: async (old) => old, dest: {}, expectReleased: true },
  { id: "renamed_boxes", label: "two boxes renamed", synthetic: true,
    mutate: async (old) => buf(await mutants.renameFields(old, { Pt1_FamilyName: "Pt1_LastName", Pt1_GivenName: "Pt1_FirstName" })),
    dest: { Pt1_FamilyName: "Pt1_LastName", Pt1_GivenName: "Pt1_FirstName" }, expectReleased: true },
  { id: "renumbered_part_shift", label: "part 1 became part 3 (every page-1 box renamed)", synthetic: true,
    mutate: async (old) => buf(await mutants.renameFields(old, SHIFT)), dest: SHIFT, expectReleased: true },
  { id: "inserted_page", label: "a page with a heading inserted (no new box)", synthetic: true,
    mutate: async (old) => buf(await mutants.insertPage(old, { index: 1, headingText: "Additional Information" })), dest: {}, expectReleased: true },
  { id: "inserted_unregistered_supplement", label: "an unregistered supplement page with a new box inserted", synthetic: true,
    mutate: async (old) => buf(await mutants.insertPage(old, { index: 1, headingText: "Supplement Z to Form SIM-1", fieldName: "Z_Extra" })), dest: {}, blank: ["Z_Extra"], expectReleased: true },
  { id: "removed_field", label: "one box removed", synthetic: true,
    mutate: async (old) => buf(await mutants.removeFields(old, ["Pt1_Obsolete"])), dest: { Pt1_Obsolete: null }, expectReleased: true },
  { id: "radio_options_changed", label: "a radio group's choices changed (Married -> Wed)", synthetic: true,
    mutate: async (old) => buf(await mutants.changeRadioOptions(old, { groupName: "Pt2_Status", options: ["Single", "Wed"] })), dest: {}, pdfNotes: ["Pt2_Status: the old choice is not on the new radio group, so the PDF cannot show it (the database keeps it)"], expectReleased: true },
  { id: "type_changed", label: "a tick box became a text box", synthetic: true,
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
  { id: "box_added_no_source", label: "a new box with no source added to page 1", synthetic: true,
    mutate: async (old) => {
      const doc = await load(old);
      doc.getForm().createTextField("Pt1_BrandNew").addToPage(doc.getPages()[0], { x: 320, y: 700, width: 200, height: 22 });
      return save(doc);
    }, dest: {}, blank: ["Pt1_BrandNew"], expectReleased: true },
];

module.exports = { EDITION_SCENARIOS };
