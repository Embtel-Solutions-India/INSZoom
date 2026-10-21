import { useEffect, useRef } from "react";
import { useSocket } from "../context/SocketContext";
import { useAuth } from "../context/AuthContext";

// Calls `onChange` (debounced) when the server says something on this case changed - an answer saved, a document uploaded / reviewed, a checklist
// approved - by anyone: the case manager in Admin, another staff member, the employer, another tab. The payload carries no data, so `onChange` just
// re-reads through the normal API. `skipOwn` ignores changes this same user made (their own save already updates the screen). A no-op without a
// socket or without a caseId, so it is safe in any hook / test.
export default function useCaseDataChanged(caseId, onChange, { skipOwn = false, delayMs = 400 } = {}) {
  const socket = useSocket();
  const auth = useAuth();
  const myId = String(auth?.user?._id || auth?.user?.id || "");
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    if (!socket?.on || !caseId) return undefined;
    let timer = null;
    const handle = (payload) => {
      if (String(payload?.caseId) !== String(caseId)) return;
      if (skipOwn && myId && String(payload?.actorId || "") === myId) return;
      clearTimeout(timer);
      timer = setTimeout(() => {
        try { onChangeRef.current?.(payload); } catch { /* a live refresh must never break the screen */ }
      }, delayMs);
    };
    socket.on("case:data_changed", handle);
    return () => {
      clearTimeout(timer);
      socket.off("case:data_changed", handle);
    };
  }, [socket, caseId, skipOwn, myId, delayMs]);
}
