import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { FirstRunStarter } from "./FirstRunStarter";

function renderStarter(hasTarget = false) {
  const onDescribe = vi.fn();
  const onScanBarcode = vi.fn();
  const onSetTargets = vi.fn();
  render(
    <FirstRunStarter
      onDescribe={onDescribe}
      onScanBarcode={onScanBarcode}
      onSetTargets={onSetTargets}
      hasTarget={hasTarget}
    />,
  );
  return { onDescribe, onScanBarcode, onSetTargets };
}

describe("FirstRunStarter", () => {
  it("leads with describe-a-meal and wires each action", async () => {
    const user = userEvent.setup();
    const { onDescribe, onScanBarcode, onSetTargets } = renderStarter();

    await user.click(screen.getByTestId("starter-describe-meal"));
    expect(onDescribe).toHaveBeenCalledTimes(1);

    await user.click(screen.getByTestId("starter-scan-barcode"));
    expect(onScanBarcode).toHaveBeenCalledTimes(1);

    await user.click(screen.getByTestId("starter-set-targets"));
    expect(onSetTargets).toHaveBeenCalledTimes(1);
  });

  it("drops the set-targets pitch once a target exists", () => {
    renderStarter(true);
    expect(screen.queryByTestId("starter-set-targets")).not.toBeInTheDocument();
    expect(screen.getByTestId("starter-describe-meal")).toBeInTheDocument();
  });
});
