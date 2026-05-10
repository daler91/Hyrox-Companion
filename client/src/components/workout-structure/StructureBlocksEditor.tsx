import type { StructureBlockInput, StructureBlockScore } from "@shared/schema";
import { useCallback, useState } from "react";

import { Button } from "@/components/ui/button";

import { configToStructureBlock, structureBlockToConfig } from "./configToStructureBlocks";
import type { WorkoutStructureConfig } from "./types";
import { WorkoutStructureEditor } from "./WorkoutStructureEditor";

interface DraftBlock {
  readonly id: string;
  readonly config: WorkoutStructureConfig;
}

interface Props {
  readonly value?: StructureBlockInput[];
  readonly onChange: (next: StructureBlockInput[]) => void;
  readonly showScoreControls?: boolean;
  readonly onScoreChange?: (blockId: string, score: StructureBlockScore | null) => void;
}

const generateId = () => crypto.randomUUID();
const EMPTY_STRUCTURE_BLOCKS: readonly StructureBlockInput[] = [];

const emptyEmomConfig = (): WorkoutStructureConfig => ({
  section: "main",
  blockType: "emom",
  emomDurationMinutes: 10,
  emomAlternating: false,
  steps: [{ id: generateId(), type: "work" }],
});

const emptyAmrapConfig = (): WorkoutStructureConfig => ({
  section: "main",
  blockType: "amrap",
  timeCapMinutes: 10,
  steps: [{ id: generateId(), type: "work" }],
});

const emptyRoundsConfig = (): WorkoutStructureConfig => ({
  section: "main",
  blockType: "rounds",
  roundCount: 3,
  steps: [{ id: generateId(), type: "work" }],
});

function normalizeValue(value: StructureBlockInput[] | undefined): readonly StructureBlockInput[] {
  return Array.isArray(value) ? value : EMPTY_STRUCTURE_BLOCKS;
}

function draftsFromValue(value: readonly StructureBlockInput[]): DraftBlock[] {
  return value.map((block) => ({ id: generateId(), config: structureBlockToConfig(block) }));
}

function draftsToValue(drafts: readonly DraftBlock[]): StructureBlockInput[] {
  return drafts.map((draft, idx) =>
    configToStructureBlock(draft.config, { sequenceOrder: idx, sortOrder: idx }),
  );
}

export function StructureBlocksEditor({ value, onChange, showScoreControls = false, onScoreChange }: Props) {
  const normalizedValue = normalizeValue(value);
  const [drafts, setDrafts] = useState<DraftBlock[]>(() => draftsFromValue(normalizedValue));
  const [trackedValue, setTrackedValue] = useState(normalizedValue);

  // Re-hydrate drafts only when the external `value` reference changes AND
  // its serialized form differs from what our drafts would emit. This keeps
  // step IDs stable across re-renders (so inputs don't lose focus) while
  // still picking up out-of-band updates such as legacy-EMOM conversion.
  if (normalizedValue !== trackedValue) {
    setTrackedValue(normalizedValue);
    const externalSnapshot = JSON.stringify(normalizedValue);
    const localSnapshot = JSON.stringify(draftsToValue(drafts));
    if (externalSnapshot !== localSnapshot) {
      setDrafts(draftsFromValue(normalizedValue));
    }
  }

  const commit = useCallback(
    (next: DraftBlock[]) => {
      setDrafts(next);
      onChange(draftsToValue(next));
    },
    [onChange],
  );

  const handleAddEmom = useCallback(() => {
    commit([...drafts, { id: generateId(), config: emptyEmomConfig() }]);
  }, [commit, drafts]);

  const handleAddAmrap = useCallback(() => {
    commit([...drafts, { id: generateId(), config: emptyAmrapConfig() }]);
  }, [commit, drafts]);

  const handleAddRounds = useCallback(() => {
    commit([...drafts, { id: generateId(), config: emptyRoundsConfig() }]);
  }, [commit, drafts]);

  const handleUpdateBlock = useCallback(
    (id: string, next: WorkoutStructureConfig) => {
      commit(drafts.map((draft) => (draft.id === id ? { ...draft, config: next } : draft)));
    },
    [commit, drafts],
  );

  const handleUpdateScore = useCallback(
    (draftId: string, blockId: string, score: StructureBlockScore | null) => {
      setDrafts((prev) =>
        prev.map((draft) =>
          draft.id === draftId ? { ...draft, config: { ...draft.config, score } } : draft,
        ),
      );
      onScoreChange?.(blockId, score);
    },
    [onScoreChange],
  );

  const handleRemoveBlock = useCallback(
    (id: string) => {
      commit(drafts.filter((draft) => draft.id !== id));
    },
    [commit, drafts],
  );

  return (
    <div className="space-y-3" data-testid="structure-blocks-editor">
      {drafts.length === 0 ? (
        <div className="rounded-md border border-dashed border-border bg-muted/20 px-3 py-4 text-sm text-muted-foreground">
          No structured blocks yet. Add an EMOM (or other format) below to record interval-based work.
        </div>
      ) : (
        drafts.map((draft, idx) => (
          <div key={draft.id} className="space-y-2" data-testid={`structure-block-${idx}`}>
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-muted-foreground">Block {idx + 1}</span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => handleRemoveBlock(draft.id)}
                data-testid={`structure-block-remove-${idx}`}
              >
                Remove
              </Button>
            </div>
            <WorkoutStructureEditor
              value={draft.config}
              onChange={(next) => handleUpdateBlock(draft.id, next)}
              showScoreControls={showScoreControls}
              onScoreChange={onScoreChange ? (blockId, score) => handleUpdateScore(draft.id, blockId, score) : undefined}
            />
          </div>
        ))
      )}
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={handleAddEmom}
          data-testid="structure-blocks-add-emom"
        >
          + Add EMOM block
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={handleAddAmrap}
          data-testid="structure-blocks-add-amrap"
        >
          + Add AMRAP block
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={handleAddRounds}
          data-testid="structure-blocks-add-rounds"
        >
          + Add Rounds block
        </Button>
      </div>
    </div>
  );
}
