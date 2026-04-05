import { useInView } from "./landing/useInView";
import { Hero, LandingHeader } from "./landing/Hero";
import { Features, SocialProof } from "./landing/Features";
import { HowItWorks } from "./landing/HowItWorks";
import { ExerciseShowcase } from "./landing/ExerciseShowcase";
import { CtaSection, LandingFooter } from "./landing/CtaFooter";

export default function Landing() {
  const sectionRef = useInView();

  return (
    <div className="min-h-screen bg-background" ref={sectionRef}>
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
      `}</style>

      <LandingHeader />

      <main>
        <Hero />
        <SocialProof />
        <Features />
        <HowItWorks />
        <ExerciseShowcase />
        <CtaSection />
      </main>

      <LandingFooter />
    </div>
  );
}
