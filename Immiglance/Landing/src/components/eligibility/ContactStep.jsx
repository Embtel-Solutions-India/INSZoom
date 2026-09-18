import { useState } from "react";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Final step before submit: name/email/phone + inline validation +
// disclaimer acceptance. Errors never lose the user's already-entered
// answers — this component only ever renders inline, never resets state.
export default function ContactStep({ contact, onChange, disclaimerAccepted, onDisclaimerChange }) {
  const [touched, setTouched] = useState({});

  const errors = {
    fullName: !contact.fullName?.trim() ? "Your name is required" : "",
    email: !contact.email?.trim() ? "Your email is required" : (!EMAIL_RE.test(contact.email) ? "Enter a valid email" : ""),
    phone: !contact.phone?.trim() ? "Your phone number is required" : "",
  };

  const field = (key, label, type = "text", placeholder) => (
    <div>
      <label htmlFor={`contact-${key}`} className="block text-sm font-bold text-foreground mb-1.5">{label}</label>
      <input
        id={`contact-${key}`}
        type={type}
        value={contact[key] || ""}
        onChange={(e) => onChange(key, e.target.value)}
        onBlur={() => setTouched((t) => ({ ...t, [key]: true }))}
        placeholder={placeholder}
        className={`w-full rounded-xl border px-4 py-3 text-sm text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-1
          ${touched[key] && errors[key] ? "border-destructive/40" : "border-border"}`}
      />
      {touched[key] && errors[key] && <p className="text-xs text-destructive mt-1">{errors[key]}</p>}
    </div>
  );

  return (
    <div className="space-y-5">
      <p className="text-sm text-muted-foreground">Last step — where should we send your results?</p>
      {field("fullName", "Full name", "text", "Jane Doe")}
      {field("email", "Email address", "email", "you@example.com")}
      {field("phone", "Phone number", "tel", "(555) 123-4567")}

      <label className="flex items-start gap-2.5 pt-2">
        <input
          type="checkbox"
          checked={disclaimerAccepted}
          onChange={(e) => onDisclaimerChange(e.target.checked)}
          className="mt-0.5"
        />
        <span className="text-xs text-muted-foreground leading-relaxed">
          I understand this assessment is not legal advice and does not guarantee any immigration outcome.
        </span>
      </label>
    </div>
  );
}

export function isContactStepValid(contact, disclaimerAccepted) {
  return Boolean(
    contact.fullName?.trim() &&
    contact.email?.trim() && EMAIL_RE.test(contact.email) &&
    contact.phone?.trim() &&
    disclaimerAccepted
  );
}
