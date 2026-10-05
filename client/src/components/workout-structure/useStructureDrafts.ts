import type { StructureBlockInput, StructureBlockScore } from "@shared/schema";
import { useCallback, useEffect, useState } from "react";

import {
  applyConfigToStructureBlock,
  configToStructureBlock,
  structureBlockToConfig,
} from "./configToStructureBlocks";
import { emomPatternLength, type StepLinkMove } from "./stepLinks";
import type { WorkoutStructureConfig } from "./types";

export interface DraftBlock {
  readonly id: string;
  readonly config: WorkoutStructureConfig;
  /**
   * The block as it was loaded or last saved, with the ids its steps were
   * given; null for a block added here. An untouched block is sent back as
   * exactly this, and an edited one as this with only the edited fields
   * changed (CL14), so the editor never re-sends what it doesn't show.
   */
  readonly source: StructureBlockInput | null;
  readonly sourceStepIds: readonly string[];
  readonly edited: boolean;
}

/**
 * Receives every block after an edit and the steps it renumbered. A returned
 * promise is the save: the editor sends nothing else until it settles, and a
 * rejection shows what is stored again.
 */
export type StructureChangeHandler = (
  next: StructureBlockInput[],
  moves: readonly StepLinkMove[],
) => unknown;

const generateId = () => crypto.randomUUID();

function ignoreRejection(): void {
  // The save's own error handling reports the failure; this only sequences.
}

export function newDraft(config: WorkoutStructureConfig): DraftBlock {
  return { id: config.id ?? generateId(), config, source: null, sourceStepIds: [], edited: true };
}

/** The draft that showed this block before, so its block and step ids carry over. */
function priorDraftFor(
  block: StructureBlockInput,
  idx: number,
  previous: readonly DraftBlock[],
): DraftBlock | undefined {
  if (block.id) return previous.find((draft) => draft.id === block.id);
  const atIndex = previous.at(idx);
  return atIndex?.source && !atIndex.source.id ? atIndex : undefined;
}

/**
 * Drafts for a value that arrived from outside. Each block and step keeps the
 * id the editor gave it before (blocks by id, steps by position), so a server
 * echo or a rollback re-renders the rows instead of remounting them and
 * dropping the focused input (U3, CODEBASE_ANALYSIS_2026-10-03).
 */
function draftsFromValue(
  value: readonly StructureBlockInput[],
  previous: readonly DraftBlock[],
): DraftBlock[] {
  return value.map((block, idx) => {
    const prior = priorDraftFor(block, idx, previous);
    const sourceStepIds = block.steps.map(
      (_, stepIdx) => prior?.config.steps.at(stepIdx)?.id ?? generateId(),
    );
    return {
      id: block.id ?? prior?.id ?? generateId(),
      config: structureBlockToConfig(block, sourceStepIds),
      source: block,
      sourceStepIds,
      edited: false,
    };
  });
}

export function blockFromDraft(draft: DraftBlock, order: number): StructureBlockInput {
  if (!draft.source) {
    return configToStructureBlock(
      { ...draft.config, id: draft.config.id ?? draft.id },
      { sequenceOrder: order, sortOrder: order },
    );
  }
  if (!draft.edited) return draft.source;
  return applyConfigToStructureBlock(draft.source, draft.sourceStepIds, draft.config);
}

function draftsToValue(drafts: readonly DraftBlock[]): StructureBlockInput[] {
  // Stored blocks keep their own order; a block added here goes after them.
  let lastOrder = -1;
  return drafts.map((draft, idx) => {
    const block = blockFromDraft(draft, Math.max(idx, lastOrder + 1));
    lastOrder = Math.max(lastOrder, block.sortOrder ?? idx);
    return block;
  });
}

/**
 * How an edit renumbered a stored block's steps, against the last saved
 * numbering: the steps that moved or went away, and any EMOM step whose minute
 * changed, so its rows' minutes follow (CL15). When the EMOM pattern grew or
 * shrank, every step is reported, since rows in later cycles move with the
 * pattern's length even where their step stayed put. CL15
 * (CODEBASE_ANALYSIS_2026-10-03)
 */
