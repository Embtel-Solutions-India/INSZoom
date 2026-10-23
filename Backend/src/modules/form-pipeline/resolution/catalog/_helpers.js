// Shared helpers of the generic catalog entries. A strategy built with `depStrategy` calls an injectable dependency (ctx.deps.<name>) that the owner of the stage supplies;
// without it the strategy reports an honest "dependency not provided" and the resolver moves on. Files starting with "_" are not catalog entries.
const NOT_PROVIDED = "dependency not provided";

/** A strategy that runs ctx.deps[depName](ctx) -> { ok, evidence?, retry? } (or a boolean). verify = the run said ok. */
function depStrategy({ id, description, depName, retry = true }) {
  return {
    id,
    description,
    safe: true,
    async run(ctx) {
      const fn = ctx?.deps?.[depName];
      if (typeof fn !== "function") return { ok: false, evidence: `${NOT_PROVIDED} (${depName})` };
      const out = await fn(ctx);
      if (typeof out === "boolean") return { ok: out, evidence: out ? `${id} worked` : `${id} did not help`, retry };
      return { ok: Boolean(out?.ok), evidence: String(out?.evidence || (out?.ok ? `${id} worked` : `${id} did not help`)), retry: out?.retry ?? retry };
    },
    async verify(_ctx, run) { return Boolean(run?.ok); },
  };
}

module.exports = { depStrategy, NOT_PROVIDED };
