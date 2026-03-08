import { Router } from "express";
import { isAuthenticated } from "../replitAuth";
import { storage } from "../storage";
import { updatePlanDaySchema, type InsertPlanDay } from "@shared/schema";
import { parse } from "csv-parse/sync";
import { samplePlanDays } from "../samplePlan";

const router = Router();

interface CSVRow {
  Week: string;
  Day: string;
  Focus: string;
  "Main Workout": string;
  "Accessory/Engine Work": string;
  Notes: string;
}

function parseCSV(csvText: string): CSVRow[] {
  try {
    const records = parse(csvText, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
      relax_quotes: true,
      relax_column_count: true,
    });
    return records as CSVRow[];
  } catch (error) {
    console.error("CSV parse error:", error);
    return [];
  }
}

router.get("/api/plans", isAuthenticated, async (req: any, res) => {
  try {
    const userId = req.user.claims.sub;
    const plans = await storage.listTrainingPlans(userId);
    res.json(plans);
  } catch (error) {
    console.error("List plans error:", error);
    res.status(500).json({ error: "Failed to list training plans" });
  }
});

router.get("/api/plans/:id", isAuthenticated, async (req: any, res) => {
  try {
    const userId = req.user.claims.sub;
    const plan = await storage.getTrainingPlan(req.params.id, userId);
    if (!plan) {
      return res.status(404).json({ error: "Training plan not found" });
    }
    res.json(plan);
  } catch (error) {
    console.error("Get plan error:", error);
    res.status(500).json({ error: "Failed to get training plan" });
  }
});

router.post("/api/plans/import", isAuthenticated, async (req: any, res) => {
  try {
    const { csvContent, fileName, planName } = req.body as {
      csvContent: string;
      fileName?: string;
      planName?: string;
    };

    if (!csvContent) {
      return res.status(400).json({ error: "CSV content is required" });
    }

    const userId = req.user.claims.sub;
    const rows = parseCSV(csvContent);
    if (rows.length === 0) {
      return res.status(400).json({ error: "No valid rows found in CSV" });
    }

    const weekNumbers = rows.map((r) => parseInt(r.Week)).filter((n) => !isNaN(n) && n > 0);
    if (weekNumbers.length === 0) {
      return res.status(400).json({ error: "No valid week numbers found in CSV" });
    }
    const uniqueWeeks = new Set(weekNumbers);
    const totalWeeks = uniqueWeeks.size;

    const plan = await storage.createTrainingPlan({
      userId,
      name: planName || fileName?.replace(".csv", "") || "Imported Plan",
      sourceFileName: fileName || null,
      totalWeeks,
    });

    const days: InsertPlanDay[] = rows
      .filter((row) => row.Week && row.Day)
      .map((row) => {
        const accessory = (row as any)["Accessory"] || row["Accessory/Engine Work"] || null;
        return {
          planId: plan.id,
          weekNumber: parseInt(row.Week) || 1,
          dayName: row.Day,
          focus: row.Focus || "",
          mainWorkout: row["Main Workout"] || "",
          accessory,
          notes: row.Notes || null,
        };
      });

    await storage.createPlanDays(days);

    const fullPlan = await storage.getTrainingPlan(plan.id, userId);
    res.json(fullPlan);
  } catch (error) {
    console.error("Import plan error:", error);
    res.status(500).json({ error: "Failed to import training plan" });
  }
});

router.post("/api/plans/sample", isAuthenticated, async (req: any, res) => {
  try {
    const userId = req.user.claims.sub;

    const plan = await storage.createTrainingPlan({
      userId,
      name: "8-Week Hyrox Training Plan",
      sourceFileName: null,
      totalWeeks: 8,
    });

    const days: InsertPlanDay[] = samplePlanDays.map((d) => ({
      planId: plan.id,
      weekNumber: d.week,
      dayName: d.day,
      focus: d.focus,
      mainWorkout: d.main,
      accessory: d.accessory,
      notes: d.notes,
    }));

    await storage.createPlanDays(days);

    const fullPlan = await storage.getTrainingPlan(plan.id, userId);
    res.json(fullPlan);
  } catch (error) {
    console.error("Create sample plan error:", error);
    res.status(500).json({ error: "Failed to create sample plan" });
  }
});

