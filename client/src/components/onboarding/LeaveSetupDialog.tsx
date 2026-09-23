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

interface LeaveSetupDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly onLeave: () => void;
}

/**
 * Asks before Esc or ✕ ends setup: one reflexive keypress used to end
 * onboarding for good (onboarding audit H4).
 */
export function LeaveSetupDialog({ open, onOpenChange, onLeave }: Readonly<LeaveSetupDialogProps>) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Leave setup?</AlertDialogTitle>
          <AlertDialogDescription>
            What you have saved so far is kept. You can run setup again anytime from Settings →
            Account → Getting Started.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel data-testid="button-onboarding-keep-going">
            Keep setting up
          </AlertDialogCancel>
          <AlertDialogAction onClick={onLeave} data-testid="button-onboarding-leave">
            Leave setup
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
