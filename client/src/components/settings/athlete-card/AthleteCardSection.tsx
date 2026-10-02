import { isAthleteFactDue, MAX_ACTIVE_ATHLETE_FACTS } from "@shared/athleteFacts";
import { ClipboardList } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { useAthleteFacts } from "@/hooks/useAthleteFacts";
import { getTodayString } from "@/lib/dateUtils";

import { AddAthleteFactForm } from "./AddAthleteFactForm";
import { type AthleteCardFacts, groupAthleteFacts } from "./athleteCardModel";
import { AthleteFactRow } from "./AthleteFactRow";
import { LegacyNoteBanner } from "./LegacyNoteBanner";
import { RetiredFactList } from "./RetiredFactList";

function AthleteCardFactsList({ card, today }: { readonly card: AthleteCardFacts; readonly today: string }) {
  const atCap = card.active.length >= MAX_ACTIVE_ATHLETE_FACTS;
  return (
    <>
      {card.active.length > 0 ? (
        <ul className="space-y-2" aria-label="Facts your coach reads">
          {card.active.map((fact) => (
            <AthleteFactRow key={fact.id} fact={fact} due={isAthleteFactDue(fact.reviewOn, today)} />
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">
          Nothing yet. Add what your coach should always know, like &ldquo;No sled at my gym&rdquo;
          or &ldquo;I work night shifts on Tuesdays&rdquo;.
        </p>
      )}
      <AddAthleteFactForm atCap={atCap} />
      <RetiredFactList facts={card.retired} atCap={atCap} />
    </>
  );
}

function AthleteCardBody() {
  const { data, isLoading, isError, refetch } = useAthleteFacts();
  if (isLoading) return <LoadingSpinner label="Loading your athlete card" iconClassName="h-5 w-5" />;
  if (isError || !data) {
    return (
      <div role="alert" className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
        Couldn&apos;t load your athlete card.
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            // A refetch reports through the query's own state, never by rejecting.
            refetch().catch(() => null);
          }}
        >
          Try again
        </Button>
      </div>
    );
  }
  const today = getTodayString();
  return <AthleteCardFactsList card={groupAthleteFacts(data, today)} today={today} />;
}

interface AthleteCardSectionProps {
  /** The older free-text injuries note, while the athlete still has one. */
  readonly legacyNote?: string | null;
}

/**
 * The athlete card (coach-memory spec, Path C): what the athlete told the
 * coach is true every week, a fact at a time. Every coach prompt and every
 * generated plan reads the active facts. One past its review date is asked
 * about here ("Still true?") and stays in use until the athlete answers.
 */
export function AthleteCardSection({ legacyNote }: AthleteCardSectionProps) {
  const note = legacyNote?.trim();
  return (
    <Card data-testid="card-athlete-card">
      <CardHeader>
        <CardTitle as="h2" className="flex items-center gap-2">
          <ClipboardList className="h-5 w-5" aria-hidden="true" />
          Athlete card
        </CardTitle>
        <CardDescription>
          What your coach should always program around, in your own words: injuries, equipment you
          don&apos;t have, your schedule. Every plan and every coach reply reads it.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {note ? <LegacyNoteBanner note={note} /> : null}
        <AthleteCardBody />
      </CardContent>
    </Card>
  );
}
