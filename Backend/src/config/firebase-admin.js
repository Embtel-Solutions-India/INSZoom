const { initializeApp, getApps, getApp: getSdkApp, cert } = require("firebase-admin/app");
const { getMessaging: getMessagingForApp } = require("firebase-admin/messaging");

// Centralized Firebase Admin init for FCM (push notifications) ONLY — this
// process has no other Firebase Admin usage (Firebase Auth was removed
// entirely; Google OAuth login and Google Document AI each use their own,
// separately-configured Google credentials — see google-oauth.service.js
// and the document-intelligence google-document-ai.provider.js — neither
// touches these FIREBASE_* vars or this module). One credential set, read
// directly from env here (matching how the Document AI provider reads its
// own GOOGLE_SERVICE_ACCOUNT_* vars directly rather than through env.js),
// one lazily-constructed app, reused by every call. Uses firebase-admin's
// modular API (subpath imports) — v14 no longer exposes admin.apps/
// admin.credential/admin.messaging() on a single default namespace import.

function buildCredentials() {
  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const rawPrivateKey = process.env.FIREBASE_PRIVATE_KEY;
  if (!projectId || !clientEmail || !rawPrivateKey) return null;
  // .env can't hold real newlines, so the key is stored with literal "\n"
  // sequences — the SDK needs an actual multi-line PEM string.
  return { projectId, clientEmail, privateKey: rawPrivateKey.replace(/\\n/g, "\n") };
}

function isConfigured() {
  return Boolean(buildCredentials());
}

function configError(message) {
  const error = new Error(message);
  error.statusCode = 503;
  error.code = "FCM_NOT_CONFIGURED";
  return error;
}

let initError = null;

// Lazy — never called at require time (nothing in app.js/server.js imports
// this at startup), so a missing/invalid Firebase config can't crash
// startup; it only surfaces as a controlled error the first time an actual
// push send is attempted. Guards against re-initializing on module reload
// (e.g. test runners) by reusing an already-initialized app instead of
// throwing "app already exists".
function getFcmApp() {
  if (getApps().length) return getSdkApp();
  if (initError) throw initError;
  const credentials = buildCredentials();
  if (!credentials) {
    initError = configError("Firebase Admin credentials are not configured");
    throw initError;
  }
  try {
    return initializeApp({ credential: cert(credentials) });
  } catch (error) {
    initError = configError(`Failed to initialize Firebase Admin: ${error.message}`);
    throw initError;
  }
}

function getMessaging() {
  return getMessagingForApp(getFcmApp());
}

module.exports = { isConfigured, getMessaging };
