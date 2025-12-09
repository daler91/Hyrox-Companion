import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { chatWithCoach, type ChatMessage } from "./gemini";

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

  return httpServer;
}
