import { Activity, Trophy } from "lucide-react";

import { ExerciseProgressionTab } from "@/components/analytics/ExerciseProgressionTab";
import { PersonalRecordsTab } from "@/components/analytics/PersonalRecordsTab";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

interface ProgressTabProps {
  readonly dateParams: string;
}

/**
 * Combines the personal-records and exercise-progression views under a single
 * top-level analytics tab. Both sub-views are exercise-centric and share the
 * `/api/v1/personal-records` query, so they live together behind an inner
 * segmented toggle (Records shown first) rather than two separate top tabs.
 */
export function ProgressTab({ dateParams }: ProgressTabProps) {
  return (
    <Tabs defaultValue="records" className="w-full">
      <TabsList className="mb-2">
        <TabsTrigger value="records" data-testid="subtab-records">
          <Trophy className="h-4 w-4 mr-2" />
          Records
        </TabsTrigger>
        <TabsTrigger value="progression" data-testid="subtab-progression">
          <Activity className="h-4 w-4 mr-2" />
          Progression
        </TabsTrigger>
      </TabsList>

      <TabsContent value="records" className="space-y-6">
        <PersonalRecordsTab dateParams={dateParams} />
      </TabsContent>

      <TabsContent value="progression" className="space-y-6">
        <ExerciseProgressionTab dateParams={dateParams} />
      </TabsContent>
    </Tabs>
  );
}
