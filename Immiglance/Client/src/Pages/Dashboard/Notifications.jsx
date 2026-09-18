import { useEffect, useState } from "react";
import { notificationsApi } from "../../services/api";

const TYPE_STYLES = {
  case: "bg-blue-50 text-blue-700 border-blue-200",
  document: "bg-violet-50 text-violet-700 border-violet-200",
  payment: "bg-accent text-accent-foreground border-accent-foreground/20",
  message: "bg-amber-50 text-amber-700 border-amber-200",
  appointment: "bg-pink-50 text-pink-700 border-pink-200",
  lead_created: "bg-accent text-accent-foreground border-accent-foreground/20",
  general: "bg-secondary text-secondary-foreground border-border",
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
    <div className="min-h-screen bg-background">
      <div className="bg-primary text-primary-foreground">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-7">
          <p className="text-primary-foreground/70 text-xs font-bold uppercase tracking-widest">
            Notification Center
          </p>
          <h1 className="text-2xl font-serif font-bold mt-1">Your Updates</h1>
          <p className="text-primary-foreground/80 text-sm mt-1">
            Track case updates, document notices, payment reminders, and messages.
          </p>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-7">
        <div className="bg-card rounded-2xl border border-border shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-border flex items-center justify-between gap-3">
            <div>
              <h2 className="font-bold text-foreground">Notifications</h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                {items.filter((n) => !n.read).length} unread
              </p>
            </div>

            <button
              onClick={markAllRead}
              className="rounded-xl bg-secondary hover:bg-secondary/70 text-secondary-foreground font-bold text-xs px-4 py-2 transition"
            >
              Mark all read
            </button>
          </div>

          {loading ? (
            <div className="p-6 text-sm text-muted-foreground">Loading...</div>
          ) : items.length === 0 ? (
            <div className="p-8 text-center">
              <p className="font-bold text-foreground">No notifications yet</p>
              <p className="text-sm text-muted-foreground mt-1">
                Your case updates will appear here.
              </p>
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {items.map((n) => (
                <li
                  key={n._id}
                  className={`px-5 py-4 flex flex-col sm:flex-row sm:items-center gap-3 ${
                    !n.read ? "bg-accent/30" : "bg-card"
                  }`}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-bold text-foreground text-sm">{n.title}</p>
                      <span
                        className={`text-[0.62rem] font-bold px-2 py-0.5 rounded-full border ${
                          TYPE_STYLES[n.type] || TYPE_STYLES.general
                        }`}
                      >
                        {n.type}
                      </span>
                      {!n.read && (
                        <span className="text-[0.62rem] font-bold px-2 py-0.5 rounded-full bg-accent text-accent-foreground">
                          New
                        </span>
                      )}
                    </div>

                    <p className="text-sm text-muted-foreground mt-1">{n.message}</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      {new Date(n.createdAt).toLocaleString()}
                    </p>
                  </div>

                  {!n.read && (
                    <button
                      onClick={() => markRead(n._id)}
                      className="rounded-xl bg-card border border-border text-foreground hover:bg-secondary font-bold text-xs px-4 py-2 transition"
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