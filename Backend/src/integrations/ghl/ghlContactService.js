const { getClient } = require("./ghlClient");

const clean = (value) => (typeof value === "string" ? value.trim() : "");

// Normalises a GHL contact (full contact record, or the summary embedded in an
// opportunity search result) into the few fields the CRM uses.
function normalizeContact(contact = {}, fallbackName = "") {
  const first = clean(contact.firstName);
  const last = clean(contact.lastName);
  const name = clean(contact.name) || clean(contact.contactName) || [first, last].filter(Boolean).join(" ") || clean(fallbackName);
  return {
    id: contact.id || contact.contactId || null,
    name,
    email: clean(contact.email).toLowerCase(),
    phone: clean(contact.phone),
  };
}

async function getContact(contactId, client = getClient()) {
  if (!contactId) return null;
  const data = await client.get(`/contacts/${contactId}`);
  return data?.contact || data || null;
}

// Prefers the full contact record (it has the phone, etc.), but falls back to
// the summary already embedded in the opportunity so one failed contact fetch
// never blocks importing the case.
async function resolveContact(opportunity, client = getClient()) {
  const embedded = normalizeContact(opportunity.contact || {}, opportunity.name);
  if (!opportunity.contactId) return embedded;
  try {
    const full = await getContact(opportunity.contactId, client);
    const normalized = normalizeContact(full || {}, opportunity.name);
    return {
      id: opportunity.contactId,
      name: normalized.name || embedded.name,
      email: normalized.email || embedded.email,
      phone: normalized.phone || embedded.phone,
    };
  } catch {
    return { ...embedded, id: opportunity.contactId };
  }
}

module.exports = { normalizeContact, getContact, resolveContact };
