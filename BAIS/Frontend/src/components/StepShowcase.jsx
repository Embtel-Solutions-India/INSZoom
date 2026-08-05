import ScrollReveal from "./ScrollReveal";

/**
 * StepShowcase - Large section with step number, title, content on one side,
 * and an image/mockup placeholder on the other. Alternates layout on desktop.
 */
export default function StepShowcase({
  stepNumber,
  title,
  description,
  features = [],
  ctaText,
  ctaLink,
  imageSrc,
  imageSrcWebp,
  imageWidth,
  imageHeight,
  imageAlt = "Step illustration",
  imagePosition = "right", // "left" or "right"
  className = "",
}) {
  const isImageLeft = imagePosition === "left";

  return (
    <ScrollReveal className={`py-16 sm:py-24 ${className}`}>
      <div className="max-w-7xl mx-auto px-6 sm:px-10">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 lg:gap-20 items-center">
          {/* Content Side */}
          <ScrollReveal
            direction={isImageLeft ? "right" : "left"}
            delay={100}
            className={isImageLeft ? "lg:order-2" : "lg:order-1"}
          >
            <div>
              {/* Step Label */}
              <div className="flex items-center gap-4 mb-6">
                <div className="shrink-0">
                  <span className="inline-flex items-center justify-center h-14 w-14 rounded-xl bg-linear-to-br from-[#1D9E75] to-teal-600 text-white font-extrabold text-xl shadow-lg">
                    {stepNumber}
                  </span>
                </div>
                <span className="text-xs font-bold uppercase tracking-widest text-[#1D9E75]">
                  Step {stepNumber}
                </span>
              </div>

              {/* Title */}
              <h2 className="text-3xl sm:text-4xl font-extrabold text-slate-900 mb-5 leading-tight">
                {title}
              </h2>

              {/* Description */}
              <p className="text-lg text-slate-600 leading-relaxed mb-8 max-w-xl">
                {description}
              </p>

              {/* Features List */}
              {features.length > 0 && (
                <ul className="space-y-4 mb-10">
                  {features.map((feature, idx) => (
                    <li key={idx} className="flex items-start gap-3">
                      <svg
                        width="20"
                        height="20"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="#1D9E75"
                        strokeWidth="2.5"
                        className="shrink-0 mt-0.5"
                      >
                        <path d="M5 13l4 4L19 7" />
                      </svg>
                      <span className="text-base text-slate-600 leading-relaxed">{feature}</span>
                    </li>
                  ))}
                </ul>
              )}

              {/* CTA */}
              {ctaText && ctaLink && (
                <a
                  href={ctaLink}
                  className="inline-flex items-center gap-2.5 px-6 py-3 bg-[#1D9E75] hover:bg-[#0F6E56] text-white font-semibold rounded-xl shadow-lg shadow-emerald-200 transition-all duration-200 active:scale-95 no-underline"
                >
                  {ctaText}
                  <svg
                    width="16"
                    height="16"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth="2.5"
                      d="M9 5l7 7-7 7"
                    />
                  </svg>
                </a>
              )}
            </div>
          </ScrollReveal>

          {/* Image Side */}
          <ScrollReveal
            direction={isImageLeft ? "left" : "right"}
            delay={200}
            className={isImageLeft ? "lg:order-1" : "lg:order-2"}
          >
            <div className="relative">
              {imageSrc ? (
                <div className="rounded-2xl overflow-hidden shadow-2xl shadow-slate-200/40">
                  <picture>
                    {imageSrcWebp ? <source srcSet={imageSrcWebp} type="image/webp" /> : null}
                    <img
                      src={imageSrc}
                      alt={imageAlt}
                      width={imageWidth}
                      height={imageHeight}
                      loading="lazy"
                      decoding="async"
                      className="w-full h-auto object-cover"
                    />
                  </picture>
                </div>
              ) : (
                /* Placeholder Mockup */
                <div className="rounded-2xl overflow-hidden shadow-2xl shadow-slate-200/40 bg-linear-to-br from-slate-100 to-slate-50 border border-slate-200">
                  <div className="aspect-square sm:aspect-video flex items-center justify-center">
                    <div className="text-center">
                      <svg
                        width="64"
                        height="64"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                        className="mx-auto text-slate-300 mb-3"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth="1.5"
                          d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
                        />
                      </svg>
                      <p className="text-slate-400 text-sm font-medium">{imageAlt}</p>
                    </div>
                  </div>
                </div>
              )}

              {/* Decorative accent */}
              <div className="absolute -top-6 -right-6 w-24 h-24 bg-linear-to-br from-emerald-200/40 to-teal-200/40 rounded-full blur-2xl pointer-events-none" />
              <div className="absolute -bottom-8 -left-8 w-32 h-32 bg-linear-to-br from-blue-200/20 to-teal-200/20 rounded-full blur-3xl pointer-events-none" />
            </div>
          </ScrollReveal>
        </div>
      </div>
    </ScrollReveal>
  );
}
