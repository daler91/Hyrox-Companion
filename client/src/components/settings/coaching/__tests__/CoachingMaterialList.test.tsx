import type { CoachingMaterialSummary } from "@shared/schema";
import { render, screen } from "@testing-library/react";
import { createRef } from "react";
import { describe, expect, it, vi } from "vitest";

import { CoachingMaterialList } from "../CoachingMaterialList";

const SUMMARIES: CoachingMaterialSummary[] = [
  {
    id: "m1",
    title: "Principles",
    type: "principles",
    contentLength: 1_400,
    createdAt: null,
    updatedAt: null,
  },
  {
    id: "m2",
    title: "Long read",
    type: "document",
    contentLength: 1_250_000,
    createdAt: null,
    updatedAt: null,
  },
];

vi.mock("@/hooks/useCoachingMaterials", () => ({
  useCoachingMaterials: () => ({ data: SUMMARIES, isLoading: false }),
  useDeleteCoachingMaterial: () => ({ isPending: false, mutate: vi.fn() }),
}));

describe("CoachingMaterialList", () => {
  // PF4 (CODEBASE_ANALYSIS_2026-10-03): the length comes from the server, so
  // the list never downloads a material's text.
  it("shows each material's length from its summary", () => {
    render(
      <CoachingMaterialList
        openPrinciplesDialog={vi.fn()}
        fileInputRef={createRef()}
        handleFileUpload={vi.fn()}
      />,
    );

    expect(screen.getByText("Principles · 1k chars")).toBeInTheDocument();
    expect(screen.getByText("Document · 1250k chars")).toBeInTheDocument();
  });
});
