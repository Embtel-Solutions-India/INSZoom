import { useMemo, useState } from "react";
import { useLocation, useParams } from "react-router-dom";
import { useQuery, useMutation } from "@tanstack/react-query";
import { consultationApi } from "../../services/api";
import EligibilityShell from "../../components/eligibility/EligibilityShell";
import MeetingSummary from "../../components/consultation/MeetingSummary";
import MonthCalendar from "../../components/consultation/MonthCalendar";
import TimeSlotList from "../../components/consultation/TimeSlotList";
import ConfirmedScreen from "../../components/consultation/ConfirmedScreen";
import { localDateKey } from "../../utils/localDateKey";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function BookConsultation() {
  const { leadId } = useParams();
  const location = useLocation();
  const prefill = location.state?.contact || {};

  const tz = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC", []);
  const [selectedDate, setSelectedDate] = useState(null);
  const [selectedSlot, setSelectedSlot] = useState(null);
  const [contact, setContact] = useState({ fullName: prefill.fullName || "", email: prefill.email || "", phone: prefill.phone || "" });
  const [note, setNote] = useState("");
  const [conflictError, setConflictError] = useState("");

  const { data: config } = useQuery({
    queryKey: ["consultation-config"],
    queryFn: async () => (await consultationApi.config()).data,
  });

  const { data: slotsData, isLoading: slotsLoading, refetch: refetchSlots } = useQuery({
    queryKey: ["consultation-slots"],
    queryFn: async () => (await consultationApi.slots()).data,
  });

  const bookMutation = useMutation({
    mutationFn: (payload) => consultationApi.book(payload),
    onError: (error) => {
      if (error?.message?.includes("conflict") || error?.status === 409) {
        setConflictError("That time was just booked by someone else — please pick another.");
        setSelectedSlot(null);
        refetchSlots();
      }
    },
  });

  const slots = slotsData?.slots || [];
  const availableDateKeys = useMemo(() => new Set(slots.map((s) => localDateKey(new Date(s.startAt)))), [slots]);
  const slotsForSelectedDate = selectedDate
    ? slots.filter((s) => localDateKey(new Date(s.startAt)) === localDateKey(selectedDate))
    : [];

  const isContactValid = contact.fullName.trim() && EMAIL_RE.test(contact.email) && contact.phone.trim();

  const handleConfirm = () => {
    setConflictError("");
    bookMutation.mutate({
      leadId,
      name: contact.fullName,
      email: contact.email,
      phone: contact.phone,
      startAt: selectedSlot?.startAt,
      note,
    });
  };

  if (bookMutation.isSuccess) {
    return (
      <EligibilityShell>
        <div className="max-w-md mx-auto px-5 py-16">
          <ConfirmedScreen booking={{ ...bookMutation.data.data, locationType: config?.locationType }} />
        </div>
      </EligibilityShell>
    );
  }

  return (
    <EligibilityShell>
      <div className="max-w-4xl mx-auto px-5 sm:px-6 py-10 sm:py-14">
        <div className="grid md:grid-cols-[280px_1fr] rounded-2xl border border-slate-200 overflow-hidden">
          <div className="bg-slate-50 border-b md:border-b-0 md:border-r border-slate-200">
            <MeetingSummary config={config} />
          </div>

          <div className="p-6 sm:p-8">
            {!selectedSlot ? (
              <>
                <div className="flex items-center justify-between mb-5">
                  <p className="text-sm font-bold text-slate-700">Select a date &amp; time</p>
                  <span className="text-xs text-slate-400">{tz.replace(/_/g, " ")}</span>
                </div>
                {slotsLoading ? (
                  <div className="h-64 rounded-xl bg-slate-100 animate-pulse" />
                ) : (
                  <div className="grid sm:grid-cols-2 gap-6">
                    <MonthCalendar availableDateKeys={availableDateKeys} selectedDate={selectedDate} onSelectDate={setSelectedDate} />
                    <div>
                      {selectedDate ? (
                        <TimeSlotList slots={slotsForSelectedDate} tz={tz} selectedSlot={selectedSlot} onSelect={setSelectedSlot} />
                      ) : (
                        <p className="text-sm text-slate-400 py-8 text-center">Pick a highlighted date to see available times.</p>
                      )}
                    </div>
                  </div>
                )}
              </>
            ) : (
              <>
                <button type="button" onClick={() => setSelectedSlot(null)} className="text-xs font-bold text-slate-400 hover:text-slate-600 mb-4 cursor-pointer">
                  &larr; Choose a different time
                </button>
                <div className="rounded-xl bg-slate-50 px-4 py-3 mb-6 text-sm font-semibold text-slate-700">
                  {new Date(selectedSlot.startAt).toLocaleString("en-US", { weekday: "long", month: "long", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: tz })}
                </div>

                {conflictError && (
                  <div className="rounded-xl bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-700 mb-4">{conflictError}</div>
                )}
                {bookMutation.isError && !conflictError && (
                  <div className="rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700 mb-4">
                    Something went wrong booking your consultation. Please try again.
                  </div>
                )}

                <div className="space-y-4 mb-6">
                  <div>
                    <label className="block text-sm font-bold text-slate-700 mb-1.5">Full name</label>
                    <input type="text" value={contact.fullName} onChange={(e) => setContact((c) => ({ ...c, fullName: e.target.value }))} className="w-full rounded-xl border border-slate-200 px-4 py-3 text-sm" />
                  </div>
                  <div>
                    <label className="block text-sm font-bold text-slate-700 mb-1.5">Email</label>
                    <input type="email" value={contact.email} onChange={(e) => setContact((c) => ({ ...c, email: e.target.value }))} className="w-full rounded-xl border border-slate-200 px-4 py-3 text-sm" />
                  </div>
                  <div>
                    <label className="block text-sm font-bold text-slate-700 mb-1.5">Phone</label>
                    <input type="tel" value={contact.phone} onChange={(e) => setContact((c) => ({ ...c, phone: e.target.value }))} className="w-full rounded-xl border border-slate-200 px-4 py-3 text-sm" />
                  </div>
                  <div>
                    <label className="block text-sm font-bold text-slate-700 mb-1.5">Anything you'd like us to know? (optional)</label>
                    <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} className="w-full rounded-xl border border-slate-200 px-4 py-3 text-sm" />
                  </div>
                </div>

                <button
                  type="button"
                  onClick={handleConfirm}
                  disabled={!isContactValid || bookMutation.isPending}
                  className="w-full inline-flex items-center justify-center px-6 py-3.5 rounded-xl text-white font-bold text-sm transition active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                  style={{ backgroundColor: "var(--eligibility-accent, #C6A15B)" }}
                >
                  {bookMutation.isPending ? "Confirming…" : "Confirm booking"}
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </EligibilityShell>
  );
}
