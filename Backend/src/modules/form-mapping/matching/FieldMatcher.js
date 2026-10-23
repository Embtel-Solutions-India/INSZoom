// Phase 7.3: matches the fields of an OLD edition to the fields of a NEW edition by what they ARE (label, section, widget kind, options, page, position, name core), not
// only by what they are CALLED. Pure and deterministic. It is built to be PRECISE rather than eager: a pair is returned only when it is the best choice for BOTH sides,
// clearly better than the runner-up on BOTH sides, and compatible in widget kind and option set. Anything else is left unmatched with the reason.
//
//   result  { oldId, newId, confidence: "high" | "medium" | "low" | "none", score, reasons[], conflicts[]? }
//   high    exact (container-free) PDF name, same kind, same semantic type, same label, compatible options
//           OR unique label/core + same section + same page + same kind/semantic type + compatible options + position within tolerance
//   medium  unique label/core + same kind + compatible options, but the name, page or position differs; or exact name with a changed label / semantic type
//   low     scored above the floor but failed the rules above (never carried)
//   none    no candidate, ambiguous (two near-equal candidates), or incompatible (kind / option set)
// An old field and a new field are NEVER matched across widget kinds, nor across different option sets (a radio whose export values changed is a different question).
const { fromField } = require("./FieldFingerprint");

const MIN_SCORE = 0.4;
const GAP = 0.06; // the best candidate must beat the runner-up by this much, on both sides
const GEOMETRY_CLOSE = 0.03; // centre distance, as a fraction of the page (about 18 x 24 points)
const SIZE_CLOSE = 0.2; // relative width / height difference

const same = (a, b) => a !== null && b !== null && a === b;

function geometryScore(a, b) {
  if (!a || !b) return { score: 0, close: false, known: false };
  const distance = Math.hypot(a.cx - b.cx, a.cy - b.cy);
  const sizeDiff = Math.max(Math.abs(a.w - b.w) / Math.max(a.w, b.w), Math.abs(a.h - b.h) / Math.max(a.h, b.h));
  const close = distance <= GEOMETRY_CLOSE && sizeDiff <= SIZE_CLOSE;
  const score = Math.max(0, 1 - distance / (GEOMETRY_CLOSE * 4)) * Math.max(0, 1 - sizeDiff);
  return { score, close, known: true };
}

/** Option sets: equal => ok; both absent => ok; only one side has options, or they differ => incompatible. */
function optionsCompat(a, b) {
  if (!a && !b) return { ok: true, equal: true };
  if (!a || !b) return { ok: false, reason: "options_differ" };
  const equal = a.length === b.length && a.every((value, index) => value === b[index]);
  return equal ? { ok: true, equal: true } : { ok: false, reason: "options_differ" };
}

/** Everything known about one (old, new) pair; `hard` is a reason the pair may never be matched. */
function compare(o, n) {
  if (!o.kind || !n.kind) return { hard: "kind_unknown" };
  if (o.kind !== n.kind) return { hard: "kind_differs" };
  const options = optionsCompat(o.options, n.options);
  if (!options.ok) return { hard: options.reason };
  const geometry = geometryScore(o.geometry, n.geometry);
  const nameExact = same(o.name, n.name) && (o.ordinal === n.ordinal);
  const kindName = same(o.kindName, n.kindName);
  const coreEq = same(o.core, n.core);
  const labelEq = same(o.label, n.label);
  const tooltipEq = same(o.tooltip, n.tooltip);
  const meaningEq = labelEq || tooltipEq; // the printed label OR the field's own help text says the same thing
  const sectionOk = !o.section || !n.section || o.section === n.section;
  const sectionEq = same(o.section, n.section);
  const pageEq = same(o.page, n.page);
  const groupEq = same(o.group, n.group);
  const semanticEq = !o.semantic || !n.semantic || o.semantic === n.semantic;
  let score = 0;
  if (nameExact) score += 0.3; else if (kindName) score += 0.12;
  if (coreEq) score += 0.12;
  if (meaningEq) score += 0.18;
  if (labelEq && tooltipEq) score += 0.05;
  if (sectionEq) score += 0.08;
  if (pageEq) score += 0.1;
  if (groupEq) score += 0.03;
  score += 0.14 * geometry.score;
  if (!semanticEq) score -= 0.1;
  if (!sectionOk) score -= 0.15;
  return { hard: null, score: Math.max(0, Math.min(1, score)), nameExact, kindName, coreEq, labelEq, tooltipEq, meaningEq, sectionOk, sectionEq, pageEq, groupEq, semanticEq, geometry, options };
}

