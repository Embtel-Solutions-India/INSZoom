import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { io } from "socket.io-client";
import { useAuth } from "./AuthContext.jsx";
import { tokenStore } from "../services/api";

const SocketContext = createContext(null);

export const useSocket = () => useContext(SocketContext);

function getSocketUrl() {
  const apiUrl = import.meta.env.VITE_API_URL || "http://localhost:7000/api";
  return apiUrl.replace(/\/api\/?$/, "");
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
      transports: ["websocket", "polling"],
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
