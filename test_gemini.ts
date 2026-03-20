import { GoogleGenAI } from "@google/genai";
import { env } from "./server/env";

const ai = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY || "test" });
// just print the structure of generateContent return type
type T = Awaited<ReturnType<typeof ai.models.generateContent>>;
// @ts-ignore
console.log(1);
