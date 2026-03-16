const fs = require('fs');

const content = fs.readFileSync('server/services/planService.test.ts', 'utf8');

const importReplacement = `import { importPlanFromCSV, validateAndMapCSVRows, createSamplePlan, updatePlanDayWithCleanup } from "./planService";
import { db } from "../db";
import { eq, and } from "drizzle-orm";
import { exerciseSets, planDays, trainingPlans, workoutLogs } from "@shared/schema";`;

const newContent = content.replace('import { importPlanFromCSV, validateAndMapCSVRows, createSamplePlan } from "./planService";', importReplacement);

fs.writeFileSync('server/services/planService.test.ts', newContent);
