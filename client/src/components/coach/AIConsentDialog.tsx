import { Bot, ExternalLink, ShieldCheck } from "lucide-react";

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

interface AIConsentDialogProps {
  readonly open: boolean;
  readonly onAccept: () => void;
  readonly onDecline: () => void;
}

export function AIConsentDialog({ open, onAccept, onDecline }: AIConsentDialogProps) {
  return (
    <AlertDialog open={open} onOpenChange={(v) => !v && onDecline()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <Bot className="h-5 w-5" aria-hidden="true" />
            Enable AI Coach
          </AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-3 text-sm text-muted-foreground">
              <p>
                The AI Coach uses Google Gemini to analyze your training and provide personalized
                coaching. To do this, the following data is sent to Google for processing:
              </p>
              <ul className="list-disc pl-5 space-y-1">
                <li>Your recent workout history (exercises, sets, reps, weights)</li>
                <li>Training plan details and schedule</li>
                <li>Performance metrics (RPE, duration, heart rate if synced)</li>
                <li>Chat messages you send to the coach</li>
              </ul>
              <div className="flex items-start gap-2 rounded-md bg-muted p-3">
                <ShieldCheck className="h-4 w-4 mt-0.5 flex-shrink-0" aria-hidden="true" />
                <p className="text-xs">
                  Your data is used solely to generate coaching responses and is not used to train
                  AI models. You can disable the AI Coach at any time in Settings.
                </p>
              </div>
              <p className="text-xs">
                By enabling, you consent to this data processing.{" "}
                <a href="/privacy" className="inline-flex items-center gap-1 underline hover:text-foreground">
                  Privacy Policy <ExternalLink className="h-3 w-3" aria-hidden="true" />
                </a>
              </p>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={onDecline}>Not now</AlertDialogCancel>
          <AlertDialogAction onClick={onAccept}>Enable AI Coach</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
