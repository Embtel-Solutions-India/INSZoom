const { OAuth2Client } = require("google-auth-library");
const env = require("../../config/env");

let client = null;

function getClient() {
  if (!env.google.oauthConfigured) {
    const error = new Error("Google sign-in is not configured");
    error.status = 503;
    error.code = "GOOGLE_OAUTH_NOT_CONFIGURED";
    throw error;
  }
  if (!client) {
    client = new OAuth2Client(env.google.oauthClientId, env.google.oauthClientSecret, env.google.oauthRedirectUri);
  }
  return client;
}

function isConfigured() {
  return env.google.oauthConfigured;
}

function buildAuthUrl(state) {
  const oauthClient = getClient();
  return oauthClient.generateAuthUrl({
    access_type: "online",
    scope: ["openid", "email", "profile"],
    state,
    prompt: "select_account",
  });
}

// Exchanges an authorization `code` for a verified Google identity, in the
// same shape the removed Firebase verifier used to produce — this is the
// only function that touches the OAuth client secret or the token
// response; callers only ever see the returned identity.
async function exchangeCodeForIdentity(code) {
  const oauthClient = getClient();
  let tokens;
  try {
    ({ tokens } = await oauthClient.getToken(code));
  } catch (error) {
    const wrapped = new Error("Failed to exchange Google authorization code");
    wrapped.status = 401;
    wrapped.code = "GOOGLE_OAUTH_CODE_EXCHANGE_FAILED";
    throw wrapped;
  }
  if (!tokens?.id_token) {
    const error = new Error("Google did not return an ID token");
    error.status = 401;
    error.code = "GOOGLE_OAUTH_NO_ID_TOKEN";
    throw error;
  }
  let payload;
  try {
    const ticket = await oauthClient.verifyIdToken({ idToken: tokens.id_token, audience: env.google.oauthClientId });
    payload = ticket.getPayload();
  } catch (error) {
    const wrapped = new Error("Google ID token verification failed");
    wrapped.status = 401;
    wrapped.code = "GOOGLE_OAUTH_INVALID_ID_TOKEN";
    throw wrapped;
  }
  if (!payload?.email) {
    const error = new Error("Google identity did not include an email address");
    error.status = 400;
    error.code = "GOOGLE_OAUTH_NO_EMAIL";
    throw error;
  }
  return {
    email: payload.email,
    name: payload.name,
    displayName: payload.name,
    picture: payload.picture,
    emailVerified: Boolean(payload.email_verified),
  };
}

module.exports = {
  isConfigured,
  buildAuthUrl,
  exchangeCodeForIdentity,
};