// A label that is specific enough to identify a question by itself: more than one word, or at least 8 characters, and not a bare answer word. "Yes" / "No" / "City" can repeat anywhere.
const GENERIC_LABELS = new Set(["yes", "no", "n a", "na", "other", "none", "city", "state", "date", "name", "number", "unit", "apt", "ste", "flr"]);
const specificLabel = (label) => Boolean(label) && !GENERIC_LABELS.has(label) && (label.split(" ").length >= 2 || label.length >= 8);

function classify(facts, extra = {}) {
  const reasons = [];
  if (facts.nameExact) reasons.push("same_name");
  if (facts.coreEq) reasons.push("same_name_core");
  if (facts.labelEq) reasons.push("same_label");
  else if (facts.tooltipEq) reasons.push("same_help_text");
  if (facts.sectionEq) reasons.push("same_section");
  if (facts.pageEq) reasons.push("same_page");
  if (facts.geometry.close) reasons.push("position_matches");
  if (facts.options.equal) reasons.push("options_equal");
  if (!facts.semanticEq) reasons.push("semantic_type_changed");
  const labelOrCore = facts.meaningEq || facts.coreEq;
  // A: the same container-free PDF name, the same label and the same semantic type
  if (facts.nameExact && facts.meaningEq && facts.semanticEq && facts.sectionOk) return { confidence: "high", reasons };
  // B: unique by meaning (label or name core), same place and same shape
  if (labelOrCore && facts.sectionEq && facts.pageEq && facts.semanticEq && facts.geometry.known && facts.geometry.close) return { confidence: "high", reasons };
  // C (Part N became Part M): the printed words, the page, the widget kind, the option set and the position (within the same tolerance as B) all agree and only the part heading
  // changed. Carried as high ONLY when no other box of the new edition keeps this box's old heading with the same words (the question did not merely move) and no other box of the
  // old edition had the new box's heading with the same words (the new box is not the old question's successor under another heading) - the margin rule has already made it unique.
  if (!facts.sectionOk && facts.labelEq && facts.pageEq && facts.semanticEq && facts.geometry.known && facts.geometry.close && extra.specific && !extra.twin) return { confidence: "high", reasons: [...reasons, "section_heading_changed"] };
  // medium: provably the same thing by meaning, but not where / how it was
  if (labelOrCore && facts.sectionOk && (facts.pageEq || facts.geometry.close || facts.sectionEq)) return { confidence: "medium", reasons };
  if (facts.nameExact && facts.sectionOk) return { confidence: "medium", reasons: [...reasons, "label_changed"] };
  return { confidence: "low", reasons };
}

/** Only for a pair whose heading differs: is the label specific, and does either side have a same-words box under the OTHER side's heading (a twin)? */
function headingShiftContext(olds, news, o, newId, facts) {
  if (facts.sectionOk) return {};
  const n = news.find((item) => item.id === newId);
  if (!n || !specificLabel(o.label)) return { specific: false };
  const homeTwin = news.some((m) => m.id !== n.id && m.kind === o.kind && m.label === o.label && m.section === o.section);
  const originTwin = olds.some((p) => p.id !== o.id && p.kind === n.kind && p.label === n.label && p.section === n.section);
  return { specific: true, twin: homeTwin || originTwin };
}

/**
 * match(oldFields, newFields, { minScore }) -> { results: [...one per old field], matched: Map(oldId -> result), conflicts: [...] }
 * One-to-one: a new field is returned for at most one old field, and only when both pick each other with a clear margin.
 */
