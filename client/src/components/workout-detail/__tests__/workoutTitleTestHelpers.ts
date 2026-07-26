import { fireEvent, screen } from "@testing-library/react";
import { expect } from "vitest";

export function renameWorkoutTitleFromHeader(
  testIdPrefix: string,
  typedTitle: string,
): void {
  fireEvent.click(screen.getByTestId(`${testIdPrefix}-edit`));
  fireEvent.change(screen.getByTestId(`${testIdPrefix}-input`), {
    target: { value: typedTitle },
  });
  fireEvent.click(screen.getByTestId(`${testIdPrefix}-save`));
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
