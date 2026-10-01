import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { RagDebugBadge } from "../RagDebugBadge";

describe("RagDebugBadge in production", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("says the reply drew on the athlete's coaching notes, and names them", () => {
    vi.stubEnv("PROD", true);
    render(
      <RagDebugBadge
        ragInfo={{ source: "rag", chunkCount: 3, sources: ["Hyrox pacing notes", "Sled technique"] }}
      />,
    );

    const chip = screen.getByTestId("button-rag-citations");
    expect(chip).toHaveTextContent("From your coaching notes");
    expect(screen.queryByText("Sled technique")).not.toBeInTheDocument();

    fireEvent.click(chip);
    expect(screen.getByText("Hyrox pacing notes")).toBeInTheDocument();
    expect(screen.getByText("Sled technique")).toBeInTheDocument();
  });

  it("shows nothing when the reply didn't use the athlete's materials", () => {
    vi.stubEnv("PROD", true);
    const { container } = render(<RagDebugBadge ragInfo={{ source: "legacy", chunkCount: 0, materialCount: 2 }} />);
    expect(container).toBeEmptyDOMElement();
  });
});
