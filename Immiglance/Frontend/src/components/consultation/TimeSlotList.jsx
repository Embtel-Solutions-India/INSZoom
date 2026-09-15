function formatTime(iso, tz) {
  return new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: tz });
}

function isMorning(iso, tz) {
  const hour = Number(new Date(iso).toLocaleTimeString("en-US", { hour: "2-digit", hour12: false, timeZone: tz }));
  return hour < 12;
}

// Time-slot list for the selected date, grouped morning/afternoon, in the
// visitor's chosen timezone. Single-select, large tap targets.
export default function TimeSlotList({ slots, tz, selectedSlot, onSelect }) {
  if (!slots.length) {
    return <p className="text-sm text-slate-400 py-8 text-center">No times available this day.</p>;
  }
  const morning = slots.filter((s) => isMorning(s.startAt, tz));
  const afternoon = slots.filter((s) => !isMorning(s.startAt, tz));

  const group = (label, items) => items.length > 0 && (
    <div className="mb-4" key={label}>
      <p className="text-[0.68rem] font-bold uppercase tracking-wider text-slate-400 mb-2">{label}</p>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        {items.map((slot) => {
          const selected = selectedSlot?.startAt === slot.startAt;
          return (
            <button
              key={slot.startAt}
              type="button"
              onClick={() => onSelect(slot)}
              className={`rounded-xl border px-3 py-2.5 text-sm font-semibold transition cursor-pointer
                ${selected ? "text-white border-transparent" : "border-slate-200 text-slate-700 hover:border-slate-300 hover:bg-slate-50"}`}
              style={selected ? { backgroundColor: "var(--eligibility-primary, #0B1F3A)" } : undefined}
            >
              {formatTime(slot.startAt, tz)}
            </button>
          );
        })}
      </div>
    </div>
  );

  return (
    <div>
      {group("Morning", morning)}
      {group("Afternoon", afternoon)}
    </div>
  );
}
