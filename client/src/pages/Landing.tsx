import { useDocumentTitle } from "@/hooks/useDocumentTitle";

import { CtaSection, LandingFooter } from "./landing/CtaFooter";
import { ExerciseShowcase } from "./landing/ExerciseShowcase";
import { Faq } from "./landing/Faq";
import { Features, SocialProof } from "./landing/Features";
import { Hero, LandingHeader } from "./landing/Hero";
import { HowItWorks } from "./landing/HowItWorks";
import { useInView } from "./landing/useInView";

export default function Landing() {
  useDocumentTitle("");
  const sectionRef = useInView();

  return (
    <div className="min-h-screen bg-background" ref={sectionRef}>
      <a href="#main-content" className="skip-to-content">
        Skip to main content
      </a>
      <style>{`
        .fade-up {
          opacity: 0;
          transform: translateY(24px);
          transition: opacity 0.6s ease-out, transform 0.6s ease-out;
        }
        .fade-up.animate-in {
          opacity: 1;
          transform: translateY(0);
        }
        .fade-up:nth-child(2) { transition-delay: 0.1s; }
        .fade-up:nth-child(3) { transition-delay: 0.2s; }
        .fade-up:nth-child(4) { transition-delay: 0.3s; }
        .fade-up:nth-child(5) { transition-delay: 0.4s; }
        @keyframes float {
          0%, 100% { transform: translateY(0px); }
          50% { transform: translateY(-8px); }
        }
        .float-animation {
          animation: float 4s ease-in-out infinite;
        }
        /* Decorative, static (reduced-motion safe). Always aria-hidden. */
        .bg-grid {
          background-image:
            linear-gradient(to right, hsl(var(--border) / 0.6) 1px, transparent 1px),
            linear-gradient(to bottom, hsl(var(--border) / 0.6) 1px, transparent 1px);
          background-size: 64px 64px;
          -webkit-mask-image: radial-gradient(ellipse at top, #000 0%, transparent 70%);
          mask-image: radial-gradient(ellipse at top, #000 0%, transparent 70%);
        }
        .accent-glow {
          background: radial-gradient(circle at center, hsl(var(--accent) / 0.18) 0%, transparent 70%);
          filter: blur(40px);
        }
      `}</style>

      <LandingHeader />

      <main id="main-content" tabIndex={-1} className="focus:outline-none">
        <Hero />
        <SocialProof />
        <Features />
        <HowItWorks />
        <ExerciseShowcase />
        <Faq />
        <CtaSection />
      </main>

      <LandingFooter />
    </div>
  );
}
