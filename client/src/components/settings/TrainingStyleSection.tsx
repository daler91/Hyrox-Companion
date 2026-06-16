import { Info } from "lucide-react";
import { useState } from "react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export type MafConsistencyInput = "" | "low" | "moderate" | "high";
export type MafTrendInput = "" | "improving" | "flat" | "declining";
export type MafHrDataAvailableInput = "" | "yes" | "no";

export interface StyleAuditEntry {
  changedAtIso: string;
  fromStyleId: string;
  toStyleId: string;
  recalculations: string[];
}

const STYLE_LABELS: Record<string, string> = {
  balanced_default: "Balanced",
  maf_method: "MAF Method",
};

export function getStyleLabel(styleId: string): string {
  return STYLE_LABELS[styleId] ?? "Balanced";
}

export function buildRecalculationSummary(styleId: string): string[] {
  const summary = [
    "Coach recommendation prompt context switched to the selected style.",
    "Future plan generation uses the updated style constraints.",
    "Training-style recompute flag set for downstream AI calculations.",
  ];
  if (styleId === "maf_method") {
    summary.push("MAF heart-rate ceiling recomputed and baseline test reminder scheduled.");
  }
  return summary;
}

interface TrainingStyleSectionProps {
  readonly trainingStyleId: string;
  readonly onTrainingStyleIdChange: (value: string) => void;
  readonly hasRequiredMafInputs: boolean;
  readonly mafAgeInput: string;
  readonly mafConsistencyInput: MafConsistencyInput;
  readonly mafTrendInput: MafTrendInput;
  readonly mafHrDataAvailableInput: MafHrDataAvailableInput;
  readonly onMafAgeInputChange: (value: string) => void;
  readonly onMafConsistencyInputChange: (value: MafConsistencyInput) => void;
  readonly onMafTrendInputChange: (value: MafTrendInput) => void;
  readonly onMafHrDataAvailableInputChange: (value: MafHrDataAvailableInput) => void;
  readonly styleAuditEntries: readonly StyleAuditEntry[];
}

function getStyleConstraintText(styleId: string): string {
  return styleId === "maf_method"
    ? "MAF uses HR ceiling framing (stay at or under your ceiling; it is not a target to chase)."
    : "Balanced style blends aerobic work, quality sessions, and recovery constraints.";
}

function getStyleTransitionNotice(styleId: string): string {
  return `Switched to ${getStyleLabel(styleId)}. Immediate: coaching language and new recommendations update now. After re-baseline: future trend analysis and longer-horizon plan adjustments will settle once new baseline data is captured.`;
}

