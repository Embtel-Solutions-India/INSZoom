// Left panel — meeting summary. Never shows the host's real identity, only
// the neutral publicHostName the backend resolves.
export default function MeetingSummary({ config }) {
  return (
    <div className="p-6 sm:p-8">
      <span className="inline-block mb-4 px-3 py-1 rounded-full bg-slate-100 text-[0.68rem] font-bold uppercase tracking-widest text-slate-500">
        {config?.title || "Free Consultation"}
      </span>
      <h1 className="text-2xl font-extrabold text-slate-900 mb-4 leading-tight">
        Book your free consultation
      </h1>
      <div className="space-y-3 text-sm text-slate-600 mb-6">
        <div className="flex items-center gap-2.5">
          <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24" className="shrink-0 text-slate-400"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
          {config?.durationMinutes || 30} minutes
        </div>
        <div className="flex items-center gap-2.5">
          <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24" className="shrink-0 text-slate-400">
            {config?.locationType === "phone"
              ? <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
              : <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />}
          </svg>
          {config?.locationType === "phone" ? "Phone call" : "Video call"}
        </div>
        <div className="flex items-center gap-2.5">
          <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24" className="shrink-0 text-slate-400"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
          with {config?.publicHostName || "our immigration team"}
        </div>
      </div>
      <p className="text-xs text-slate-400 leading-relaxed">
        This is a free, no-obligation conversation about your options. We'll follow up with meeting details after you book.
      </p>
    </div>
  );
}
