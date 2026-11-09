import { useEffect } from "react";
import { onForegroundMessage, showMessagePushInForeground } from "../services/notificationService";

// A new message while the portal is open and focused: the browser hands it to the page and shows nothing by itself, so this shows the browser notification
// (unless the person is on the Messages page, where it appears live). Renders nothing, never throws, never affects the page.
export default function ForegroundMessagePush() {
  useEffect(() => onForegroundMessage((payload) => {
    try { Promise.resolve(showMessagePushInForeground?.(payload)).catch(() => {}); } catch { /* a notification problem never reaches the page */ }
  }), []);
  return null;
}
