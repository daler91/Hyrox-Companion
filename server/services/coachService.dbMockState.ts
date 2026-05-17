import { vi } from "vitest";

const dbMockState = vi.hoisted(() => {
  const deleteWhere = vi.fn().mockResolvedValue(undefined);
  const insertValues = vi.fn().mockResolvedValue(undefined);
  const selectWhere = vi.fn().mockResolvedValue([{ maxSortOrder: 1 }]);
  const selectFrom = vi.fn(() => ({ where: selectWhere }));
  const tx = {
    delete: vi.fn(() => ({ where: deleteWhere })),
    insert: vi.fn(() => ({ values: insertValues })),
    select: vi.fn(() => ({ from: selectFrom })),
  };
  return { deleteWhere, insertValues, selectFrom, selectWhere, tx };
});

export { dbMockState };
