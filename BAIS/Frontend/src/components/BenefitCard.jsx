/**
 * Reusable benefit/feature card with consistent styling
 */
export default function BenefitCard({ icon: Icon, title, description, className = "" }) {
  return (
    <div className={`group p-6 rounded-xl border border-slate-200 bg-white hover:border-emerald-300 hover:shadow-lg hover:shadow-emerald-100/50 hover:-translate-y-1 transition-all duration-300 ease-out ${className}`}>
      <div className="mb-4">
        <Icon size={32} className="text-emerald-600 group-hover:text-emerald-700 transition-colors" />
      </div>
      <h3 className="font-bold text-slate-900 mb-2 leading-tight">{title}</h3>
      <p className="text-sm text-slate-600 leading-relaxed">{description}</p>
    </div>
  );
}