function stepMovesForDraft(draft: DraftBlock, next: StructureBlockInput): StepLinkMove[] {
  const source = draft.source;
  if (!draft.edited || !source?.id) return [];
  const blockId = source.id;
  const positions = new Map(draft.config.steps.map((step, idx) => [step.id, idx + 1]));
  const fromPatternLength = emomPatternLength(source);
  const toPatternLength = emomPatternLength(next);
  const moves: StepLinkMove[] = [];
  source.steps.forEach((step, idx) => {
    const stepId = draft.sourceStepIds.at(idx);
    const toStepNumber = (stepId ? positions.get(stepId) : undefined) ?? null;
    const toStep = toStepNumber === null ? undefined : next.steps.at(toStepNumber - 1);
    const fromMinuteIndex = step.minuteIndex ?? null;
    const toMinuteIndex = toStep?.minuteIndex ?? null;
    const stayed = toStepNumber === step.stepNumber && toMinuteIndex === fromMinuteIndex;
    if (stayed && toPatternLength === fromPatternLength) return;
    moves.push({
      blockId,
      fromStepNumber: step.stepNumber,
      toStepNumber,
      fromMinuteIndex,
      toMinuteIndex,
      fromPatternLength,
      toPatternLength,
    });
  });
  return moves;
}

/**
 * Once a save lands, what it sent is the baseline the next edit's moves are
 * measured from. A draft edited again while the save was out stays edited,
 * now against what was saved.
 */
function rebaseline(
  drafts: readonly DraftBlock[],
  sent: readonly DraftBlock[],
  saved: readonly StructureBlockInput[],
): DraftBlock[] {
  const savedById = new Map<string, { draft: DraftBlock; block: StructureBlockInput }>();
  sent.forEach((draft, idx) => {
    const block = saved.at(idx);
    if (block) savedById.set(draft.id, { draft, block });
  });
  return drafts.map((draft) => {
    const entry = savedById.get(draft.id);
    if (!entry) return draft;
    if (draft === entry.draft && !draft.edited && draft.source === entry.block) return draft;
    return {
      ...draft,
      source: entry.block,
      sourceStepIds: entry.draft.config.steps.map((step) => step.id),
      edited: draft !== entry.draft,
    };
  });
}

function withScore(draft: DraftBlock, score: StructureBlockScore | null): DraftBlock {
  // The score saves on its own route, so it moves the baseline too: a later
  // structure save must carry it rather than the score the block loaded with.
  return {
    ...draft,
    config: { ...draft.config, score },
    source: draft.source ? { ...draft.source, score } : null,
  };
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return typeof (value as { then?: unknown } | null)?.then === "function";
}

interface LiveState {
  drafts: readonly DraftBlock[];
  value: readonly StructureBlockInput[];
  onChange: StructureChangeHandler;
  timer: ReturnType<typeof setTimeout> | null;
  /** A save the owner is still sending. Only one goes out at a time. */
  inFlight: boolean;
  /** An edit made while a save was out, sent once that save settles. */
  queued: boolean;
  /** Whether the latest save landed. */
  lastSaveOk: boolean;
  idleWaiters: ((saved: boolean) => void)[];
}

type RenderedState = Pick<LiveState, "value" | "onChange">;

/** An edit, applied to the drafts as they are when it lands. */
type DraftsUpdate = (drafts: readonly DraftBlock[]) => DraftBlock[];

interface DraftSaver {
  /** Called after each render with the props it rendered. */
  sync: (rendered: RenderedState) => void;
  updateDrafts: (update: DraftsUpdate) => void;
  commit: (update: DraftsUpdate, debounceMs: number) => void;
  flush: () => Promise<boolean>;
  isIdle: () => boolean;
  sendPending: () => void;
}

/**
 * The save side of the builder, kept out of render, and the only writer of the
 * drafts, so a late effect from an older render can't put back drafts a save
 * has since rebaselined. Saves go out one at a time: save N+1 is sent once
 * save N settles, so its moves are measured from what N saved, never from a
 * numbering the server may not have yet, and two replacements of one owner's
 * blocks never overlap (U3, CODEBASE_ANALYSIS_2026-10-03).
 */
