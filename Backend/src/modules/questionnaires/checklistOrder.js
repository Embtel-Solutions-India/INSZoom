// The order a visa type's DEFAULT checklists are shown in: settings.checklistOrder, lowest first (US Visitor Visa: the applicant checklist 1, the I-134 sponsor questionnaire 2).
// Pure and STABLE: a checklist without an order sorts after every ordered one, and the checklists that have none keep exactly the order they came in - so a visa type that sets no
// order (every other visa type) is untouched. Sorts in place and returns the same array.
const CHECKLIST_ORDER_NONE = 1e9;

function orderDefaultChecklists(checklists) {
  const rank = (questionnaire) => (Number.isFinite(questionnaire?.settings?.checklistOrder) ? questionnaire.settings.checklistOrder : CHECKLIST_ORDER_NONE);
  return checklists.sort((left, right) => rank(left) - rank(right));
}

module.exports = { orderDefaultChecklists, CHECKLIST_ORDER_NONE };
