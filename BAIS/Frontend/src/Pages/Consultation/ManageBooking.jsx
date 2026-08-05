import { useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { useQuery, useMutation } from "@tanstack/react-query";
import { consultationApi } from "../../services/api";
import EligibilityShell from "../../components/eligibility/EligibilityShell";
import MonthCalendar from "../../components/consultation/MonthCalendar";
import TimeSlotList from "../../components/consultation/TimeSlotList";
import { localDateKey } from "../../utils/localDateKey";

export default function ManageBooking() {
  const { token } = useParams();
  const tz = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC", []);
  const [mode, setMode] = useState("view"); // view | reschedule | cancel-confirm
  const [selectedDate, setSelectedDate] = useState(null);
  const [selectedSlot, setSelectedSlot] = useState(null);
  const [cancelReason, setCancelReason] = useState("");

  const bookingQuery = useQuery({
    queryKey: ["consultation-booking", token],
    queryFn: async () => (await consultationApi.getBooking(token)).data,
    retry: false,
  });

  const slotsQuery = useQuery({
    queryKey: ["consultation-slots"],
    queryFn: async () => (await consultationApi.slots()).data,
    enabled: mode === "reschedule",
  });

  const rescheduleMutation = useMutation({
    mutationFn: (newStartAt) => consultationApi.reschedule(token, newStartAt),
    onSuccess: () => { setMode("view"); bookingQuery.refetch(); },
  });
  const cancelMutation = useMutation({
    mutationFn: (reason) => consultationApi.cancel(token, reason),
    onSuccess: () => bookingQuery.refetch(),
  });

  if (bookingQuery.isLoading) {
    return <EligibilityShell><div className="max-w-md mx-auto px-5 py-16"><div className="h-48 rounded-2xl bg-slate-100 animate-pulse" /></div></EligibilityShell>;
  }

  if (bookingQuery.isError) {
    return (
      <EligibilityShell>
        <div className="max-w-md mx-auto px-5 py-24 text-center">
          <p className="font-bold text-slate-800 mb-2">This booking link is invalid or has expired</p>
          <p className="text-sm text-slate-500">If you still need a consultation, please start a new booking.</p>
        </div>
      </EligibilityShell>
    );
  }

  const booking = bookingQuery.data;
  const slots = slotsQuery.data?.slots || [];
  const availableDateKeys = new Set(slots.map((s) => localDateKey(new Date(s.startAt))));
  const slotsForSelectedDate = selectedDate ? slots.filter((s) => localDateKey(new Date(s.startAt)) === localDateKey(selectedDate)) : [];

  return (
    <EligibilityShell>
      <div className="max-w-lg mx-auto px-5 sm:px-6 py-14">
        <div className="rounded-2xl border border-slate-200 p-6 sm:p-8">
          {mode === "view" && (
            <>
              <p className={`text-xs font-bold uppercase tracking-wider mb-3 ${booking.status === "cancelled" ? "text-red-500" : "text-emerald-600"}`}>
                {booking.status === "cancelled" ? "Cancelled" : "Confirmed"}
              </p>
              <h1 className="text-xl font-extrabold text-slate-900 mb-2">
                {new Date(booking.startAt).toLocaleString("en-US", { weekday: "long", month: "long", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: tz })}
              </h1>
              <p className="text-sm text-slate-500 mb-6">with {booking.publicHostName} &middot; {booking.locationType === "phone" ? "Phone call" : "Video call"}</p>

              {booking.status !== "cancelled" && (
                <div className="flex flex-col sm:flex-row gap-3">
                  <button type="button" onClick={() => setMode("reschedule")} className="flex-1 px-5 py-3 rounded-xl border border-slate-200 text-slate-700 font-bold text-sm hover:bg-slate-50 cursor-pointer">
                    Reschedule
                  </button>
                  <button type="button" onClick={() => setMode("cancel-confirm")} className="flex-1 px-5 py-3 rounded-xl border border-red-200 text-red-600 font-bold text-sm hover:bg-red-50 cursor-pointer">
                    Cancel
                  </button>
                </div>
              )}
            </>
          )}

          {mode === "reschedule" && (
            <>
              <button type="button" onClick={() => setMode("view")} className="text-xs font-bold text-slate-400 hover:text-slate-600 mb-4 cursor-pointer">&larr; Back</button>
              <p className="text-sm font-bold text-slate-700 mb-4">Pick a new time</p>
              <div className="grid sm:grid-cols-2 gap-6 mb-6">
                <MonthCalendar availableDateKeys={availableDateKeys} selectedDate={selectedDate} onSelectDate={setSelectedDate} />
                <div>
                  {selectedDate ? (
                    <TimeSlotList slots={slotsForSelectedDate} tz={tz} selectedSlot={selectedSlot} onSelect={setSelectedSlot} />
                  ) : (
                    <p className="text-sm text-slate-400 py-8 text-center">Pick a date to see available times.</p>
                  )}
                </div>
              </div>
              <button
                type="button"
                disabled={!selectedSlot || rescheduleMutation.isPending}
                onClick={() => rescheduleMutation.mutate(selectedSlot?.startAt)}
                className="w-full px-6 py-3.5 rounded-xl text-white font-bold text-sm disabled:opacity-40 cursor-pointer"
                style={{ backgroundColor: "var(--eligibility-primary, #0B1F3A)" }}
              >
                {rescheduleMutation.isPending ? "Saving…" : "Confirm new time"}
              </button>
            </>
          )}

          {mode === "cancel-confirm" && (
            <>
              <p className="font-bold text-slate-800 mb-2">Cancel this consultation?</p>
              <p className="text-sm text-slate-500 mb-4">Let us know why (optional), so we can follow up appropriately.</p>
              <textarea value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} rows={2} className="w-full rounded-xl border border-slate-200 px-4 py-3 text-sm mb-4" placeholder="Reason (optional)" />
              <div className="flex gap-3">
                <button type="button" onClick={() => setMode("view")} className="flex-1 px-5 py-3 rounded-xl border border-slate-200 text-slate-700 font-bold text-sm cursor-pointer">
                  Keep booking
                </button>
                <button
                  type="button"
                  disabled={cancelMutation.isPending}
                  onClick={() => { cancelMutation.mutate(cancelReason); setMode("view"); }}
                  className="flex-1 px-5 py-3 rounded-xl bg-red-600 hover:bg-red-700 text-white font-bold text-sm cursor-pointer"
                >
                  {cancelMutation.isPending ? "Cancelling…" : "Cancel consultation"}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </EligibilityShell>
  );
}
