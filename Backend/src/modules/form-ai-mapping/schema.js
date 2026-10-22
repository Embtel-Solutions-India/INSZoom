// Strict, code-side validation of what the model returned (plan Phase 4 "Output"). The model may only pick a candidate FROM the registry slice it was given, give a reason
// code and quote the label text it relied on; this file checks the SHAPE (zod is already a backend dependency), candidateValidator.js checks the MEANING.
//
// Batch level: an answer that is not `{ suggestions: [...] }` is a failed batch (retryable). Item level: a malformed item only invalidates ITS box (that box becomes
// needs_review / rejected), never the whole batch. Unknown keys are refused, not ignored.
const { z } = require("zod");

const REASON_CODES = Object.freeze(["label_exact", "label_synonym", "section_context", "sibling_pattern", "aliases_match", "none"]);

const itemSchema = z.object({
  fieldId: z.string().min(1).max(300),
  candidatePath: z.string().min(1).max(200).nullable(),
  reasonCode: z.enum(REASON_CODES),
  labelEvidence: z.string().max(300).default(""),
  score: z.number().finite().min(0).max(100).default(0),
}).strict();

const batchSchema = z.object({ suggestions: z.array(z.unknown()).max(500) }).passthrough();

/** The model sometimes scores 0..1 and sometimes 0..100; both are kept as 0..100 for the audit trail (the number never decides anything). */
const normalizeScore = (value) => (Number.isFinite(Number(value)) ? (Number(value) <= 1 ? Math.round(Number(value) * 100) : Math.min(100, Math.round(Number(value)))) : 0);

/** { ok:false, error } for a bad batch; { ok:true, items:[{ fieldId, ... }], rejected:[{ index, fieldId?, issues }] } otherwise. */
function parseModelOutput(data) {
  const batch = batchSchema.safeParse(data);
  if (!batch.success) return { ok: false, error: `the answer is not { suggestions: [...] } (${batch.error.issues[0]?.message || "invalid"})` };
  const items = [];
  const rejected = [];
  batch.data.suggestions.forEach((raw, index) => {
    const prepared = raw && typeof raw === "object" ? { ...raw, score: normalizeScore(raw.score) } : raw;
    const parsed = itemSchema.safeParse(prepared);
    if (parsed.success) items.push(parsed.data);
    else rejected.push({ index, fieldId: raw && typeof raw === "object" && typeof raw.fieldId === "string" ? raw.fieldId : undefined, issues: parsed.error.issues.slice(0, 3).map((issue) => `${issue.path.join(".") || "item"}: ${issue.message}`) });
  });
  return { ok: true, items, rejected };
}

module.exports = { parseModelOutput, REASON_CODES, normalizeScore };
