import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { GeneratePlanDialog } from "@/components/plans/GeneratePlanDialog";
import { useToast } from "@/hooks/use-toast";
import { useGeneratePlan } from "@/hooks/usePlanGeneration";
import { QUERY_KEYS } from "@/lib/api";
import { apiRequest } from "@/lib/queryClient";

vi.mock("@/hooks/use-toast", () => ({ useToast: vi.fn() }));
vi.mock("@/hooks/usePlanGeneration", () => ({ useGeneratePlan: vi.fn() }));
vi.mock("@/lib/queryClient", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/queryClient")>()),
  apiRequest: vi.fn(),
  queryClient: { invalidateQueries: vi.fn(() => Promise.resolve()) },
}));

// CL47 (CODEBASE_ANALYSIS_2026-10-03): the dialog refused to close while a plan
// generated, so a job that never settled held the athlete until a reload.
describe("GeneratePlanDialog while a plan generates", () => {
  const toast = vi.fn();
  const onOpenChange = vi.fn();
  const reset = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useToast).mockReturnValue({ toast } as unknown as ReturnType<typeof useToast>);
    vi.mocked(apiRequest).mockImplementation(() => Promise.resolve(new Response("[]")));
  });

  function renderDialog(isPending: boolean) {
    vi.mocked(useGeneratePlan).mockReturnValue({ mutate: vi.fn(), isPending, reset });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(QUERY_KEYS.authUser, { id: "u-1", aiCoachEnabled: true });
    return render(
      <QueryClientProvider client={client}>
        <GeneratePlanDialog open onOpenChange={onOpenChange} aiCoachEnabled />
      </QueryClientProvider>,
    );
  }

  it("closes, keeps the generation going, and says where the plan will appear", async () => {
    const user = userEvent.setup();
    renderDialog(true);
    expect(screen.getByText(/You can close this window/)).toBeInTheDocument();

    await user.keyboard("{Escape}");

    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(reset).not.toHaveBeenCalled();
    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Your plan is still generating" }),
    );
  });

  it("resets the form and the generation state when closed with nothing in flight", async () => {
    const user = userEvent.setup();
    renderDialog(false);

    await user.keyboard("{Escape}");

    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(reset).toHaveBeenCalledTimes(1);
    expect(toast).not.toHaveBeenCalled();
  });
});
