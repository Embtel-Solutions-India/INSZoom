// Boxes the system never fills on any form: the interpreter's and the preparer's own details (name, business, address, phone, e-mail, language, date). They describe
// another person, not the client, so no questionnaire answer, canonical fact, default value or mapping may put anything there - a person types them if they apply.
// A box is recognised by its PDF name ("Pt8Line1_InterpreterGivenName", "P7_Line1b_PreparersGivenName", "...PreparerEmailAddress") or by a label that names the
// interpreter / preparer as the person to enter ("Item 3: Enter Interpreter's Daytime Telephone Number"). The applicant's own declaration boxes ("I used an
// interpreter ...", "I have requested the services of ...") are NOT covered: those are the client's statements and stay with the case manager.
const NAME = /interpret|prepar|translat/i;
const LABEL = /^\s*(item\s*\d+[a-z]?\s*[:.]?\s*)?(enter|select)\s+(the\s+)?(interpreter|preparer|translator)/i;
const LABEL_LOOSE = /\b(interpreter|preparer|translator)(['’]s)?\b[^.]*\b(name|business|organization|address|phone|telephone|email|e-mail|language|signature|date|city|state|zip|country|province|street)\b/i;

function isInterpreterOrPreparerField(field = {}) {
  const stem = String(field.fieldName || field.pdfFieldName || field.originalName || "").split(".").pop();
  if (NAME.test(stem)) return true;
  const label = String(field.fieldLabel || field.label || "");
  if (!label || /^\s*i\s+(have|am|can|read)/i.test(label)) return false;
  return LABEL.test(label) || LABEL_LOOSE.test(label);
}

module.exports = { isInterpreterOrPreparerField };