function match(oldFields = [], newFields = [], options = {}) {
  const minScore = options.minScore ?? MIN_SCORE;
  const olds = oldFields.map(fromField).filter((fp) => fp.id);
  const news = newFields.map(fromField).filter((fp) => fp.id);
  const candidatesOf = new Map(olds.map((o) => [o.id, []]));
  const reverse = new Map(news.map((n) => [n.id, []]));
  const hardReasons = new Map(olds.map((o) => [o.id, new Set()]));
  const conflicts = [];

  // blocking: only compare fields that can plausibly be the same (same kind); keeps 1,000-field forms fast
  const newsByKind = new Map();
  news.forEach((n) => { const key = n.kind || "?"; (newsByKind.get(key) || newsByKind.set(key, []).get(key)).push(n); });
  for (const o of olds) {
    const pool = [...(newsByKind.get(o.kind || "?") || [])];
    // a new field with an identical name but another kind is a CONFLICT to report, not a candidate
    news.filter((n) => n.kind !== o.kind && n.name && n.name === o.name).forEach((n) => { hardReasons.get(o.id).add("kind_differs"); conflicts.push({ oldId: o.id, newId: n.id, severity: "hard", reasons: ["kind_differs"] }); });
    for (const n of pool) {
      const facts = compare(o, n);
      if (facts.hard) {
        if (facts.hard === "options_differ" && (same(o.name, n.name) || (same(o.label, n.label) && same(o.page, n.page)))) {
          hardReasons.get(o.id).add("options_differ");
          conflicts.push({ oldId: o.id, newId: n.id, severity: "hard", reasons: ["options_differ"] });
        }
        continue;
      }
      // a pair whose only difference is the part heading pays the heading penalty and can land just under the floor with no help text to lift it: it stays a CANDIDATE (so it takes part in
      // the uniqueness margins and can be carried by rule C); it is still never carried unless classify() says so
      const headingShape = !facts.sectionOk && facts.labelEq && facts.pageEq && facts.semanticEq && facts.geometry.known && facts.geometry.close;
      if (facts.score < minScore && !(headingShape && facts.score >= minScore - 0.1)) continue;
      candidatesOf.get(o.id).push({ id: n.id, score: facts.score, facts });
      reverse.get(n.id).push({ id: o.id, score: facts.score });
    }
  }
  const order = (a, b) => b.score - a.score || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  candidatesOf.forEach((list) => list.sort(order));
  reverse.forEach((list) => list.sort(order));

  const clearBest = (list) => {
    if (!list.length) return { best: null, ambiguous: false };
    const [first, second] = list;
    if (second && first.score - second.score < GAP) return { best: null, ambiguous: true, among: list.filter((item) => first.score - item.score < GAP).map((item) => item.id) };
    return { best: first, ambiguous: false };
  };

  const results = [];
  const matched = new Map();
  for (const o of olds) {
    const forward = clearBest(candidatesOf.get(o.id));
    let result = { oldId: o.id, newId: null, confidence: "none", score: 0, reasons: [] };
    if (forward.ambiguous) result = { ...result, reasons: ["ambiguous"], among: forward.among };
    else if (!forward.best) result = { ...result, reasons: hardReasons.get(o.id).size ? [...hardReasons.get(o.id)] : ["no_candidate"] };
    else {
      const back = clearBest(reverse.get(forward.best.id));
      if (back.ambiguous) result = { ...result, reasons: ["ambiguous"], among: back.among };
      else if (!back.best || back.best.id !== o.id) result = { ...result, reasons: ["claimed_by_better_match"] };
      else {
        const verdict = classify(forward.best.facts, headingShiftContext(olds, news, o, forward.best.id, forward.best.facts));
        result = { oldId: o.id, newId: forward.best.id, confidence: verdict.confidence, score: Math.round(forward.best.score * 1000) / 1000, reasons: verdict.reasons };
        if (verdict.confidence !== "none") matched.set(o.id, result);
      }
    }
    results.push(result);
  }
  return { results, matched, conflicts };
}

/** Policy: high is automatic; medium only when the caller's own contract check passed; low / none are never carried. */
function acceptable(result, { contractOk = false } = {}) {
  if (!result || !result.newId) return false;
  if (result.confidence === "high") return true;
  if (result.confidence === "medium") return Boolean(contractOk);
  return false;
}

/**
 * Pairs that the CURRENT exact-name logic would accept (same name in both editions) but that are not really the same field: another widget kind or another option set
 * (hard), or a changed label (soft). Used so a value is never carried into a different kind of box just because the name survived.
 */
function exactMatchConflicts(oldFields = [], newFields = []) {
  const newByName = new Map();
  newFields.map(fromField).forEach((n) => { if (n.name) (newByName.get(n.name) || newByName.set(n.name, []).get(n.name)).push(n); });
  const out = [];
  for (const o of oldFields.map(fromField)) {
    const candidates = (newByName.get(o.name) || []).filter((n) => n.ordinal === o.ordinal);
    if (candidates.length !== 1) continue;
    const n = candidates[0];
    const reasons = [];
    let severity = null;
    if (o.kind && n.kind && o.kind !== n.kind) { reasons.push("kind_differs"); severity = "hard"; }
    else if (!optionsCompat(o.options, n.options).ok) { reasons.push("options_differ"); severity = "hard"; }
    if (!severity && o.label && n.label && o.label !== n.label && o.tooltip && n.tooltip && o.tooltip !== n.tooltip) { reasons.push("label_changed"); severity = "soft"; }
    if (!severity && o.semantic && n.semantic && o.semantic !== n.semantic) { reasons.push("semantic_type_changed"); severity = "soft"; }
    if (severity) out.push({ oldId: o.id, newId: n.id, severity, reasons });
  }
  return out;
}

module.exports = { match, acceptable, exactMatchConflicts, compare, MIN_SCORE, GAP };
