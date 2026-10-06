import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  FakeRecognition,
  final,
  interim,
  stubMicrophone,
  unstubMicrophone,
} from "@/test/support/fakeSpeechRecognition";

import { useWorkoutForm } from "../useWorkoutForm";
import type { UseWorkoutFormProps } from "../workout-form/types";

const mocks = vi.hoisted(() => ({
  createWorkout: vi.fn(),
  navigate: vi.fn(),
  toast: vi.fn(),
}));

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    api: { ...actual.api, workouts: { ...actual.api.workouts, create: mocks.createWorkout } },
  };
});
vi.mock("@/lib/workoutInvalidation", () => ({ invalidateWorkoutWriteQueries: vi.fn() }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: mocks.toast }) }));
vi.mock("wouter", () => ({ useLocation: () => ["/log", mocks.navigate] }));

const props: UseWorkoutFormProps = {
  useTextMode: true,
  exerciseBlocks: [],
  exerciseData: {},
  structureBlocks: [],
  weightLabel: "kg",
  distanceUnit: "km",
  initialValues: { title: "Squats", date: "2026-10-06", freeText: "5x5 back squat" },
};

function renderForm() {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return renderHook(() => useWorkoutForm(props), { wrapper });
}

type FormResult = ReturnType<typeof renderForm>["result"];

/** Start the notes dictation, as the Reflect step's mic button does. */
async function dictateNotes(result: FormResult): Promise<FakeRecognition> {
  await act(async () => {
    await result.current.notesVoiceInput.startListening();
  });
  const recognition = FakeRecognition.instances.at(-1);
  if (!recognition) throw new Error("dictation did not start");
  return recognition;
}

/** The notes the saved workout carried, or undefined when nothing was sent. */
function savedNotes(): unknown {
  const [payload] = mocks.createWorkout.mock.calls.at(-1) ?? [];
  return (payload as { notes?: unknown } | undefined)?.notes;
}

// CL54 (CODEBASE_ANALYSIS_2026-10-03): Save built the payload as it stopped
// dictation, before the recogniser delivered its final result, so the phrase
// on screen as interim text was not saved.
describe("Save while dictating", () => {
  beforeEach(() => {
    mocks.createWorkout.mockReset();
    mocks.createWorkout.mockResolvedValue({ id: "w-1", newPersonalRecords: [] });
    FakeRecognition.instances.length = 0;
    vi.stubGlobal("SpeechRecognition", FakeRecognition);
    stubMicrophone();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    unstubMicrophone();
  });

  it("waits for the recogniser's final result and saves the last phrase", async () => {
    const { result } = renderForm();
    const recognition = await dictateNotes(result);
    recognition.hear(final("Felt strong"), interim("legs heavy"));

    act(() => {
      result.current.handleSave();
    });

    expect(recognition.stop).toHaveBeenCalledTimes(1);
    expect(recognition.abort).not.toHaveBeenCalled();
    expect(mocks.createWorkout).not.toHaveBeenCalled();

    recognition.hear(final("legs heavy on the last set"));
    recognition.end();

    await vi.waitFor(() => {
      expect(mocks.createWorkout).toHaveBeenCalledTimes(1);
    });
    expect(savedNotes()).toBe("Felt strong legs heavy on the last set");
  });

  it("saves the words on screen when the recogniser never delivers them", async () => {
    const { result } = renderForm();
    const recognition = await dictateNotes(result);
    recognition.hear(final("Felt strong"), interim("legs heavy"));
    vi.useFakeTimers();

    act(() => {
      result.current.handleSave();
    });
    act(() => {
      vi.advanceTimersByTime(1999);
    });
    expect(mocks.createWorkout).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(1);
    });
    vi.useRealTimers();

    await vi.waitFor(() => {
      expect(mocks.createWorkout).toHaveBeenCalledTimes(1);
    });
    expect(recognition.abort).toHaveBeenCalledTimes(1);
    expect(savedNotes()).toBe("Felt strong legs heavy");
  });

  it("saves once however often Save is tapped while it waits", async () => {
    const { result } = renderForm();
    const recognition = await dictateNotes(result);
    recognition.hear(interim("legs heavy"));

    act(() => {
      result.current.handleSave();
      result.current.handleSave();
    });
    recognition.end();

    await vi.waitFor(() => {
      expect(mocks.createWorkout).toHaveBeenCalledTimes(1);
    });
    expect(savedNotes()).toBe("legs heavy");
  });

  it("saves straight away when nothing is dictating", async () => {
    const { result } = renderForm();

    act(() => {
      result.current.handleSave();
    });

    await vi.waitFor(() => {
      expect(mocks.createWorkout).toHaveBeenCalledTimes(1);
    });
    expect(FakeRecognition.instances).toHaveLength(0);
    expect(mocks.createWorkout).toHaveBeenCalledWith(
      expect.objectContaining({ mainWorkout: "5x5 back squat", notes: null }),
      expect.anything(),
    );
  });
});
