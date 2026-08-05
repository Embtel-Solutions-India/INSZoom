// Renders whatever profile questions the backend definition returns —
// select or text, nothing hardcoded. Exactly 3 by default (field, current
// status, goal) but this component doesn't assume a count or specific keys.
export default function ProfileStep({ questions, answers, onChange }) {
  return (
    <div className="space-y-5">
      {questions.map((q) => (
        <div key={q.key}>
          <label htmlFor={`profile-${q.key}`} className="block text-sm font-bold text-slate-700 mb-1.5">
            {q.label}
          </label>
          {q.type === "select" ? (
            <select
              id={`profile-${q.key}`}
              value={answers[q.key] || ""}
              onChange={(e) => onChange(q.key, e.target.value)}
              required={q.required}
              className="w-full rounded-xl border border-slate-200 px-4 py-3 text-sm text-slate-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 bg-white"
            >
              <option value="" disabled>Select an option…</option>
              {(q.options || []).map((opt) => (
                <option key={opt} value={opt}>{opt}</option>
              ))}
            </select>
          ) : (
            <input
              id={`profile-${q.key}`}
              type="text"
              value={answers[q.key] || ""}
              onChange={(e) => onChange(q.key, e.target.value)}
              required={q.required}
              className="w-full rounded-xl border border-slate-200 px-4 py-3 text-sm text-slate-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-1"
              placeholder="Type your answer"
            />
          )}
        </div>
      ))}
    </div>
  );
}
