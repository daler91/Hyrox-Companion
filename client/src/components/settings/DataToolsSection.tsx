import { ExportDataCard } from "./data-tools/ExportDataCard";
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
      <ExportDataCard />
    </>
  );
}
