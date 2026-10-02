import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { FactProposalCard } from "../FactProposalCard";

const OFFER = { fact: "No sled at my gym", category: "equipment" as const, status: "pending" as const };

describe("FactProposalCard", () => {
  it("offers the fact for the card, and passes on the athlete's answer", async () => {
    const user = userEvent.setup();
    const onDecide = vi.fn();
    render(<FactProposalCard messageId="reply-1" proposal={OFFER} onDecide={onDecide} />);

    const card = screen.getByRole("region", { name: "Save to your athlete card?" });
    expect(card).toHaveTextContent("“No sled at my gym”");
    expect(card).toHaveTextContent("(Equipment)");

    await user.click(screen.getByRole("button", { name: "Save to card" }));
    await user.click(screen.getByRole("button", { name: "Not now" }));
    expect(onDecide.mock.calls).toEqual([
      ["reply-1", "save"],
      ["reply-1", "dismiss"],
    ]);
  });

  it("says where a saved fact went, and shows nothing once turned down", () => {
    const { rerender } = render(<FactProposalCard messageId="reply-1" proposal={{ ...OFFER, status: "saved" }} onDecide={vi.fn()} />);
    expect(screen.getByTestId("fact-proposal-saved")).toHaveTextContent("Saved to your athlete card");
    expect(screen.queryByRole("button")).not.toBeInTheDocument();

    rerender(<FactProposalCard messageId="reply-1" proposal={{ ...OFFER, status: "dismissed" }} onDecide={vi.fn()} />);
    expect(screen.queryByTestId("fact-proposal-saved")).not.toBeInTheDocument();
    expect(screen.queryByTestId("fact-proposal")).not.toBeInTheDocument();
  });
});
