// DB-free: the title of an imported form is never page furniture such as the "For USCIS Only" box that follows the form number on some PDFs (N-644 was stored with that as its title).
const assert = require("node:assert/strict");
const test = require("node:test");
const { extractTitle } = require("../services/FormMetadataService");

test("a 'For USCIS Only' box after the form number is skipped; the real title is used", () => {
  const text = ["Form N-644", "For USCIS Only", "Department of Homeland Security", "U.S. Citizenship and Immigration Services", "Application for Posthumous Citizenship", "OMB No. 1615-0059"].join("\n");
  assert.equal(extractTitle(text, "N-644"), "Application for Posthumous Citizenship");
});

test("the usual layout (title on the line after the form number) is unchanged", () => {
  assert.equal(extractTitle("I-129\nPetition for a Nonimmigrant Worker\nOMB No. 1615-0009", "I-129"), "Petition for a Nonimmigrant Worker");
});

test("with nothing usable the generic label is returned", () => {
  assert.equal(extractTitle("For USCIS Use Only", "X-1"), "USCIS Form X-1");
});
