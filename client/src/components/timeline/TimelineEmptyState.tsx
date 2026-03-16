import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  FileText,
  Calendar,
  Loader2,
  Dumbbell,
  Target,
  Zap,
  Sparkles,
} from "lucide-react";
import { Link } from "wouter";
import { FilterStatus } from "./types";
import { TrainingPlan } from "@shared/schema";

interface TimelineEmptyStateProps {
  filterStatus: FilterStatus;
  selectedPlanId: string | null;
  plans: TrainingPlan[];
  samplePlanMutation: { mutate: () => void; isPending: boolean };
  importMutation: { isPending: boolean };
  handleFileUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
  setSchedulingPlanId: (id: string) => void;
  setFilterStatus: (status: FilterStatus) => void;
}

export default function TimelineEmptyState({
  filterStatus,
  selectedPlanId,
  plans,
  samplePlanMutation,
  importMutation,
  handleFileUpload,
  setSchedulingPlanId,
  setFilterStatus,
}: Readonly<TimelineEmptyStateProps>) {
  return (
    <Card className="overflow-visible">
      <CardContent className="p-8 md:p-12">
        {filterStatus === "all" && !selectedPlanId && plans.length === 0 ? (
          <div className="text-center space-y-6">
            <div className="flex justify-center gap-3 mb-2">
              <div className="p-3 rounded-full bg-primary/10">
                <Target className="h-6 w-6 text-primary" />
              </div>
              <div className="p-3 rounded-full bg-primary/10">
                <Dumbbell className="h-6 w-6 text-primary" />
              </div>
              <div className="p-3 rounded-full bg-primary/10">
                <Zap className="h-6 w-6 text-primary" />
              </div>
            </div>

            <div>
              <h2 className="text-2xl font-bold mb-2">Welcome to HyroxTracker</h2>
              <p className="text-muted-foreground max-w-md mx-auto">
                Your personal training companion for Hyrox preparation. Track workouts, follow structured plans, and get AI-powered coaching.
              </p>
            </div>

            <div className="flex flex-col sm:flex-row gap-3 justify-center pt-2">
              <Button
                size="lg"
                onClick={() => samplePlanMutation.mutate()}
                disabled={samplePlanMutation.isPending}
                data-testid="button-use-sample-plan"
              >
                {samplePlanMutation.isPending ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Sparkles className="h-4 w-4 mr-2" />
                )}
                Use 8-Week Hyrox Plan
              </Button>
              <div>
                <Label htmlFor="csv-upload-empty" className="cursor-pointer">
                  <Button size="lg" variant="outline" disabled={importMutation.isPending} data-testid="button-import-plan-empty" asChild>
                    <span>
                    {importMutation.isPending ? (
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    ) : (
                      <FileText className="h-4 w-4 mr-2" />
                    )}
                    Import Your Own
                    </span>
                  </Button>
                </Label>
                <Input
                  id="csv-upload-empty"
                  type="file"
                  accept=".csv"
                  className="hidden"
                  onChange={handleFileUpload}
                  data-testid="input-csv-upload-empty"
                />
              </div>
            </div>

            <div className="flex justify-center pt-2">
              <Link href="/log">
                <Button variant="ghost" data-testid="button-log-workout-empty">
                  <Dumbbell className="h-4 w-4 mr-2" />
                  Or just log a workout
                </Button>
              </Link>
            </div>

            <p className="text-xs text-muted-foreground pt-2">
              New to Hyrox? Ask our AI Coach for training recommendations.
            </p>
          </div>
        ) : filterStatus === "all" && selectedPlanId ? (
          <div className="text-center space-y-4">
            <Calendar className="h-12 w-12 mx-auto text-muted-foreground opacity-50" />
            <div>
              <h3 className="font-semibold mb-2">Ready to Start Training</h3>
              <p className="text-muted-foreground text-sm max-w-md mx-auto">
                Set a start date for your plan to schedule workouts on your calendar.
              </p>
            </div>
            <Button
              onClick={() => setSchedulingPlanId(selectedPlanId)}
              data-testid="button-set-start-date"
            >
              <Calendar className="h-4 w-4 mr-2" />
              Set Start Date
            </Button>
          </div>
        ) : (
          <div className="text-center space-y-4">
            <Calendar className="h-12 w-12 mx-auto text-muted-foreground opacity-50" />
            <div>
              <h3 className="font-semibold mb-2">No {filterStatus} workouts</h3>
              <p className="text-muted-foreground text-sm">
                Try adjusting your filter or complete more workouts to see them here.
              </p>
            </div>
            <Button
              variant="outline"
              onClick={() => setFilterStatus("all")}
              data-testid="button-clear-filter"
            >
              Show All
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
