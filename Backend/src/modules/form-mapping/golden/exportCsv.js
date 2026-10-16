// Plain-language spreadsheet (CSV, opens in Excel) of golden-set entries, optionally with the reviewer's verdicts. Only human wording: no technical ids.
const COLUMNS = [
  ["No.", (e) => e.ref], ["Form", (e) => `${e.formCode} - ${e.formName}`], ["Kind of form", (e) => e.familyLabel], ["Where on the form", (e) => e.where], ["The box asks for", (e) => e.boxLabel],
  ["Box type", (e) => e.boxKind], ["This box is about", (e) => e.belongsTo], ["We fill it with", (e) => e.fillsWith], ["How it is written", (e) => e.writtenAs], ["Only when", (e) => e.onlyWhen],
  ["If that is empty we use", (e) => e.ifEmpty], ["Appears on the form", (e) => (e.appearsTimes > 1 ? `${e.appearsTimes} times` : "once")], ["Sample client's data", (e) => e.example?.clientData], ["The box would show", (e) => e.example?.boxShows],
  ["In one sentence", (e) => e.sentence], ["Your answer (Right / Wrong / Not sure)", (e) => e.verdictLabel || ""], ["If wrong: why?", (e) => e.reason || ""], ["If wrong: what should be filled instead?", (e) => e.correction || ""], ["Your notes", (e) => e.note || ""],
];

const cell = (value) => {
  const text = String(value ?? "").replace(/\r?\n/g, " ");
  return /[",]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

function toCsv(entries) {
  return [COLUMNS.map(([name]) => cell(name)).join(","), ...entries.map((entry) => COLUMNS.map(([, get]) => cell(get(entry))).join(","))].join("\r\n");
}

module.exports = { toCsv, COLUMNS };
