import { useState } from "react";
import { localDateKey as dateKey } from "../../utils/localDateKey";

const WEEKDAYS = ["S", "M", "T", "W", "T", "F", "S"];

// Month calendar — only dates present in `availableDateKeys` (a Set of
// YYYY-MM-DD strings derived from the fetched slots) are selectable; past
// dates and dates with no availability are disabled. Smooth month
// navigation, keyboard-reachable day buttons.
export default function MonthCalendar({ availableDateKeys, selectedDate, onSelectDate }) {
  const [viewMonth, setViewMonth] = useState(() => { const d = new Date(); d.setDate(1); return d; });

  const firstOfMonth = new Date(viewMonth);
  const startWeekday = firstOfMonth.getDay();
  const daysInMonth = new Date(viewMonth.getFullYear(), viewMonth.getMonth() + 1, 0).getDate();
  const todayKey = dateKey(new Date());

  const cells = [];
  for (let i = 0; i < startWeekday; i += 1) cells.push(null);
  for (let day = 1; day <= daysInMonth; day += 1) {
    cells.push(new Date(viewMonth.getFullYear(), viewMonth.getMonth(), day));
  }

  const changeMonth = (delta) => {
    setViewMonth((m) => new Date(m.getFullYear(), m.getMonth() + delta, 1));
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <button type="button" onClick={() => changeMonth(-1)} aria-label="Previous month" className="w-8 h-8 rounded-lg hover:bg-slate-100 flex items-center justify-center text-slate-500 cursor-pointer">
          <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 19l-7-7 7-7" /></svg>
        </button>
        <p className="font-bold text-slate-800 text-sm">{viewMonth.toLocaleDateString("en-US", { month: "long", year: "numeric" })}</p>
        <button type="button" onClick={() => changeMonth(1)} aria-label="Next month" className="w-8 h-8 rounded-lg hover:bg-slate-100 flex items-center justify-center text-slate-500 cursor-pointer">
          <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5l7 7-7 7" /></svg>
        </button>
      </div>
      <div className="grid grid-cols-7 gap-1 mb-1">
        {WEEKDAYS.map((w, i) => (
          <div key={i} className="text-center text-[0.65rem] font-bold text-slate-400 py-1">{w}</div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {cells.map((date, i) => {
          if (!date) return <div key={i} />;
          const key = dateKey(date);
          const available = availableDateKeys.has(key);
          const isPast = key < todayKey;
          const selected = selectedDate && dateKey(selectedDate) === key;
          return (
            <button
              key={i}
              type="button"
              disabled={!available || isPast}
              onClick={() => onSelectDate(date)}
              className={`aspect-square rounded-lg text-xs font-semibold transition flex items-center justify-center
                ${selected ? "text-white" : available && !isPast ? "text-slate-700 hover:bg-slate-100 cursor-pointer" : "text-slate-300 cursor-not-allowed"}`}
              style={selected ? { backgroundColor: "var(--eligibility-primary, #0B1F3A)" } : undefined}
            >
              {date.getDate()}
            </button>
          );
        })}
      </div>
    </div>
  );
}
