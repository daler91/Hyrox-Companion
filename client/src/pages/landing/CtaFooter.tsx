import { Button } from "@/components/ui/button";
import { ArrowRight } from "lucide-react";
import { SignInButton } from "@clerk/react";

export function CtaSection() {
  return (
    <section className="py-20 md:py-28 relative overflow-hidden">
      <div className="absolute inset-0 bg-gradient-to-t from-primary/5 via-primary/3 to-transparent" />
      <div className="container mx-auto px-4 relative text-center">
        <div className="max-w-2xl mx-auto">
          <h2 className="fade-up text-3xl md:text-4xl font-bold mb-5">
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
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded bg-primary flex items-center justify-center">
              <span className="text-primary-foreground font-bold text-xs">F</span>
            </div>
            <span className="font-semibold text-sm">fitai.coach</span>
          </div>
          <p className="text-sm text-muted-foreground">
            Train smarter with AI
          </p>
        </div>
      </div>
    </footer>
  );
}
