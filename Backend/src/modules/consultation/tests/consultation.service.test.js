const assert = require("node:assert/strict");
const test = require("node:test");
const bookingTokenService = require("../bookingToken.service");
const { buildConsultationIcs } = require("../ics.service");

// bookingToken.service and ics.service are pure/self-contained (no DB) —
// covered directly here. The rest of consultation.service.js (slot
// resolution, booking, reschedule/cancel, atomicity, email/notification
// side effects) is covered by live verification against the running dev
// backend — see the report — matching this repo's established no-DB test
// convention for DB-heavy orchestration code.

test("bookingToken: issue() then verify() round-trips to the same appointment id", () => {
  const token = bookingTokenService.issue("appt123");
  const decoded = bookingTokenService.verify(token);
  assert.equal(decoded.appointmentId, "appt123");
});

test("bookingToken: a tampered token is rejected", () => {
  const token = bookingTokenService.issue("appt123");
  const tampered = token.slice(0, -2) + "00";
  assert.equal(bookingTokenService.verify(tampered), null);
});

test("bookingToken: an expired token is rejected", () => {
  const token = bookingTokenService.issue("appt123", { validForMs: -1000 }); // already expired
  assert.equal(bookingTokenService.verify(token), null);
});

test("bookingToken: garbage input never throws, just returns null", () => {
  assert.equal(bookingTokenService.verify(""), null);
  assert.equal(bookingTokenService.verify("not-a-token"), null);
  assert.equal(bookingTokenService.verify(undefined), null);
  assert.equal(bookingTokenService.verify({}), null);
});

test("bookingToken: never encodes anything beyond the appointment id + expiry (no internal identity)", () => {
  const token = bookingTokenService.issue("appt123");
  const [payload] = token.split(".");
  const decoded = Buffer.from(payload, "base64url").toString("utf8");
  assert.equal(decoded.split(".")[0], "appt123");
  assert.doesNotMatch(decoded, /host|user|role|admin/i);
});

test("ics: produces a structurally valid VCALENDAR/VEVENT", () => {
  const ics = buildConsultationIcs({
    uid: "abc@test",
    startAt: new Date("2026-08-03T05:00:00Z"),
    endAt: new Date("2026-08-03T05:30:00Z"),
    summary: "Free Consultation",
    description: "test description",
  });
  assert.match(ics, /^BEGIN:VCALENDAR\r\n/);
  assert.match(ics, /BEGIN:VEVENT/);
  assert.match(ics, /UID:abc@test/);
  assert.match(ics, /DTSTART:20260803T050000Z/);
  assert.match(ics, /DTEND:20260803T053000Z/);
  assert.match(ics, /END:VEVENT\r\n/);
  assert.match(ics, /END:VCALENDAR\r\n$/);
});

test("ics: escapes special characters in text fields", () => {
  const ics = buildConsultationIcs({
    uid: "abc@test",
    startAt: new Date(),
    endAt: new Date(),
    summary: "Consultation; with, special\nchars",
    description: "plain",
  });
  assert.match(ics, /SUMMARY:Consultation\\; with\\, special\\nchars/);
});
