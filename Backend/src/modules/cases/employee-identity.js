// Who an employee case is: the name and email of the person it is for, as typed by staff when the case was created / the employee added, or by the
// employer in the client portal. One rule for every reader (Admin list and case page, client Employees dashboard) so the two portals can never disagree.
//
// Stored on the child case as `employeeIdentity` (and mirrored in `pendingEmployee`, which the creation flow always wrote). A case whose employee has been
// invited (own login) carries the invitation's `clientName`/`clientEmail`; those are the fallback when no identity was typed.
const cleanEmail = (value) => String(value ?? "").trim().toLowerCase();
const cleanName = (value) => String(value ?? "").trim().replace(/\s+/g, " ");
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const isEmployeeCase = (child) => child?.caseRole === "employee";

function employeeContact(child) {
  if (!isEmployeeCase(child)) return null;
  const name = cleanName(child.employeeIdentity?.name) || cleanName(child.pendingEmployee?.name) || cleanName(child.clientName);
  const email = cleanEmail(child.employeeIdentity?.email) || cleanEmail(child.pendingEmployee?.email) || cleanEmail(child.clientEmail);
  return { name, email, missingName: !name, missingEmail: !email, complete: Boolean(name && email) };
}

// A typed identity ({ name?, email? }) checked against the matter: the email must be valid, not the employer's own address and not another employee's.
// Returns { identity: { name?, email? } } with only the supplied fields, or { message }.
function validateIdentityInput(input, { blockedEmails = [], siblingEmails = [] } = {}) {
  const identity = {};
  if (input?.name !== undefined) {
    const name = cleanName(input.name);
    if (name.length > 120) return { message: "The name is too long." };
    if (name) identity.name = name;
  }
  if (input?.email !== undefined) {
    const email = cleanEmail(input.email);
    if (email) {
      if (!EMAIL_PATTERN.test(email)) return { message: "Enter a valid email address." };
      if (blockedEmails.map(cleanEmail).filter(Boolean).includes(email)) return { message: "Use a separate email - it is the employer's own address." };
      if (siblingEmails.map(cleanEmail).filter(Boolean).includes(email)) return { message: "That email is already used for another employee." };
      identity.email = email;
    }
  }
  if (!Object.keys(identity).length) return { message: "Enter the employee's name or email." };
  return { identity };
}

module.exports = { employeeContact, validateIdentityInput, cleanEmail, cleanName };
