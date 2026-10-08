// The "person" a GHL-driven action is attributed to when nobody is logged in.
//
// Why this exists: the existing case code (assigning checklists, forms, petition
// drafts) always expects an acting user. questionnaire.assignQuestionnaire, for
// example, refuses with a 403 when there is none, which would silently leave a
// GHL-created case WITHOUT its checklists. This follows the precedent the
// codebase already uses for system work (the template seeder runs as
// { _id: undefined, role: "super_admin" }), so it passes the same access checks
// a super admin would, and leaves "performed by" empty in audit entries rather
// than blaming a real person.
//
// A function (not a shared object) so no caller can mutate another's actor.
const ghlSystemActor = () => ({ _id: undefined, role: "super_admin", name: "GoHighLevel", displayName: "GoHighLevel" });

module.exports = { ghlSystemActor };
