import { useEffect } from "react";
import StepShowcase from "../../components/StepShowcase";
import ScrollReveal from "../../components/ScrollReveal";
import StartAssessmentButton from "../../components/StartAssessmentButton";
import ConsultationSection from "../../components/ConsultationSection";
import accountSetupImage from "../../assets/images/client-portal/account-setup.png";
import accountSetupImageWebp from "../../assets/images/client-portal/account-setup.webp";
import eligibilityImage from "../../assets/images/client-portal/eligibility-hit.jpg";
import visaCategroyImage from "../../assets/images/client-portal/visa-category.png";
import visaCategroyImageWebp from "../../assets/images/client-portal/visa-category.webp";
import detailedQuestionnaireImage from "../../assets/images/client-portal/detailed-questionnaire.png";
import detailedQuestionnaireImageWebp from "../../assets/images/client-portal/detailed-questionnaire.webp";
import secureDocumentImage from "../../assets/images/client-portal/secure-document.png";
import secureDocumentImageWebp from "../../assets/images/client-portal/secure-document.webp";
import consultantReviewImage from "../../assets/images/client-portal/consultant-review.png";
import consultantReviewImageWebp from "../../assets/images/client-portal/consultant-review.webp";
import attorneyReviewImage from "../../assets/images/client-portal/attorney-review.png";
import attorneyReviewImageWebp from "../../assets/images/client-portal/attorney-review.webp";
import formFillingImage from "../../assets/images/client-portal/form-filling.png";
import formFillingImageWebp from "../../assets/images/client-portal/form-filling.webp";
import statusTrackingImage from "../../assets/images/client-portal/status-tracking.png";
import statusTrackingImageWebp from "../../assets/images/client-portal/status-tracking.webp";
import {
  IconHome,
  IconListCheck,
  IconDocument,
  IconCheckCircle,
  IconUpload,
  IconUsers,
  IconShield,
  IconFileText,
  IconClock,
  IconAward,
  IconTrendingUp,
} from "../../utils/iconComponents";

