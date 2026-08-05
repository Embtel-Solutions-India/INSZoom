import { Link } from "react-router-dom";
import useHasCase from "../hooks/useHasCase";

// Reusable "Start Free Assessment" CTA — the highlighted, consistent
// primary action pointing to the public eligibility quiz. `variant="solid"`
// (default) matches Home.jsx's hero button (`bg-[#1D9E75] hover:bg-[#0F6E56]`,
// the literal brand hex used across Home/HowItWorks); `variant="inverted"`
// is for placement on a colored/gradient/dark background (white pill,
// brand-colored text), matching the existing inverted-button convention
// used on all three marketing pages' colored CTA bands.
const VARIANTS = {
  solid: "bg-[#1D9E75] hover:bg-[#0F6E56] text-white shadow-lg shadow-black/10",
  inverted: "bg-white text-[#1D9E75] hover:bg-emerald-50",
  outline: "bg-white/10 hover:bg-white/20 text-white border border-white/35 hover:border-white/55 backdrop-blur-sm",
};

export default function StartAssessmentButton({ variant = "solid", size = "md", className = "", children = "Start Free Assessment", pageSource }) {
  const { hasCase, loading } = useHasCase();
  const sizeClasses = size === "lg" ? "px-8 py-4 text-base" : "px-7 py-3.5 text-base";
  // Renders nothing while the has-a-case check is still in flight (loading)
  // AND once it resolves true — never shows the quiz CTA and then yanks it
  // away a moment later. An existing client should never be invited to
  // retake the assessment; see hooks/useHasCase.js. Anonymous visitors and
  // logged-in users without a case resolve `loading` to false immediately
  // (no network round trip needed to know "anonymous"), so the funnel never
  // stalls for them.
  if (hasCase || loading) return null;
  // `pageSource` (e.g. "Home Page") travels through EligibilityIntro ->
  // EligibilityQuiz -> the submit payload's `source`, so a lead created by
  // completing the quiz is traceable back to the page that launched it —
  // same idea as ConsultationSection's `source` prop for the contact forms.
  const quizLink = pageSource ? `/eligibility?src=${encodeURIComponent(pageSource)}` : "/eligibility";
  return (
    <Link
      to={quizLink}
      className={`inline-flex items-center justify-center gap-2 ${sizeClasses} font-bold rounded-xl transition-all duration-200 active:scale-95 no-underline cursor-pointer ${VARIANTS[variant] || VARIANTS.solid} ${className}`}
    >
      {children}
      <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M9 5l7 7-7 7" />
      </svg>
    </Link>
  );
}
