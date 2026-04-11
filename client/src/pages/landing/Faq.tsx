import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";

const FAQS = [
  {
    question: "Is fitai.coach free to use?",
    answer:
      "Yes. The core training tracker, timeline, workout logging, and analytics are free. Some AI-assisted features (plan generation, streaming chat) may have fair-use limits.",
  },
  {
    question: "Do I need to be training for Hyrox specifically?",
    answer:
      "No. The app is built around Hyrox-style training blocks, but the exercise library covers strength, running, conditioning, and functional movements, so anyone following a structured program can use it.",
  },
  {
    question: "How does the AI coach work?",
    answer:
      "After each workout you log, the AI reviews your recent volume, intensity, and plan progression, then suggests adjustments to upcoming sessions. You can accept, tweak, or dismiss any suggestion before it touches your plan.",
  },
  {
    question: "Will my Strava activities sync automatically?",
    answer:
      "Once you connect Strava from Settings, completed activities appear on your timeline with a Strava badge. Your Strava tokens are encrypted at rest and never shared with third parties.",
  },
  {
    question: "What happens if I go offline mid-workout?",
    answer:
      "The app is a Progressive Web App with an offline queue. Workouts you log without a connection are held locally and sync automatically the moment you're back online — you'll see a Back online confirmation when it happens.",
  },
  {
    question: "Can I import my own training plan?",
    answer:
      "Yes. You can upload a CSV training plan during onboarding or from the Timeline page. We also ship an 8-week sample plan and can generate a custom plan from your goal description.",
  },
];

export function Faq() {
  return (
    <section id="faq" className="py-20 bg-muted/20">
      <div className="container mx-auto px-4 max-w-3xl">
        <div className="fade-up text-center mb-12">
          <h2 className="text-3xl md:text-4xl font-bold mb-3">Frequently asked questions</h2>
          <p className="text-muted-foreground text-base md:text-lg">
            Short answers to the questions athletes ask before signing up.
          </p>
        </div>
        <div className="fade-up">
          <Accordion type="single" collapsible className="w-full">
            {FAQS.map((item, index) => (
              <AccordionItem key={item.question} value={`faq-${index}`} data-testid={`faq-item-${index}`}>
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
