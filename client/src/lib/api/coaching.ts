import { apiRequest } from "@/lib/queryClient";
import type { ChatRequest, InsertCoachingMaterial } from "@shared/schema";

export async function sendChatMessage(msg: { role: string; content: string }): Promise<any> {
  const response = await apiRequest("POST", "/api/v1/chat/message", msg);
  return response.json();
}

export async function streamChat(data: ChatRequest): Promise<Response> {
  const response = await apiRequest("POST", "/api/v1/chat/stream", data);
  return response; // Return raw Response for stream handling
}

export async function sendChat(data: ChatRequest): Promise<any> {
  const response = await apiRequest("POST", "/api/v1/chat", data);
  return response.json();
}

export async function clearChatHistory(): Promise<void> {
  await apiRequest("DELETE", "/api/v1/chat/history");
}

export async function getCoachingMaterials(): Promise<any> {
  const response = await apiRequest("GET", "/api/v1/coaching-materials");
  return response.json();
}

export async function createCoachingMaterial(data: InsertCoachingMaterial): Promise<any> {
  const response = await apiRequest("POST", "/api/v1/coaching-materials", data);
  return response.json();
}

export async function updateCoachingMaterial(id: string | number, data: Partial<InsertCoachingMaterial>): Promise<any> {
  const response = await apiRequest("PATCH", `/api/v1/coaching-materials/${id}`, data);
  return response.json();
}

export async function getRagStatus(): Promise<any> {
  const response = await apiRequest("GET", "/api/v1/coaching-materials/rag-status");
  return response.json();
}

export async function reEmbedCoachingMaterials(): Promise<any> {
  const response = await apiRequest("POST", "/api/v1/coaching-materials/re-embed");
  return response.json();
}

export async function deleteCoachingMaterial(id: string | number): Promise<void> {
  await apiRequest("DELETE", `/api/v1/coaching-materials/${id}`);
}

export async function getSuggestions(): Promise<any> {
  const response = await apiRequest("GET", "/api/v1/chat/suggestions");
  return response.json();
}
