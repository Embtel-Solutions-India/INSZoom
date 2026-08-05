import { useEffect, useState } from "react";
import { notificationsApi } from "../../services/api";

const TYPE_STYLES = {
  case: "bg-blue-50 text-blue-700 border-blue-200",
  document: "bg-violet-50 text-violet-700 border-violet-200",
  payment: "bg-emerald-50 text-emerald-700 border-emerald-200",
  message: "bg-amber-50 text-amber-700 border-amber-200",
  appointment: "bg-pink-50 text-pink-700 border-pink-200",
  lead_created: "bg-teal-50 text-teal-700 border-teal-200",
  general: "bg-slate-50 text-slate-700 border-slate-200",
};

export default function Notifications() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    const data = await notificationsApi.my();
    setItems(data);
  };

  useEffect(() => {
    load()
      .catch(() => setItems([]))
      .finally(() => setLoading(false));
  }, []);

  const markRead = async (id) => {
    await notificationsApi.markRead(id);
    await load();
  };

  const markAllRead = async () => {
    await notificationsApi.markAllRead();
    await load();
  };

  return (
    <div className="min-h-screen bg-[#f1f5f9]">
      <div className="bg-linear-to-r from-[#1D9E75] via-teal-600 to-blue-700 text-white">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-7">
          <p className="text-white/70 text-xs font-bold uppercase tracking-widest">
            Notification Center
          </p>
          <h1 className="text-2xl font-extrabold mt-1">Your Updates</h1>
          <p className="text-white/80 text-sm mt-1">
            Track case updates, document notices, payment reminders, and messages.
          </p>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-7">
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between gap-3">
            <div>
              <h2 className="font-extrabold text-slate-800">Notifications</h2>
              <p className="text-xs text-slate-400 mt-0.5">
                {items.filter((n) => !n.read).length} unread
              </p>
            </div>

            <button
              onClick={markAllRead}
              className="rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs px-4 py-2 transition"
            >
              Mark all read
            </button>
          </div>

          {loading ? (
            <div className="p-6 text-sm text-slate-500">Loading...</div>
          ) : items.length === 0 ? (
            <div className="p-8 text-center">
              <p className="font-extrabold text-slate-700">No notifications yet</p>
              <p className="text-sm text-slate-400 mt-1">
                Your case updates will appear here.
              </p>
            </div>
          ) : (
            <ul className="divide-y divide-slate-100">
              {items.map((n) => (
                <li
                  key={n._id}
                  className={`px-5 py-4 flex flex-col sm:flex-row sm:items-center gap-3 ${
                    !n.read ? "bg-emerald-50/30" : "bg-white"
                  }`}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-extrabold text-slate-800 text-sm">{n.title}</p>
                      <span
                        className={`text-[0.62rem] font-bold px-2 py-0.5 rounded-full border ${
                          TYPE_STYLES[n.type] || TYPE_STYLES.general
                        }`}
                      >
                        {n.type}
                      </span>
                      {!n.read && (
                        <span className="text-[0.62rem] font-bold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700">
                          New
                        </span>
                      )}
                    </div>

                    <p className="text-sm text-slate-500 mt-1">{n.message}</p>
                    <p className="text-xs text-slate-400 mt-1">
                      {new Date(n.createdAt).toLocaleString()}
                    </p>
                  </div>

                  {!n.read && (
                    <button
                      onClick={() => markRead(n._id)}
                      className="rounded-xl bg-white border border-slate-200 text-slate-600 hover:bg-slate-50 font-bold text-xs px-4 py-2 transition"
                    >
                      Mark read
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}