/**
 * Step card for process/timeline sections
 */
export default function StepCard({ stepNumber, title, description, icon: Icon, isLast = false, className = "" }) {
  return (
    <div className={`relative ${className}`}>
      {/* Connector line (hidden on last item) */}
      {!isLast && (
        <div className="absolute top-20 left-[28px] w-0.5 h-12 bg-gradient-to-b from-emerald-300 to-transparent hidden lg:block" />
      )}

      <div className="flex gap-4 lg:gap-6">
        {/* Step number circle */}
        <div className="flex-shrink-0 relative">
          <div className="w-14 h-14 rounded-full bg-emerald-100 border-2 border-emerald-600 flex items-center justify-center relative z-10">
            <span className="text-lg font-bold text-emerald-700">{stepNumber}</span>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 pt-2 group hover:bg-slate-50/50 rounded-lg p-4 transition-colors -ml-4">
          {Icon && <Icon size={24} className="text-emerald-600 mb-2" />}
          <h3 className="font-bold text-slate-900 mb-2">{title}</h3>
          <p className="text-sm text-slate-600 leading-relaxed">{description}</p>
        </div>
      </div>
    </div>
  );
}
