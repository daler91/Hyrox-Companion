import { useMutation } from "@tanstack/react-query";
import { AlertTriangle, Loader2, Trash2 } from "lucide-react";
import { useCallback, useState } from "react";

import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { rawRequest } from "@/lib/api/client";

function useDeleteAccount() {
  return useMutation({
    mutationFn: () => rawRequest("DELETE", "/api/v1/account"),
  });
}

export function AccountDangerZone() {
  const [confirmText, setConfirmText] = useState("");
  const [open, setOpen] = useState(false);
  const { toast } = useToast();
  const deleteMutation = useDeleteAccount();

  const handleDelete = useCallback(() => {
    deleteMutation.mutate(undefined, {
      onSuccess: () => {
        toast({ title: "Account deleted", description: "Your account and all data have been permanently removed." });
        // Force a full page reload to clear all client state and trigger
        // Clerk sign-out (the session cookie is now invalid).
        setTimeout(() => {
          globalThis.window.location.href = "/";
        }, 1500);
      },
      onError: () => {
        toast({ title: "Deletion failed", description: "Could not delete your account. Please try again." });
      },
    });
  }, [deleteMutation, toast]);

  return (
    <Card className="border-destructive/50">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-destructive">
          <AlertTriangle className="h-5 w-5" aria-hidden="true" />
          Danger Zone
        </CardTitle>
        <CardDescription>
          Permanently delete your account and all associated data. This action cannot be undone.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <AlertDialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) setConfirmText(""); }}>
          <AlertDialogTrigger asChild>
            <Button variant="destructive" className="gap-2">
              <Trash2 className="h-4 w-4" aria-hidden="true" />
              Delete Account
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
              <AlertDialogDescription asChild>
                <div className="space-y-3">
                  <p>
                    This will permanently delete your account including all workout logs, training
                    plans, exercise data, chat history, coaching materials, and connected service
                    credentials. This action cannot be undone.
                  </p>
                  <p className="text-sm">
                    We recommend exporting your data first from the Data Tools section above.
                  </p>
                  <div>
                    <label htmlFor="delete-confirm" className="text-sm font-medium">
                      Type <span className="font-mono font-bold">DELETE</span> to confirm:
                    </label>
                    <Input
                      id="delete-confirm"
                      value={confirmText}
                      onChange={(e) => setConfirmText(e.target.value)}
                      placeholder="DELETE"
                      className="mt-1"
                      autoComplete="off"
                    />
                  </div>
                </div>
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <Button
                variant="destructive"
                disabled={confirmText !== "DELETE" || deleteMutation.isPending}
                onClick={handleDelete}
              >
                {deleteMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" aria-hidden="true" />}
                Delete My Account
              </Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </CardContent>
    </Card>
  );
}
