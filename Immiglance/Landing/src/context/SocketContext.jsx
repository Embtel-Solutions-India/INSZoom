import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { io } from "socket.io-client";
import { useAuth } from "./AuthContext.jsx";
import { tokenStore } from "../services/api";

const SocketContext = createContext(null);

export const useSocket = () => useContext(SocketContext);

function getSocketUrl() {
  // BUG (fixed): falling back to a dev-only localhost URL when VITE_API_URL
  // is unset is exactly the same class of bug already confirmed live on
  // api.js's own fallback (https://client.immiglance.com calling
  // http://localhost:7000) — a real user's browser can never reach that. In
  // dev, an unset VITE_API_URL should never happen (see .env.development),
  // so no fallback is needed there either; in production, fail loudly
  // instead of silently pointing the socket at localhost.
  const apiUrl = import.meta.env.VITE_API_URL || (import.meta.env.DEV ? "/api" : (() => {
    console.error("[FATAL CONFIG] VITE_API_URL is not set in this production build — the realtime socket cannot connect. Set it in the build server's environment before deploying.");
    return "https://MISSING-VITE_API_URL.invalid/api";
  })());
  // Strip the "/api" suffix to get the realtime origin. When VITE_API_URL is a
  // relative base ("/api"), this strips to "" — fall back to the current origin
  // so the socket connects same-origin and is proxied to the backend. Absolute
  // URLs (production) are returned unchanged.
  return apiUrl.replace(/\/api\/?$/, "") || window.location.origin;
}

export function SocketProvider({ children }) {
  const { user } = useAuth();
  const [socket, setSocket] = useState(null);

  useEffect(() => {
    if (!user?._id) {
      setSocket(null);
      return;
    }

    const newSocket = io(getSocketUrl(), {
      // BUG (fixed): forcing websocket as the FIRST transport fails
      // repeatedly (reconnecting every ~1s) when running through Vite's dev
      // proxy — confirmed live: a plain HTTP polling handshake through the
      // same proxy succeeds immediately, only the direct websocket-first
      // connection attempt does not. In dev, start with polling (which
      // reliably works through the proxy) and let socket.io upgrade to
      // websocket afterward, same as its own documented default order; kept
      // websocket-first in production, where the client connects same-origin
      // with no dev proxy in between.
      transports: import.meta.env.DEV ? ["polling", "websocket"] : ["websocket", "polling"],
      // A function (not a static object) so every reconnection attempt —
      // not just the first connect — reads the current access token. A
      // static token here would get silently and permanently rejected by
      // the server after any token rotation, since socket.io keeps retrying
      // with whatever was captured at the original `io()` call.
      auth: (callback) => callback({ token: tokenStore.getAccess() }),
      reconnection: true,
    });

    newSocket.emit("join", user._id);
    setSocket(newSocket);

    return () => {
      newSocket.disconnect();
    };
  }, [user?._id]);

  const value = useMemo(() => socket, [socket]);

  return (
    <SocketContext.Provider value={value}>
      {children}
    </SocketContext.Provider>
  );
}
