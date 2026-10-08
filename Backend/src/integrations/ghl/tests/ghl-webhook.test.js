const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("crypto");
const http = require("http");

const { verifyGhlSignature, loadPublicKey } = require("../ghlWebhookSignature");
const { decideInboundStage, firstValidDate, MAX_DEFERRALS } = require("../ghlStageDecision");

// GHL's official public key as published in their Webhook Integration Guide.
const GHL_OFFICIAL_KEY = "MCowBQYDK2VwAyEAi2HR1srL4o18O8BRa7gVJY7G7bupbN3H9AwJrHCDiOg=";

// A throwaway key pair generated in memory for tests only (never written anywhere).
const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
const testPublicPem = publicKey.export({ type: "spki", format: "pem" });
const testPublicB64 = publicKey.export({ type: "spki", format: "der" }).toString("base64");
const sign = (buf) => crypto.sign(null, buf, privateKey).toString("base64");

// ---- signature -------------------------------------------------------------

test("GHL's official public key is a valid Ed25519 key", () => {
  const key = loadPublicKey(GHL_OFFICIAL_KEY);
  assert.equal(key.asymmetricKeyType, "ed25519");
  const pem = `-----BEGIN PUBLIC KEY-----\n${GHL_OFFICIAL_KEY}\n-----END PUBLIC KEY-----`;
  assert.equal(loadPublicKey(pem).asymmetricKeyType, "ed25519");
  assert.equal(loadPublicKey(pem.replace(/\n/g, "\\n")).asymmetricKeyType, "ed25519"); // .env-style escaped newlines
});

test("a correct signature over the exact raw bytes verifies (PEM and bare base64 keys)", () => {
  const body = Buffer.from('{"type":"OpportunityCreate","id":"o1"}');
  assert.equal(verifyGhlSignature(body, sign(body), testPublicPem).ok, true);
  assert.equal(verifyGhlSignature(body, sign(body), testPublicB64).ok, true);
});

test("any change to the body bytes (even whitespace) fails verification", () => {
  const body = Buffer.from('{"type":"OpportunityCreate","id":"o1"}');
  const signature = sign(body);
  assert.equal(verifyGhlSignature(Buffer.from('{"type":"OpportunityCreate", "id":"o1"}'), signature, testPublicPem).reason, "signature_mismatch");
  assert.equal(verifyGhlSignature(Buffer.from('{"type":"OpportunityCreate","id":"o2"}'), signature, testPublicPem).ok, false);
});

test("wrong key, missing/malformed signature, empty body and bad key all fail closed", () => {
  const body = Buffer.from("{}");
  const other = crypto.generateKeyPairSync("ed25519").publicKey.export({ type: "spki", format: "der" }).toString("base64");
  assert.equal(verifyGhlSignature(body, sign(body), other).ok, false);
  assert.equal(verifyGhlSignature(body, undefined, testPublicPem).reason, "missing_signature");
  assert.equal(verifyGhlSignature(body, "not-base64!!", testPublicPem).reason, "malformed_signature");
  assert.equal(verifyGhlSignature(Buffer.alloc(0), sign(body), testPublicPem).reason, "empty_body");
  assert.equal(verifyGhlSignature(body, sign(body), "").reason, "bad_public_key");
  const rsa = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 }).publicKey.export({ type: "spki", format: "pem" });
  assert.equal(verifyGhlSignature(body, sign(body), rsa).reason, "bad_public_key"); // only Ed25519 accepted
});

// ---- conflict rule ---------------------------------------------------------

const ghlState = (over = {}) => ({
  pipelineId: "pA",
  pipelineStageId: "A1",
  sync: { state: "synced", source: "ghl", changedAt: new Date("2026-10-08T10:00:00Z"), ...over },
});
const incoming = (over = {}) => ({ pipelineId: "pA", stageId: "A2", eventTime: new Date("2026-10-08T10:05:00Z"), ...over });

test("same stage already stored is a no-op (echo of our own write or duplicate)", () => {
  assert.equal(decideInboundStage({ ghl: ghlState(), incoming: incoming({ stageId: "A1" }) }).action, "noop");
});

test("a newer GHL change is applied", () => {
  assert.equal(decideInboundStage({ ghl: ghlState(), incoming: incoming() }).action, "apply");
});

test("an older (late or reordered) GHL event is ignored", () => {
  const decision = decideInboundStage({ ghl: ghlState(), incoming: incoming({ eventTime: new Date("2026-10-08T09:00:00Z") }) });
  assert.equal(decision.action, "ignore_older");
});

test("unknown event time is applied (GHL owns the stage)", () => {
  assert.equal(decideInboundStage({ ghl: ghlState(), incoming: incoming({ eventTime: null }) }).action, "apply");
});

test("while our own outbound change is unresolved, the inbound event is deferred", () => {
  const ghl = ghlState({ state: "pending", source: "immiglance" });
  const decision = decideInboundStage({ ghl, incoming: incoming(), attempts: 0 });
  assert.equal(decision.action, "defer");
  assert.ok(decision.delayMs > 0);
});

test("after the wait budget the timestamp rule decides (newer applies, older is ignored)", () => {
  const ghl = ghlState({ state: "pending", source: "immiglance" });
  assert.equal(decideInboundStage({ ghl, incoming: incoming(), attempts: MAX_DEFERRALS }).action, "apply");
  assert.equal(
    decideInboundStage({ ghl, incoming: incoming({ eventTime: new Date("2026-10-08T09:00:00Z") }), attempts: MAX_DEFERRALS }).action,
    "ignore_older"
  );
});

