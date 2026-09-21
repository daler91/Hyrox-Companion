export default function TimelineHeader() {
  return (
    <div>
      <h1 className="text-2xl font-bold tracking-tight md:text-3xl" data-testid="text-page-title">
        Training
      </h1>
      {/* The subtitle explains a page the phone tab bar already names; on a
          phone it was one more line between the athlete and today's card. */}
      <p className="mt-1 hidden text-muted-foreground md:block">
        Today, upcoming sessions, and recent training.
      </p>
    </div>
  );
}