/* ── Process steps data ──────────────────────────────────────────────────────── */
const PROCESS_STEPS = [
  {
    stepNumber: 1,
    title: "Create Your Secure Account",

    description: "Sign up with your email and verify your identity. Your account is protected with bank-grade encryption. All your data stays confidential.",
    features: [
      "Email verification for security",
      "Bank-grade encryption",
      "Secure password protection",
      "Two-factor authentication available",
    ],
    imageAlt: "Account Setup",
    imageSrc: accountSetupImage,
    imageSrcWebp: accountSetupImageWebp,
    imagePosition: "right",
  },
  {
    stepNumber: 2,
    title: "Complete Your Eligibility Quiz",
    description: "Answer our guided questions about your background, education, work experience, and immigration goals. Takes 10-15 minutes. AI-powered recommendations follow.",
    features: [
      "AI-guided questionnaire",
      "Personalized visa recommendations",
      "Immediate eligibility insights",
      "Save and resume anytime",
    ],
    imageAlt: "Eligibility Assessment",
    imageSrc: eligibilityImage,
    imagePosition: "left",
  },
  {
    stepNumber: 3,
    title: "Choose Your Visa Category",
    description: "Based on your quiz results, we recommend the visa categories best suited for you — H-1B, F-1, Green Card, etc. Select your preferred path or discuss options with our team.",
    features: [
      "Visa-specific requirements outlined",
      "Comparison of visa categories",
      "Processing timelines shown",
      "Consultant recommendation available",
    ],
    imageAlt: "Visa Selection",
    imageSrc: visaCategroyImage,
    imageSrcWebp: visaCategroyImageWebp,
    imagePosition: "right",
  },
  {
    stepNumber: 4,
    title: "Complete Detailed Questionnaire",
    description: "Answer comprehensive questions specific to your chosen visa category. Our forms are guided, step-by-step, and auto-save. No data is lost.",
    features: [
      "Category-specific questions",
      "Clear guidance for each field",
      "Auto-save functionality",
      "Progress tracking",
    ],
    imageAlt: "Detailed Forms",
    imageSrc: detailedQuestionnaireImage,
    imageSrcWebp: detailedQuestionnaireImageWebp,
    imagePosition: "left",
  },
  {
    stepNumber: 5,
    title: "Upload Supporting Documents",
    description: "Securely upload all required documents — passport, degrees, employment letters, financial proof, etc. Our system tells you exactly what's needed for your case.",
    features: [
      "Guided document checklist",
      "Drag-and-drop upload",
      "Automatic file verification",
      "Encrypted storage",
    ],
    imageAlt: "Document Upload",
    imageSrc: secureDocumentImage,
    imageSrcWebp: secureDocumentImageWebp,
    imagePosition: "right",
  },
  {
    stepNumber: 6,
    title: "Initial Consultant Review",
    description: "Our experienced immigration consultant thoroughly reviews your application and documents. They contact you with any clarifications needed and provide strategic recommendations.",
    features: [
      "Dedicated case manager assigned",
      "Detailed application review",
      "Strategic recommendations",
      "Direct communication channel",
    ],
    imageAlt: "Consultant Review",
    imageSrc: consultantReviewImage,
    imageSrcWebp: consultantReviewImageWebp,
    imagePosition: "left",
  },
  {
    stepNumber: 7,
    title: "Attorney Legal Review",
    description: "Our immigration attorneys conduct a comprehensive legal review. They ensure USCIS compliance, optimize your application strategy, and prepare expert opinion letters if needed.",
    features: [
      "Attorney-led legal analysis",
      "USCIS compliance check",
      "Strategy optimization",
      "Expert documentation",
    ],
    imageAlt: "Legal Review",
    imageSrc: attorneyReviewImage,
    imageSrcWebp: attorneyReviewImageWebp,
    imagePosition: "right",
  },
  {
    stepNumber: 8,
    title: "Final Filing & Submission",
    description: "We prepare your complete immigration package and file it with USCIS or the appropriate consulate. You receive copies of everything submitted. Real-time tracking begins.",
    features: [
      "Complete package preparation",
      "USCIS filing handled",
      "Receipt of all submissions",
      "Status tracking begins",
    ],
    imageAlt: "Filing & Submission",
    imageSrc: formFillingImage,
    imageSrcWebp: formFillingImageWebp,
    imagePosition: "left",
  },
  {
    stepNumber: 9,
    title: "Track Status & Receive Updates",
    description: "Monitor your case status in real-time through your secure dashboard. Receive instant notifications on approvals, requests for additional evidence, or status changes.",
    features: [
      "Real-time status dashboard",
      "Instant notifications",
      "Communication center",
      "Document request handling",
    ],
    imageAlt: "Status Tracking",
    imageSrc: statusTrackingImage,
    imageSrcWebp: statusTrackingImageWebp,
    imagePosition: "right",
  },
];

/* ── Statistics ──────────────────────────────────────────────────────────────── */
const STATS = [
  { icon: IconAward, value: "1200+", label: "Applications Processed" },
  { icon: IconTrendingUp, value: "98%", label: "Success Rate" },
  { icon: IconGlobe, value: "30+", label: "Countries Served" },
  { icon: IconClock, value: "15+", label: "Years of Experience" },
];

import { IconGlobe, IconPhone } from "../../utils/iconComponents";

