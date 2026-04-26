import type { ReactNode } from "react";

import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";

interface SelectOption {
  readonly value: string;
  readonly label: string;
}

interface PreferenceSelectRowProps {
  readonly label: string;
  readonly description: string;
  readonly value: string;
  readonly onValueChange: (value: string) => void;
  readonly options: readonly SelectOption[];
  readonly testId: string;
  readonly ariaLabel: string;
}

export function PreferenceSelectRow({
  label,
  description,
  value,
  onValueChange,
  options,
  testId,
  ariaLabel,
}: PreferenceSelectRowProps) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="space-y-1">
        <Label>{label}</Label>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
      <Select value={value} onValueChange={onValueChange}>
        <SelectTrigger className="w-24" data-testid={testId} aria-label={ariaLabel}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

interface PreferenceSwitchRowProps {
  readonly id: string;
  readonly label: ReactNode;
  readonly description: ReactNode;
  readonly checked: boolean;
  readonly onCheckedChange: (checked: boolean) => void;
  readonly testId: string;
  readonly ariaLabel?: string;
  readonly disabled?: boolean;
}

export function PreferenceSwitchRow({
  id,
  label,
  description,
  checked,
  onCheckedChange,
  testId,
  ariaLabel,
  disabled,
}: PreferenceSwitchRowProps) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="space-y-1">
        <Label htmlFor={id} className="cursor-pointer">
          {label}
        </Label>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
      <Switch
        id={id}
        checked={checked}
        onCheckedChange={onCheckedChange}
        disabled={disabled}
        data-testid={testId}
        aria-label={ariaLabel}
      />
    </div>
  );
}
