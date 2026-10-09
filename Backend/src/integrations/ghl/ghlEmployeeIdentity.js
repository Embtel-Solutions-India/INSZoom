// Who is this employee card, if anyone yet? One rule, used by the board card AND by the GHL display-name sync, so
// the two can never disagree.
//
// Why not just read `clientName`: while the employer holds an employee's file, the existing flows copy the OWNING
// user's name onto the card (so an unidentified employee shows up as the employer's contact). A typed name is only
// trustworthy once the employee has their OWN login (an invitation sets both together). Otherwise the only reliable
// source is the employee's own canonical profile (person.*), which is exactly what the employer's data entry fills.

const clean = (value) => (typeof value === "string" ? value.trim() : "");
const val = (v) => (v && typeof v === "object" && "value" in v ? v.value : v);

/**
 * @param child           the employee case (needs: user, clientName, canonicalProfile.profile.person)
 * @param employerUserId  the employer matter's user id (so we can tell "has their own login")
 * @param employerContactName  the employer matter's contact name (a profile name equal to it is the seed, not the employee)
 * @returns the employee's name, or "" if they are not identified yet
 */
function employeeName(child, employerUserId, employerContactName) {
  if (!child) return "";
  const ownLogin = Boolean(child.user && employerUserId && String(child.user) !== String(employerUserId));
  const typed = ownLogin ? clean(child.clientName) : "";
  if (typed) return typed;
  const person = child.canonicalProfile?.profile?.person || {};
  const first = clean(val(person.firstName));
  const last = clean(val(person.lastName));
  const fromProfile = [first, last].filter(Boolean).join(" ") || clean(val(person.fullName));
  // Unidentified employee files are seeded with the employer contact's own name; that is not the employee.
  if (fromProfile && clean(employerContactName).toLowerCase() === fromProfile.toLowerCase()) return "";
  return fromProfile;
}

module.exports = { employeeName };
