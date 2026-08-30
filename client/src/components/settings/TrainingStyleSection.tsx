import { HeartPulse, Info } from "lucide-react";
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
import { Button } from "@/components/ui/button";
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

/** Maffetone's category question (audit M6); "" means "not answered". Values
 *  mirror MafCategory in shared/maf.ts. */
export type MafCategoryInput = "" | import("@shared/maf").MafCategory;
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
  /** The athlete's stored MAF ceiling in bpm. Optional so non-MAF callers and
   *  the settings test harness need not supply it. */
  readonly mafHr?: number | null;
  readonly mafAgeInput: string;
  readonly mafCategoryInput: MafCategoryInput;
  readonly mafHrDataAvailableInput: MafHrDataAvailableInput;
  readonly onMafAgeInputChange: (value: string) => void;
  readonly onMafCategoryInputChange: (value: MafCategoryInput) => void;
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
  mafHr,
  mafAgeInput,
  mafCategoryInput,
  mafHrDataAvailableInput,
  onMafAgeInputChange,
  onMafCategoryInputChange,
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
  const [draftMafCategoryInput, setDraftMafCategoryInput] =
    useState<MafCategoryInput>(mafCategoryInput);
  const [draftMafHrDataAvailableInput, setDraftMafHrDataAvailableInput] =
    useState<MafHrDataAvailableInput>(mafHrDataAvailableInput);

  const applyTrainingStyle = (styleId: string) => {
    onTrainingStyleIdChange(styleId);
    setStyleTransitionNotice(getStyleTransitionNotice(styleId));
    setStyleSwitchBlockedMessage(null);
  };

  const openMafSetup = () => {
    setDraftMafAgeInput(mafAgeInput);
    setDraftMafCategoryInput(mafCategoryInput);
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
        <CardContent className="space-y-3 text-sm text-muted-foreground">
          <div className="flex gap-2">
            <Info className="h-4 w-4 mt-0.5" aria-hidden="true" />
            <p>
              Recommendations are explained using your current style first, then filtered by saved
              constraints and available baseline data.
            </p>
          </div>
          {trainingStyleId === "maf_method" && mafHr != null && (
            <div className="flex gap-2" data-testid="maf-ceiling-summary">
              <HeartPulse className="h-4 w-4 mt-0.5" aria-hidden="true" />
              <p>
                Your MAF ceiling is{" "}
                <strong className="text-foreground tabular-nums">{mafHr} bpm</strong> — 180 minus
                your age, adjusted by your Maffetone health and training category. Aerobic sessions
                are scored against it, so keep easy runs at or under it.
              </p>
            </div>
          )}
          {trainingStyleId === "maf_method" && (
            // The dialog was previously reachable only while SWITCHING to MAF,
            // and only when required inputs were missing — so an athlete
            // already on MAF could never revisit these answers, which is how
            // the injury flag became permanent.
            <Button
              variant="outline"
              size="sm"
              className="self-start"
              data-testid="button-maf-setup"
              onClick={openMafSetup}
            >
              Edit MAF setup
            </Button>
          )}
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
              <Label htmlFor="maf-category-select">Health and training category</Label>
              {/* Maffetone's own category question (audit M6), editable here
                  for the same reason the old injury flag was: the answer moves
                  the ceiling and must not be write-once at onboarding — a
                  healed injury or a second training anniversary changes it. */}
              <Select
                value={draftMafCategoryInput}
                onValueChange={(value: MafCategoryInput) => setDraftMafCategoryInput(value)}
              >
                <SelectTrigger id="maf-category-select" data-testid="select-maf-category">
                  <SelectValue placeholder="Which best describes you? (required)" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="recovering_or_medicated">
                    Recovering from major illness or surgery, or on regular medication (−10 bpm)
                  </SelectItem>
                  <SelectItem value="training_interrupted">
                    Injured, regressing, frequent colds, allergies/asthma, or new/inconsistent
                    training (−5 bpm)
                  </SelectItem>
                  <SelectItem value="consistent_up_to_2y">
                    Training consistently (up to 2 years) without those problems
                  </SelectItem>
                  <SelectItem value="consistent_2y_plus_improving">
                    Training 2+ years without those problems, and improving (+5 bpm)
                  </SelectItem>
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
                  !draftMafCategoryInput
                ) {
                  event.preventDefault();
                  setMafSetupError("Enter a valid age and select your category.");
                  return;
                }
                setMafSetupError(null);
                onMafAgeInputChange(String(parsedAge));
                onMafCategoryInputChange(draftMafCategoryInput);
                onMafHrDataAvailableInputChange(draftMafHrDataAvailableInput);
                // Only a style SWITCH has a pending id to apply; editing the
                // setup of the style already in use just saves the answers.
                if (pendingStyleId) applyTrainingStyle(pendingStyleId);
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
