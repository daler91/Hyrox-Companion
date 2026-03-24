import "@testing-library/jest-dom";
import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { ChatMessage } from "../ChatMessage";

describe("ChatMessage", () => {
  it("renders a user message correctly", () => {
    render(<ChatMessage role="user" content="Hello, world!" />);
    expect(screen.getByText("Hello, world!")).toBeInTheDocument();
  });

  it("renders an assistant message correctly", () => {
    render(<ChatMessage role="assistant" content="How can I help you today?" />);
    expect(screen.getByText("How can I help you today?")).toBeInTheDocument();
  });

  it("applies correct styling for user messages", () => {
    render(<ChatMessage role="user" content="Test styling" />);
    const messageContainer = screen.getByTestId("message-user");
    expect(messageContainer).toHaveClass("flex-row-reverse");

    // Check if the actual text container has the correct background
    const textContainer = screen.getByText("Test styling").parentElement;
    expect(textContainer).toHaveClass("bg-primary");
    expect(textContainer).toHaveClass("text-primary-foreground");
  });

  it("applies correct styling for assistant messages", () => {
    render(<ChatMessage role="assistant" content="Test styling" />);
    const messageContainer = screen.getByTestId("message-assistant");
    expect(messageContainer).not.toHaveClass("flex-row-reverse");

    // Check if the actual text container has the correct background
    const textContainer = screen.getByText("Test styling").parentElement;
    expect(textContainer).toHaveClass("bg-card");
    expect(textContainer).toHaveClass("border");
  });

  it("renders timestamp when provided", () => {
    render(<ChatMessage role="user" content="Time check" timestamp="10:30 AM" />);
    expect(screen.getByText("10:30 AM")).toBeInTheDocument();
  });

  it("does not render timestamp when omitted", () => {
    render(<ChatMessage role="user" content="No time" />);
    const timestampElements = screen.queryByText(/AM|PM|\d{1,2}:\d{2}/);
    expect(timestampElements).not.toBeInTheDocument();
  });
});
