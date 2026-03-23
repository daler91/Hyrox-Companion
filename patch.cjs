const fs = require('fs');
const content = fs.readFileSync('server/routes/plans.ts', 'utf8');
const search = `    const userId = getUserId(req);
    const fullPlan = await importPlanFromCSV(csvContent, userId, { fileName, planName });
    res.json(fullPlan);
  }));`;
const replace = `    const userId = getUserId(req);
    try {
      const fullPlan = await importPlanFromCSV(csvContent, userId, { fileName, planName });
      res.json(fullPlan);
    } catch (error: any) {
      const log = (req as any).log || console;
      log.error({ err: error }, "Failed to import plan from CSV");
      return res.status(400).json({ error: "Failed to parse CSV content. Please ensure it follows the expected template format.", code: "INVALID_CSV" });
    }
  }));`;

const newContent = content.replace(search, replace);
fs.writeFileSync('server/routes/plans.ts', newContent);
