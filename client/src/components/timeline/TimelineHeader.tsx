export default function TimelineHeader() {
  return (
    <div className="flex items-center justify-between gap-4 flex-wrap">
      <div>
        <h1 className="text-3xl font-bold tracking-tight" data-testid="text-page-title">
          Training Timeline
        </h1>
        <p className="text-muted-foreground mt-1">
          Today, upcoming sessions, and recent training.
        </p>
      </div>
    </div>
  );
}
