let firebaseApp = null;

function getFirebaseAdmin() {
  try {
    const admin = require("firebase-admin");
    if (!firebaseApp) {
      const projectId = process.env.FIREBASE_PROJECT_ID;
      const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
      const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n");

      if (!projectId) {
        const configError = new Error("Firebase project ID is not configured");
        configError.status = 503;
        throw configError;
      }

      if (admin.apps.length) {
        firebaseApp = admin.app();
      } else if (clientEmail && privateKey) {
        firebaseApp = admin.initializeApp({
          credential: admin.credential.cert({ projectId, clientEmail, privateKey }),
          projectId,
        });
      } else {
        firebaseApp = admin.initializeApp({
          projectId,
        });
      }
    }
    return admin;
  } catch (error) {
    if (error.status) throw error;
    const wrapped = new Error("Firebase authentication is not available");
    wrapped.status = 503;
    wrapped.cause = error;
    throw wrapped;
  }
}

async function verifyIdToken(idToken) {
  let decoded;
  try {
    const admin = getFirebaseAdmin();
    decoded = await admin.auth().verifyIdToken(idToken);
  } catch (error) {
    if (error.status) throw error;
    const wrapped = new Error("Invalid Firebase ID token");
    wrapped.status = 401;
    wrapped.cause = error;
    throw wrapped;
  }
  return {
    email: decoded.email,
    emailVerified: decoded.email_verified,
    name: decoded.name,
    displayName: decoded.name,
    picture: decoded.picture,
    provider: "firebase",
    providerId: decoded.uid,
  };
}

module.exports = { verifyIdToken, getFirebaseAdmin };
