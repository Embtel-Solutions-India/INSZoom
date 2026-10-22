// Phase 7.7 - the ONLY ways an answer may change on its way to a new edition's box. PURE (no database).
//
// An answer is carried unchanged ("same_kind" rules), or converted by exactly one NAMED rule below, or it does not go into that box at all: the caller archives it
// (or parks the case form when the answer is protected). Nothing here ever truncates, rounds or guesses: a value that does not provably fit is refused.
//
//   carry({ value, oldField, newField }) -> { ok: true, value, rule, converted } | { ok: false, reason }
//
// Rules (rule ids are stored on the migration record so every conversion is explainable):
//   blank                   an empty answer stays empty
//   unchanged_box           the new box is the same box (same kind, same option set, same maxLength): the answer is carried untouched - nothing to validate or convert
//   already_overflowing     the answer was ALREADY longer than the old box's maxLength (the renderer shrinks long text, so real answers do overflow): it is not a NEW problem, kept as is
//   locked_box_refused      signature / barcode boxes never receive a carried answer
//   text_same_kind          text / date / number -> text-like box; refused when it is longer than the new box's maxLength (never cut)
//   boolean_checkbox        a true / false -> a tick box
//   choice_to_checkbox      an affirmative / negative choice ("Yes", "No", "On", "Off" ...) -> a tick box (true / false)
//   boolean_to_choice       true / false -> the ONE option of the new box that says yes / no
//   option_exact            a choice whose exact value exists in the new box
//   option_normalized       a choice whose text matches exactly one new option after trimming and ignoring case
//   options_unknown         the new box lists no options: carried as before, flagged (nothing can be proven either way)
//   override_record         a manual-override record (an object): carried as is, its value is validated through the filled value of the same box
//   array_each_option       a list of choices, each one proven against the new options
const AFFIRMATIVE = new Set(["yes", "y", "true", "on", "1", "checked", "x"]);
const NEGATIVE = new Set(["no", "n", "false", "off", "0", "unchecked"]);

const norm = (value) => String(value ?? "").trim().replace(/\s+/g, " ").toLowerCase();
const isBlank = (value) => value === undefined || value === null || value === "";

function kindOf(field) {
  if (!field) return null;
  const raw = String(field.fieldType || field.type || field.pdfFieldType || "").toLowerCase();
  if (!raw) return null;
  if (/sig|barcode|pdf417/.test(raw)) return "locked";
  if (/check/.test(raw)) return "checkbox";
  if (/radio/.test(raw)) return "radio";
  if (/drop|select|combo|list|choice/.test(raw)) return "choice";
  return "text"; // text, date, number, phone, ssn, textarea ...
}

/** [{ value, label }] of a field's options (strings or objects), or null when the field lists none. */
function optionsOf(field) {
  const raw = field && (field.options || field.pdfOptions || field.exportValues || field.choices);
  if (!Array.isArray(raw) || !raw.length) return null;
  const list = raw.map((item) => (item && typeof item === "object" ? { value: item.value ?? item.exportValue ?? item.id ?? item.label, label: item.label ?? item.text ?? item.value } : { value: item, label: item }))
    .filter((item) => !isBlank(item.value));
  return list.length ? list : null;
}

function maxLengthOf(field) {
  const n = Number(field?.maxLength ?? field?.validation?.maxLength ?? field?.maxLen);
  return Number.isFinite(n) && n > 0 ? n : null;
}

const refuse = (reason) => ({ ok: false, reason });
const optionValues = (field) => { const list = optionsOf(field); return list ? list.map((option) => String(option.value)).sort() : null; };
/** The old and the new box are the same box as far as an answer is concerned: nothing about the answer needs validating or converting. */
function sameBox(oldField, newField) {
  if (!oldField || !newField) return false;
  const a = kindOf(oldField);
  const b = kindOf(newField);
  return Boolean(a) && a === b && maxLengthOf(oldField) === maxLengthOf(newField) && JSON.stringify(optionValues(oldField)) === JSON.stringify(optionValues(newField));
}
const pass = (value, rule, converted = false) => ({ ok: true, value, rule, converted });

function toOption(options, text) {
  const wanted = norm(text);
  const exact = options.filter((option) => String(option.value) === String(text));
  if (exact.length === 1) return { option: exact[0], rule: "option_exact" };
  const matches = options.filter((option) => norm(option.value) === wanted || norm(option.label) === wanted);
  const distinct = [...new Set(matches.map((option) => String(option.value)))];
  return distinct.length === 1 ? { option: matches[0], rule: "option_normalized" } : null;
}

function booleanToOption(options, truthy) {
  const set = truthy ? AFFIRMATIVE : NEGATIVE;
  const matches = options.filter((option) => set.has(norm(option.value)) || set.has(norm(option.label)));
  const distinct = [...new Set(matches.map((option) => String(option.value)))];
  return distinct.length === 1 ? matches[0] : null;
}

function carry({ value, oldField = null, newField = null }) {
  if (isBlank(value)) return pass(value, "blank");
  const target = kindOf(newField);
  if (!target) return pass(value, "no_type_info"); // the new edition's box says nothing about its type: carried exactly as today
  if (target === "locked") return refuse("locked_box_refused");
  if (sameBox(oldField, newField)) return pass(value, "unchanged_box");
  if (value && typeof value === "object" && !Array.isArray(value)) return target === "text" ? refuse("object_into_text_box") : pass(value, "override_record");

  if (target === "text") {
    if (typeof value === "boolean") return refuse("boolean_into_text_box");
    if (Array.isArray(value)) return refuse("list_into_text_box");
    const max = maxLengthOf(newField);
    if (max && String(value).length > max) {
      // only a NEW restriction refuses: an answer that already overflowed its old box (or fits an old box that had no limit) is judged against that
      const oldMax = maxLengthOf(oldField);
      if (oldMax !== null && String(value).length > oldMax) return pass(value, "already_overflowing");
      return refuse(`exceeds_max_length_${max}`);
    }
    return pass(value, "text_same_kind");
  }
  if (target === "checkbox") {
    if (typeof value === "boolean") return pass(value, "boolean_checkbox");
    if (AFFIRMATIVE.has(norm(value))) return pass(true, "choice_to_checkbox", true);
    if (NEGATIVE.has(norm(value))) return pass(false, "choice_to_checkbox", true);
    return refuse("not_a_tick_box_answer");
  }
  // radio / choice
  const options = optionsOf(newField);
  if (!options) return pass(value, "options_unknown");
  if (Array.isArray(value)) {
    const mapped = [];
    for (const item of value) {
      const hit = typeof item === "string" || typeof item === "number" ? toOption(options, item) : null;
      if (!hit) return refuse("option_not_in_new_edition");
      mapped.push(hit.option.value);
    }
    return pass(mapped, "array_each_option", mapped.some((item, index) => String(item) !== String(value[index])));
  }
  if (typeof value === "boolean") {
    const hit = booleanToOption(options, value);
    return hit ? pass(hit.value, "boolean_to_choice", true) : refuse("no_single_yes_no_option");
  }
  const hit = toOption(options, value);
  if (!hit) return refuse("option_not_in_new_edition");
  return pass(hit.option.value, hit.rule, String(hit.option.value) !== String(value));
}

/** Bumped when a rule is added / changed in a way that can turn a parked case form into a carriable one (stored on the park record). */
const RULES_VERSION = 1;

module.exports = { carry, sameBox, kindOf, optionsOf, maxLengthOf, AFFIRMATIVE, NEGATIVE, RULES_VERSION };
