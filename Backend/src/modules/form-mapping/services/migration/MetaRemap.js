// Phase 7.7 - the case form's NON-answer records that name a field (case comments, field history, sync state) follow the field to its new box. PURE.
// Nothing is deleted or rewritten in place without a way back: `pre` carries full copies of every array that changes, stored with the pre-image snapshot, so a restore puts
// them back exactly. A record whose field has no counterpart keeps its old name (it is history about the old edition, not an answer).
const mapName = (name, match, idOf) => {
  if (!name) return null;
  const target = match(name);
  const id = target ? idOf(target) : null;
  return id && id !== name ? id : null;
};

function plan(doc, match, idOf) {
  const set = {};
  const pre = {};
  let changed = 0;
  const remapArray = (key) => {
    const list = Array.isArray(doc[key]) ? doc[key] : null;
    if (!list || !list.length) return;
    let touched = false;
    const next = list.map((item) => {
      const id = item && typeof item === "object" ? mapName(item.fieldName, match, idOf) : null;
      if (!id) return item;
      touched = true;
      changed += 1;
      return { ...item, fieldName: id };
    });
    if (touched) { set[key] = next; pre[key] = list; }
  };
  remapArray("comments");
  remapArray("fieldHistory");
  const sync = doc.syncState;
  if (sync && typeof sync === "object") {
    for (const key of ["changedFields", "affectedFields"]) {
      if (!Array.isArray(sync[key]) || !sync[key].length) continue;
      let touched = false;
      const next = sync[key].map((name) => { const id = mapName(name, match, idOf); if (id) { touched = true; changed += 1; return id; } return name; });
      if (touched) { set[`syncState.${key}`] = [...new Set(next)]; (pre.syncState ||= {})[key] = sync[key]; }
    }
  }
  return { set, pre, changed };
}

module.exports = { plan };