router.patch("/api/plans/:planId/days/:dayId", isAuthenticated, async (req: any, res) => {
  try {
    const { dayId } = req.params;
    const userId = req.user.claims.sub;

    const parseResult = updatePlanDaySchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({ error: "Invalid update data", details: parseResult.error });
    }

    const updatedDay = await storage.updatePlanDay(dayId, parseResult.data, userId);
    if (!updatedDay) {
      return res.status(404).json({ error: "Day not found" });
    }

    res.json(updatedDay);
  } catch (error) {
    console.error("Update day error:", error);
    res.status(500).json({ error: "Failed to update day" });
  }
});

router.patch("/api/plans/days/:dayId", isAuthenticated, async (req: any, res) => {
  try {
    const { dayId } = req.params;
    const userId = req.user.claims.sub;

    const parseResult = updatePlanDaySchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({ error: "Invalid update data", details: parseResult.error });
    }

    if (parseResult.data.mainWorkout !== undefined) {
      const linkedLog = await storage.getWorkoutLogByPlanDayId(dayId, userId);
      if (linkedLog) {
        await storage.deleteExerciseSetsByWorkoutLog(linkedLog.id);
      }
    }

    const updatedDay = await storage.updatePlanDay(dayId, parseResult.data, userId);
    if (!updatedDay) {
      return res.status(404).json({ error: "Day not found" });
    }

    res.json(updatedDay);
  } catch (error) {
    console.error("Update day error:", error);
    res.status(500).json({ error: "Failed to update day" });
  }
});

router.patch("/api/plans/:id", isAuthenticated, async (req: any, res) => {
  try {
    const userId = req.user.claims.sub;
    const { name } = req.body;
    if (!name || typeof name !== "string" || name.trim().length === 0) {
      return res.status(400).json({ error: "Name is required" });
    }
    const updated = await storage.renameTrainingPlan(req.params.id, name.trim(), userId);
    if (!updated) {
      return res.status(404).json({ error: "Training plan not found" });
    }
    res.json(updated);
  } catch (error) {
    console.error("Rename plan error:", error);
    res.status(500).json({ error: "Failed to rename training plan" });
  }
});

router.delete("/api/plans/:id", isAuthenticated, async (req: any, res) => {
  try {
    const userId = req.user.claims.sub;
    const deleted = await storage.deleteTrainingPlan(req.params.id, userId);
    if (!deleted) {
      return res.status(404).json({ error: "Training plan not found" });
    }
    res.json({ success: true });
  } catch (error) {
    console.error("Delete plan error:", error);
    res.status(500).json({ error: "Failed to delete training plan" });
  }
});

router.post("/api/plans/:planId/schedule", isAuthenticated, async (req: any, res) => {
  try {
    const userId = req.user.claims.sub;
    const { planId } = req.params;
    const { startDate } = req.body;

    if (!startDate) {
      return res.status(400).json({ error: "Start date is required" });
    }

    const success = await storage.schedulePlan(planId, startDate, userId);
    if (!success) {
      return res.status(404).json({ error: "Training plan not found" });
    }

    res.json({ success: true });
  } catch (error) {
    console.error("Schedule plan error:", error);
    res.status(500).json({ error: "Failed to schedule training plan" });
  }
});

router.patch("/api/plans/days/:dayId/status", isAuthenticated, async (req: any, res) => {
  try {
    const { dayId } = req.params;
    const userId = req.user.claims.sub;
    const { status, scheduledDate } = req.body as { status?: string; scheduledDate?: string };

    const updates: Record<string, string | null> = {};
    if (status) updates.status = status;
    if (scheduledDate !== undefined) updates.scheduledDate = scheduledDate;

    if (status && status !== "completed") {
      await storage.deleteWorkoutLogByPlanDayId(dayId, userId);
    }

    const updatedDay = await storage.updatePlanDay(dayId, updates, userId);
    if (!updatedDay) {
      return res.status(404).json({ error: "Day not found" });
    }

    res.json(updatedDay);
  } catch (error) {
    console.error("Update day status error:", error);
    res.status(500).json({ error: "Failed to update day status" });
  }
});

router.delete("/api/plans/days/:dayId", isAuthenticated, async (req: any, res) => {
  try {
    const { dayId } = req.params;
    const userId = req.user.claims.sub;
    const deleted = await storage.deletePlanDay(dayId, userId);
    if (!deleted) {
      return res.status(404).json({ error: "Plan day not found" });
    }
    res.json({ success: true });
  } catch (error) {
    console.error("Delete plan day error:", error);
    res.status(500).json({ error: "Failed to delete plan day" });
  }
});

export default router;
