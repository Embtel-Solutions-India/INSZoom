// Who a case is for, in one place: the person's name and email lead everywhere a case is titled, with the case ID beneath them. An employee slot that has not been named yet
// reads "Employee slot" (its case ID still shows), instead of an empty title.
const pick = (...values) => values.map((value) => String(value ?? '').trim()).find(Boolean) || ''

export function caseIdentity(item) {
  const name = pick(item?.clientName, item?.employeeIdentity?.name, item?.pendingEmployee?.name, item?.name) || (item?.caseRole === 'employee' || item?.parentCase ? 'Employee slot' : 'Unnamed')
  const email = pick(item?.clientEmail, item?.employeeContact?.email, item?.employeeIdentity?.email, item?.pendingEmployee?.email, item?.email)
  const caseId = pick(item?.caseNumber, item?.caseId)
  return { name, email, caseId }
}
