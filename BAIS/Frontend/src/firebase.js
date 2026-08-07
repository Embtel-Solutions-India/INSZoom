import { initializeApp } from "firebase/app";
import { getMessaging } from "firebase/messaging";
import {
  initializeAuth,
  browserLocalPersistence,
  browserPopupRedirectResolver,
  GoogleAuthProvider,
  signInWithRedirect,
  signInWithPopup,
  getRedirectResult,
} from "firebase/auth";

const firebaseConfig = {
  apiKey: "AIzaSyCSHRE5bTfzYvl_WUC-PVAPevSUFDK2jWw",
  // MUST stay the default *.firebaseapp.com domain, not our own custom
  // domain: /__/auth/handler (where Google bounces back to mid-OAuth) is a
  // special asset only Firebase Hosting auto-serves. The app is hosted on
  // AWS, not Firebase Hosting, so a custom authDomain here 404s/blank-pages
  // at that handler no matter what's whitelisted in Google Cloud Console's
  // redirect URIs (that allowlist only controls what Google permits - it
  // doesn't make AWS serve Firebase's page). *.firebaseapp.com is always
  // Firebase-Hosting-backed, so this resolves unconditionally.
  authDomain: "react-oauth-7883c.firebaseapp.com",
  projectId: "react-oauth-7883c",
  storageBucket: "react-oauth-7883c.firebasestorage.app",
  messagingSenderId: "1048148448884",
  appId: "1:1048148448884:web:731dd818b1ed1046676321",
};

const app = initializeApp(firebaseConfig);

// getAuth(app) (the previous approach) internally calls initializeAuth with
// persistence: [indexedDBLocalPersistence, browserLocalPersistence,
// browserSessionPersistence] - IndexedDB first, since it's normally
// available. directlySetCurrentUser() -> assertedPersistence.setCurrentUser()
// writes the signed-in user through whichever persistence won that
// hierarchy - IndexedDB, in practice. On Mac Chrome and Edge (screenshot-
// confirmed) that IndexedDB connection can close/get GC'd right as a popup
// window tears down, mid-write, producing "Error: Database is closing/
// hidden". Passing ONLY browserLocalPersistence here removes IndexedDB from
// the hierarchy entirely - localStorage has no open/close connection
// lifecycle to race against popup teardown.
//
// This is unrelated to (and does not fix) the SEPARATE redirect-pending-
// state mechanism used by signInWithRedirect, which is hardcoded to
// browserSessionPersistence on the resolver itself (BrowserPopupRedirectResolver
// in the installed @firebase/auth SDK) regardless of what's configured here.
//
// popupRedirectResolver is required here - getAuth() supplies it
// automatically (it calls this exact initializeAuth internally with
// popupRedirectResolver: browserPopupRedirectResolver baked in), but a
// direct initializeAuth call does not default it. Omitting it left `auth`
// unable to run signInWithPopup/signInWithRedirect/getRedirectResult at
// all - confirmed via live test: every getRedirectResult() call threw
// FirebaseError auth/argument-error, and Edge's popup path never opened.
//
// initializeAuth and getAuth(app) cannot both be called on the same app
// instance (throws auth/already-initialized) - confirmed via grep that this
// file is the only place in src/ that calls getAuth, so there's nothing
// else to update.
export const auth = initializeAuth(app, {
  persistence: browserLocalPersistence,
  popupRedirectResolver: browserPopupRedirectResolver,
});

export const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: "select_account" });

// Detect browsers confirmed to break signInWithRedirect by deleting
// IndexedDB state for intermediate origins in the navigation chain.
// Currently: Edge (Chromium) - screenshot-confirmed. Chrome/Firefox desktop
// are fine on redirect. Safari/iOS: unknown - left on redirect until tested
// on a real device; the original move away from signInWithPopup for Safari
// was specifically to dodge ITP blocking the cross-origin auth-handler
// iframe (authDomain isn't this app's own domain - see comment above), so
// adding Safari/iOS back here without confirming that risk no longer
// applies would just trade one untested failure mode for a known one.
export function redirectWillLoseState() {
  return /Edg\//.test(navigator.userAgent);
}

// getMessaging() throws in browsers/contexts that don't support Cloud
// Messaging (older Safari, insecure/non-HTTPS origins, no Service Worker
// support) — guarded so an unsupported browser degrades to "no push"
// instead of breaking Google sign-in (auth/googleProvider above), which
// share this same Firebase app instance.
let messagingInstance = null;
try {
  messagingInstance = getMessaging(app);
} catch {
  messagingInstance = null;
}
export const messaging = messagingInstance;

export { signInWithRedirect, signInWithPopup, getRedirectResult };
