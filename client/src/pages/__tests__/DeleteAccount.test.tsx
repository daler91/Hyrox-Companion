import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import DeleteAccount from "../DeleteAccount";

// Google Play links to this page for account-deletion requests, so it must
// name the app, give the steps, and say what is deleted and what is kept.
describe("Delete account page", () => {
  it("names the app and gives the steps, ending with the DELETE confirmation", () => {
    render(<DeleteAccount />);

    expect(screen.getByRole("heading", { level: 1, name: "Delete your fitai.coach account" })).toBeInTheDocument();
    const steps = screen.getByRole("heading", { name: "How to delete your account" }).nextElementSibling as HTMLElement;
    expect(within(steps).getAllByRole("listitem")).toHaveLength(4);
    expect(steps).toHaveTextContent(/Type DELETE to confirm/);
  });

  it("says what is deleted and the one thing that is kept", () => {
    render(<DeleteAccount />);

    const deleted = screen.getByRole("heading", { name: "What is deleted" }).parentElement as HTMLElement;
    expect(deleted).toHaveTextContent(/Health Connect/);
    expect(deleted).toHaveTextContent(/AI Coach conversations/);
    const kept = screen.getByRole("heading", { name: "What is kept" }).nextElementSibling as HTMLElement;
    expect(kept).toHaveTextContent(/share publicly/);
  });

  it("links to the privacy policy and offers Back as a single link", () => {
    render(<DeleteAccount />);

    expect(screen.getByRole("link", { name: "privacy policy" })).toHaveAttribute("href", "/privacy");
    expect(screen.getByRole("link", { name: "Back" })).toHaveAttribute("href", "/");
  });
});
