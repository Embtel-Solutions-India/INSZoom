// The packages a case can have: exactly the three in the New case dropdown (components/CreateCaseModal.jsx). A case with no package chosen yet is "Not assigned".
export const PACKAGES = ['Self Filing Package', 'Attorney Review Package', 'Full Attorney Filing Package']
export const NOT_ASSIGNED = 'Not assigned'

// the canonical package name for any stored value (any spelling / case), or "Not assigned" for blank, "unknown", "Not Selected" or anything else
export function normalizePackage(value) {
  const text = String(value ?? '').trim().toLowerCase()
  return PACKAGES.find((name) => name.toLowerCase() === text) || NOT_ASSIGNED
}

// Rows keyed by package ([{ name | key | _id, ...numbers }]) -> exactly the three packages plus "Not assigned", every one listed (zero if none), the numbers added up.
export function packageRows(rows, numberKeys = ['value']) {
  const table = new Map([...PACKAGES, NOT_ASSIGNED].map((name) => [name, Object.fromEntries(numberKeys.map((key) => [key, 0]))]))
  for (const row of rows || []) {
    const target = table.get(normalizePackage(row.name ?? row.key ?? row._id))
    numberKeys.forEach((key) => { target[key] += Number(row[key]) || 0 })
  }
  return [...table.entries()].map(([name, numbers]) => ({ name, ...numbers }))
}
