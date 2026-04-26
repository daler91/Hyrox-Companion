import { Download, FileJson, FileSpreadsheet } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export function ExportDataCard() {
  return (
    <Card>
      <CardHeader>
        <CardTitle as="h2" className="flex items-center gap-2">
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
  );
}
