import { initializeApp } from "firebase/app";
import { getMessaging } from "firebase/messaging";
import { getAuth, GoogleAuthProvider } from "firebase/auth";

const firebaseConfig = {
  apiKey: "AIzaSyCSHRE5bTfzYvl_WUC-PVAPevSUFDK2jWw",
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

export { auth, googleProvider };