export default function HowItWorks() {
  useEffect(() => {
    window.scrollTo(0, 0);
    document.title = "How It Works | Immiglance";
  }, []);

  return (
    <div className="bg-background">
      {/* ══ HERO SECTION ══ */}
      <section className="pt-16 sm:pt-24 pb-12 px-6 sm:px-10 bg-background">
        <div className="max-w-4xl mx-auto text-center">
          <ScrollReveal>
            <span className="inline-block mb-4 px-4 py-1.5 rounded-full bg-accent text-accent-foreground text-xs font-bold uppercase tracking-widest">
              Step-by-Step Guide
            </span>
            <h1 className="text-4xl sm:text-5xl font-extrabold text-foreground mb-5 leading-tight">
              How Your Immigration Journey Works
            </h1>
            <p className="text-lg text-muted-foreground leading-relaxed max-w-2xl mx-auto mb-8">
              A clear, guided process from application to approval. We handle the complexity so you can focus on your future in the USA.
            </p>
            <StartAssessmentButton size="lg" pageSource="How It Works Page" />
          </ScrollReveal>
        </div>
      </section>

      {/* ══ PROCESS STEPS - SaaS Style ══ */}
      <section className="bg-background">
        {PROCESS_STEPS.map((step) => (
          <StepShowcase
            key={step.stepNumber}
            stepNumber={step.stepNumber}
            title={step.title}
            description={step.description}
            features={step.features}
            imageAlt={step.imageAlt}
            imageSrc={step.imageSrc}
            imageSrcWebp={step.imageSrcWebp}
            imageWidth={step.imageSrcWebp ? 1536 : undefined}
            imageHeight={step.imageSrcWebp ? 1024 : undefined}
            imagePosition={step.imagePosition}
          />
        ))}
      </section>

      {/* ══ STATISTICS SECTION ══ */}
      <section className="py-16 sm:py-24 px-6 sm:px-10 bg-secondary border-y border-border">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-16">
            <ScrollReveal>
              <h2 className="text-3xl sm:text-4xl font-extrabold text-foreground mb-3">
                Real Results From Real Clients
              </h2>
              <p className="text-muted-foreground text-lg">
                Numbers that speak for themselves
              </p>
            </ScrollReveal>
          </div>

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-6 sm:gap-8">
            {STATS.map((stat, idx) => (
              <ScrollReveal key={idx} delay={idx * 100}>
                <div className="text-center p-8 rounded-2xl bg-card border border-border hover:border-primary/40 hover:shadow-lg transition-all duration-300">
                  <div className="flex justify-center mb-4">
                    <stat.icon size={32} className="text-primary" />
                  </div>
                  <p className="text-3xl sm:text-4xl font-extrabold text-primary mb-1">
                    {stat.value}
                  </p>
                  <p className="text-xs sm:text-sm font-semibold text-muted-foreground uppercase tracking-widest">
                    {stat.label}
                  </p>
                </div>
              </ScrollReveal>
            ))}
          </div>
        </div>
      </section>

      {/* ══ WHY THIS PROCESS WORKS ══ */}
      <section className="py-16 sm:py-24 px-6 sm:px-10 bg-background">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-16">
            <ScrollReveal>
              <h2 className="text-3xl sm:text-4xl font-extrabold text-foreground mb-3">
                Why This Process Works
              </h2>
              <p className="text-muted-foreground text-lg max-w-2xl mx-auto">
                Built on years of immigration expertise, backed by proven results
              </p>
            </ScrollReveal>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            {[
              {
                icon: IconCheckCircle,
                title: "100% Guided",
                desc: "Every step explained clearly. You always know what's happening.",
              },
              {
                icon: IconShield,
                title: "Completely Secure",
                desc: "Bank-grade encryption protects all your documents and data.",
              },
              {
                icon: IconUsers,
                title: "Expert Support",
                desc: "Attorneys and consultants guide you throughout the journey.",
              },
              {
                icon: IconClock,
                title: "Time-Efficient",
                desc: "Streamlined process reduces preparation time significantly.",
              },
            ].map((item, idx) => (
              <ScrollReveal key={idx} delay={idx * 50}>
                <div className="p-6 rounded-2xl border border-border bg-card hover:border-primary/40 hover:shadow-lg transition-all duration-300">
                  <item.icon size={32} className="text-primary mb-4" />
                  <h3 className="font-bold text-foreground mb-2">{item.title}</h3>
                  <p className="text-sm text-muted-foreground leading-relaxed">{item.desc}</p>
                </div>
              </ScrollReveal>
            ))}
          </div>
        </div>
      </section>

      {/* ══ CTA SECTION ══ */}
      <section className="py-16 sm:py-24 px-6 sm:px-10 bg-primary">
        <div className="max-w-3xl mx-auto text-center text-primary-foreground">
          <ScrollReveal>
            <h2 className="text-3xl sm:text-4xl font-extrabold mb-5">
              Ready to Start Your Journey?
            </h2>
            <p className="text-primary-foreground/80 text-lg mb-8 max-w-2xl mx-auto">
              Join over 1,200 successful clients who've navigated their visa journey with Immiglance. Let's get you to the USA.
            </p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <StartAssessmentButton variant="inverted" size="lg" pageSource="How It Works Page">Start Your Free Assessment</StartAssessmentButton>
              <a
                href="tel:+15107708700"
                className="inline-flex items-center justify-center gap-2 px-8 py-4 bg-primary-foreground/20 border border-primary-foreground/40 text-primary-foreground font-bold rounded-xl hover:bg-primary-foreground/30 transition-colors no-underline"
              >
                <IconPhone size={18} /> Call Us
              </a>
            </div>
          </ScrollReveal>
        </div>
      </section>

      <ConsultationSection source="How It Works Page" id="how-it-works-appointment" />
    </div>
  );
}
