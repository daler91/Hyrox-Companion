import { CHAT_STATUS_STEPS, type ChatStatusStep } from "@shared/chat";

/**
 * What the chat shows while a reply is on its way (AI coach chat review, I11):
 * "reading" until the server accepts the send (it reads the athlete's training
 * before it answers), then the steps the server reports.
 */
export type ChatProgress = ChatStatusStep | "reading";

const STATUS_STEPS: ReadonlySet<string> = new Set(CHAT_STATUS_STEPS);

export function isChatStatusStep(value: unknown): value is ChatStatusStep {
  return typeof value === "string" && STATUS_STEPS.has(value);
}

/** The words for a step, shown beside the typing dots. */
export function chatProgressLabel(progress: ChatProgress | null): string {
  switch (progress) {
    case "reading":
      return "Reading your training log...";
    case "drafting_plan":
      return "Checking your plan...";
    case "looking_up_workouts":
      return "Looking through your workouts...";
    case "looking_up_exercises":
      return "Checking your exercise history...";
    case "looking_up_records":
      return "Checking your personal records...";
    case "searching_notes":
      return "Searching your coaching notes...";
    default:
      return "Thinking...";
  }
}
