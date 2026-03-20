const fs = require('fs');
const file = 'server/storage/__tests__/workouts.test.ts';
let code = fs.readFileSync(file, 'utf8');

code = code.replace(
  `    const updateWhereMock = vi.fn().mockResolvedValue([]);
    const updateSetMock = vi.fn().mockReturnValue({ where: updateWhereMock });
    vi.mocked(db.update).mockReturnValue({ set: updateSetMock });`,
  `    const updateWhereMock = vi.fn().mockResolvedValue([]);
    const updateFromMock = vi.fn().mockReturnValue({ where: updateWhereMock });
    const updateSetMock = vi.fn().mockReturnValue({ from: updateFromMock });
    vi.mocked(db.update).mockReturnValue({ set: updateSetMock } as any);`
);

code = code.replace(
  `    const updateError = new Error("Database connection dropped during update");
    const updateWhereMock = vi.fn().mockRejectedValue(updateError);
    const updateSetMock = vi.fn().mockReturnValue({ where: updateWhereMock });
    vi.mocked(db.update).mockReturnValue({ set: updateSetMock });`,
  `    const updateError = new Error("Database connection dropped during update");
    const updateWhereMock = vi.fn().mockRejectedValue(updateError);
    const updateFromMock = vi.fn().mockReturnValue({ where: updateWhereMock });
    const updateSetMock = vi.fn().mockReturnValue({ from: updateFromMock });
    vi.mocked(db.update).mockReturnValue({ set: updateSetMock } as any);`
);

code = code.replace(
  `    const updateWhereMock = vi.fn().mockResolvedValue([]);
    const updateSetMock = vi.fn().mockReturnValue({ where: updateWhereMock });
    vi.mocked(db.update).mockReturnValue({ set: updateSetMock });`,
  `    const updateWhereMock = vi.fn().mockResolvedValue([]);
    const updateFromMock = vi.fn().mockReturnValue({ where: updateWhereMock });
    const updateSetMock = vi.fn().mockReturnValue({ from: updateFromMock });
    vi.mocked(db.update).mockReturnValue({ set: updateSetMock } as any);`
);

fs.writeFileSync(file, code);
