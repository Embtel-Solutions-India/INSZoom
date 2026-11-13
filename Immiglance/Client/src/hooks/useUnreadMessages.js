import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSocket } from "../context/SocketContext";
import { messagesApi } from "../services/api";

// The number of unopened messages (all chats) for the sidebar badge. Same query key as the dashboard's "unread messages" tile, so they share one request.
// Refreshed every 30 s as a fallback and instantly when a message arrives; the Messages page refreshes it as soon as a chat is opened (see refreshUnreadMessages).
export const UNREAD_MESSAGES_KEY = ["messages", "unread-count"];

const CHANGED = "client:unread-messages-changed";

/** Called by the Messages page when a chat is opened (marked read): the sidebar badge re-reads the count at once. A plain window event, so the page needs no query provider. */
export const refreshUnreadMessages = () => { try { window.dispatchEvent(new Event(CHANGED)); } catch { /* badge only */ } };

export default function useUnreadMessages() {
  const queryClient = useQueryClient();
  const socket = useSocket();
  const { data } = useQuery({ queryKey: UNREAD_MESSAGES_KEY, queryFn: messagesApi.getUnreadCount, retry: false, refetchInterval: 30 * 1000 });
  useEffect(() => {
    if (!socket?.on) return undefined;
    const refresh = () => queryClient.invalidateQueries({ queryKey: UNREAD_MESSAGES_KEY });
    socket.on("message:new", refresh);
    return () => socket.off("message:new", refresh);
  }, [socket, queryClient]);
  useEffect(() => {
    const refresh = () => queryClient.invalidateQueries({ queryKey: UNREAD_MESSAGES_KEY });
    window.addEventListener(CHANGED, refresh);
    return () => window.removeEventListener(CHANGED, refresh);
  }, [queryClient]);
  const count = Number(data?.unreadCount ?? data?.count ?? 0);
  return Number.isFinite(count) && count > 0 ? count : 0;
}
