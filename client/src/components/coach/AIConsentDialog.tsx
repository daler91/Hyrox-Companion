import { Bot } from "lucide-react";

import { AiConsentDetails } from "@/components/coach/AiConsentDetails";
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
            <AiConsentDetails />
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
