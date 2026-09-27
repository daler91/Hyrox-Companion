import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";

import { FAQS } from "./landingCopy";
import { SectionHeading } from "./SectionHeading";

export function Faq() {
  return (
    <section id="faq" className="py-20 md:py-28">
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
