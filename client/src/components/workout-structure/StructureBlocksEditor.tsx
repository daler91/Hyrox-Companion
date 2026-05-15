import type { StructureBlockInput, StructureBlockScore } from "@shared/schema";
import { useCallback, useState } from "react";

import { Button } from "@/components/ui/button";

import { configToStructureBlock, structureBlockToConfig } from "./configToStructureBlocks";
import { UNASSIGNED_WORK_STEP_LABEL, type WorkoutStructureConfig } from "./types";
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
  id: generateId(),
  section: "main",
  blockType: "emom",
  emomDurationMinutes: 10,
  emomAlternating: false,
  steps: [{ id: generateId(), type: "work", exercise: UNASSIGNED_WORK_STEP_LABEL }],
});

const emptyAmrapConfig = (): WorkoutStructureConfig => ({
  id: generateId(),
  section: "main",
  blockType: "amrap",
  timeCapMinutes: 10,
  steps: [{ id: generateId(), type: "work", exercise: UNASSIGNED_WORK_STEP_LABEL }],
});

const emptyRoundsConfig = (): WorkoutStructureConfig => ({
  id: generateId(),
  section: "main",
  blockType: "rounds",
  roundCount: 3,
  steps: [{ id: generateId(), type: "work", exercise: UNASSIGNED_WORK_STEP_LABEL }],
});

function normalizeValue(value: StructureBlockInput[] | undefined): readonly StructureBlockInput[] {
  return Array.isArray(value) ? value : EMPTY_STRUCTURE_BLOCKS;
}

function draftsFromValue(value: readonly StructureBlockInput[]): DraftBlock[] {
  return value.map((block) => ({ id: block.id ?? generateId(), config: structureBlockToConfig(block) }));
}

function draftsToValue(drafts: readonly DraftBlock[]): StructureBlockInput[] {
  return drafts.map((draft, idx) =>
    configToStructureBlock(
      { ...draft.config, id: draft.config.id ?? draft.id },
      { sequenceOrder: idx, sortOrder: idx },
    ),
  );
}

export function StructureBlocksEditor({ value, onChange, showScoreControls = false, onScoreChange }: Props) {
  const normalizedValue = normalizeValue(value);
  const [drafts, setDrafts] = useState<DraftBlock[]>(() => draftsFromValue(normalizedValue));
  const [trackedValue, setTrackedValue] = useState(normalizedValue);
  // Keep the format picker tucked away until the user opts in — most
  // workouts are plain per-set tables and don't need a structured block,
  // so three add buttons shouldn't greet every athlete by default.
  const [addOpen, setAddOpen] = useState(false);

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

  const hasBlocks = drafts.length > 0;

  return (
    <div className="space-y-3" data-testid="structure-blocks-editor">
      <div>
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Structured blocks
        </p>
        <p className="text-xs text-muted-foreground">
          EMOM, AMRAP, or fixed-round formats that don&apos;t fit the per-set table.
        </p>
      </div>

      {hasBlocks
        ? drafts.map((draft, idx) => (
            <div key={draft.id} className="space-y-2" data-testid={`structure-block-${idx}`}>
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-muted-foreground">
                  Block {idx + 1} · {draft.config.blockType.toUpperCase()}
                </span>
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
        : null}

      {hasBlocks || addOpen ? (
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleAddEmom}
            data-testid="structure-blocks-add-emom"
          >
            + EMOM
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleAddAmrap}
            data-testid="structure-blocks-add-amrap"
          >
            + AMRAP
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleAddRounds}
            data-testid="structure-blocks-add-rounds"
          >
            + Rounds
          </Button>
        </div>
      ) : (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setAddOpen(true)}
          data-testid="structure-blocks-add-toggle"
        >
          + Add structured block
        </Button>
      )}
    </div>
  );
}
