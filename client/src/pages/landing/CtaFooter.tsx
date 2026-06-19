import { SignInButton } from "@clerk/react";
import { ArrowRight } from "lucide-react";

import { Logo } from "@/components/brand/Logo";
import { Button } from "@/components/ui/button";

export function CtaSection() {
  return (
    <section className="py-20 md:py-28 relative overflow-hidden">
      <div className="absolute inset-0 bg-gradient-to-t from-primary/5 via-primary/3 to-transparent" aria-hidden="true" />
      <div className="accent-glow absolute left-1/2 top-1/2 h-[24rem] w-[24rem] -translate-x-1/2 -translate-y-1/2" aria-hidden="true" />
      <div className="container mx-auto px-4 relative text-center">
        <div className="max-w-2xl mx-auto">
          <h2 className="fade-up font-heading text-3xl md:text-4xl font-bold tracking-tight mb-5">
            Ready to Train Smarter?
          </h2>
          <p className="fade-up text-lg text-muted-foreground mb-8">
            Join athletes using AI-powered coaching to reach their fitness goals. Free to get started.
          </p>
          <div className="fade-up">
            <SignInButton mode="modal">
              <Button size="lg" className="text-base px-8" data-testid="button-start-training">
                Start Training Today
                <ArrowRight className="h-4 w-4 ml-2" />
              </Button>
            </SignInButton>
          </div>
        </div>
      </div>
    </section>
  );
}

export function LandingFooter() {
  return (
    <footer className="border-t py-8 bg-muted/20">
      <div className="container mx-auto px-4">
        <div className="flex flex-col md:flex-row items-center justify-between gap-4">
          <Logo size={24} />
          <nav className="flex items-center gap-4 text-sm text-muted-foreground" aria-label="Footer">
            <a href="#features" className="rounded hover:text-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">Features</a>
            <a href="#how-it-works" className="rounded hover:text-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">How It Works</a>
            <a href="#faq" className="rounded hover:text-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">FAQ</a>
            <a href="/privacy" className="rounded hover:text-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">Privacy</a>
          </nav>
        </div>
        <p className="mt-6 text-center text-xs text-muted-foreground md:text-left">
          © 2026 fitai.coach · Train smarter with AI
        </p>
      </div>
    </footer>
  );
}
