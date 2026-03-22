const fs = require('fs');

function patchFile(filePath, fromObj, toObj) {
  let content = fs.readFileSync(filePath, 'utf8');
  content = content.replace(fromObj, toObj);
  fs.writeFileSync(filePath, content);
}

// In server/routes/ai.ts
patchFile(
  'server/routes/ai.ts',
  'async (req: ExpressRequest<{}, any, z.infer<typeof parseExercisesRequestSchema>>, res: Response) => {',
  'async (req: ExpressRequest<Record<string, never>, any, z.infer<typeof parseExercisesRequestSchema>>, res: Response) => {'
);
patchFile(
  'server/routes/ai.ts',
  'async (req: ExpressRequest<{}, any, z.infer<typeof chatRequestSchema>>, res: Response) => {',
  'async (req: ExpressRequest<Record<string, never>, any, z.infer<typeof chatRequestSchema>>, res: Response) => {'
);
patchFile(
  'server/routes/ai.ts',
  'async (req: ExpressRequest<{}, any, z.infer<typeof chatRequestSchema>>, res: Response) => {',
  'async (req: ExpressRequest<Record<string, never>, any, z.infer<typeof chatRequestSchema>>, res: Response) => {'
);
patchFile(
  'server/routes/ai.ts',
  'async (req: ExpressRequest<{}, any, InsertChatMessage>, res: Response) => {',
  'async (req: ExpressRequest<Record<string, never>, any, InsertChatMessage>, res: Response) => {'
);
