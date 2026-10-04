import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import Privacy from "../Privacy";

function processorRows(): string[] {
  const table = screen.getByRole("table");
  return within(table)
    .getAllByRole("row")
    .slice(1)
    .map((row) => row.textContent ?? "");
}

// P4 (CODEBASE_ANALYSIS_2026-10-03): the policy had drifted from the
// integrations. It listed one "configured AI provider" and said another
// provider's terms replaced Google's, though photos and embeddings always go to
// Google; it left out the food databases and push services; and its data
// categories omitted the nutrition, body-profile and MAF health data.
describe("Privacy policy", () => {
  it("lists Google as a fixed processor for photos and embeddings, whatever text provider is configured", () => {
    render(<Privacy />);

    const google = processorRows().find((row) => row.startsWith("Google (Gemini API)"));
    expect(google).toMatch(/whichever text provider is configured/);
    expect(google).toMatch(/photos/);
    expect(google).toMatch(/embeddings/);
  });

  it("lists the food databases and browser push services that receive data", () => {
    render(<Privacy />);

    const rows = processorRows();
    expect(rows.some((row) => /Open Food Facts, USDA FoodData Central, Edamam/.test(row))).toBe(true);
    expect(rows.some((row) => /push service/.test(row))).toBe(true);
    expect(rows.find((row) => row.startsWith("Resend"))).toMatch(/coach insights/);
  });

  it("names the nutrition, body-profile and MAF health data it collects", () => {
    render(<Privacy />);

    const categories = screen.getByRole("heading", { name: "1. Data We Collect" }).nextElementSibling
      ?.nextElementSibling as HTMLElement;
    expect(within(categories).getByText("Nutrition")).toBeInTheDocument();
    expect(within(categories).getByText("Body and health profile")).toBeInTheDocument();
    expect(categories).toHaveTextContent(/MAF heart-rate questionnaire/);
  });

  it("lists the export's newer sections instead of claiming it covers 'everything we hold'", () => {
    render(<Privacy />);

    expect(screen.queryByText(/covers everything we hold/)).not.toBeInTheDocument();
    const access = screen.getByText("Access").parentElement as HTMLElement;
    for (const section of ["nutrition log", "heart-rate", "MAF tests", "weekly reviews", "consent records"]) {
      expect(access).toHaveTextContent(new RegExp(section));
    }
  });
});
