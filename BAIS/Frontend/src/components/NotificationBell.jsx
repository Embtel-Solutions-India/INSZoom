import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSocket } from "../context/SocketContext";
import { notificationsApi } from "../services/api";
import { onForegroundMessage, requestPermissionAndGetToken } from "../services/notificationService";

const NOTIFICATIONS_QUERY_KEY = ["notifications", "my"];

const TYPE_STYLES = {
  case: "bg-blue-100 text-blue-700",
  document: "bg-violet-100 text-violet-700",
  payment: "bg-emerald-100 text-emerald-700",
  message: "bg-amber-100 text-amber-700",
  appointment: "bg-pink-100 text-pink-700",
  lead_created: "bg-teal-100 text-teal-700",
  general: "bg-slate-100 text-slate-700",
};

const fmt = (iso) => {
  if (!iso) return "";
  const d = new Date(iso);
  const now = new Date();
  const diff = (now - d) / 1000;
  if (diff < 60) return "Just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return d.toLocaleDateString("en-US", { day: "numeric", month: "short" });
};

export default function NotificationBell() {
  const socket = useSocket();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  // Perf fix: previously a raw fetch on every mount with no caching — now
  // shares one TanStack Query cache entry across page navigations
  // (staleTime 60s means most nav changes serve this from cache instead of
  // refetching). The live Socket.IO/FCM push handlers below write straight
  // into this same cache entry via queryClient.setQueryData instead of a
  // local setItems, so polling and live push share one source of truth.
  const { data: items = [] } = useQuery({
    queryKey: NOTIFICATIONS_QUERY_KEY,
    queryFn: notificationsApi.my,
    staleTime: 60_000,
  });
  const [open, setOpen] = useState(false);
  const [pushPermission, setPushPermission] = useState(
    typeof Notification !== "undefined" ? Notification.permission : "unsupported"
  );
  const [enablingPush, setEnablingPush] = useState(false);
  const dropRef = useRef(null);

  // User-driven only — this button click is the ONLY place the browser's
  // permission prompt fires from; nothing here runs automatically on
  // mount/login (see notificationService.js's initializeNotifications,
  // which only silently re-registers an already-granted permission).
  const enablePush = async () => {
    setEnablingPush(true);
    try {
      await requestPermissionAndGetToken();
    } finally {
      setPushPermission(typeof Notification !== "undefined" ? Notification.permission : "unsupported");
      setEnablingPush(false);
    }
  };

  const addLive = (n) => {
    queryClient.setQueryData(NOTIFICATIONS_QUERY_KEY, (prev = []) =>
      prev.some((existing) => existing._id === n._id) ? prev : [n, ...prev]
    );
  };

  useEffect(() => {
    if (socket) {
      socket.on("new_notification", addLive);
      return () => socket.off("new_notification", addLive);
    }
  }, [socket]);

  // Foreground FCM — supplementary to Socket.IO (which stays primary while
  // the tab is open); de-duplicated by _id in addLive above in case both
  // deliver the same notification.
  useEffect(() => onForegroundMessage((payload) => {
    // The push payload's `data` is string-only IDs (see push.service.js's
    // buildMessage) — the display text lives in `payload.notification`.
    // Reconstruct the shape the bell already expects from both.
    const id = payload.data?.notificationId;
    if (!id) return;
    addLive({
      _id: id,
      title: payload.notification?.title,
      message: payload.notification?.body,
      type: payload.data?.type,
      link: payload.data?.link,
      read: false,
      createdAt: new Date().toISOString(),
    });
  }), []);

  // A background push notification was clicked — the service worker
  // postMessage()s the app instead of doing a full-page navigate() so the
  // SPA's router (and all its state) stays intact.
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return undefined;
    const handler = (event) => {
      if (event.data?.type === "notification-click" && event.data.link) navigate(event.data.link);
    };
    navigator.serviceWorker.addEventListener("message", handler);
    return () => navigator.serviceWorker.removeEventListener("message", handler);
  }, [navigate]);

  useEffect(() => {
    const handler = (e) => {
      if (dropRef.current && !dropRef.current.contains(e.target)) setOpen(false);
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    document.addEventListener("keydown", handler);
    return () => {
      document.removeEventListener("mousedown", handler);
      document.removeEventListener("keydown", handler);
    };
  }, []);

  const unreadCount = items.filter((n) => !n.read).length;

  const markRead = async (id) => {
    try {
      await notificationsApi.markRead(id);
      queryClient.setQueryData(NOTIFICATIONS_QUERY_KEY, (prev = []) => prev.map((n) => n._id === id ? { ...n, read: true } : n));
    } catch { /* fail */ }
  };

  const markAllRead = async () => {
    try {
      await notificationsApi.markAllRead();
      queryClient.setQueryData(NOTIFICATIONS_QUERY_KEY, (prev = []) => prev.map((n) => ({ ...n, read: true })));
    } catch { /* fail */ }
  };

  const handleItemClick = (n) => {
    if (!n.read) markRead(n._id);
    if (n.link) {
      setOpen(false);
      navigate(n.link);
    }
  };

  return (
    <div className="relative" ref={dropRef}>
      <button onClick={() => setOpen(!open)}
        className="w-10 h-10 rounded-xl flex items-center justify-center text-slate-500 hover:bg-slate-100 transition relative">
        <svg width="20" height="20" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"/>
        </svg>
        {unreadCount > 0 && (
          <span className="absolute top-2 right-2 w-4 h-4 bg-red-500 text-white text-[0.6rem] font-bold rounded-full flex items-center justify-center ring-2 ring-white">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-80 sm:w-96 bg-white rounded-2xl border border-slate-200 shadow-xl overflow-hidden z-[60] animate-[fadeDown_0.15s_ease_forwards]">
          <div className="px-5 py-3.5 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
            <h3 className="font-extrabold text-slate-800 text-xs uppercase tracking-wider">Notifications</h3>
            {unreadCount > 0 && (
              <button onClick={markAllRead} className="text-[0.65rem] font-bold text-emerald-600 hover:text-emerald-700 uppercase tracking-wide">
                Mark all read
              </button>
            )}
          </div>

          {pushPermission === "default" && (
            <div className="px-5 py-3 border-b border-slate-100 bg-emerald-50/60 flex items-center justify-between gap-3">
              <p className="text-xs text-slate-600 leading-snug">Get notified instantly, even when this tab isn't open.</p>
              <button
                onClick={enablePush}
                disabled={enablingPush}
                className="shrink-0 text-[0.65rem] font-bold text-white bg-[#1D9E75] hover:bg-[#0F6E56] px-3 py-1.5 rounded-lg uppercase tracking-wide disabled:opacity-60 cursor-pointer"
              >
                {enablingPush ? "Enabling…" : "Enable"}
              </button>
            </div>
          )}

          <div className="max-h-[400px] overflow-y-auto">
            {items.length === 0 ? (
              <div className="py-10 text-center px-6">
                <p className="text-sm font-bold text-slate-700">No notifications yet</p>
                <p className="text-xs text-slate-400 mt-1">Updates about your case will appear here.</p>
              </div>
            ) : (
              <ul className="divide-y divide-slate-50">
                {items.map((n) => (
                  <li key={n._id} className={`px-5 py-4 transition flex gap-3 ${!n.read ? 'bg-emerald-50/30' : 'hover:bg-slate-50'} ${n.link ? 'cursor-pointer' : ''}`}>
                    <div className="flex-1 min-w-0" onClick={() => handleItemClick(n)}>
                      <div className="flex items-start justify-between gap-2">
                        <p className={`text-sm leading-snug ${!n.read ? 'font-bold text-slate-800' : 'text-slate-600'}`}>{n.title}</p>
                        <span className={`text-[0.55rem] font-black px-1.5 py-0.5 rounded-full shrink-0 uppercase tracking-tighter ${TYPE_STYLES[n.type] || TYPE_STYLES.general}`}>
                          {n.type}
                        </span>
                      </div>
                      <p className="text-xs text-slate-500 mt-1 leading-relaxed">{n.message}</p>
                      <p className="text-[0.62rem] text-slate-400 mt-1.5 font-medium">{fmt(n.createdAt)}</p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}