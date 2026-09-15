/**
 * Reusable benefit/feature card with consistent styling
 */
export default function BenefitCard({ icon: Icon, title, description, className = "" }) {
  return (
    <div className={`group p-6 rounded-xl border border-border bg-card hover:border-primary/40 hover:shadow-lg hover:shadow-primary/10 hover:-translate-y-1 transition-all duration-300 ease-out ${className}`}>
      <div className="mb-4">
        <Icon size={32} className="text-primary group-hover:opacity-80 transition-colors" />
      </div>
      <h3 className="font-bold text-foreground mb-2 leading-tight">{title}</h3>
      <p className="text-sm text-muted-foreground leading-relaxed">{description}</p>
    </div>
  );
}