export function TrainingStyleSection({
  trainingStyleId,
  onTrainingStyleIdChange,
  hasRequiredMafInputs,
  mafAgeInput,
  mafConsistencyInput,
  mafTrendInput,
  mafHrDataAvailableInput,
  onMafAgeInputChange,
  onMafConsistencyInputChange,
  onMafTrendInputChange,
  onMafHrDataAvailableInputChange,
  styleAuditEntries,
}: Readonly<TrainingStyleSectionProps>) {
  const [confirmStyleOpen, setConfirmStyleOpen] = useState(false);
  const [pendingStyleId, setPendingStyleId] = useState<string | null>(null);
  const [styleTransitionNotice, setStyleTransitionNotice] = useState<string | null>(null);
  const [styleSwitchBlockedMessage, setStyleSwitchBlockedMessage] = useState<string | null>(null);
  const [mafSetupOpen, setMafSetupOpen] = useState(false);
  const [mafSetupError, setMafSetupError] = useState<string | null>(null);
  const [draftMafAgeInput, setDraftMafAgeInput] = useState(mafAgeInput);
  const [draftMafConsistencyInput, setDraftMafConsistencyInput] =
    useState<MafConsistencyInput>(mafConsistencyInput);
  const [draftMafTrendInput, setDraftMafTrendInput] = useState<MafTrendInput>(mafTrendInput);
  const [draftMafHrDataAvailableInput, setDraftMafHrDataAvailableInput] =
    useState<MafHrDataAvailableInput>(mafHrDataAvailableInput);

  const applyTrainingStyle = (styleId: string) => {
    onTrainingStyleIdChange(styleId);
    setStyleTransitionNotice(getStyleTransitionNotice(styleId));
    setStyleSwitchBlockedMessage(null);
  };

  const openMafSetup = () => {
    setDraftMafAgeInput(mafAgeInput);
    setDraftMafConsistencyInput(mafConsistencyInput);
    setDraftMafTrendInput(mafTrendInput);
    setDraftMafHrDataAvailableInput(mafHrDataAvailableInput);
    setMafSetupError(null);
    setMafSetupOpen(true);
  };

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle as="h2">Training style</CardTitle>
          <CardDescription>
            Changing style updates future analysis and plan generation behavior.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          <Label htmlFor="training-style-select">Training style</Label>
          <Select
            value={trainingStyleId}
            onValueChange={(value) => {
              setStyleSwitchBlockedMessage(null);
              setPendingStyleId(value);
              setConfirmStyleOpen(true);
            }}
          >
            <SelectTrigger id="training-style-select" className="max-w-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="balanced_default">Balanced</SelectItem>
              <SelectItem value="maf_method">MAF Method</SelectItem>
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      {styleTransitionNotice && (
        <Card className="border-primary/40">
          <CardHeader>
            <CardTitle as="h2" className="text-base">
              Style transition notice
            </CardTitle>
            <CardDescription>{styleTransitionNotice}</CardDescription>
          </CardHeader>
        </Card>
      )}

      {styleSwitchBlockedMessage && (
        <p className="text-sm text-destructive" role="alert" data-testid="maf-switch-blocked">
          {styleSwitchBlockedMessage}
        </p>
      )}

      <Card>
        <CardHeader>
          <CardTitle as="h2">Why this recommendation</CardTitle>
          <CardDescription>
            Active style: <strong>{getStyleLabel(trainingStyleId)}</strong>. Key constraints:{" "}
            {getStyleConstraintText(trainingStyleId)}
          </CardDescription>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          <div className="flex gap-2">
            <Info className="h-4 w-4 mt-0.5" aria-hidden="true" />
            <p>
              Recommendations are explained using your current style first, then filtered by saved
              constraints and available baseline data.
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle as="h2">Settings audit</CardTitle>
          <CardDescription>
            Tracks training-style changes and triggered downstream recalculations.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {styleAuditEntries.length === 0 ? (
            <p className="text-sm text-muted-foreground">No training-style changes recorded yet.</p>
          ) : (
            styleAuditEntries.map((entry) => (
              <div key={entry.changedAtIso} className="rounded-md border p-3 text-sm">
                <p className="font-medium">
                  {new Date(entry.changedAtIso).toLocaleString()} -{" "}
                  {getStyleLabel(entry.fromStyleId)} to {getStyleLabel(entry.toStyleId)}
                </p>
                <ul className="list-disc pl-5 text-muted-foreground">
                  {entry.recalculations.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <AlertDialog open={confirmStyleOpen} onOpenChange={setConfirmStyleOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Change training style?</AlertDialogTitle>
            <AlertDialogDescription>
              This will change how your AI analysis works and affect future plans. We'll re-baseline
              MAF settings when needed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (!pendingStyleId) {
                  return;
                }
                if (pendingStyleId === "maf_method" && !hasRequiredMafInputs) {
                  setStyleSwitchBlockedMessage("Complete MAF setup to switch styles");
                  openMafSetup();
                  return;
                }
                applyTrainingStyle(pendingStyleId);
              }}
            >
              Confirm
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={mafSetupOpen} onOpenChange={setMafSetupOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Complete MAF setup</AlertDialogTitle>
            <AlertDialogDescription>
              Required fields are marked. Optional field: HR data available.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-3">
            <div className="space-y-2">
              <Label htmlFor="maf-age-input">Age</Label>
              <Input
                id="maf-age-input"
                placeholder="Age (required)"
                value={draftMafAgeInput}
                onChange={(event) => setDraftMafAgeInput(event.target.value)}
                data-testid="maf-age-input"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="maf-consistency-select">Consistency</Label>
              <Select
                value={draftMafConsistencyInput}
                onValueChange={(value: MafConsistencyInput) => setDraftMafConsistencyInput(value)}
              >
                <SelectTrigger id="maf-consistency-select">
                  <SelectValue placeholder="Consistency (required)" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="low">Low</SelectItem>
                  <SelectItem value="moderate">Moderate</SelectItem>
                  <SelectItem value="high">High</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="maf-trend-select">Trend</Label>
              <Select
                value={draftMafTrendInput}
                onValueChange={(value: MafTrendInput) => setDraftMafTrendInput(value)}
              >
                <SelectTrigger id="maf-trend-select">
                  <SelectValue placeholder="Trend (required)" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="improving">Improving</SelectItem>
                  <SelectItem value="flat">Flat</SelectItem>
                  <SelectItem value="declining">Declining</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="maf-hr-data-available-select">HR data available</Label>
              <Select
                value={draftMafHrDataAvailableInput}
                onValueChange={(value: MafHrDataAvailableInput) =>
                  setDraftMafHrDataAvailableInput(value)
                }
              >
                <SelectTrigger id="maf-hr-data-available-select">
                  <SelectValue placeholder="HR data available (optional)" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="yes">Yes</SelectItem>
                  <SelectItem value="no">No</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {mafSetupError && (
              <p className="text-sm text-destructive" role="alert">
                {mafSetupError}
              </p>
            )}
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                const parsedAge = Number.parseInt(draftMafAgeInput, 10);
                if (
                  !Number.isInteger(parsedAge) ||
                  parsedAge < 16 ||
                  parsedAge > 99 ||
                  !draftMafConsistencyInput ||
                  !draftMafTrendInput
                ) {
                  event.preventDefault();
                  setMafSetupError("Enter a valid age and select required MAF fields.");
                  return;
                }
                setMafSetupError(null);
                if (!pendingStyleId) {
                  return;
                }
                onMafAgeInputChange(String(parsedAge));
                onMafConsistencyInputChange(draftMafConsistencyInput);
                onMafTrendInputChange(draftMafTrendInput);
                onMafHrDataAvailableInputChange(draftMafHrDataAvailableInput);
                applyTrainingStyle(pendingStyleId);
                setMafSetupOpen(false);
              }}
            >
              Save MAF setup
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
