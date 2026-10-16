// Enforces a prompt template's `outputSchema` on what a model returned (plan Phase 0, AI infra prerequisite). The schemas in prompt.defaults.js are flat maps of
// key -> "string" | "number" | "boolean" | "array" | "object". Rules, chosen so a slightly different model answer never crashes a caller:
//   - the answer must be a plain object, and a declared key that is PRESENT must have the declared type - otherwise the call fails with a retryable 502
//     (a number or boolean sent as a string, e.g. "85", is converted instead);
//   - a declared key that is MISSING (or null) is filled with the empty value of its type, so downstream code never meets `undefined`;
//   - keys the schema does not declare are kept untouched.
// A template with no schema is returned as is.

const EMPTY = { string: "", number: 0, boolean: false, array: [], object: {} };

const typeOf = (value) => (Array.isArray(value) ? "array" : value === null ? "null" : typeof value);

class AIOutputSchemaError extends Error {
  constructor(problems) {
    super(`The model's answer does not match the expected shape: ${problems.join("; ")}`);
    this.name = "AIOutputSchemaError";
    this.status = 502;
    this.code = "AI_OUTPUT_SCHEMA_VIOLATION";
    this.retryable = true;
    this.problems = problems;
  }
}

function enforceOutputSchema(data, schema) {
  if (!schema || typeof schema !== "object" || !Object.keys(schema).length) return data;
  if (typeOf(data) !== "object") throw new AIOutputSchemaError([`expected an object but got ${typeOf(data)}`]);
  const problems = [];
  const result = { ...data };
  for (const [key, declared] of Object.entries(schema)) {
    const expected = typeof declared === "string" ? declared : declared?.type;
    if (!(expected in EMPTY)) continue; // an unknown type name is not enforced
    const value = data[key];
    if (value === undefined || value === null) {
      result[key] = Array.isArray(EMPTY[expected]) ? [] : typeof EMPTY[expected] === "object" ? {} : EMPTY[expected];
    } else if (typeOf(value) !== expected) {
      // models often answer 85 as "85" or true as "true"; callers already treat them that way, so they are converted rather than rejected
      if (expected === "number" && typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) result[key] = Number(value);
      else if (expected === "boolean" && typeof value === "string" && /^(true|false)$/i.test(value.trim())) result[key] = value.trim().toLowerCase() === "true";
      else problems.push(`"${key}" should be ${expected} but is ${typeOf(value)}`);
    }
  }
  if (problems.length) throw new AIOutputSchemaError(problems);
  return result;
}

module.exports = { enforceOutputSchema, AIOutputSchemaError };
