import { Badge } from "@/components/ui/badge";

interface QuickActionsProps {
  suggestions: string[];
  onSelect: (suggestion: string) => void;
}

export function QuickActions({ suggestions, onSelect }: QuickActionsProps) {
  return (
    <div className="flex flex-wrap gap-2" data-testid="quick-actions">
      {suggestions.map((suggestion, index) => (
        <Badge
          key={index}
          variant="secondary"
          className="cursor-pointer"
          onClick={() => onSelect(suggestion)}
          data-testid={`button-suggestion-${index}`}
        >
          {suggestion}
        </Badge>
      ))}
    </div>
  );
}
