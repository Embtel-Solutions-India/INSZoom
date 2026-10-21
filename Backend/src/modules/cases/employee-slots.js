// The employees of an employer matter: one { name, email } per employee case. Both are optional (the employer may not know them yet - they can be added from
// the case page later); an email that IS given must be valid, different from the other employees and from the employer's own address(es). Returns { slots } or { message }.
const cleanEmail = (value) => String(value ?? "").trim().toLowerCase();

function validateEmployeeSlots(input, count, blockedEmails = []) {
  const list = Array.isArray(input) ? input : [];
  const blocked = new Set(blockedEmails.map(cleanEmail).filter(Boolean));
  const seen = new Set();
  const slots = [];
  for (let index = 0; index < count; index += 1) {
    const label = `Employee ${index + 1}`;
    const name = String(list[index]?.name || "").trim();
    const email = cleanEmail(list[index]?.email);
    if (email) {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { message: `${label}: enter a valid email address.` };
      if (blocked.has(email)) return { message: `${label}: use a separate email - it is the employer's own address.` };
      if (seen.has(email)) return { message: `${label}: that email is already used for another employee.` };
      seen.add(email);
    }
    slots.push({ name, email });
  }
  return { slots };
}

module.exports = { validateEmployeeSlots };
