// The case's lifecycle milestones as the client sees them (the Tasks page and the dashboard progress bar read the same list).
// Once the last one ("Filed") is complete - which happens the moment the case's card reaches Submitted on the Pipeline - every step before it is
// shown complete too: a case cannot be filed with steps still open, and staff may move a card straight to Submitted without ticking each one off.
// Display only: nothing is saved from here.
export function effectiveMilestones(milestones) {
  if (!Array.isArray(milestones) || !milestones.length) return milestones;
  const filed = milestones.find((milestone) => milestone.key === "filed");
  if (!filed || !filed.completed) return milestones;
  return milestones.map((milestone) => (milestone.completed ? milestone : { ...milestone, completed: true, status: "completed" }));
}
