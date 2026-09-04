import { useState } from "react";
import { leadsApi } from "../services/api";
import { IconPhone, IconMail, IconClock } from "../utils/iconComponents";

// Full "Book a Free Consultation" section — dark two-column band (contact
// info + white form card) — shared by Home/HowItWorks/About so every page
// creates leads the exact same way instead of re-implementing the form.
// `source` tags which page the submission came from (shown in the admin
// Leads Inbox's Source column/drawer — see LeadsInbox.jsx), so a new lead
// generated here is traceable back to its originating page.
function ConsultationForm({ source }) {
  const [form, setForm] = useState({ name: "", email: "", phone: "", visa: "", message: "" });
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const set = (f) => (e) => setForm({ ...form, [f]: e.target.value });

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.name || !form.email || !form.phone) return;
    setError(""); setLoading(true);
    try {
      await leadsApi.create({
        fullName: form.name,
        email: form.email,
        phone: form.phone,
        visaType: form.visa,
        message: form.message,
        source: `${source} — Consultation Request`,
      });
      // The backend persists the lead and sends the internal notification
      // email itself (lead.service.js's createLead -> notifyStaffOfLead) -
      // the client only ever needs to know the request succeeded, never an
      // email address or mailto link to act on.
      setSubmitted(true);
    } catch (err) {
      setError(err.message || "Failed to submit. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  if (submitted) {
    return (
      <div className="flex flex-col items-center justify-center py-14 text-center">
        <div className="w-16 h-16 rounded-full bg-emerald-100 flex items-center justify-center mb-4">
          <svg width="32" height="32" fill="none" stroke="#1D9E75" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M5 13l4 4L19 7"/>
          </svg>
        </div>
        <h3 className="text-xl font-bold text-slate-800 mb-2">Request Received!</h3>
        <p className="text-slate-500 text-sm max-w-xs">Our team will contact you within 24 hours to confirm your appointment.</p>
        <button onClick={() => setSubmitted(false)}
          className="mt-6 text-sm text-emerald-600 hover:underline font-semibold cursor-pointer">
          Submit another request
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className="block text-xs font-semibold text-slate-600 mb-1.5">Full Name *</label>
          <input value={form.name} onChange={set("name")} required placeholder="John Smith"
            className="w-full px-4 py-3 text-sm border border-slate-200 rounded-xl bg-white text-slate-800
              placeholder-slate-400 outline-none hover:border-slate-300
              focus:border-[#1D9E75] focus:ring-2 focus:ring-[#1D9E75]/15 transition-all"/>
        </div>
        <div>
          <label className="block text-xs font-semibold text-slate-600 mb-1.5">Email Address *</label>
          <input type="email" value={form.email} onChange={set("email")} required placeholder="you@email.com"
            className="w-full px-4 py-3 text-sm border border-slate-200 rounded-xl bg-white text-slate-800
              placeholder-slate-400 outline-none hover:border-slate-300
              focus:border-[#1D9E75] focus:ring-2 focus:ring-[#1D9E75]/15 transition-all"/>
        </div>
        <div>
          <label className="block text-xs font-semibold text-slate-600 mb-1.5">Phone Number *</label>
          <input type="tel" value={form.phone} onChange={set("phone")} required placeholder="(510) 770-8700"
            className="w-full px-4 py-3 text-sm border border-slate-200 rounded-xl bg-white text-slate-800
              placeholder-slate-400 outline-none hover:border-slate-300
              focus:border-[#1D9E75] focus:ring-2 focus:ring-[#1D9E75]/15 transition-all"/>
        </div>
        <div>
          <label className="block text-xs font-semibold text-slate-600 mb-1.5">Visa Type</label>
          <select value={form.visa} onChange={set("visa")}
            className="w-full px-4 py-3 text-sm border border-slate-200 rounded-xl bg-white text-slate-700
              outline-none hover:border-slate-300
              focus:border-[#1D9E75] focus:ring-2 focus:ring-[#1D9E75]/15 transition-all cursor-pointer">
            <option value="">Select visa type</option>
            <option>Temporary Visa</option>
            <option>Permanent Visa (Green Card)</option>
            <option>Business Visa (B-1/B-2)</option>
            <option>Work Visa (H-1B / L-1)</option>
            <option>Student Visa (F-1)</option>
            <option>Family Visa</option>
            <option>Change of Status</option>
            <option>Other / Not Sure</option>
          </select>
        </div>
      </div>
      <div>
        <label className="block text-xs font-semibold text-slate-600 mb-1.5">Message</label>
        <textarea value={form.message} onChange={set("message")} rows={4}
          placeholder="Tell us about your situation and how we can help…"
          className="w-full px-4 py-3 text-sm border border-slate-200 rounded-xl bg-white text-slate-800
            placeholder-slate-400 outline-none resize-none hover:border-slate-300
            focus:border-[#1D9E75] focus:ring-2 focus:ring-[#1D9E75]/15 transition-all"/>
      </div>
      {error && <p className="text-xs font-semibold text-rose-600">{error}</p>}
      <button type="submit" disabled={loading}
        className="w-full py-3.5 bg-[#1D9E75] hover:bg-[#0F6E56] text-white font-bold text-sm
          rounded-xl shadow-sm shadow-emerald-200 hover:shadow-md transition-all duration-200
          active:scale-[0.98] disabled:opacity-60 disabled:cursor-not-allowed cursor-pointer">
        {loading ? "Submitting…" : "Request Appointment"}
      </button>
      <p className="text-xs text-slate-400 text-center">We typically respond within 24 hours on business days.</p>
    </form>
  );
}

export default function ConsultationSection({ source, id = "appointment" }) {
  return (
    <section id={id} className="min-h-145 flex flex-col justify-center bg-linear-to-br from-slate-900 via-slate-800 to-slate-900 py-16 sm:py-20">
      <div className="max-w-6xl mx-auto px-6 sm:px-10 w-full">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-start">
          <div className="text-white">
            <span className="inline-block mb-4 text-xs font-bold uppercase tracking-widest text-emerald-400">
              Free Consultation
            </span>
            <h2 className="text-3xl sm:text-4xl font-extrabold leading-tight mb-5">
              Make an Appointment<br className="hidden sm:block"/> with Us
            </h2>
            <p className="text-slate-300 text-sm sm:text-base leading-relaxed mb-8">
              Not sure which visa you need? Talk to our expert consultants for free.
              We'll assess your profile and recommend the best immigration pathway for you.
            </p>
            <div className="space-y-4">
              {[
                { icon: IconPhone, label: "Call Us",  val: "(510) 770-8700" },
                { icon: IconMail, label: "Email Us", val: "info@bayareaimmigrationservices.com" },
                { icon: IconClock, label: "Hours",    val: "Mon – Sat, 9:00 AM – 6:30 PM PT" },
              ].map(({ icon: Icon, label, val }) => (
                <div key={label} className="flex items-start gap-3">
                  <Icon size={20} className="text-emerald-400 shrink-0 mt-0.5" />
                  <div>
                    <p className="text-xs font-bold uppercase tracking-wider text-slate-400">{label}</p>
                    <p className="text-sm text-white/90 mt-0.5">{val}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div className="bg-white rounded-2xl p-7 sm:p-8 shadow-2xl shadow-black/30">
            <h3 className="text-lg font-extrabold text-slate-900 mb-1">Book a Free Consultation</h3>
            <p className="text-sm text-slate-500 mb-6">Fill in the form — we'll reach out within 24 hours.</p>
            <ConsultationForm source={source} />
          </div>
        </div>
      </div>
    </section>
  );
}
