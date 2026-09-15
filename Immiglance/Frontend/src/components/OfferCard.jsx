/**
 * Offer card for Offers page
 */
export default function OfferCard({ icon: Icon, title, description, price, features = [], cta, ctaText, badge, className = "" }) {
  return (
    <div className={`group relative p-6 sm:p-8 rounded-2xl border border-border bg-card hover:shadow-xl hover:shadow-primary/10 hover:-translate-y-2 hover:border-primary/30 transition-all duration-300 ease-out overflow-hidden ${className}`}>
      {/* Background gradient on hover */}
      <div className="absolute inset-0 bg-gradient-to-br from-accent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none" />

      <div className="relative z-10">
        {badge && (
          <span className="inline-block mb-4 px-3 py-1 rounded-full bg-accent text-accent-foreground text-xs font-semibold uppercase tracking-wider">
            {badge}
          </span>
        )}

        <div className="mb-4">
          {Icon && <Icon size={36} className="text-primary group-hover:opacity-90 transition-colors" />}
        </div>

        <h3 className="font-bold text-lg text-foreground mb-2">{title}</h3>
        <p className="text-sm text-muted-foreground mb-4 leading-relaxed">{description}</p>

        {price && (
          <div className="mb-4">
            <p className="text-xl font-bold text-foreground">{price}</p>
            <p className="text-xs text-muted-foreground mt-0.5">Exact price depends on visa type</p>
          </div>
        )}

        {features.length > 0 && (
          <ul className="mb-5 space-y-2">
            {features.map((feature) => (
              <li key={feature} className="flex items-start gap-2 text-sm text-muted-foreground">
                <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24" className="mt-0.5 shrink-0 text-primary">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M5 13l4 4L19 7" />
                </svg>
                <span>{feature}</span>
              </li>
            ))}
          </ul>
        )}

        {cta && (
          <button onClick={cta} className="w-full px-4 py-2.5 rounded-lg bg-primary text-primary-foreground font-semibold text-sm hover:opacity-90 transition-colors">
            {ctaText || "Learn More"}
          </button>
        )}
      </div>
    </div>
  );
}
