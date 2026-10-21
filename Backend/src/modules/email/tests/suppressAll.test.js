const assert = require("node:assert/strict");
const test = require("node:test");
const env = require("../../../config/env");
const EmailLog = require("../../../models/EmailLog");
const emailService = require("../email.service");

// Master switch (EMAIL_SUPPRESS_ALL): nothing is handed to the mail provider; every email is only logged as skipped. DB-free: the log model is stubbed.
function withStubbedLog(run) {
  const original = EmailLog.create;
  const rows = [];
  EmailLog.create = async (row) => { rows.push(row); return { ...row, save: async () => {} }; };
  const previous = env.emailSuppressAll;
  return Promise.resolve(run(rows)).finally(() => { EmailLog.create = original; env.emailSuppressAll = previous; });
}

test("with the master switch on, a client email and a team email are both held back and logged as skipped", () => withStubbedLog(async (rows) => {
  env.emailSuppressAll = true;
  for (const templateKey of ["case-created-client", "task-assigned"]) {
    const result = await emailService.dispatch({ templateKey, to: "person@example.org", subject: "Hello", html: "<p>Hi</p>", text: "Hi" });
    assert.equal(result.sent, false);
    assert.equal(result.skipped, true);
    assert.equal(result.reason, "all_email_suppressed");
  }
  assert.equal(rows.length, 2);
  assert.ok(rows.every((row) => row.status === "skipped" && /EMAIL_SUPPRESS_ALL/.test(row.error)));
}));
