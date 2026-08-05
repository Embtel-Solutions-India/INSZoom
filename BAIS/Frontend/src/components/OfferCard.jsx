/**
 * Offer card for Offers page
 */
export default function OfferCard({ icon: Icon, title, description, price, features = [], cta, ctaText, badge, className = "" }) {
  return (
    <div className={`group relative p-6 sm:p-8 rounded-2xl border border-slate-200 bg-white hover:shadow-xl hover:shadow-emerald-200/40 hover:-translate-y-2 hover:border-emerald-300 transition-all duration-300 ease-out overflow-hidden ${className}`}>
      {/* Background gradient on hover */}
      <div className="absolute inset-0 bg-gradient-to-br from-emerald-50 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none" />
      
      <div className="relative z-10">
        {badge && (
          <span className="inline-block mb-4 px-3 py-1 rounded-full bg-emerald-100 text-emerald-700 text-xs font-semibold uppercase tracking-wider">
            {badge}
          </span>
        )}

        <div className="mb-4">
          {Icon && <Icon size={36} className="text-emerald-600 group-hover:text-emerald-700 transition-colors" />}
        </div>

        <h3 className="font-bold text-lg text-slate-900 mb-2">{title}</h3>
        <p className="text-sm text-slate-600 mb-4 leading-relaxed">{description}</p>

        {price && (
          <div className="mb-4">
            <p className="text-xl font-bold text-slate-900">{price}</p>
            <p className="text-xs text-slate-400 mt-0.5">Exact price depends on visa type</p>
          </div>
        )}

        {features.length > 0 && (
          <ul className="mb-5 space-y-2">
            {features.map((feature) => (
              <li key={feature} className="flex items-start gap-2 text-sm text-slate-600">
                <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24" className="mt-0.5 shrink-0 text-emerald-600">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M5 13l4 4L19 7" />
                </svg>
                <span>{feature}</span>
              </li>
            ))}
          </ul>
        )}

        {cta && (
          <button onClick={cta} className="w-full px-4 py-2.5 rounded-lg bg-emerald-600 text-white font-semibold text-sm hover:bg-emerald-700 transition-colors">
            {ctaText || "Learn More"}
          </button>
        )}
      </div>
    </div>
  );
}
