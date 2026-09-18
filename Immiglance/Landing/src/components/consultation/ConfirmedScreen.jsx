import { useNavigate } from "react-router-dom";

// Builds a valid .ics client-side for the download link — the email already
// carries a server-generated one as an attachment, this is a same-content
// convenience so the confirmation screen doesn't need a network round-trip.
function buildIcsDataUrl({ startAt, endAt, summary, description }) {
  const stamp = (d) => new Date(d).toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";
  const lines = [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//ImmigrationCRM//Consultation//EN",
    "BEGIN:VEVENT",
    `UID:${startAt}@consultation.immigration-crm`,
    `DTSTAMP:${stamp(new Date())}`,
    `DTSTART:${stamp(startAt)}`,
    `DTEND:${stamp(endAt)}`,
    `SUMMARY:${summary}`,
    `DESCRIPTION:${description}`,
    "END:VEVENT", "END:VCALENDAR",
  ];
  return `data:text/calendar;charset=utf8,${encodeURIComponent(lines.join("\r\n"))}`;
}

export default function ConfirmedScreen({ booking }) {
  const navigate = useNavigate();
  const icsUrl = buildIcsDataUrl({
    startAt: booking.startAt,
    endAt: booking.endAt,
    summary: `Free Consultation with ${booking.publicHostName}`,
    description: booking.locationType === "phone" ? "We will call you." : "Video call details to follow.",
  });

  return (
    <div className="text-center py-8">
      <div className="w-14 h-14 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-5">
        <svg width="26" height="26" fill="none" stroke="currentColor" viewBox="0 0 24 24" className="text-primary"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M5 13l4 4L19 7" /></svg>
      </div>
      <h2 className="text-xl font-extrabold text-foreground mb-2">You're booked!</h2>
      <p className="text-muted-foreground text-sm mb-1">
        {new Date(booking.startAt).toLocaleString("en-US", { weekday: "long", month: "long", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: booking.timezone })}
      </p>
      <p className="text-muted-foreground text-xs mb-8">
        {booking.locationType === "phone" ? "We'll call you at the number you provided." : "We'll follow up with your video call link."}
      </p>

      <div className="flex flex-col sm:flex-row gap-3 justify-center">
        <a
          href={icsUrl}
          download="consultation.ics"
          className="inline-flex items-center justify-center gap-2 px-6 py-3 rounded-xl border border-border text-foreground font-bold text-sm hover:bg-secondary transition no-underline"
        >
          Add to calendar
        </a>
        <button
          type="button"
          onClick={() => navigate(`/consultation/booking/${booking.bookingToken}`)}
          className="inline-flex items-center justify-center gap-2 px-6 py-3 rounded-xl bg-primary text-primary-foreground font-bold text-sm hover:opacity-90 transition cursor-pointer"
        >
          Manage booking
        </button>
      </div>
      <button
        type="button"
        onClick={() => navigate("/")}
        className="mt-6 text-sm font-semibold text-muted-foreground hover:text-foreground cursor-pointer"
      >
        Return to home
      </button>
    </div>
  );
}
