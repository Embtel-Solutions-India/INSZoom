// The LIVE canonical registry as the model sees it: a SLICE per batch (the paths that share words with the boxes in it), never the whole registry and never data.
// registryVersion is a hash of the registry's paths / types / roles, so a changed registry invalidates every cached suggestion.
const crypto = require("crypto");
const Registry = require("../form-mapping/services/CanonicalFieldRegistryService");

const sha = (value) => crypto.createHash("sha256").update(value).digest("hex");

/** { entries: Map(path -> { path, type, role, description, aliases, cardinality, tokens }), version } - `list` is injectable for tests. */
function liveRegistry(list = () => Registry.list({})) {
  const entries = new Map();
  for (const field of list()) {
    if (!field?.path || /^raw\./.test(field.path) || entries.has(field.path)) continue;
    entries.set(field.path, {
      path: field.path, type: field.type || "text", role: field.role || "other", description: String(field.description || field.label || "").slice(0, 160),
      aliases: (field.aliases || []).slice(0, 8).map((alias) => String(alias).slice(0, 60)), cardinality: field.cardinality || "one",
      tokens: new Set(field.tokens || Registry.tokenize([field.path, ...(field.aliases || []), field.description || ""].join(" "))),
    });
  }
  const version = sha([...entries.values()].map((entry) => `${entry.path}|${entry.type}|${entry.role}`).sort().join("\n")).slice(0, 16);
  return { entries, version };
}

const tokensOf = (text) => new Set(Registry.tokenize(String(text || "")));

/** The registry entries that share words with the boxes' own text: the best `perBox` for each box, at most `max` in all (sorted, so a batch is reproducible). */
function sliceFor(boxTexts, registry, { perBox = 18, max = 150 } = {}) {
  const chosen = new Map();
  for (const text of boxTexts) {
    const wanted = tokensOf(text);
    if (!wanted.size) continue;
    const scored = [];
    for (const entry of registry.entries.values()) {
      let overlap = 0;
      for (const token of wanted) if (entry.tokens.has(token)) overlap += 1;
      if (overlap) scored.push([overlap, entry]);
    }
    scored.sort((a, b) => b[0] - a[0] || a[1].path.localeCompare(b[1].path)).slice(0, perBox).forEach(([, entry]) => chosen.set(entry.path, entry));
  }
  return [...chosen.values()].sort((a, b) => a.path.localeCompare(b.path)).slice(0, max)
    .map(({ path, type, role, description, aliases, cardinality }) => ({ path, type, role, description, aliases, cardinality }));
}

module.exports = { liveRegistry, sliceFor, tokensOf, sha };
