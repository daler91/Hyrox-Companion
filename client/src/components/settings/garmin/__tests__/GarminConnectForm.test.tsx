import "@testing-library/jest-dom/vitest";

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { GarminConnectForm } from "../GarminConnectForm";

function renderForm(overrides: Partial<React.ComponentProps<typeof GarminConnectForm>> = {}) {
  const props = {
    email: "",
    onEmailChange: vi.fn(),
    password: "",
    onPasswordChange: vi.fn(),
    garminLoading: false,
    isConnecting: false,
    onConnect: vi.fn(),
    ...overrides,
  };
  render(<GarminConnectForm {...props} />);
  return props;
}

describe("GarminConnectForm", () => {
  it("marks email and password as required for assistive tech", () => {
    renderForm();
    for (const id of ["input-garmin-email", "input-garmin-password"]) {
      const input = screen.getByTestId(id);
      expect(input).toBeRequired();
      expect(input).toHaveAttribute("aria-required", "true");
    }
  });

  it("disables Connect until both email and password are filled", () => {
    const base = {
      onEmailChange: vi.fn(),
      onPasswordChange: vi.fn(),
      garminLoading: false,
      isConnecting: false,
      onConnect: vi.fn(),
    };
    const { rerender } = render(<GarminConnectForm {...base} email="" password="" />);
    const button = () => screen.getByTestId("button-connect-garmin");
    expect(button()).toBeDisabled();

    rerender(<GarminConnectForm {...base} email="a@b.co" password="" />);
    expect(button()).toBeDisabled();
    rerender(<GarminConnectForm {...base} email="" password="pw" />);
    expect(button()).toBeDisabled();
    rerender(<GarminConnectForm {...base} email="a@b.co" password="pw" />);
    expect(button()).toBeEnabled();
  });

  it("disables inputs and Connect and flags busy while connecting", () => {
    renderForm({ email: "a@b.co", password: "pw", isConnecting: true });
    expect(screen.getByTestId("input-garmin-email")).toBeDisabled();
    expect(screen.getByTestId("input-garmin-password")).toBeDisabled();
    expect(screen.getByTestId("button-connect-garmin")).toBeDisabled();
    expect(screen.getByTestId("button-connect-garmin")).toHaveAttribute("aria-busy", "true");
  });

  it("disables everything while the Garmin status is loading", () => {
    renderForm({ email: "a@b.co", password: "pw", garminLoading: true });
    expect(screen.getByTestId("input-garmin-email")).toBeDisabled();
    expect(screen.getByTestId("button-connect-garmin")).toBeDisabled();
  });

  it("reports typed values and calls onConnect when enabled", async () => {
    const user = userEvent.setup();
    const props = renderForm({ email: "a@b.co", password: "pw" });

    await user.type(screen.getByTestId("input-garmin-email"), "x");
    expect(props.onEmailChange).toHaveBeenCalledWith("a@b.cox");
    await user.type(screen.getByTestId("input-garmin-password"), "y");
    expect(props.onPasswordChange).toHaveBeenCalledWith("pwy");

    await user.click(screen.getByTestId("button-connect-garmin"));
    expect(props.onConnect).toHaveBeenCalledTimes(1);
  });
});
