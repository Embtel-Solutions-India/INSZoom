// One login, many cases - Phase 4 hardening: each fix found while verifying the feature, pinned. DB-free.
const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const links = require("../caseLinks.service");
const { resolveDisplayVisa } = require("../../../utils/visaDisplay");
const { buttonsToLogin } = require("../../email/portalUrls");

const SRC = path.join(__dirname, "..", "..", "..");
const ROOT = path.join(SRC, "..", "..");
const read = (...parts) => fs.readFileSync(path.join(...parts), "utf8");
const ID = "a".repeat(24);

test("deleting a case: a login still on ANY other case (client, employer, employee, petitioner, beneficiary, delegate) is never deleted; the landing case is replaced", () => {
  const source = read(SRC, "modules", "cases", "case-deletion.service.js");
  for (const field of ["user", "clientEmail", "employerUser", "employeeUser", "petitionerUser", "beneficiaryUser", "delegateEmployerUser"]) {
    assert.match(source, new RegExp(`\\{ ${field}: user\\.(_id|email) \\}`), `${field} counts as "still on a case"`);
  }
  assert.match(source, /repointLandingCases\(keep\)/);
});

test("repointLandingCases: the newest remaining top-level case becomes the landing case; one that still exists is never replaced; nobody left stays blank", async () => {
  const calls = [];
  const UserModel = { updateOne: async (filter, update) => { calls.push({ filter, update }); return { modifiedCount: 1 }; } };
  const list = async (id) => (id === "u1" ? [{ _id: "old" }, { _id: "newest" }] : []);
  const count = await links.repointLandingCases(["u1", "u2"], { UserModel, list });
  assert.equal(count, 1, "only the person who has a case");
  assert.deepEqual(calls[0].update, { $set: { primaryCaseId: "newest" } });
  assert.deepEqual(calls[0].filter.$or, [{ primaryCaseId: null }, { primaryCaseId: { $exists: false } }], "only when there is no landing case - never replaces an existing one");
});

test("appendCaseIdsAtomic: one atomic $addToSet (two cases created at once cannot drop each other's link)", async () => {
  let seen;
  await links.appendCaseIdsAtomic("u1", ["c1", null, "c2"], { UserModel: { updateOne: async (...args) => { seen = args; return {}; } } });
  assert.deepEqual(seen, [{ _id: "u1" }, { $addToSet: { caseIds: { $each: ["c1", "c2"] } } }]);
  const controller = read(SRC, "modules", "cases", "case.controller.js");
  assert.match(controller, /clientUser\.unmarkModified\("caseIds"\)[\s\S]{0,200}appendCaseIdsAtomic\(clientUser\._id, \[principalCase\._id\]\)/);
  assert.match(read(SRC, "modules", "cases", "clientAccount.service.js"), /existing\.unmarkModified\("caseIds"\)[\s\S]{0,200}appendCaseIdsAtomic\(existing\._id/);
});

test("'my case' with no landing case prefers a top-level case, never an employee case of another matter", () => {
  const controller = read(SRC, "modules", "cases", "case.controller.js");
  assert.match(controller, /Case\.findOne\(\{ \$and: \[filter, \{ parentCase: null \}\] \}\)\.sort\(\{ createdAt: -1 \}\)\.lean\(\)/, "/cases/my");
  assert.match(controller, /Case\.findOne\(\{ \$and: \[filter, \{ parentCase: null \}\] \}\)\.sort\(\{ createdAt: -1 \}\)\.select\("integrations\.ghl"\)/, "/cases/my/pipeline");
});

test("a returning person's 'case created' e-mail button opens THAT case after sign-in: login?case=<id> survives the button rewrite, every other button still goes to the plain login page", () => {
  const mk = (href) => `<a href="${href}" style="display:inline-block;padding:1px">Go</a>`;
  const hrefOf = (html) => /href="([^"]*)"/.exec(html)[1];
  const login = "https://client.immiglance.com/login";
  assert.equal(hrefOf(buttonsToLogin(mk(`${login}?case=${ID}`), "", "client").html), `${login}?case=${ID}`);
  assert.equal(hrefOf(buttonsToLogin(mk(login), "", "client").html), login);
  for (const href of ["https://client.immiglance.com/dashboard", `https://client.immiglance.com/dashboard?case=${ID}`, `${login}?case=zzz`, `${login}?case=${ID}&x=1`]) {
    assert.equal(hrefOf(buttonsToLogin(mk(href), "", "client").html), login, href);
  }
  assert.match(read(SRC, "modules", "cases", "case-lifecycle-orchestrator.service.js"), /login\$\{hasOtherCase \? `\?case=\$\{caseData\._id\}` : ""\}/, "only a returning person gets the case in the link");
  assert.match(read(SRC, "modules", "cases", "clientAccount.service.js"), /\(user\.caseIds \|\| \[\]\)\.length > 1 \? `\?case=\$\{caseDoc\._id\}`/);
  const login2 = read(ROOT, "Immiglance", "Client", "src", "Pages", "Auth", "Login.jsx");
  assert.match(login2, /\/\^\[a-f0-9\]\{24\}\$\/i\.test\(searchParams\.get\("case"\)/, "only a well-formed id is used");
  // the e-mail's ?case= link wins; otherwise the page the person asked for before signing in (a notification link, a bookmark); otherwise the dashboard
  assert.match(login2, /afterLogin = caseParam \? `\/dashboard\?case=\$\{caseParam\}` : \(requestedPath \|\| "\/dashboard"\)/);
  assert.ok((login2.match(/afterLogin/g) || []).length >= 4, "every post-sign-in redirect (Google, already signed in) uses it");
  assert.doesNotMatch(login2, /navigate\("\/dashboard", \{ replace: true \}\)|<Navigate to="\/dashboard" replace \/>/, "no redirect still goes to the bare dashboard");
});

