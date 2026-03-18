const fs = require('fs');
const filePath = 'client/src/hooks/__tests__/useWorkoutActions.test.tsx';
let content = fs.readFileSync(filePath, 'utf8');

// The failure is likely because queryClient.setQueryData is called but not mocked.
// Let's add it to the mock of @/lib/queryClient
content = content.replace(
  /queryClient: {\n\s+invalidateQueries: vi\.fn\(\),\n\s+},/,
  `queryClient: {\n    invalidateQueries: vi.fn(),\n    setQueryData: vi.fn(),\n  },`
);

fs.writeFileSync(filePath, content, 'utf8');