function createDraftSaver(
  initialDrafts: DraftBlock[],
  rendered: RenderedState,
  setDrafts: (next: DraftBlock[]) => void,
): DraftSaver {
  const live: LiveState = {
    ...rendered,
    drafts: initialDrafts,
    timer: null,
    inFlight: false,
    queued: false,
    lastSaveOk: true,
    idleWaiters: [],
  };

  const replaceDrafts = (next: DraftBlock[]) => {
    live.drafts = next;
    setDrafts(next);
  };

  const isIdle = () => !live.timer && !live.inFlight && !live.queued;

  // A value that arrives while a save is waiting or out is the echo of an
  // earlier save or a refetch, older than what the athlete sees, so it is only
  // adopted once the editor is idle (U3).
  const adoptValue = () => {
    if (JSON.stringify(live.value) === JSON.stringify(draftsToValue(live.drafts))) return;
    replaceDrafts(draftsFromValue(live.value, live.drafts));
  };

  const settle = (adopt: boolean) => {
    if (!isIdle()) return;
    if (adopt) adoptValue();
    for (const resolve of live.idleWaiters.splice(0)) resolve(live.lastSaveOk);
  };

  const send = (current: readonly DraftBlock[]) => {
    live.queued = false;
    const next = draftsToValue(current);
    const moves = current.flatMap((draft, idx) => {
      const block = next.at(idx);
      return block ? stepMovesForDraft(draft, block) : [];
    });
    const result = live.onChange(next, moves);
    if (!isPromiseLike(result)) {
      // An owner that only keeps the blocks (the /log Confirm step) has nothing in flight.
      live.lastSaveOk = true;
      replaceDrafts(rebaseline(live.drafts, current, next));
      settle(false);
      return;
    }
    live.inFlight = true;
    Promise.resolve(result)
      .then(
        () => {
          live.lastSaveOk = true;
          replaceDrafts(rebaseline(live.drafts, current, next));
        },
        () => {
          // Not rebaselined: the next save is measured from what is stored.
          live.lastSaveOk = false;
        },
      )
      .finally(() => {
        live.inFlight = false;
        if (live.queued) send(live.drafts);
        else settle(true);
      })
      .catch(ignoreRejection);
  };

  const sendOrQueue = () => {
    if (live.inFlight) live.queued = true;
    else send(live.drafts);
  };

  const sendPending = () => {
    if (!live.timer) return;
    clearTimeout(live.timer);
    live.timer = null;
    sendOrQueue();
  };

  // Applied to the live drafts, not the copy the handler rendered with: a save
  // that landed since then rebaselined them, and committing the rendered copy
  // put the old baseline back, so the next save moved rows from a numbering
  // already replaced. CL15 (CODEBASE_ANALYSIS_2026-10-03)
  const commit = (update: DraftsUpdate, debounceMs: number) => {
    replaceDrafts(update(live.drafts));
    if (live.timer) clearTimeout(live.timer);
    live.timer = null;
    if (debounceMs <= 0) {
      sendOrQueue();
      return;
    }
    live.timer = setTimeout(() => {
      live.timer = null;
      sendOrQueue();
    }, debounceMs);
  };

  const flush = () => {
    sendPending();
    if (!live.inFlight && !live.queued) return Promise.resolve(true);
    return new Promise<boolean>((resolve) => {
      live.idleWaiters.push(resolve);
    });
  };

  const sync = (next: RenderedState) => {
    live.onChange = next.onChange;
    if (next.value === live.value) return;
    live.value = next.value;
    if (isIdle()) adoptValue();
  };

  const updateDrafts = (update: DraftsUpdate) => {
    replaceDrafts(update(live.drafts));
  };

  return { sync, updateDrafts, commit, flush, isIdle, sendPending };
}

/**
 * The block builder's working copy of `value`, and its save. Edits land in the
 * drafts at once and reach `onChange` `saveDebounceMs` after the last one (at
 * once when 0). While a save is waiting or out, a new `value` is not adopted:
 * it is the echo of an earlier save or a refetch, older than what the athlete
 * sees, and adopting it lost the digits typed since (U3,
 * CODEBASE_ANALYSIS_2026-10-03). A save still waiting when the editor unmounts
 * is sent then.
 */
export function useStructureDrafts(
  value: readonly StructureBlockInput[],
  onChange: StructureChangeHandler,
  saveDebounceMs: number,
) {
  const [drafts, setDrafts] = useState<DraftBlock[]>(() => draftsFromValue(value, []));
  const [saver] = useState(() => createDraftSaver(drafts, { value, onChange }, setDrafts));

  useEffect(() => {
    saver.sync({ value, onChange });
  });

  const commit = useCallback(
    (update: DraftsUpdate) => {
      saver.commit(update, saveDebounceMs);
    },
    [saver, saveDebounceMs],
  );

  const updateScore = useCallback(
    (draftId: string, score: StructureBlockScore | null) => {
      saver.updateDrafts((current) =>
        current.map((draft) => (draft.id === draftId ? withScore(draft, score) : draft)),
      );
    },
    [saver],
  );

  // Closing the sheet mid-pause sends the edit rather than dropping it, after
  // the save still out when there is one.
  useEffect(
    () => () => {
      saver.sendPending();
    },
    [saver],
  );

  return { drafts, commit, updateScore, flush: saver.flush, isIdle: saver.isIdle };
}
