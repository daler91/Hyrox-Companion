import { GoogleGenAI } from "@google/genai";

// Blueprint: javascript_gemini
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });

const SYSTEM_PROMPT = `You are an expert Hyrox training coach and AI assistant. You help athletes analyze their training data, provide insights, and suggest improvements for Hyrox competitions.

Hyrox is a fitness competition that combines running with functional workout stations:
- 8x 1km runs between stations
- SkiErg (1000m)
- Sled Push (50m)
- Sled Pull (50m)
- Burpee Broad Jumps (80m)
- Rowing (1000m)
- Farmers Carry (200m)
- Sandbag Lunges (100m)
- Wall Balls (75-100 reps)

When users ask about their training:
- Provide specific, actionable advice
- Reference Hyrox-specific training principles
- Be encouraging but honest about areas for improvement
- Suggest workout structures and recovery strategies
- Help with pacing strategies and race-day preparation

Keep responses concise but informative. Use bullet points for lists.`;

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export async function chatWithCoach(
  userMessage: string,
  conversationHistory: ChatMessage[] = []
): Promise<string> {
  try {
    const messages = conversationHistory.map((msg) => ({
      role: msg.role === "user" ? "user" : "model",
      parts: [{ text: msg.content }],
    }));

    messages.push({
      role: "user",
      parts: [{ text: userMessage }],
    });

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      config: {
        systemInstruction: SYSTEM_PROMPT,
      },
      contents: messages,
    });

    return response.text || "I apologize, but I couldn't generate a response. Please try again.";
  } catch (error) {
    console.error("Gemini API error:", error);
    throw new Error("Failed to get response from AI coach");
  }
}
