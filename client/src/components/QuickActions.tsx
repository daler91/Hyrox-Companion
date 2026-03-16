import { Button } from "@/components/ui/button";

export interface QuickAction {
  id: string;
  label: string;
}

interface QuickActionsProps {
  readonly actions: QuickAction[];
  readonly onSelect: (action: QuickAction) => void;
  readonly disabled?: boolean;
}

export function QuickActions({ actions, onSelect, disabled }: QuickActionsProps) {
  return (
    <div className="flex flex-wrap gap-2" data-testid="quick-actions">
      {actions.map((action) => (
        <Button
          key={action.id}
          variant="secondary"
          size="sm"
          disabled={disabled}
          onClick={() => onSelect(action)}
          data-testid={`button-action-${action.id}`}
        >
          {action.label}
        </Button>
      ))}
    </div>
  );
}
