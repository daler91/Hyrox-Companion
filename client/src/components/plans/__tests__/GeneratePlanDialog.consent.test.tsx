import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { GeneratePlanDialog } from "@/components/plans/GeneratePlanDialog";
import { useToast } from "@/hooks/use-toast";
import { QUERY_KEYS } from "@/lib/api";
import * as queryClientLib from "@/lib/queryClient";

vi.mock("@/hooks/use-toast", () => ({ useToast: vi.fn() }));
vi.mock("@/lib/queryClient", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/queryClient")>()),
  apiRequest: vi.fn(),
  queryClient: { invalidateQueries: vi.fn().mockResolvedValue(undefined) },
}));

// Plan generation is consent-gated on the server and every account starts
// with the AI Coach off, so the dialog asks first (onboarding audit C1).
describe("GeneratePlanDialog AI consent", () => {
  const toast = vi.fn();
  const onOpenChange = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useToast).mockReturnValue({ toast } as unknown as ReturnType<typeof useToast>);
    vi.mocked(queryClientLib.apiRequest).mockImplementation(
      async () => new Response(JSON.stringify({ aiCoachEnabled: true })),
    );
  });

  function renderDialog({ aiCoachEnabled = false, prop }: { aiCoachEnabled?: boolean; prop?: boolean } = {}) {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(QUERY_KEYS.authUser, { id: "u-1", aiCoachEnabled });
    return render(
      <QueryClientProvider client={client}>
        <GeneratePlanDialog open onOpenChange={onOpenChange} aiCoachEnabled={prop} />
      </QueryClientProvider>,
    );
  }

  it("asks for consent before the plan steps while the AI Coach is off", () => {
    renderDialog();
    expect(screen.getByRole("button", { name: "Enable AI Coach" })).toBeInTheDocument();
    expect(screen.getByText(/Your recent workout history/)).toBeInTheDocument();
    expect(screen.queryByLabelText("Goal")).not.toBeInTheDocument();
  });

  it("saves the consent and continues to the plan steps", async () => {
    const user = userEvent.setup();
    renderDialog();

    await user.click(screen.getByRole("button", { name: "Enable AI Coach" }));

    expect(await screen.findByLabelText("Goal")).toBeInTheDocument();
    expect(queryClientLib.apiRequest).toHaveBeenCalledWith(
      "PATCH",
      "/api/v1/preferences",
      { aiCoachEnabled: true },
      expect.anything(),
    );
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it("closes without enabling anything on Not now", async () => {
    const user = userEvent.setup();
    renderDialog();

    await user.click(screen.getByRole("button", { name: "Not now" }));

    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(queryClientLib.apiRequest).not.toHaveBeenCalled();
  });

  it("stays on the consent step and says so when enabling fails", async () => {
    const user = userEvent.setup();
    vi.mocked(queryClientLib.apiRequest).mockRejectedValueOnce(new Error("500: boom"));
    renderDialog();

    await user.click(screen.getByRole("button", { name: "Enable AI Coach" }));

    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith(
        expect.objectContaining({ title: "Could not enable AI features", variant: "destructive" }),
      ),
    );
    expect(screen.getByRole("button", { name: "Enable AI Coach" })).toBeInTheDocument();
    expect(screen.queryByLabelText("Goal")).not.toBeInTheDocument();
  });

  it("goes straight to the plan steps when the AI Coach is already on", () => {
    renderDialog({ aiCoachEnabled: true });
    expect(screen.getByLabelText("Goal")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Enable AI Coach" })).not.toBeInTheDocument();
  });

  it("trusts a caller that has just turned the AI Coach on", () => {
    renderDialog({ prop: true });
    expect(screen.getByLabelText("Goal")).toBeInTheDocument();
  });
});
