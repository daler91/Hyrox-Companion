import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Loader2, Download, FileSpreadsheet, FileJson, Sparkles, Trash2 } from "lucide-react";
import { useMutation } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { api, QUERY_KEYS } from "@/lib/api";
import { apiRequest, queryClient } from "@/lib/queryClient";


export function DataToolsSection() {
  const { toast } = useToast();
  const [unstructuredCount, setUnstructuredCount] = useState<number | null>(null);
  const [parseResults, setParseResults] = useState<{ success: number; failed: number } | null>(null);
  const [deletedCount, setDeletedCount] = useState<number | null>(null);

  const findUnstructuredMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("GET", "/api/v1/workouts/unstructured");
      return response.json();
    },
    onSuccess: (data: Array<{ id: string }>) => {
      setUnstructuredCount(data.length);
      toast({
        title: "Search Complete",
        description: `Found ${data.length} workouts without structured exercise data.`,
      });
    },
    onError: () => {
      toast({
        title: "Search Failed",
        description: "Failed to find unstructured workouts.",
        variant: "destructive",
      });
    },
  });

  const batchReparseMutation = useMutation({
    mutationFn: () => api.workouts.batchReparse(),
    onSuccess: (data) => {
      setParseResults({ success: data.parsed, failed: data.failed });
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.timeline });
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.workouts });
      toast({
        title: "Parsing Complete",
        description: `Parsed ${data.parsed} workouts successfully. ${data.failed} could not be parsed.`,
      });
    },
    onError: () => {
      toast({
        title: "Parsing Failed",
        description: "Failed to parse workouts with AI.",
        variant: "destructive",
      });
    },
  });

  const deleteFutureWorkoutsMutation = useMutation({
    mutationFn: () => api.workouts.deleteAfterDate("2026-04-06"),
    onSuccess: (data) => {
      setDeletedCount(data.deletedCount);
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.timeline });
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.workouts });
      toast({
        title: "Workouts Deleted",
        description: `Deleted ${data.deletedCount} workout${data.deletedCount === 1 ? "" : "s"} after April 6th, 2026.`,
      });
    },
    onError: () => {
      toast({
        title: "Deletion Failed",
        description: "Failed to delete workouts.",
        variant: "destructive",
      });
    },
  });

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5" />
            Structure Old Workouts
          </CardTitle>
          <CardDescription>Use AI to convert free-text workout descriptions into structured exercise data</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {unstructuredCount === null && parseResults === null ? (
            <div>
              <p className="text-sm text-muted-foreground mb-4">
                Find and parse unstructured workout descriptions to extract exercise data using AI.
              </p>
              <Button
                onClick={() => findUnstructuredMutation.mutate()}
                disabled={findUnstructuredMutation.isPending}
                data-testid="button-find-unstructured"
                variant="outline"
              >
                {findUnstructuredMutation.isPending ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                    Searching...
                  </>
                ) : (
                  "Find Unstructured Workouts"
                )}
              </Button>
            </div>
          ) : null}

          {unstructuredCount !== null && !parseResults ? (
            <div>
              <p className="text-sm text-muted-foreground mb-4" data-testid="text-unstructured-count">
                Found {unstructuredCount} workouts without structured exercise data
              </p>
              {unstructuredCount > 0 ? (
                <Button
                  onClick={() => batchReparseMutation.mutate()}
                  disabled={batchReparseMutation.isPending}
                  data-testid="button-batch-reparse"
                >
                  {batchReparseMutation.isPending ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin mr-2" />
                      Parsing...
                    </>
                  ) : (
                    "Parse All with AI"
                  )}
                </Button>
              ) : (
                <p className="text-sm text-muted-foreground">
                  All your workouts are already structured.
                </p>
              )}
            </div>
          ) : null}

          {parseResults ? (
            <div>
              <p className="text-sm text-muted-foreground mb-4" data-testid="text-parse-results">
                Parsed {parseResults.success} workouts successfully. {parseResults.failed} could not be parsed.
              </p>
              <Button
                onClick={() => {
                  setUnstructuredCount(null);
                  setParseResults(null);
                }}
                variant="outline"
                size="sm"
              >
                Run Again
              </Button>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Download className="h-5 w-5" />
            Export Data
          </CardTitle>
          <CardDescription>Download your training data for backup or analysis</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <Button
              variant="outline"
              onClick={() => {
                globalThis.location.href = "/api/v1/export?format=csv";
              }}
              data-testid="button-export-csv"
            >
              <FileSpreadsheet className="h-4 w-4 mr-2" />
              Export as CSV
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                globalThis.location.href = "/api/v1/export?format=json";
              }}
              data-testid="button-export-json"
            >
              <FileJson className="h-4 w-4 mr-2" />
              Export as JSON
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            CSV includes your workout history. JSON includes full data with training plans.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Trash2 className="h-5 w-5" />
            Delete Future Workouts
          </CardTitle>
          <CardDescription>Remove all workouts logged after April 6th, 2026</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {deletedCount !== null ? (
            <p className="text-sm text-muted-foreground" data-testid="text-deleted-count">
              Deleted {deletedCount} workout{deletedCount === 1 ? "" : "s"}.
            </p>
          ) : (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  variant="destructive"
                  disabled={deleteFutureWorkoutsMutation.isPending}
                  data-testid="button-delete-future-workouts"
                >
                  {deleteFutureWorkoutsMutation.isPending ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin mr-2" />
                      Deleting...
                    </>
                  ) : (
                    "Delete Workouts After April 6th"
                  )}
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete future workouts?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This will permanently delete all workouts with dates after April 6th, 2026. This action cannot be undone.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel data-testid="button-cancel-delete-future">Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={() => deleteFutureWorkoutsMutation.mutate()}
                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                    data-testid="button-confirm-delete-future"
                  >
                    Delete
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
        </CardContent>
      </Card>
    </>
  );
}
