import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { chatWithCoach, type ChatMessage } from "./gemini";
import { updatePlanDaySchema, type InsertPlanDay } from "@shared/schema";

interface CSVRow {
  Week: string;
  Day: string;
  Focus: string;
  "Main Workout": string;
  "Accessory/Engine Work": string;
  Notes: string;
}

function parseCSV(csvText: string): CSVRow[] {
  const lines = csvText.trim().split("\n");
  if (lines.length < 2) return [];

  const headers = lines[0].split(",").map((h) => h.trim());
  const rows: CSVRow[] = [];

  for (let i = 1; i < lines.length; i++) {
    const values: string[] = [];
    let current = "";
    let inQuotes = false;

    for (const char of lines[i]) {
      if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === "," && !inQuotes) {
        values.push(current.trim());
        current = "";
      } else {
        current += char;
      }
    }
    values.push(current.trim());

    const row: Record<string, string> = {};
    headers.forEach((header, index) => {
      row[header] = values[index] || "";
    });
    rows.push(row as unknown as CSVRow);
  }

  return rows;
}

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  // Chat endpoint for AI coach
  app.post("/api/chat", async (req, res) => {
    try {
      const { message, history } = req.body as {
        message: string;
        history?: ChatMessage[];
      };

      if (!message || typeof message !== "string") {
        return res.status(400).json({ error: "Message is required" });
      }

      const response = await chatWithCoach(message, history || []);
      res.json({ response });
    } catch (error) {
      console.error("Chat error:", error);
      res.status(500).json({ error: "Failed to get response from AI coach" });
    }
  });

  // List all training plans
  app.get("/api/plans", async (_req, res) => {
    try {
      const plans = await storage.listTrainingPlans();
      res.json(plans);
    } catch (error) {
      console.error("List plans error:", error);
      res.status(500).json({ error: "Failed to list training plans" });
    }
  });

  // Get a specific training plan with all days
  app.get("/api/plans/:id", async (req, res) => {
    try {
      const plan = await storage.getTrainingPlan(req.params.id);
      if (!plan) {
        return res.status(404).json({ error: "Training plan not found" });
      }
      res.json(plan);
    } catch (error) {
      console.error("Get plan error:", error);
      res.status(500).json({ error: "Failed to get training plan" });
    }
  });

  // Import a training plan from CSV
  app.post("/api/plans/import", async (req, res) => {
    try {
      const { csvContent, fileName, planName } = req.body as {
        csvContent: string;
        fileName?: string;
        planName?: string;
      };

      if (!csvContent) {
        return res.status(400).json({ error: "CSV content is required" });
      }

      const rows = parseCSV(csvContent);
      if (rows.length === 0) {
        return res.status(400).json({ error: "No valid rows found in CSV" });
      }

      const weekNumbers = rows.map((r) => parseInt(r.Week)).filter((n) => !isNaN(n) && n > 0);
      if (weekNumbers.length === 0) {
        return res.status(400).json({ error: "No valid week numbers found in CSV" });
      }
      const totalWeeks = Math.max(...weekNumbers);

      const plan = await storage.createTrainingPlan({
        name: planName || fileName?.replace(".csv", "") || "Imported Plan",
        sourceFileName: fileName || null,
        totalWeeks,
      });

      const days: InsertPlanDay[] = rows
        .filter((row) => row.Week && row.Day)
        .map((row) => ({
          planId: plan.id,
          weekNumber: parseInt(row.Week) || 1,
          dayName: row.Day,
          focus: row.Focus || "",
          mainWorkout: row["Main Workout"] || "",
          accessory: row["Accessory/Engine Work"] || null,
          notes: row.Notes || null,
        }));

      await storage.createPlanDays(days);

      const fullPlan = await storage.getTrainingPlan(plan.id);
      res.json(fullPlan);
    } catch (error) {
      console.error("Import plan error:", error);
      res.status(500).json({ error: "Failed to import training plan" });
    }
  });

  // Update a specific day in a plan
  app.patch("/api/plans/:planId/days/:dayId", async (req, res) => {
    try {
      const { dayId } = req.params;

      const parseResult = updatePlanDaySchema.safeParse(req.body);
      if (!parseResult.success) {
        return res.status(400).json({ error: "Invalid update data", details: parseResult.error });
      }

      const updatedDay = await storage.updatePlanDay(dayId, parseResult.data);
      if (!updatedDay) {
        return res.status(404).json({ error: "Day not found" });
      }

      res.json(updatedDay);
    } catch (error) {
      console.error("Update day error:", error);
      res.status(500).json({ error: "Failed to update day" });
    }
  });

  // Delete a training plan
  app.delete("/api/plans/:id", async (req, res) => {
    try {
      const deleted = await storage.deleteTrainingPlan(req.params.id);
      if (!deleted) {
        return res.status(404).json({ error: "Training plan not found" });
      }
      res.json({ success: true });
    } catch (error) {
      console.error("Delete plan error:", error);
      res.status(500).json({ error: "Failed to delete training plan" });
    }
  });

  return httpServer;
}
