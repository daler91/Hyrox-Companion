import { ErrorReportingConsentCard } from "./data-tools/ErrorReportingConsentCard";
import { ExportDataCard } from "./data-tools/ExportDataCard";
import { RecycleBinCard } from "./data-tools/RecycleBinCard";
import { StructureOldWorkoutsCard } from "./data-tools/StructureOldWorkoutsCard";
import { useWorkoutReparseTools } from "./data-tools/useWorkoutReparseTools";

export function DataToolsSection() {
  const { unstructuredCount, parseResults, findUnstructuredMutation, batchReparseMutation, reset } =
    useWorkoutReparseTools();

  return (
    <>
      <StructureOldWorkoutsCard
        unstructuredCount={unstructuredCount}
        parseResults={parseResults}
        isFinding={findUnstructuredMutation.isPending}
        isParsing={batchReparseMutation.isPending}
        onFind={() => findUnstructuredMutation.mutate()}
        onParse={() => batchReparseMutation.mutate()}
        onReset={reset}
      />
      <RecycleBinCard />
      <ExportDataCard />
      <ErrorReportingConsentCard />
    </>
  );
}
