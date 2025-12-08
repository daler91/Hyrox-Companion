import { QuickActions } from "../QuickActions";

export default function QuickActionsExample() {
  const suggestions = [
    "Analyze my running",
    "Show weekly volume",
    "Compare to last month",
    "Best SkiErg time",
  ];

  return (
    <div className="p-4">
      <QuickActions
        suggestions={suggestions}
        onSelect={(s) => console.log("Selected:", s)}
      />
    </div>
  );
}
