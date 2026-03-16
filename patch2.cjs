const fs = require('fs');

let content = fs.readFileSync('server/services/planService.test.ts', 'utf8');

const dbMock = `
vi.mock("../db", () => {
  return {
    db: {
      transaction: vi.fn(),
    },
  };
});
`;

content = content.replace('vi.mock("../storage", () => {', dbMock + '\nvi.mock("../storage", () => {');

const storageMockAdd = `
      getTrainingPlan: vi.fn(),
      updatePlanDay: vi.fn(),
    },
`;

content = content.replace('      getTrainingPlan: vi.fn(),\n    },\n', storageMockAdd);

fs.writeFileSync('server/services/planService.test.ts', content);
