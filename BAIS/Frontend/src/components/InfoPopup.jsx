import { useEffect } from "react";
import { IconX } from "../utils/iconComponents";

/**
 * Small responsive popup listing visa types (with optional short descriptions).
 * Closes on outside click (backdrop) or Escape.
 * `items` accepts either strings ("H-1B") or objects ({ id, desc } / { label, desc }).
 * `onSelect` is called with the visa type id when an item is chosen.
 */
export default function InfoPopup({ open, onClose, title, description, items = [], onSelect }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    if (open) window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const normalized = items.map((it) =>
    typeof it === "string" ? { id: it, label: it, desc: "" } : { id: it.id || it.label, label: it.label || it.id, desc: it.desc || "" }
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop — outside click closes */}
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative z-10 w-full max-w-md mx-4 bg-white rounded-2xl shadow-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-100">
          <div className="flex items-start gap-3">
            <div>
              <h3 className="font-extrabold text-slate-800">{title}</h3>
              {description && <p className="text-sm text-slate-500 mt-1">{description}</p>}
            </div>
            <button onClick={onClose} aria-label="Close" className="ml-auto text-slate-400 hover:text-slate-600">
              <IconX size={16} className="text-inherit" />
            </button>
          </div>
        </div>
        <div className="p-4 space-y-3 max-h-[60vh] overflow-auto">
          <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">Visa Types</p>
          <div className="grid grid-cols-1 gap-2">
            {normalized.map((t) => (
              <button
                key={t.id}
                onClick={() => onSelect?.(t.id)}
                className="text-left px-3 py-2.5 rounded-lg border border-slate-200 hover:border-emerald-300
                  hover:bg-emerald-50/50 transition bg-white group"
              >
                <span className="font-extrabold text-slate-800 text-sm group-hover:text-emerald-700">{t.label}</span>
                {t.desc && <span className="block text-xs text-slate-500 mt-0.5 leading-snug">{t.desc}</span>}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
