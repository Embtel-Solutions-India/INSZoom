import { initializeApp } from "firebase/app";
import { getMessaging } from "firebase/messaging";
import { getAuth, GoogleAuthProvider, signInWithRedirect, getRedirectResult } from "firebase/auth";

const firebaseConfig = {
  apiKey: "AIzaSyCSHRE5bTfzYvl_WUC-PVAPevSUFDK2jWw",
  // MUST stay the default *.firebaseapp.com domain, not our own custom
  // domain: /__/auth/handler (where Google bounces back to mid-OAuth) is a
  // special asset only Firebase Hosting auto-serves. The app is hosted on
  // AWS, not Firebase Hosting, so a custom authDomain here 404s/blank-pages
  // at that handler no matter what's whitelisted in Google Cloud Console's
  // redirect URIs (that allowlist only controls what Google permits - it
  // doesn't make AWS serve Firebase's page). *.firebaseapp.com is always
  // Firebase-Hosting-backed, so this resolves unconditionally. The Mac/
  // Safari popup bug this domain change was meant to prevent is already
  // fixed by signInWithRedirect (see AuthContext.jsx) - that switch doesn't
  // depend on authDomain matching our own domain.
  authDomain: "react-oauth-7883c.firebaseapp.com",
  projectId: "react-oauth-7883c",
  storageBucket: "react-oauth-7883c.firebasestorage.app",
  messagingSenderId: "1048148448884",
  appId: "1:1048148448884:web:731dd818b1ed1046676321"
};

const app = initializeApp(firebaseConfig);
// getMessaging() throws in browsers/contexts that don't support Cloud
// Messaging (older Safari, insecure/non-HTTPS origins, no Service Worker
// support) — guarded so an unsupported browser degrades to "no push"
// instead of breaking Google sign-in (auth/googleProvider below), which
// share this same Firebase app instance.
let messagingInstance = null;
try {
  messagingInstance = getMessaging(app);
} catch {
  messagingInstance = null;
}
export const messaging = messagingInstance;
const auth = getAuth(app);
const googleProvider = new GoogleAuthProvider();

export { auth, googleProvider, signInWithRedirect, getRedirectResult };