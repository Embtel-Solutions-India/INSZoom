import { initializeApp } from "firebase/app";
import { getMessaging } from "firebase/messaging";

const firebaseConfig = {
  apiKey: "AIzaSyCSHRE5bTfzYvl_WUC-PVAPevSUFDK2jWw",
  authDomain: "react-oauth-7883c.firebaseapp.com",
  projectId: "react-oauth-7883c",
  storageBucket: "react-oauth-7883c.firebasestorage.app",
  messagingSenderId: "1048148448884",
  appId: "1:1048148448884:web:731dd818b1ed1046676321",
};
const app = initializeApp(firebaseConfig);
let messagingInstance = null;
try { messagingInstance = getMessaging(app); } catch { messagingInstance = null; }
export const messaging = messagingInstance;