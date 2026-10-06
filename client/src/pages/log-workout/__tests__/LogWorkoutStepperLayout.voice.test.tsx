import { act, fireEvent, render, screen } from "@testing-library/react";
import { type ComponentProps, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { WorkoutStep } from "@/hooks/useLogWorkoutDraft";
import { useWorkoutFormVoice } from "@/hooks/workout-form/useWorkoutFormVoice";
import {
  FakeRecognition,
  final,
  interim,
  stubMicrophone,
  unstubMicrophone,
} from "@/test/support/fakeSpeechRecognition";

import { LogWorkoutStepperLayout } from "../LogWorkoutStepperLayout";

type LayoutProps = ComponentProps<typeof LogWorkoutStepperLayout>;

// The steps are stubbed down to the controls this spec drives; the voice
// session, the form state and the stepper's Continue logic are real.
vi.mock("../steps/CaptureStep", () => ({
  CaptureStep: (props: {
    toggleListening: () => void;
    onContinue: () => void;
    isListening: boolean;
  }) => (
    <div data-testid="capture-step">
      <button type="button" onClick={props.toggleListening}>
        {props.isListening ? "Stop dictation" : "Dictate"}
      </button>
      <button type="button" onClick={props.onContinue}>
        Continue to exercises
      </button>
    </div>
  ),
}));
vi.mock("../steps/ConfirmStep", () => ({ ConfirmStep: () => <div data-testid="confirm-step" /> }));
vi.mock("../steps/ReflectStep", () => ({ ReflectStep: () => <div data-testid="reflect-step" /> }));
vi.mock("@/components/workout/WorkoutHeader", () => ({ WorkoutHeader: () => null }));

const parseNow = vi.fn<(text: string) => void>();

function Harness() {
  const [step, setStep] = useState<WorkoutStep>(1);
  const [freeText, setFreeText] = useState("");
  const [notes, setNotes] = useState("");
  const { voiceInput } = useWorkoutFormVoice({ setFreeText, setNotes });
  const props = {
    step,
    setStep,
    freeText,
    setFreeText,
    notes,
    setNotes,
    exerciseBlocks: [],
    exerciseData: {},
    structureBlocks: [],
    autoParsing: false,
    autoParseError: false,
    parseNow,
    isListening: voiceInput.isListening,
    isSupported: voiceInput.isSupported,
    interimTranscript: voiceInput.interimTranscript,
    toggleListening: voiceInput.toggleListening,
    stopListening: voiceInput.stopListening,
  } as Partial<LayoutProps> as LayoutProps;
  return (
    <>
      <LogWorkoutStepperLayout {...props} />
      <output data-testid="free-text">{freeText}</output>
    </>
  );
}

async function startDictating() {
  render(<Harness />);
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Dictate" }));
    await Promise.resolve();
  });
  const recognition = FakeRecognition.instances.at(-1);
  if (!recognition) throw new Error("dictation did not start");
  return recognition;
}

function clickContinue() {
  fireEvent.click(screen.getByRole("button", { name: "Continue to exercises" }));
}

describe("Continue to exercises while dictating (CL30)", () => {
  beforeEach(() => {
    parseNow.mockReset();
    FakeRecognition.instances.length = 0;
    vi.stubGlobal("SpeechRecognition", FakeRecognition);
    stubMicrophone();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    unstubMicrophone();
  });

  it("stops with stop() and parses once the recogniser's final result for the phrase being spoken is in", async () => {
    const recognition = await startDictating();
    // One event finalising the first phrase while the next is still interim.
    recognition.hear(final("3x10 back squat"), interim("5x5 dead"));

    clickContinue();

    expect(recognition.stop).toHaveBeenCalledTimes(1);
    expect(recognition.abort).not.toHaveBeenCalled();
    expect(parseNow).not.toHaveBeenCalled();
    expect(screen.getByTestId("capture-step")).toBeInTheDocument();

    recognition.hear(final("5x5 deadlift"));
    recognition.end();

    expect(parseNow).toHaveBeenCalledTimes(1);
    expect(parseNow).toHaveBeenCalledWith("3x10 back squat 5x5 deadlift");
    expect(screen.getByTestId("confirm-step")).toBeInTheDocument();
    expect(screen.getByTestId("free-text")).toHaveTextContent(/^3x10 back squat 5x5 deadlift$/);
  });

  it("keeps the words on screen when the recogniser ends without finalising them", async () => {
    const recognition = await startDictating();
    recognition.hear(final("3x10 back squat"), interim("5x5 deadlift"));

    clickContinue();
    recognition.end();

    expect(parseNow).toHaveBeenCalledWith("3x10 back squat 5x5 deadlift");
    expect(screen.getByTestId("confirm-step")).toBeInTheDocument();
  });

  it("cuts off a recogniser that never ends and parses the words on screen", async () => {
    const recognition = await startDictating();
    recognition.hear(final("3x10 back squat"), interim("5x5 deadlift"));
    vi.useFakeTimers();

    clickContinue();
    act(() => {
      vi.advanceTimersByTime(1999);
    });
    expect(parseNow).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(recognition.abort).toHaveBeenCalledTimes(1);
    expect(parseNow).toHaveBeenCalledWith("3x10 back squat 5x5 deadlift");

    recognition.hear(final("did you see the game last night"));
    expect(screen.getByTestId("free-text")).toHaveTextContent(/^3x10 back squat 5x5 deadlift$/);
  });

  it("captures nothing said after the session ended into the unseen description", async () => {
    const recognition = await startDictating();
    recognition.hear(final("3x10 back squat"));

    clickContinue();
    recognition.end();
    recognition.hear(final("did you see the game last night"));

    expect(screen.getByTestId("free-text")).toHaveTextContent(/^3x10 back squat$/);
    expect(parseNow).toHaveBeenCalledTimes(1);
    expect(parseNow).toHaveBeenCalledWith("3x10 back squat");
  });

  it("waits for a stop the mic button started just before Continue", async () => {
    const recognition = await startDictating();
    recognition.hear(final("3x10 back squat"), interim("5x5 dead"));
    fireEvent.click(screen.getByRole("button", { name: "Stop dictation" }));

    clickContinue();
    clickContinue();
    expect(parseNow).not.toHaveBeenCalled();

    recognition.hear(final("5x5 deadlift"));
    recognition.end();

    expect(parseNow).toHaveBeenCalledTimes(1);
    expect(parseNow).toHaveBeenCalledWith("3x10 back squat 5x5 deadlift");
    expect(screen.getByTestId("confirm-step")).toBeInTheDocument();
  });

  it("advances straight away when no dictation is running", async () => {
    const recognition = await startDictating();
    recognition.hear(final("3x10 back squat"));
    fireEvent.click(screen.getByRole("button", { name: "Stop dictation" }));
    recognition.end();
    parseNow.mockReset();

    clickContinue();

    expect(parseNow).toHaveBeenCalledWith("3x10 back squat");
    expect(screen.getByTestId("confirm-step")).toBeInTheDocument();
  });
});
