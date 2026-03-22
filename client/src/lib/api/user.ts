import { apiRequest } from "@/lib/queryClient";


export async function updatePreferences(prefs: { weightUnit: string; distanceUnit: string }): Promise<any> {
  const response = await apiRequest("PATCH", "/api/v1/preferences", prefs);
  return response.json();
}

export async function connectStrava(): Promise<{ authUrl: string }> {
  const response = await apiRequest("GET", "/api/v1/strava/auth");
  return response.json();
}

export async function disconnectStrava(): Promise<void> {
  await apiRequest("DELETE", "/api/v1/strava/disconnect");
}

export async function syncStrava(): Promise<{ imported: number; skipped: number; total: number }> {
  const response = await apiRequest("POST", "/api/v1/strava/sync");
  return response.json();
}

export async function getStravaStatus(): Promise<any> {
  const response = await apiRequest("GET", "/api/v1/strava/status");
  return response.json();
}
