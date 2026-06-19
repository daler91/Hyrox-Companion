import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";

import { SectionHeading } from "./SectionHeading";

const FAQS = [
  {
    question: "Is fitai.coach free to use?",
    answer:
      "Yes. The core training tracker, timeline, workout logging, and analytics are free. Some AI-assisted features (plan generation, streaming chat) may have fair-use limits.",
  },
  {
    question: "Do I need a specific race goal?",
    answer:
      "No. fitai.coach works for any structured training: hyrox prep, half-marathon builds, general functional fitness, strength cycles. The exercise library covers running, strength, conditioning, and the full set of functional stations.",
  },
  {
    question: "How does the AI coach work?",
    answer:
      "After each workout you log, the AI reviews your recent volume, intensity, and plan progression, then suggests adjustments to upcoming sessions. You can accept, tweak, or dismiss any suggestion before it touches your plan.",
  },
  {
    question: "Do I have to type out every workout?",
    answer:
      "No. Describe a session in plain text, dictate it with your voice, or snap a photo of a whiteboard or printed plan. The AI parses it into structured exercises, sets, reps, and loads for you to review before saving.",
  },
  {
    question: "Will my Strava and Garmin activities sync?",
    answer:
      "Yes. Connect Strava or Garmin Connect from Settings and completed activities appear on your timeline with a source badge. Your Strava tokens and Garmin credentials are encrypted at rest and never shared with third parties.",
  },
  {
    question: "What happens if I go offline mid-workout?",
    answer:
      "The app is a Progressive Web App with an offline queue for workout logging. If a workout save loses connection, it is held locally and syncs automatically when you're back online. Signing out or deleting your account clears unsynced local saves for privacy.",
  },
  {
    question: "Can I import my own training plan?",
    answer:
      "Yes. You can upload a CSV training plan during onboarding or from the Timeline page. We also ship an 8-week sample plan and can generate a custom plan from your goal description.",
  },
];

export function Faq() {
  return (
    <section id="faq" className="py-20 md:py-28 bg-muted/20">
      <div className="container mx-auto px-4 max-w-3xl">
        <SectionHeading
          eyebrow="FAQ"
          title="Frequently asked questions"
          description="Short answers to the questions athletes ask before signing up."
        />
        <div className="fade-up">
          <Accordion type="single" collapsible className="w-full space-y-3">
            {FAQS.map((item, index) => (
              <AccordionItem
                key={item.question}
                value={`faq-${index}`}
                data-testid={`faq-item-${index}`}
                className="rounded-lg border border-border/60 bg-card/50 px-4"
              >
                <AccordionTrigger className="text-left text-base font-semibold">
                  {item.question}
                </AccordionTrigger>
                <AccordionContent className="text-sm text-muted-foreground">
                  {item.answer}
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </div>
      </div>
    </section>
  );
}
