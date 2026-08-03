import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { Toaster } from "@/components/ui/toaster";
import { __resetToastStateForTests } from "@/hooks/use-toast";
import { api } from "@/lib/api";
import { BANANA } from "@/test/factories/foodFactory";
import { installRadixPointerMocks } from "@/test/support/radixPointerMocks";
import { renderWithClient } from "@/test/support/renderWithClient";

import { FavoriteStarButton } from "./FavoriteStarButton";

vi.mock("@/lib/api", () => ({
  api: {
    nutrition: {
      listFavorites: vi.fn(),
      addFavorite: vi.fn(),
      removeFavorite: vi.fn(),
    },
  },
  QUERY_KEYS: { nutritionFavorites: ["/api/v1/nutrition/favorites"] },
}));

const STARRED = { ...BANANA, lastQuantityG: 140, lastMealType: "breakfast" as const };

function renderStar() {
  return renderWithClient(<FavoriteStarButton foodId="f1" foodName="Banana" />);
}

describe("FavoriteStarButton", () => {
  installRadixPointerMocks();

  beforeEach(() => {
    vi.clearAllMocks();
    // Toasts live in a module-level singleton that survives unmounts; drop any
    // toast a previous test raised so it can't re-render under this test's
    // <Toaster /> and trip a not.toBeInTheDocument() assertion.
    __resetToastStateForTests();
  });

  it("stars a food that isn't yet a favourite", async () => {
    vi.mocked(api.nutrition.listFavorites).mockResolvedValue([]);
    vi.mocked(api.nutrition.addFavorite).mockResolvedValue({ success: true });
    const user = userEvent.setup();
    renderStar();

    await user.click(screen.getByTestId("favorite-toggle-f1"));

    await waitFor(() => {
      expect(api.nutrition.addFavorite).toHaveBeenCalledWith({ foodId: "f1" });
    });
  });

  it("un-stars a food that is already a favourite", async () => {
    vi.mocked(api.nutrition.listFavorites).mockResolvedValue([STARRED]);
    vi.mocked(api.nutrition.removeFavorite).mockResolvedValue({ success: true });
    const user = userEvent.setup();
    renderStar();

    await waitFor(() => {
      expect(screen.getByTestId("favorite-toggle-f1")).toHaveAttribute("aria-pressed", "true");
    });
    await user.click(screen.getByTestId("favorite-toggle-f1"));

    await waitFor(() => {
      expect(api.nutrition.removeFavorite).toHaveBeenCalledWith("f1");
    });
  });

  it("flips the star before the write lands", async () => {
    vi.mocked(api.nutrition.listFavorites).mockResolvedValue([]);
    // Never resolves: the star must not wait on the network to look pressed.
    vi.mocked(api.nutrition.addFavorite).mockReturnValue(new Promise(() => {}));
    const user = userEvent.setup();
    renderStar();

    const button = screen.getByTestId("favorite-toggle-f1");
    expect(button).toHaveAttribute("aria-pressed", "false");

    await user.click(button);

    expect(button).toHaveAttribute("aria-pressed", "true");
  });

  it("treats un-starring something already gone as success", async () => {
    vi.mocked(api.nutrition.listFavorites).mockResolvedValue([STARRED]);
    // The DELETE route 404s when the row was already removed elsewhere.
    vi.mocked(api.nutrition.removeFavorite).mockRejectedValue(new Error("404: Favorite not found"));
    const user = userEvent.setup();
    renderWithClient(
      <>
        <FavoriteStarButton foodId="f1" foodName="Banana" />
        <Toaster />
      </>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("favorite-toggle-f1")).toHaveAttribute("aria-pressed", "true");
    });
    await user.click(screen.getByTestId("favorite-toggle-f1"));

    await waitFor(() => {
      expect(api.nutrition.removeFavorite).toHaveBeenCalled();
    });
    // A stale toggle is not a failure the athlete needs to hear about.
    expect(screen.queryByText("Couldn't update your favourites")).not.toBeInTheDocument();
  });

  it("does surface a real failure", async () => {
    vi.mocked(api.nutrition.listFavorites).mockResolvedValue([]);
    vi.mocked(api.nutrition.addFavorite).mockRejectedValue(new Error("500: boom"));
    const user = userEvent.setup();
    renderWithClient(
      <>
        <FavoriteStarButton foodId="f1" foodName="Banana" />
        <Toaster />
      </>,
    );

    await user.click(screen.getByTestId("favorite-toggle-f1"));

    expect(await screen.findByText("Couldn't update your favourites")).toBeInTheDocument();
  });

  it("surfaces a real failure when un-starring, not just a stale-404 success", async () => {
    vi.mocked(api.nutrition.listFavorites).mockResolvedValue([STARRED]);
    vi.mocked(api.nutrition.removeFavorite).mockRejectedValue(new Error("500: boom"));
    const user = userEvent.setup();
    renderWithClient(
      <>
        <FavoriteStarButton foodId="f1" foodName="Banana" />
        <Toaster />
      </>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("favorite-toggle-f1")).toHaveAttribute("aria-pressed", "true");
    });
    await user.click(screen.getByTestId("favorite-toggle-f1"));

    expect(await screen.findByText("Couldn't update your favourites")).toBeInTheDocument();
    // The optimistic flip rolled back — the star still reads as favourited.
    await waitFor(() => {
      expect(screen.getByTestId("favorite-toggle-f1")).toHaveAttribute("aria-pressed", "true");
    });
  });
});
