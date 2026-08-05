import { useEffect, useState } from "react";
import { notificationsApi } from "../services/api";

const CHANNEL_LABELS = [
  { channel: "push", label: "Browser push" },
  { channel: "in_app", label: "In-app" },
  { channel: "email", label: "Email" },
];

function isChannelEnabled(preferences, channel) {
  const entry = preferences?.channels?.find((item) => item.channel === channel);
  return entry ? entry.enabled : true;
}

export default function NotificationPreferencesCard() {
  const [preferences, setPreferences] = useState(null);
  const [saving, setSaving] = useState("");

  useEffect(() => {
    notificationsApi.getPreferences()
      .then((data) => setPreferences(data.preferences))
      .catch(() => {});
  }, []);

  const toggle = async (channel) => {
    if (!preferences) return;
    const nextEnabled = !isChannelEnabled(preferences, channel);
    const nextChannels = [
      ...(preferences.channels || []).filter((item) => item.channel !== channel),
      { channel, enabled: nextEnabled },
    ];
    setSaving(channel);
    try {
      // PUT replaces the whole preferences document server-side, so send
      // everything we already have back, only changing `channels` — not
      // just the one field, or the rest of the preference doc gets wiped.
      const { preferences: updated } = await notificationsApi.updatePreferences({ ...preferences, channels: nextChannels });
      setPreferences(updated);
    } catch {
      /* leave preferences unchanged on failure */
    } finally {
      setSaving("");
    }
  };

  if (!preferences) return null;

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <p className="text-xs font-black uppercase tracking-wide text-slate-400">Notification preferences</p>
      <div className="mt-3 space-y-2">
        {CHANNEL_LABELS.map(({ channel, label }) => {
          const enabled = isChannelEnabled(preferences, channel);
          return (
            <label key={channel} className="flex items-center justify-between gap-3 rounded-lg bg-slate-50 px-3 py-2">
              <span className="text-sm font-semibold text-slate-700">{label}</span>
              <input
                type="checkbox"
                checked={enabled}
                disabled={saving === channel}
                onChange={() => toggle(channel)}
                className="h-4 w-4 accent-emerald-600"
              />
            </label>
          );
        })}
      </div>
    </div>
  );
}
