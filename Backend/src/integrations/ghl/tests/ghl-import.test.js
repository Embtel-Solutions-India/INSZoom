const test = require("node:test");
const assert = require("node:assert/strict");

const { fetchAllOpportunities } = require("../ghlOpportunityService");
const { normalizeContact, resolveContact } = require("../ghlContactService");
const visa = require("../ghlVisaSelection.service");

// ---- pagination ----------------------------------------------------------

const opp = (n) => ({ id: `o${n}` });
const fakeClient = (pages) => {
  const calls = [];
  return {
    calls,
    get: async (path, query) => {
      calls.push(query);
      return pages.shift() || { opportunities: [], meta: {} };
    },
  };
};

test("pagination follows the cursor across pages and does not stop at page one", async () => {
  const full = Array.from({ length: 100 }, (_, i) => opp(i));
  const second = Array.from({ length: 100 }, (_, i) => opp(100 + i));
  const third = [opp(200), opp(201)];
  const client = fakeClient([
    { opportunities: full, meta: { startAfter: 111, startAfterId: "o99" } },
    { opportunities: second, meta: { startAfter: 222, startAfterId: "o199" } },
    { opportunities: third, meta: { startAfter: 333, startAfterId: "o201" } },
  ]);
  const all = await fetchAllOpportunities("p1", { client, locationId: "L" });
  assert.equal(all.length, 202);
  assert.equal(client.calls.length, 3);
  assert.equal(client.calls[0].startAfter, undefined);
  assert.deepEqual([client.calls[1].startAfter, client.calls[1].startAfterId], [111, "o99"]);
  assert.equal(client.calls[0].pipeline_id, "p1");
});

test("pagination dedupes repeated records and stops if the cursor yields nothing new", async () => {
  const full = Array.from({ length: 100 }, (_, i) => opp(i));
  const client = fakeClient([
    { opportunities: full, meta: { startAfter: 1, startAfterId: "o99" } },
    { opportunities: full, meta: { startAfter: 1, startAfterId: "o99" } },
  ]);
  const all = await fetchAllOpportunities("p1", { client, locationId: "L" });
  assert.equal(all.length, 100);
  assert.equal(client.calls.length, 2);
});

test("a short single page stops immediately", async () => {
  const client = fakeClient([{ opportunities: [opp(1)], meta: { startAfter: 1, startAfterId: "o1" } }]);
  assert.equal((await fetchAllOpportunities("p1", { client, locationId: "L" })).length, 1);
  assert.equal(client.calls.length, 1);
});

// ---- contacts ------------------------------------------------------------

test("contact normalisation lowercases email and builds a name", () => {
  assert.deepEqual(normalizeContact({ id: "c1", firstName: "Jo", lastName: "Doe", email: " Jo@X.COM ", phone: "+1" }), {
    id: "c1",
    name: "Jo Doe",
    email: "jo@x.com",
    phone: "+1",
  });
  assert.equal(normalizeContact({}, "Fallback Opp").name, "Fallback Opp");
});

test("a failed contact fetch falls back to the embedded contact and never throws", async () => {
  const client = { get: async () => { throw new Error("boom"); } };
  const contact = await resolveContact({ contactId: "c9", name: "Opp", contact: { name: "Embedded", email: "e@x.com" } }, client);
  assert.equal(contact.name, "Embedded");
  assert.equal(contact.email, "e@x.com");
  assert.equal(contact.id, "c9");
});

test("the full contact fills in what the embedded summary lacks (phone)", async () => {
  const client = { get: async () => ({ contact: { firstName: "A", lastName: "B", email: "a@b.com", phone: "+15551234" } }) };
  const contact = await resolveContact({ contactId: "c1", contact: { name: "A B", email: "a@b.com" } }, client);
  assert.equal(contact.phone, "+15551234");
});

// ---- visa selection hook (must be a no-op for every non-GHL case) ----------

test("markVisaSelected only affects pending GHL cases", () => {
  const normal = { visaType: "H-1B", creationSource: "admin_direct" };
  assert.equal(visa.markVisaSelected(normal, "O-1"), false);
  assert.equal(normal.visaSelectionStatus, undefined);

  const selectedGhl = { creationSource: "ghl", visaSelectionStatus: "selected" };
  assert.equal(visa.markVisaSelected(selectedGhl, "O-1"), false);

  const pending = { creationSource: "ghl", visaSelectionStatus: "pending" };
  assert.equal(visa.markVisaSelected(pending, ""), false);
  assert.equal(pending.visaSelectionStatus, "pending");
  assert.equal(visa.markVisaSelected(pending, "F-1"), true);
  assert.equal(pending.visaSelectionStatus, "selected");
  assert.equal(pending.visaCategory, "F-1");
  assert.equal(pending.petitionType, "F-1");
});

test("markVisaSelected keeps an explicitly supplied category/petition type", () => {
  const pending = { creationSource: "ghl", visaSelectionStatus: "pending", visaCategory: "Work", petitionType: "I-129" };
  visa.markVisaSelected(pending, "F-1");
  assert.equal(pending.visaCategory, "Work");
  assert.equal(pending.petitionType, "I-129");
});

test("multi-party and unknown visas are refused for a pending GHL case, and nothing is changed", () => {
  for (const [visaType, code, status] of [["H-1B", "GHL_VISA_STRUCTURE_UNSUPPORTED", 422], ["K-1", "GHL_VISA_STRUCTURE_UNSUPPORTED", 422], ["NOT-A-VISA", "UNKNOWN_VISA_TYPE", 400]]) {
    const pending = { creationSource: "ghl", visaSelectionStatus: "pending" };
    assert.throws(() => visa.markVisaSelected(pending, visaType), (error) => error.code === code && error.status === status);
    assert.equal(pending.visaSelectionStatus, "pending");
    assert.equal(pending.visaCategory, undefined);
  }
});

test("the structure guard never applies to non-GHL cases", () => {
  const normal = { creationSource: "admin_direct", visaType: "H-1B" };
  assert.equal(visa.markVisaSelected(normal, "H-1B"), false);
});
