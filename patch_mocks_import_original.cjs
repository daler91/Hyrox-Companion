const fs = require('fs');

function replaceInFile(filePath, replacements) {
  let content = fs.readFileSync(filePath, 'utf8');
  for (const [search, replace] of replacements) {
    if (typeof search === 'string') {
        content = content.split(search).join(replace);
    } else {
        content = content.replace(search, replace);
    }
  }
  fs.writeFileSync(filePath, content, 'utf8');
  console.log(`Patched ${filePath}`);
}

replaceInFile('client/src/hooks/__tests__/useWorkoutActions.test.tsx', [
  [
    `vi.mock('@/lib/queryClient', () => ({
  apiRequest: vi.fn(),
  queryClient: {
    invalidateQueries: vi.fn(),
    setQueryData: vi.fn(),
  },
}));`,
    `vi.mock('@/lib/queryClient', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    apiRequest: vi.fn(),
    queryClient: {
      invalidateQueries: vi.fn(),
      setQueryData: vi.fn(),
    },
  };
});`
  ]
]);

replaceInFile('client/src/hooks/__tests__/useWorkoutForm.test.tsx', [
  [
    `vi.mock('@/lib/queryClient', () => ({
  apiRequest: vi.fn(),
  queryClient: {
    invalidateQueries: vi.fn(),
  },
}));`,
    `vi.mock('@/lib/queryClient', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    apiRequest: vi.fn(),
    queryClient: {
      invalidateQueries: vi.fn(),
    },
  };
});`
  ]
]);
