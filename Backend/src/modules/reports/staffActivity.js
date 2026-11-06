// record(user, kind, ref): remembers that this internal team member opened a case / moved one to Submitted / opened a document / messaged a person.
// A pure side effect: never awaited by callers, never throws, never slows a request. Anyone outside the internal team is ignored.
const StaffActivity = require("../../models/StaffActivity");
const logger = require("../../utils/logger");

const KINDS = new Set(["case", "closed", "document", "message"]);
const INTERNAL = new Set(["admin", "team_lead", "case_manager", "paralegal", "finance", "hr", "reviewer"]);

// The application does not build indexes by itself (autoIndex is off): build this collection's unique index once, best effort.
let indexReady = null;
const ensureIndex = () => (indexReady = indexReady || StaffActivity.createIndexes().catch(() => null));

function record(user, kind, ref, now = new Date()) {
  try {
    const staff = user?._id;
    const id = ref?._id?.toString?.() || ref?.toString?.();
    if (!staff || !id || !KINDS.has(kind) || !INTERNAL.has(String(user.role || ""))) return Promise.resolve(false);
    const { workDateOf } = require("./everyday.service");
    return ensureIndex().then(() => StaffActivity.updateOne({ staff, day: workDateOf(now), kind, ref: id }, { $setOnInsert: { at: now } }, { upsert: true }))
      .then(() => true)
      .catch((error) => {
        if (error?.code !== 11000) logger.warn("staff_activity_failed", { kind, error: error?.message });
        return false;
      });
  } catch (error) {
    logger.warn("staff_activity_failed", { kind, error: error?.message });
    return Promise.resolve(false);
  }
}

// { "<staffId>": { case, closed, document, message } } for the given work days.
async function countsForDays(days) {
  const rows = await StaffActivity.aggregate([
    { $match: { day: { $in: days } } },
    { $group: { _id: { staff: "$staff", day: "$day", kind: "$kind" }, refs: { $addToSet: "$ref" } } },
    { $project: { n: { $size: "$refs" } } },
  ]);
  const out = {};
  for (const { _id, n } of rows) {
    const key = `${_id.staff}|${_id.day}`;
    (out[key] = out[key] || { case: 0, closed: 0, document: 0, message: 0 })[_id.kind] = n;
  }
  return out;
}

module.exports = { record, countsForDays };
