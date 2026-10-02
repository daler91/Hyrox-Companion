import type { AthleteFact } from "@shared/schema";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { apiRequest } from "@/lib/queryClient";
import { installRadixPointerMocks } from "@/test/support/radixPointerMocks";

import { createMockAthleteFact } from "../../../../../test/factories";
import { AthleteCardSection } from "./AthleteCardSection";

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("@/lib/queryClient", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/queryClient")>()),
  apiRequest: vi.fn(),
  queryClient: { invalidateQueries: vi.fn(() => Promise.resolve()) },
}));

installRadixPointerMocks();

const FRESH = createMockAthleteFact({ id: "f-fresh", fact: "No sled at my gym", reviewOn: "2999-01-01" });
const DUE = createMockAthleteFact({
  id: "f-due",
  fact: "Bad left knee: no deep lunges",
  dedupeKey: "bad left knee: no deep lunges",
  category: "constraint",
  reviewOn: "2020-01-01",
});
const RETIRED = createMockAthleteFact({ id: "f-old", fact: "Sore shoulder", dedupeKey: "sore shoulder", active: false });

function serve(facts: readonly AthleteFact[]) {
  vi.mocked(apiRequest).mockImplementation((method: string, url: string) => {
    const body = method === "GET" && url === "/api/v1/athlete-facts" ? facts : { success: true, added: 1, skipped: 0 };
    return Promise.resolve(new Response(JSON.stringify(body)));
  });
}

function renderCard(legacyNote?: string | null) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <AthleteCardSection legacyNote={legacyNote} />
    </QueryClientProvider>,
  );
}

function expectRequest(method: string, url: string, body?: unknown) {
  return waitFor(() =>
    expect(apiRequest).toHaveBeenCalledWith(method, url, body, expect.anything()),
  );
}

describe("AthleteCardSection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    serve([FRESH, DUE, RETIRED]);
  });

  it("lists a fact due for a check first, asks whether it is still true, and confirms it", async () => {
    const user = userEvent.setup();
    renderCard();

    const list = await screen.findByRole("list", { name: "Facts your coach reads" });
    const rows = within(list).getAllByRole("listitem");
    expect(rows.map((row) => row.querySelector("p")?.textContent)).toEqual([DUE.fact, FRESH.fact]);
    expect(rows[0]).toHaveTextContent("Still true?");
    expect(rows[1]).not.toHaveTextContent("Still true?");

    await user.click(screen.getByRole("button", { name: "Yes, still true" }));
    await expectRequest("PATCH", "/api/v1/athlete-facts/f-due", { confirm: true });
  });

  it("retires a fact, and restores or deletes a retired one", async () => {
    const user = userEvent.setup();
    renderCard();

    await user.click(await screen.findByRole("button", { name: `Retire "${FRESH.fact}"` }));
    await expectRequest("PATCH", "/api/v1/athlete-facts/f-fresh", { active: false });

    await user.click(screen.getByRole("button", { name: "Retired (1)" }));
    await user.click(screen.getByRole("button", { name: `Restore "${RETIRED.fact}"` }));
    await expectRequest("PATCH", "/api/v1/athlete-facts/f-old", { active: true });
    await user.click(screen.getByRole("button", { name: `Delete "${RETIRED.fact}"` }));
    await expectRequest("DELETE", "/api/v1/athlete-facts/f-old");
  });

  it("rewords a fact, sending only what changed", async () => {
    const user = userEvent.setup();
    renderCard();

    await user.click(await screen.findByRole("button", { name: `Edit "${FRESH.fact}"` }));
    const input = screen.getByDisplayValue(FRESH.fact);
    await user.clear(input);
    await user.type(input, "No sled or rower at my gym");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await expectRequest("PATCH", "/api/v1/athlete-facts/f-fresh", { fact: "No sled or rower at my gym" });
  });

  it("adds a fact, about an injury or limit unless the athlete says otherwise", async () => {
    const user = userEvent.setup();
    renderCard();

    await user.type(await screen.findByLabelText("Add a fact"), "  Night shifts on Tuesdays ");
    await user.click(screen.getByRole("button", { name: "Add" }));

    await expectRequest("POST", "/api/v1/athlete-facts", { fact: "Night shifts on Tuesdays", category: "constraint" });
  });

  it("stops adding, and restoring, once the card is full", async () => {
    serve([
      ...Array.from({ length: 20 }, (_, i) =>
        createMockAthleteFact({ id: `f-${i}`, fact: `Fact ${i}`, dedupeKey: `fact ${i}`, reviewOn: "2999-01-01" }),
      ),
      RETIRED,
    ]);
    const user = userEvent.setup();
    renderCard();

    expect(await screen.findByLabelText("Add a fact")).toBeDisabled();
    expect(screen.getByText(/holds up to 20 facts/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Retired (1)" }));
    expect(screen.getByRole("button", { name: `Restore "${RETIRED.fact}"` })).toBeDisabled();
  });

  it("invites the first fact on an empty card", async () => {
    serve([]);
    renderCard();

    expect(await screen.findByText(/Nothing yet/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Retired/ })).not.toBeInTheDocument();
  });

  it("moves the older note onto the card, or removes it once the athlete confirms", async () => {
    const user = userEvent.setup();
    renderCard("  Bad left knee. No sled at my gym.  ");

    const note = await screen.findByRole("region", { name: "Your older injuries note" });
    expect(within(note).getByText("Bad left knee. No sled at my gym.")).toBeInTheDocument();

    await user.click(within(note).getByRole("button", { name: "Add to card" }));
    await expectRequest("POST", "/api/v1/athlete-facts/import", {});

    await user.click(within(note).getByRole("button", { name: "Remove note" }));
    const dialog = await screen.findByRole("alertdialog", { name: "Remove your older note?" });
    await user.click(within(dialog).getByRole("button", { name: "Remove note" }));
    await expectRequest("PATCH", "/api/v1/preferences", { trainingConstraints: null });
  });

  it("shows no note section for an athlete without the older note", async () => {
    renderCard("   ");

    await screen.findByRole("list", { name: "Facts your coach reads" });
    expect(screen.queryByRole("region", { name: "Your older injuries note" })).not.toBeInTheDocument();
  });
});
