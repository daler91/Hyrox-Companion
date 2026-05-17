import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect } from "vitest";

export async function renameWorkoutTitleFromHeader(
  testIdPrefix: string,
  typedTitle: string,
): Promise<void> {
  const user = userEvent.setup();
  await user.click(screen.getByTestId(`${testIdPrefix}-edit`));
  await user.clear(screen.getByTestId(`${testIdPrefix}-input`));
  await user.type(screen.getByTestId(`${testIdPrefix}-input`), typedTitle);
  await user.click(screen.getByTestId(`${testIdPrefix}-save`));
}

export function expectWorkoutTitleRename(
  onRenameTitle: unknown,
  entryId: string,
  title: string,
): void {
  expect(onRenameTitle).toHaveBeenCalledWith(
    expect.objectContaining({ id: entryId }),
    title,
  );
}