test("a filing type shows its proper name everywhere (stored code unchanged); every other visa is untouched", () => {
  assert.equal(resolveDisplayVisa({ visaType: "I765EAD" }), "I-765 EAD");
  assert.equal(resolveDisplayVisa({ visaType: "H4EAD" }), "H-4 EAD");
  assert.equal(resolveDisplayVisa({ visaType: "H4EXTENSIONEAD" }), "H-4 Extension + EAD");
  assert.equal(resolveDisplayVisa({ visaType: "COSF1" }), "Change of Status to F-1");
  assert.equal(resolveDisplayVisa({ visaType: "H-1B" }), "H-1B");
  assert.equal(resolveDisplayVisa({ visaType: "H-1B", petitionSubType: "H-1B Extension" }), "H-1B Extension");
  assert.equal(resolveDisplayVisa({ visaType: "PERM" }), "PERM");
  assert.equal(resolveDisplayVisa({ visaType: "I765EAD", questionnaireData: { masterData: { visaVariant: "Custom" } } }), "Custom", "a chosen variant still wins");
  assert.equal(resolveDisplayVisa({}), "");
  // the four front-end copies carry the same names
  for (const file of [["Admin", "frontend", "src", "utils", "visaDisplay.js"], ["Immiglance", "Client", "src", "utils", "visaDisplay.js"], ["Immiglance", "Landing", "src", "utils", "visaDisplay.js"], ["Attorney", "src", "utils", "visaDisplay.js"]]) {
    const text = read(ROOT, ...file);
    for (const [code, name] of [["H4EAD", "H-4 EAD"], ["I765EAD", "I-765 EAD"], ["COSH4", "Change of Status to H-4"], ["F1REINSTATEMENT", "F-1 Reinstatement"]]) assert.match(text, new RegExp(`${code}: '${name}'`), `${file.join("/")} ${code}`);
  }
});

test("the person's other-cases list shows the proper name, and filings get the SAME case-number sequence as every case (B001 ...), with the portal id set", async () => {
  const rows = [{ _id: "c1", user: "u1", visaType: "I765EAD", status: "active", createdAt: new Date("2026-01-01") }, { _id: "c2", user: "u1", visaType: "H-1B", petitionSubType: "H-1B Transfer", createdAt: new Date("2026-02-01") }];
  const CaseModel = { find: () => ({ select: () => ({ sort: () => ({ limit: () => ({ lean: async () => rows }) }) }) }) };
  const listed = await links.listPersonCases("u1", { CaseModel });
  assert.deepEqual(listed.map((row) => row.visaType), ["I-765 EAD", "H-1B Transfer"], "the same names the rest of the system shows");
  const filing = read(SRC, "modules", "single-party-filings", "single-party-filing.controller.js");
  assert.match(filing, /const caseNumber = await CaseNumberService\.nextPrincipalCaseNumber\(\);/);
  assert.match(filing, /caseId: caseNumber,\s*clientPortalId: caseNumber,/);
  assert.doesNotMatch(filing, /generateCaseNumber/, "the older random 'Immiglance-2026-xxxxx' generator is no longer used for new filings");
  assert.match(filing, /ensureTemplate\(filingType\.questionnaireKey, undefined, undefined, \{ wait: true \}\)/, "a new filing waits for its checklist");
});

test("an employer with several matters: Documents opens the matter selected in the header (or the newest matter), the case-aware document count, and the case-created notices name the case properly", () => {
  const documents = read(ROOT, "Immiglance", "Client", "src", "Pages", "Dashboard", "Documents.jsx");
  assert.match(documents, /const open = openCaseId \? employerCases\.find\(\(item\) => item\._id === openCaseId\) : null;/);
  assert.match(documents, /return <Navigate to=\{`\/dashboard\/documents\/\$\{target\._id\}`\} replace \/>;/);
  assert.match(read(ROOT, "Immiglance", "Client", "src", "services", "api.js"), /count: \(\) => api\.get\(activeCase\.capacity && !activeCase\.capacity\.startsWith\("employer"\) \? withCase\("\/documents\/me\/count"\)/);
  assert.match(read(SRC, "modules", "cases", "clientAccount.service.js"), /message: `\$\{caseDoc\.caseNumber\} - \$\{shownVisa\}`/);
});

test("kill switch: MULTI_CASE_CLIENTS=false restores the one-case rule on every entry point that checks it", () => {
  assert.match(read(SRC, "modules", "cases", "case.controller.js"), /if \(!multiCase && existingHadCase\) \{\s*return res\.status\(409\)/);
  assert.match(read(SRC, "modules", "cases", "clientAccount.service.js"), /if \(!multiCase && hadCase\) throw refuse\(409, "CLIENT_ALREADY_HAS_CASE"/);
  assert.equal(links.multiCaseClientsEnabled({ MULTI_CASE_CLIENTS: "false" }), false);
  assert.equal(links.multiCaseClientsEnabled({}), true);
});