test("firstValidDate handles ISO strings, epoch millis and junk", () => {
  assert.equal(firstValidDate("garbage", "2026-10-08T10:00:00Z").toISOString(), "2026-10-08T10:00:00.000Z");
  assert.equal(firstValidDate(1791304691553).getTime(), 1791304691553);
  assert.equal(firstValidDate(null, undefined, ""), null);
});

// ---- HTTP route through the real app.js (DB stubbed) ------------------------

const env = require("../../../config/env");
const GHLWebhookEvent = require("../../../models/GHLWebhookEvent");
const webhookService = require("../ghlWebhookService");

async function withServer(fn) {
  const app = require("../../../app");
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const url = `http://127.0.0.1:${server.address().port}/api/integrations/ghl/webhooks`;
  try {
    await fn(url);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

const post = (url, body, signature, extra = {}) =>
  fetch(url, { method: "POST", headers: { "content-type": "application/json", ...(signature ? { "x-ghl-signature": signature } : {}), ...extra }, body });

test("webhook route: disabled, no key, bad signature, location, duplicate and happy path", async (t) => {
  const original = { ...env.ghl };
  const originalCreate = GHLWebhookEvent.create;
  const originalSoon = webhookService.processEventSoon;
  const created = [];
  GHLWebhookEvent.create = async (doc) => {
    if (created.some((c) => c.webhookId === doc.webhookId)) throw Object.assign(new Error("dup"), { code: 11000 });
    created.push(doc);
    return { _id: "evt1", ...doc };
  };
  t.after(() => {
    Object.assign(env.ghl, original);
    GHLWebhookEvent.create = originalCreate;
    webhookService.processEventSoon = originalSoon;
  });

  const payload = (over = {}) => JSON.stringify({ type: "OpportunityCreate", locationId: "LOC1", id: "opp1", webhookId: "wh-1", timestamp: new Date().toISOString(), ...over });

  await withServer(async (url) => {
    // Integration off -> inert.
    Object.assign(env.ghl, { enabled: false, webhookPublicKey: testPublicB64, locationId: "LOC1" });
    assert.equal((await post(url, payload(), sign(Buffer.from(payload())))).status, 503);

    // Enabled but no public key configured -> refuses (fails closed).
    Object.assign(env.ghl, { enabled: true, webhookPublicKey: "" });
    assert.equal((await post(url, payload(), sign(Buffer.from(payload())))).status, 503);

    Object.assign(env.ghl, { enabled: true, webhookPublicKey: testPublicB64, locationId: "LOC1", webhookToleranceSeconds: 86400 });

    // Unsigned / forged / tampered -> 401 and nothing stored.
    assert.equal((await post(url, payload())).status, 401);
    assert.equal((await post(url, payload(), "AAAA")).status, 401);
    const good = payload();
    assert.equal((await post(url, good.replace("opp1", "opp2"), sign(Buffer.from(good)))).status, 401);
    assert.equal(created.length, 0);

    // Verify-before-parse: garbage + bad signature is 401 (not 400); garbage + good signature is 400.
    assert.equal((await post(url, "not json", "AAAA")).status, 401);
    assert.equal((await post(url, "not json", sign(Buffer.from("not json")))).status, 400);

    // Signed, but for another location / an event we don't handle -> acknowledged, not stored.
    const other = payload({ locationId: "OTHER" });
    assert.equal((await post(url, other, sign(Buffer.from(other)))).status, 200);
    const unhandled = payload({ type: "NoteCreate" });
    assert.equal((await post(url, unhandled, sign(Buffer.from(unhandled)))).status, 200);
    assert.equal(created.length, 0);

    // Stale timestamp -> acknowledged, not stored.
    const stale = payload({ timestamp: "2020-01-01T00:00:00Z", webhookId: "wh-old" });
    const staleResponse = await post(url, stale, sign(Buffer.from(stale)));
    assert.equal((await staleResponse.json()).ignored, "stale");
    assert.equal(created.length, 0);

    // Happy path: stored once, processing kicked off.
    let kicked = null;
    webhookService.processEventSoon = (id) => { kicked = id; };
    const ok = await post(url, good, sign(Buffer.from(good)));
    assert.equal(ok.status, 200);
    assert.equal(created.length, 1);
    assert.equal(created[0].webhookId, "wh-1");
    assert.equal(created[0].opportunityId, "opp1");
    assert.equal(kicked, "evt1");

    // Same webhookId again -> 200 duplicate, nothing new stored, no second processing.
    kicked = null;
    const dup = await post(url, good, sign(Buffer.from(good)));
    assert.equal((await dup.json()).duplicate, true);
    assert.equal(created.length, 1);
    assert.equal(kicked, null);
  });
});

test("an id-less payload is still deduped by a content hash", async (t) => {
  const original = { ...env.ghl };
  const originalCreate = GHLWebhookEvent.create;
  let stored;
  GHLWebhookEvent.create = async (doc) => { stored = doc; return { _id: "e", ...doc }; };
  t.after(() => { Object.assign(env.ghl, original); GHLWebhookEvent.create = originalCreate; });
  Object.assign(env.ghl, { enabled: true, webhookPublicKey: testPublicB64, locationId: "LOC1" });
  const body = Buffer.from(JSON.stringify({ type: "ContactUpdate", locationId: "LOC1", id: "c1" }));
  const result = await webhookService.receiveWebhook(body, { "x-ghl-signature": sign(body) });
  assert.equal(result.status, 200);
  assert.match(stored.webhookId, /^sha256:[0-9a-f]{64}$/);
});
