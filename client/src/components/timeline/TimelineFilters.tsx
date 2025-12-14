import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Upload, Loader2, Filter } from "lucide-react";
import type { TrainingPlan } from "@shared/schema";
import type { FilterStatus } from "./types";

interface TimelineFiltersProps {
  plans: TrainingPlan[];
  plansLoading: boolean;
  selectedPlanId: string | null;
  onPlanChange: (planId: string) => void;
  filterStatus: FilterStatus;
  onFilterChange: (status: FilterStatus) => void;
  onFileUpload: (event: React.ChangeEvent<HTMLInputElement>) => void;
  isImporting: boolean;
}

export default function TimelineFilters({
  plans,
  plansLoading,
  selectedPlanId,
  onPlanChange,
  filterStatus,
  onFilterChange,
  onFileUpload,
  isImporting,
}: TimelineFiltersProps) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center">
          <div className="flex-1">
            <Label htmlFor="plan-select" className="text-sm text-muted-foreground mb-2 block">
              Active Training Plan
            </Label>
            {plansLoading ? (
              <div className="flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" />
                <span className="text-sm text-muted-foreground">Loading plans...</span>
              </div>
            ) : plans.length > 0 ? (
              <Select
                value={selectedPlanId || ""}
                onValueChange={(value) => onPlanChange(value)}
              >
                <SelectTrigger id="plan-select" data-testid="select-plan">
                  <SelectValue placeholder="Select a training plan" />
                </SelectTrigger>
                <SelectContent>
                  {plans.map((plan) => (
                    <SelectItem key={plan.id} value={plan.id}>
                      {plan.name} ({plan.totalWeeks} weeks)
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <p className="text-sm text-muted-foreground">No plans yet. Import one below.</p>
            )}
          </div>

          <div className="flex gap-2 flex-wrap">
            <Select value={filterStatus} onValueChange={(v) => onFilterChange(v as FilterStatus)}>
              <SelectTrigger className="w-36" data-testid="select-filter">
                <Filter className="h-4 w-4 mr-2" />
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                <SelectItem value="completed">Completed</SelectItem>
                <SelectItem value="planned">Planned</SelectItem>
                <SelectItem value="missed">Missed</SelectItem>
                <SelectItem value="skipped">Skipped</SelectItem>
              </SelectContent>
            </Select>

            <Label htmlFor="csv-upload" className="cursor-pointer">
              <Button
                variant="outline"
                className="pointer-events-none"
                disabled={isImporting}
              >
                {isImporting ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <>
                    <Upload className="h-4 w-4 mr-2" />
                    Import CSV
                  </>
                )}
              </Button>
            </Label>
            <Input
              id="csv-upload"
              type="file"
              accept=".csv"
              className="hidden"
              onChange={onFileUpload}
              data-testid="input-csv-upload"
            />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
